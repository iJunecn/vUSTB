"""Yggdrasil 协议路由（authlib-injector 兼容）

实现端点：
- GET  /skinapi/                                Yggdrasil meta（含 signaturePublickey、skinDomains）
- POST /skinapi/authserver/authenticate
- POST /skinapi/authserver/refresh
- POST /skinapi/authserver/validate
- POST /skinapi/authserver/invalidate
- POST /skinapi/authserver/signout
- POST /skinapi/sessionserver/session/minecraft/join
- GET  /skinapi/sessionserver/session/minecraft/hasJoined
- GET  /skinapi/sessionserver/session/minecraft/profile/{uuid}
- GET  /skinapi/api/profiles/minecraft
- POST /skinapi/api/profiles/minecraft
- PUT  /skinapi/api/user/profile/{uuid}/{textureType}  (上传材质，需要 access_token)
- DELETE /skinapi/api/user/profile/{uuid}/{textureType}
"""
import base64
import json
import secrets
import time
import uuid as uuid_lib
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Header, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import User, Player, Texture
from app.services.auth import verify_password
from app.services.crypto import crypto
from app.utils.image import save_texture

router = APIRouter(prefix="/skinapi", tags=["yggdrasil"])


# ====== 会话 token（Yggdrasil 使用自定义 accessToken/clientToken 而非 JWT） ======
# 简化实现：用 Redis 或 in-memory，这里用数据库 OAuth AccessToken 表复用
_SESSION_TOKENS: dict[str, dict] = {}  # access_token -> {user_id, client_token, selected_uuid, expires_at}
_JOIN_TOKENS: dict[str, dict] = {}  # access_token -> {selected_uuid, server_id, expires_at}


def _new_token() -> str:
    return uuid_lib.uuid4().hex


def _now_ms() -> int:
    return int(time.time() * 1000)


async def _build_profile_json(
    db: AsyncSession, player: Player, sign: bool = False
) -> dict:
    """构建 Yggdrasil profile JSON，包含 textures 与可选签名"""
    skin_tex = None
    cape_tex = None
    if player.skin_texture_id:
        skin_tex = (await db.execute(
            select(Texture).where(Texture.id == player.skin_texture_id)
        )).scalar_one_or_none()
    if player.cape_texture_id:
        cape_tex = (await db.execute(
            select(Texture).where(Texture.id == player.cape_texture_id)
        )).scalar_one_or_none()

    base_url = settings.site_url.rstrip("/") + "/static/textures/"
    textures = {}
    if skin_tex:
        item = {"url": base_url + skin_tex.hash + ".png"}
        if skin_tex.model == "slim":
            item["metadata"] = {"model": "slim"}
        textures["SKIN"] = item
    if cape_tex:
        textures["CAPE"] = {"url": base_url + cape_tex.hash + ".png"}

    textures_payload = {
        "timestamp": _now_ms(),
        "profileId": player.uuid.replace("-", ""),
        "profileName": player.name,
        "textures": textures,
    }
    textures_b64 = base64.b64encode(
        json.dumps(textures_payload).encode("utf-8")
    ).decode("utf-8")

    prop = {"name": "textures", "value": textures_b64}
    if sign:
        prop["signature"] = crypto.sign_data(textures_b64)

    profile_data = {
        "id": player.uuid.replace("-", ""),
        "name": player.name,
        "properties": [
            prop,
            {"name": "uploadableTextures", "value": "skin,cape"},
        ],
    }
    return profile_data


# ====== Meta 端点（authlib-injector 必需） ======
@router.get("/")
async def yggdrasil_meta():
    site_host = settings.site_url.replace("https://", "").replace("http://", "").rstrip("/")
    return JSONResponse(
        {
            "meta": {
                "serverName": settings.site_name,
                "implementationName": "vUSTB",
                "implementationVersion": "0.1.0",
                "links": {
                    "homepage": settings.site_url,
                    "register": settings.site_url + "/register",
                },
                "feature.non_email_login": True,
                "feature.legacy_skin_api": False,
                "feature.no_mojang_namespace": False,
                "feature.enable_mojang_anti_features": False,
                "feature.enable_profile_key": True,
                "feature.username_check": False,
            },
            "signaturePublickey": crypto.public_pem_oneline,
            "skinDomains": [site_host, "." + site_host.split(":")[0]],
        }
    )


# ====== authserver ======
@router.post("/authserver/authenticate")
async def authserver_authenticate(req: dict, db: AsyncSession = Depends(get_db)):
    username = req.get("username")
    password = req.get("password")
    client_token = req.get("clientToken") or _new_token()
    request_user = bool(req.get("requestUser"))

    if not username or not password:
        raise HTTPException(status_code=400, detail="ForbiddenOperationException")

    user = (await db.execute(select(User).where(User.email == username))).scalar_one_or_none()
    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=403, detail={"error": "ForbiddenOperationException", "errorMessage": "Invalid credentials."})

    players = (await db.execute(select(Player).where(Player.owner_id == user.id))).scalars().all()
    access_token = _new_token()
    selected = players[0] if len(players) == 1 else None

    _SESSION_TOKENS[access_token] = {
        "user_id": user.id,
        "client_token": client_token,
        "selected_uuid": selected.uuid if selected else None,
        "expires_at": time.time() + 86400,
    }

    resp = {
        "accessToken": access_token,
        "clientToken": client_token,
        "availableProfiles": [
            {"id": p.uuid.replace("-", ""), "name": p.name} for p in players
        ],
    }
    if selected:
        resp["selectedProfile"] = {"id": selected.uuid.replace("-", ""), "name": selected.name}
    if request_user:
        resp["user"] = {"id": str(user.id), "properties": []}
    return resp


@router.post("/authserver/refresh")
async def authserver_refresh(req: dict, db: AsyncSession = Depends(get_db)):
    access_token = req.get("accessToken")
    client_token = req.get("clientToken")
    if not access_token or access_token not in _SESSION_TOKENS:
        raise HTTPException(status_code=403, detail={"error": "ForbiddenOperationException", "errorMessage": "Invalid token."})
    session = _SESSION_TOKENS[access_token]
    if client_token and session["client_token"] != client_token:
        raise HTTPException(status_code=403, detail={"error": "ForbiddenOperationException", "errorMessage": "Token mismatch."})

    new_token = _new_token()
    _SESSION_TOKENS[new_token] = {**session, "expires_at": time.time() + 86400}
    _SESSION_TOKENS.pop(access_token, None)

    selected = None
    if session.get("selected_uuid"):
        selected = (await db.execute(
            select(Player).where(Player.uuid == session["selected_uuid"])
        )).scalar_one_or_none()

    resp = {"accessToken": new_token, "clientToken": session["client_token"]}
    if selected:
        resp["selectedProfile"] = {"id": selected.uuid.replace("-", ""), "name": selected.name}
    return resp


@router.post("/authserver/validate")
async def authserver_validate(req: dict):
    access_token = req.get("accessToken")
    if not access_token or access_token not in _SESSION_TOKENS:
        return Response(status_code=403)
    if _SESSION_TOKENS[access_token]["expires_at"] < time.time():
        return Response(status_code=403)
    return Response(status_code=204)


@router.post("/authserver/invalidate")
async def authserver_invalidate(req: dict):
    access_token = req.get("accessToken")
    _SESSION_TOKENS.pop(access_token, None)
    return Response(status_code=204)


@router.post("/authserver/signout")
async def authserver_signout(req: dict, db: AsyncSession = Depends(get_db)):
    username = req.get("username")
    password = req.get("password")
    user = (await db.execute(select(User).where(User.email == username))).scalar_one_or_none()
    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=403, detail="ForbiddenOperationException")
    for k in list(_SESSION_TOKENS.keys()):
        if _SESSION_TOKENS[k]["user_id"] == user.id:
            _SESSION_TOKENS.pop(k, None)
    return Response(status_code=204)


# ====== sessionserver ======
@router.post("/sessionserver/session/minecraft/join")
async def session_join(req: dict):
    access_token = req.get("accessToken")
    selected_profile = req.get("selectedProfile")
    server_id = req.get("serverId")
    if not all([access_token, selected_profile, server_id]) or access_token not in _SESSION_TOKENS:
        raise HTTPException(status_code=403, detail="ForbiddenOperationException")
    sess = _SESSION_TOKENS[access_token]
    if not sess.get("selected_uuid") or sess["selected_uuid"].replace("-", "") != selected_profile:
        raise HTTPException(status_code=403, detail="ForbiddenOperationException")
    _JOIN_TOKENS[server_id] = {
        "selected_uuid": sess["selected_uuid"],
        "expires_at": time.time() + 60,
    }
    return Response(status_code=204)


@router.get("/sessionserver/session/minecraft/hasJoined")
async def session_has_joined(
    username: str, serverId: str, ip: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    info = _JOIN_TOKENS.get(serverId)
    if not info or info["expires_at"] < time.time():
        return Response(status_code=204)
    player = (await db.execute(
        select(Player).where(Player.uuid == info["selected_uuid"], Player.name == username)
    )).scalar_one_or_none()
    if not player:
        return Response(status_code=204)
    return await _build_profile_json(db, player, sign=True)


@router.get("/sessionserver/session/minecraft/profile/{uuid}")
async def session_profile(uuid: str, unsigned: bool = True, db: AsyncSession = Depends(get_db)):
    normalized = uuid.replace("-", "")
    player = (await db.execute(
        select(Player).where(Player.uuid == normalized) | (Player.uuid.like(f"%{normalized}%"))
    )).scalar_one_or_none()
    if not player:
        # 试 dashed
        for fmt_uuid in (uuid, normalized):
            player = (await db.execute(select(Player).where(Player.uuid == fmt_uuid))).scalar_one_or_none()
            if player:
                break
    if not player:
        return Response(status_code=204)
    return await _build_profile_json(db, player, sign=(not unsigned))


# ====== profiles ======
@router.post("/api/profiles/minecraft")
async def query_profiles(names: list[str], db: AsyncSession = Depends(get_db)):
    if not names:
        return []
    players = (await db.execute(select(Player).where(Player.name.in_(names)))).scalars().all()
    return [{"id": p.uuid.replace("-", ""), "name": p.name} for p in players]


# ====== 材质上传/删除 ======
@router.put("/api/user/profile/{uuid}/{texture_type}")
async def upload_texture(
    uuid: str,
    texture_type: str,
    model: str = Form("classic"),
    file: UploadFile = File(...),
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing token")
    access_token = authorization.removeprefix("Bearer ").strip()
    sess = _SESSION_TOKENS.get(access_token)
    if not sess:
        raise HTTPException(status_code=403, detail="invalid token")

    player = (await db.execute(
        select(Player).where(Player.uuid == uuid.replace("-", ""))
    )).scalar_one_or_none()
    if not player or player.owner_id != sess["user_id"]:
        raise HTTPException(status_code=403, detail="forbidden")

    data = await file.read()
    h = save_texture(data, kind=texture_type)
    existing = (await db.execute(select(Texture).where(Texture.hash == h))).scalar_one_or_none()
    if not existing:
        tex = Texture(
            hash=h, type=texture_type, model=model if texture_type == "skin" else "classic",
            name=f"{texture_type}-{h[:8]}", uploader_id=sess["user_id"],
        )
        db.add(tex)
        await db.flush()
    else:
        tex = existing

    if texture_type == "skin":
        player.skin_texture_id = tex.id
    elif texture_type == "cape":
        player.cape_texture_id = tex.id
    await db.commit()
    return Response(status_code=204)


@router.delete("/api/user/profile/{uuid}/{texture_type}")
async def delete_texture_binding(
    uuid: str,
    texture_type: str,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing token")
    access_token = authorization.removeprefix("Bearer ").strip()
    sess = _SESSION_TOKENS.get(access_token)
    if not sess:
        raise HTTPException(status_code=403, detail="invalid token")

    player = (await db.execute(
        select(Player).where(Player.uuid == uuid.replace("-", ""))
    )).scalar_one_or_none()
    if not player or player.owner_id != sess["user_id"]:
        raise HTTPException(status_code=403, detail="forbidden")
    if texture_type == "skin":
        player.skin_texture_id = None
    elif texture_type == "cape":
        player.cape_texture_id = None
    await db.commit()
    return Response(status_code=204)
