"""微软正版验证路由。"""
import secrets
import time
import urllib.parse

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from fastapi.responses import Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import User, Player, Texture, Wardrobe, SiteSetting
from app.services.auth import decode_jwt
from app.services.microsoft_auth import MicrosoftAuthService, download_texture
from app.utils.image import save_texture

router = APIRouter(prefix="/api/microsoft", tags=["microsoft"])

_security = HTTPBearer(auto_error=False)


async def _get_jwt_user_id(creds: HTTPAuthorizationCredentials = Depends(_security)) -> int:
    """从 JWT 获取 user_id"""
    if not creds:
        raise HTTPException(status_code=401, detail="missing bearer token")
    payload = decode_jwt(creds.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="invalid or expired token")
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="invalid token")
    return int(user_id)


# OAuth state 临时存储（生产环境应使用 Redis）
_oauth_states: dict[str, dict] = {}


@router.get("/auth-url")
async def microsoft_get_auth_url(user_id: int = Depends(_get_jwt_user_id), db: AsyncSession = Depends(get_db)):
    """获取微软 OAuth 授权 URL"""
    client_id_row = (await db.execute(
        select(SiteSetting).where(SiteSetting.key == "microsoft_client_id")
    )).scalar_one_or_none()
    client_secret_row = (await db.execute(
        select(SiteSetting).where(SiteSetting.key == "microsoft_client_secret")
    )).scalar_one_or_none()

    client_id = client_id_row.value if client_id_row else ""
    client_secret = client_secret_row.value if client_secret_row else ""

    if not client_id:
        raise HTTPException(status_code=500, detail="Microsoft OAuth not configured. Please contact administrator.")
    if not client_secret:
        raise HTTPException(status_code=500, detail="Microsoft OAuth client_secret not configured.")

    state = secrets.token_urlsafe(32)
    _oauth_states[state] = {
        "user_id": user_id,
        "expires_at": time.time() + 600,
    }

    redirect_uri_row = (await db.execute(
        select(SiteSetting).where(SiteSetting.key == "microsoft_redirect_uri")
    )).scalar_one_or_none()
    default_redirect = settings.site_url.rstrip("/") + "/microsoft/callback"
    redirect_uri = redirect_uri_row.value if redirect_uri_row else default_redirect

    service = MicrosoftAuthService(client_id, client_secret, redirect_uri)
    auth_url = service.get_authorization_url(state)

    return {"auth_url": auth_url, "state": state}


@router.get("/callback")
async def microsoft_callback(
    code: str = None, state: str = None, error: str = None,
    db: AsyncSession = Depends(get_db),
):
    """微软 OAuth 回调端点"""
    if error:
        frontend_url = settings.site_url
        error_encoded = urllib.parse.quote(str(error))
        return Response(status_code=302, headers={"Location": f"{frontend_url}/dashboard/roles?error={error_encoded}"})

    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing code or state parameter")

    if state not in _oauth_states:
        raise HTTPException(status_code=400, detail="Invalid state parameter")

    session_data = _oauth_states[state]
    if time.time() > session_data["expires_at"]:
        del _oauth_states[state]
        raise HTTPException(status_code=400, detail="State expired")

    user_id = session_data["user_id"]
    del _oauth_states[state]

    client_id_row = (await db.execute(
        select(SiteSetting).where(SiteSetting.key == "microsoft_client_id")
    )).scalar_one_or_none()
    client_secret_row = (await db.execute(
        select(SiteSetting).where(SiteSetting.key == "microsoft_client_secret")
    )).scalar_one_or_none()

    client_id = client_id_row.value if client_id_row else ""
    client_secret = client_secret_row.value if client_secret_row else ""

    redirect_uri_row = (await db.execute(
        select(SiteSetting).where(SiteSetting.key == "microsoft_redirect_uri")
    )).scalar_one_or_none()
    default_redirect = settings.site_url.rstrip("/") + "/microsoft/callback"
    redirect_uri = redirect_uri_row.value if redirect_uri_row else default_redirect

    try:
        service = MicrosoftAuthService(client_id, client_secret, redirect_uri)
        token_data = await service.exchange_code_for_token(code)
        ms_access_token = token_data["access_token"]
        profile = await service.complete_auth_flow(ms_access_token)

        if not profile.get("profile"):
            raise Exception("No Minecraft Java Edition profile found for this account.")

        temp_token = secrets.token_urlsafe(32)
        _oauth_states[temp_token] = {
            "user_id": user_id,
            "profile": profile,
            "expires_at": time.time() + 300,
        }

        frontend_url = settings.site_url
        return Response(
            status_code=302,
            headers={"Location": f"{frontend_url.rstrip('/')}/dashboard/roles?ms_token={temp_token}"},
        )

    except Exception as e:
        frontend_url = settings.site_url
        error_msg = str(e).replace("\n", " ")
        error_encoded = urllib.parse.quote(error_msg)
        return Response(
            status_code=302,
            headers={"Location": f"{frontend_url.rstrip('/')}/dashboard/roles?error={error_encoded}"},
        )


@router.post("/get-profile")
async def microsoft_get_profile(
    body: dict = Body(...),
    user_id: int = Depends(_get_jwt_user_id),
):
    """使用临时 token 获取 profile 数据"""
    ms_token = body.get("ms_token", "")

    if ms_token not in _oauth_states:
        raise HTTPException(status_code=400, detail="Invalid or expired token")

    session_data = _oauth_states[ms_token]
    if time.time() > session_data["expires_at"]:
        del _oauth_states[ms_token]
        raise HTTPException(status_code=400, detail="Token expired")

    if session_data["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="Unauthorized")

    profile = session_data["profile"]
    del _oauth_states[ms_token]

    return {
        "profile": {
            "id": profile["profile"]["id"],
            "name": profile["profile"]["name"],
            "skins": profile["profile"].get("skins", []),
            "capes": profile["profile"].get("capes", []),
        },
        "has_game": profile.get("has_game", False),
    }


@router.post("/import-profile")
async def microsoft_import_profile(
    data: dict,
    user_id: int = Depends(_get_jwt_user_id),
    db: AsyncSession = Depends(get_db),
):
    """导入正版角色"""
    profile_id = data.get("profile_id")
    profile_name = data.get("profile_name")
    skin_url = data.get("skin_url")
    skin_variant = data.get("skin_variant", "classic")
    cape_url = data.get("cape_url")

    if not profile_id or not profile_name:
        raise HTTPException(status_code=400, detail="Missing required fields")

    existing = (await db.execute(select(Player).where(Player.name == profile_name))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail=f"Profile name '{profile_name}' already exists")

    skin_tex_id = None
    skin_hash = None
    cape_tex_id = None
    cape_hash = None

    # 下载并保存皮肤
    if skin_url:
        try:
            skin_data = await download_texture(skin_url)
            skin_hash = save_texture(skin_data, kind="skin")
            existing_skin = (await db.execute(select(Texture).where(Texture.hash == skin_hash))).scalar_one_or_none()
            if not existing_skin:
                tex = Texture(
                    hash=skin_hash, type="skin",
                    model="slim" if skin_variant == "slim" else "classic",
                    name=f"From Microsoft account - {profile_name}",
                    is_public=False, uploader_id=user_id,
                )
                db.add(tex)
                await db.flush()
                skin_tex_id = tex.id
            else:
                skin_tex_id = existing_skin.id

            already = (await db.execute(
                select(Wardrobe).where(Wardrobe.user_id == user_id, Wardrobe.texture_id == skin_tex_id)
            )).scalar_one_or_none()
            if not already:
                db.add(Wardrobe(user_id=user_id, texture_id=skin_tex_id))
        except Exception as e:
            print(f"Failed to download skin: {e}")

    # 下载并保存披风
    if cape_url:
        try:
            cape_data = await download_texture(cape_url)
            cape_hash = save_texture(cape_data, kind="cape")
            existing_cape = (await db.execute(select(Texture).where(Texture.hash == cape_hash))).scalar_one_or_none()
            if not existing_cape:
                tex = Texture(
                    hash=cape_hash, type="cape", model="classic",
                    name=f"From Microsoft account - {profile_name}",
                    is_public=False, uploader_id=user_id,
                )
                db.add(tex)
                await db.flush()
                cape_tex_id = tex.id
            else:
                cape_tex_id = existing_cape.id

            already = (await db.execute(
                select(Wardrobe).where(Wardrobe.user_id == user_id, Wardrobe.texture_id == cape_tex_id)
            )).scalar_one_or_none()
            if not already:
                db.add(Wardrobe(user_id=user_id, texture_id=cape_tex_id))
        except Exception as e:
            print(f"Failed to download cape: {e}")

    # 创建角色
    texture_model = "slim" if skin_variant == "slim" else "default"
    player = Player(
        uuid=profile_id.replace("-", ""),
        name=profile_name,
        owner_id=user_id,
        skin_texture_id=skin_tex_id,
        cape_texture_id=cape_tex_id,
    )
    db.add(player)
    await db.commit()

    return {
        "ok": True,
        "profile": {
            "id": profile_id,
            "name": profile_name,
            "model": texture_model,
            "skin_hash": skin_hash,
            "cape_hash": cape_hash,
        },
    }
