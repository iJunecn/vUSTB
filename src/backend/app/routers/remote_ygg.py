"""远程 Yggdrasil 皮肤站导入 — 从 element-skin profile_import_backend 搬运，适配 SQLAlchemy。

允许用户从其他 Yggdrasil 皮肤站导入角色和材质到本站。
"""
import base64
import json
import logging

import aiohttp
from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User, Player, Texture, Wardrobe
from app.services.auth import decode_jwt
from app.services.microsoft_auth import download_texture
from app.utils.image import save_texture

logger = logging.getLogger("vustb.remote-ygg")

router = APIRouter(prefix="/api/remote-ygg", tags=["remote-ygg"])

_security = HTTPBearer(auto_error=False)


async def _get_jwt_user_id(creds: HTTPAuthorizationCredentials = Depends(_security)) -> int:
    if not creds:
        raise HTTPException(status_code=401, detail="missing bearer token")
    payload = decode_jwt(creds.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="invalid or expired token")
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="invalid token")
    return int(user_id)


async def _authenticate_remote(api_url: str, username: str, password: str) -> dict:
    """在远程 Yggdrasil 皮肤站进行身份验证"""
    auth_url = api_url.rstrip("/") + "/authserver/authenticate"
    payload = {
        "username": username,
        "password": password,
        "agent": {"name": "Minecraft", "version": 1},
        "requestUser": True,
    }
    async with aiohttp.ClientSession() as session:
        async with session.post(auth_url, json=payload, timeout=aiohttp.ClientTimeout(total=10)) as resp:
            if resp.status == 200:
                return await resp.json()
            else:
                try:
                    error_data = await resp.json()
                    error_msg = error_data.get("errorMessage", f"HTTP {resp.status}")
                except Exception:
                    error_msg = f"HTTP {resp.status}"
                raise HTTPException(status_code=400, detail=f"远程认证失败: {error_msg}")


async def _get_remote_profile(api_url: str, uuid: str) -> dict:
    """获取远程角色的材质信息"""
    profile_url = api_url.rstrip("/") + f"/sessionserver/session/minecraft/profile/{uuid.replace('-', '')}"
    async with aiohttp.ClientSession() as session:
        async with session.get(profile_url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
            if resp.status == 200:
                data = await resp.json()
                return _parse_remote_textures(data)
            elif resp.status == 204:
                raise HTTPException(status_code=404, detail="远程角色未找到")
            else:
                raise HTTPException(status_code=400, detail=f"获取远程角色失败: HTTP {resp.status}")


def _parse_remote_textures(profile_data: dict) -> dict:
    """从远程角色属性中解析材质信息"""
    properties = profile_data.get("properties", [])
    textures_base64 = None
    for prop in properties:
        if prop.get("name") == "textures":
            textures_base64 = prop.get("value")
            break

    if not textures_base64:
        return {
            "id": profile_data.get("id"),
            "name": profile_data.get("name"),
            "skins": [],
            "capes": [],
        }

    try:
        textures_json = json.loads(base64.b64decode(textures_base64).decode("utf-8"))
        textures = textures_json.get("textures", {})

        skins = []
        if "SKIN" in textures:
            skin_data = textures["SKIN"]
            skins.append({
                "url": skin_data.get("url"),
                "variant": skin_data.get("metadata", {}).get("model", "classic"),
            })

        capes = []
        if "CAPE" in textures:
            capes.append({"url": textures["CAPE"].get("url")})

        return {
            "id": profile_data.get("id"),
            "name": profile_data.get("name"),
            "skins": skins,
            "capes": capes,
        }
    except Exception as e:
        logger.error(f"Error parsing remote textures: {e}")
        return {
            "id": profile_data.get("id"),
            "name": profile_data.get("name"),
            "skins": [],
            "capes": [],
        }


@router.post("/get-profiles")
async def get_remote_profiles(
    body: dict = Body(...),
    user_id: int = Depends(_get_jwt_user_id),
):
    """从远程 Yggdrasil 皮肤站获取角色列表"""
    api_url = body.get("api_url", "")
    username = body.get("username", "")
    password = body.get("password", "")

    if not api_url or not username or not password:
        raise HTTPException(status_code=400, detail="api_url, username and password required")

    auth_result = await _authenticate_remote(api_url, username, password)
    profiles = auth_result.get("availableProfiles", [])
    return {"profiles": profiles}


@router.post("/import-profile")
async def import_remote_profile(
    body: dict = Body(...),
    user_id: int = Depends(_get_jwt_user_id),
    db: AsyncSession = Depends(get_db),
):
    """从远程 Yggdrasil 皮肤站导入单个角色"""
    api_url = body.get("api_url", "")
    profile_id = body.get("profile_id", "")
    profile_name = body.get("profile_name", "")

    if not api_url or not profile_id or not profile_name:
        raise HTTPException(status_code=400, detail="api_url, profile_id and profile_name required")

    # 检查角色名是否已存在
    existing = (await db.execute(select(Player).where(Player.name == profile_name))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail=f"角色名 '{profile_name}' 已存在")

    # 获取远程角色的材质信息
    remote_profile = await _get_remote_profile(api_url, profile_id)

    skin_tex_id = None
    cape_tex_id = None

    # 导入皮肤
    for skin in remote_profile.get("skins", []):
        skin_url = skin.get("url")
        if skin_url:
            try:
                skin_data = await download_texture(skin_url)
                skin_hash = save_texture(skin_data, kind="skin")
                skin_variant = skin.get("variant", "classic")
                existing_tex = (await db.execute(
                    select(Texture).where(Texture.hash == skin_hash)
                )).scalar_one_or_none()
                if existing_tex:
                    skin_tex_id = existing_tex.id
                else:
                    tex = Texture(
                        hash=skin_hash, type="skin",
                        model="slim" if skin_variant == "slim" else "classic",
                        name=f"Imported from remote - {profile_name}",
                        is_public=False, uploader_id=user_id,
                    )
                    db.add(tex)
                    await db.flush()
                    skin_tex_id = tex.id
                # 加入衣柜
                already = (await db.execute(
                    select(Wardrobe).where(Wardrobe.user_id == user_id, Wardrobe.texture_id == skin_tex_id)
                )).scalar_one_or_none()
                if not already:
                    db.add(Wardrobe(user_id=user_id, texture_id=skin_tex_id))
            except Exception as e:
                logger.error(f"Failed to download skin from remote: {e}")

    # 导入披风
    for cape in remote_profile.get("capes", []):
        cape_url = cape.get("url")
        if cape_url:
            try:
                cape_data = await download_texture(cape_url)
                cape_hash = save_texture(cape_data, kind="cape")
                existing_tex = (await db.execute(
                    select(Texture).where(Texture.hash == cape_hash)
                )).scalar_one_or_none()
                if existing_tex:
                    cape_tex_id = existing_tex.id
                else:
                    tex = Texture(
                        hash=cape_hash, type="cape", model="classic",
                        name=f"Imported from remote - {profile_name}",
                        is_public=False, uploader_id=user_id,
                    )
                    db.add(tex)
                    await db.flush()
                    cape_tex_id = tex.id
                already = (await db.execute(
                    select(Wardrobe).where(Wardrobe.user_id == user_id, Wardrobe.texture_id == cape_tex_id)
                )).scalar_one_or_none()
                if not already:
                    db.add(Wardrobe(user_id=user_id, texture_id=cape_tex_id))
            except Exception as e:
                logger.error(f"Failed to download cape from remote: {e}")

    # 创建角色
    import uuid as uuid_lib
    player = Player(
        uuid=profile_id.replace("-", "") if len(profile_id.replace("-", "")) == 32 else uuid_lib.uuid4().hex,
        name=profile_name,
        owner_id=user_id,
        skin_texture_id=skin_tex_id,
        cape_texture_id=cape_tex_id,
    )
    db.add(player)
    await db.commit()

    return {"id": player.uuid, "name": player.name}


@router.post("/import-profiles")
async def import_remote_profiles(
    body: dict = Body(...),
    user_id: int = Depends(_get_jwt_user_id),
    db: AsyncSession = Depends(get_db),
):
    """从远程 Yggdrasil 皮肤站批量导入角色"""
    api_url = body.get("api_url", "")
    profiles = body.get("profiles", [])

    if not api_url or not profiles:
        raise HTTPException(status_code=400, detail="api_url and profiles required")

    success_count = 0
    failure_count = 0
    failed = []

    for p in profiles:
        try:
            profile_id = p.get("profile_id", "")
            profile_name = p.get("profile_name", "")
            if not profile_id or not profile_name:
                failure_count += 1
                failed.append({"profile_id": profile_id, "profile_name": profile_name, "detail": "missing fields"})
                continue
            # 递归调用单个导入
            import_result = await import_remote_profile(
                body={"api_url": api_url, "profile_id": profile_id, "profile_name": profile_name},
                user_id=user_id,
                db=db,
            )
            success_count += 1
        except Exception as e:
            failure_count += 1
            failed.append({"profile_id": p.get("profile_id", ""), "profile_name": p.get("profile_name", ""), "detail": str(e)})

    return {
        "items": [{"id": "", "name": ""}],  # placeholder
        "success_count": success_count,
        "failure_count": failure_count,
        "failed": failed,
    }
