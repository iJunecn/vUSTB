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
- GET  /skinapi/api/users/profiles/minecraft/{playerName}
- POST /skinapi/api/profiles/minecraft
- GET  /skinapi/api/minecraft/profile/lookup/name/{playerName}
- PUT  /skinapi/api/user/profile/{uuid}/{textureType}  (上传材质，需要 access_token)
- DELETE /skinapi/api/user/profile/{uuid}/{textureType}
"""
import base64
import json
import time
import uuid as uuid_lib

from fastapi import APIRouter, Depends, File, Form, HTTPException, Header, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import User, Player, Texture, SiteSetting
from app.services.auth import verify_password
from app.services.crypto import crypto
from app.services.fallback import fallback_backend
from app.utils.image import save_texture
from app.utils.schemas import AuthRequest, RefreshRequest, JoinRequest, ValidationRequest
from app.utils.rate_limiter import rate_limiter
from app.utils.user_groups import resolve_user_group, is_admin_group

router = APIRouter(prefix="/skinapi", tags=["yggdrasil"])


# ====== 会话 token（Yggdrasil 使用自定义 accessToken/clientToken 而非 JWT） ======
_SESSION_TOKENS: dict[str, dict] = {}  # access_token -> {user_id, client_token, selected_uuid, expires_at}
_JOIN_TOKENS: dict[str, dict] = {}  # server_id -> {selected_uuid, access_token, expires_at}

TOKEN_TTL = 15 * 24 * 3600  # 15天
SESSION_TTL = 30  # 30秒


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


def _yggdrasil_error(error: str, message: str, status_code: int = 403):
    """返回 Yggdrasil 规范的错误格式"""
    return HTTPException(status_code=status_code, detail={"error": error, "errorMessage": message})


# ====== 收集 skinDomains ======

async def _collect_skin_domains(db: AsyncSession) -> list[str]:
    """从配置和 fallback 端点中收集所有 skinDomains"""
    domains = []
    site_host = settings.site_url.replace("https://", "").replace("http://", "").split("/")[0].rstrip("/")
    if site_host:
        domains.append(site_host)
        domains.append("." + site_host.split(":")[0])

    from app.models import FallbackEndpoint
    rows = (await db.execute(select(FallbackEndpoint))).scalars().all()
    for r in rows:
        if r.skin_domains:
            if isinstance(r.skin_domains, list):
                domains.extend(r.skin_domains)
            elif isinstance(r.skin_domains, str):
                domains.extend([s.strip() for s in r.skin_domains.split(",") if s.strip()])
    return list(dict.fromkeys(domains))


# ====== Meta 端点（authlib-injector 必需） ======
@router.get("/")
async def yggdrasil_meta(db: AsyncSession = Depends(get_db)):
    site_host = settings.site_url.replace("https://", "").replace("http://", "").rstrip("/")
    site_name_row = (await db.execute(
        select(SiteSetting).where(SiteSetting.key == "site_name")
    )).scalar_one_or_none()
    site_name = site_name_row.value if site_name_row else settings.site_name

    skin_domains = await _collect_skin_domains(db)

    meta = {
        "meta": {
            "serverName": site_name,
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
        "skinDomains": skin_domains,
    }

    # OpenID 配置链接
    api_url = settings.api_url.rstrip("/") or settings.site_url.rstrip("/")
    if api_url:
        meta["meta"]["feature.openid_configuration_url"] = f"{api_url}/.well-known/openid-configuration"

    return JSONResponse(meta)


# ====== authserver ======
@router.post("/authserver/authenticate")
async def authserver_authenticate(req: AuthRequest, request: Request, db: AsyncSession = Depends(get_db)):
    await rate_limiter.check(request, db, is_auth_endpoint=True)

    username = req.username
    password = req.password
    client_token = req.clientToken or _new_token()

    if not username or not password:
        raise _yggdrasil_error("ForbiddenOperationException", "Invalid credentials. Invalid username or password.")

    # 支持邮箱或角色名登录
    user = (await db.execute(select(User).where(User.email == username))).scalar_one_or_none()
    if not user:
        # 尝试用角色名查找
        player = (await db.execute(select(Player).where(Player.name == username))).scalar_one_or_none()
        if player:
            user = (await db.execute(select(User).where(User.id == player.owner_id))).scalar_one_or_none()

    if not user or not verify_password(password, user.password_hash):
        raise _yggdrasil_error("ForbiddenOperationException", "Invalid credentials. Invalid username or password.")

    # 检查是否被封禁
    user_group = resolve_user_group(getattr(user, "user_group", None), user.is_admin)
    banned_until = getattr(user, "banned_until", None)
    if banned_until and banned_until > int(time.time() * 1000):
        raise _yggdrasil_error("ForbiddenOperationException", "Account is banned. Please contact administrator.")

    players = (await db.execute(select(Player).where(Player.owner_id == user.id))).scalars().all()
    access_token = _new_token()

    # 选择 selectedProfile
    selected = None
    if len(players) == 1:
        selected = players[0]
    else:
        # 如果用户用角色名登录，优先选中该角色
        login_player = (await db.execute(select(Player).where(Player.name == username, Player.owner_id == user.id))).scalar_one_or_none()
        if login_player:
            selected = login_player

    _SESSION_TOKENS[access_token] = {
        "user_id": user.id,
        "client_token": client_token,
        "selected_uuid": selected.uuid if selected else None,
        "expires_at": int(time.time() * 1000) + TOKEN_TTL * 1000,
    }

    # 清理过期 token
    _cleanup_expired_tokens()

    rate_limiter.reset(request.client.host, request.url.path)

    resp = {
        "accessToken": access_token,
        "clientToken": client_token,
        "availableProfiles": [
            {"id": p.uuid.replace("-", ""), "name": p.name} for p in players
        ],
    }
    if selected:
        resp["selectedProfile"] = {"id": selected.uuid.replace("-", ""), "name": selected.name}
    if req.requestUser:
        resp["user"] = {"id": str(user.id), "properties": []}
    return resp


@router.post("/authserver/refresh")
async def authserver_refresh(req: RefreshRequest, db: AsyncSession = Depends(get_db)):
    access_token = req.accessToken
    client_token = req.clientToken

    if not access_token or access_token not in _SESSION_TOKENS:
        raise _yggdrasil_error("ForbiddenOperationException", "Invalid token.")
    session = _SESSION_TOKENS[access_token]
    if client_token and session["client_token"] != client_token:
        raise _yggdrasil_error("ForbiddenOperationException", "Token mismatch.")

    # 如果请求中指定了 selectedProfile
    selected_profile_uuid = None
    if req.selectedProfile:
        if isinstance(req.selectedProfile, dict):
            selected_profile_uuid = req.selectedProfile.get("id")
        elif hasattr(req.selectedProfile, "id"):
            selected_profile_uuid = req.selectedProfile.id

    new_profile_uuid = session.get("selected_uuid")
    if selected_profile_uuid:
        if session.get("selected_uuid"):
            # 已有 profile 不能再选择
            raise _yggdrasil_error("IllegalArgumentException", "Access token already has a profile assigned.")
        sp_clean = selected_profile_uuid.replace("-", "")
        # 验证角色所有权
        player = (await db.execute(select(Player).where(Player.uuid == sp_clean))).scalar_one_or_none()
        if not player or player.owner_id != session["user_id"]:
            raise _yggdrasil_error("ForbiddenOperationException", "Invalid profile.")
        new_profile_uuid = sp_clean

    new_token = _new_token()
    _SESSION_TOKENS[new_token] = {
        "user_id": session["user_id"],
        "client_token": session["client_token"],
        "selected_uuid": new_profile_uuid,
        "expires_at": int(time.time() * 1000) + TOKEN_TTL * 1000,
    }
    _SESSION_TOKENS.pop(access_token, None)

    selected = None
    if new_profile_uuid:
        selected = (await db.execute(
            select(Player).where(Player.uuid == new_profile_uuid)
        )).scalar_one_or_none()

    resp = {"accessToken": new_token, "clientToken": session["client_token"]}
    if selected:
        resp["selectedProfile"] = {"id": selected.uuid.replace("-", ""), "name": selected.name}

    if req.requestUser:
        user = (await db.execute(select(User).where(User.id == session["user_id"]))).scalar_one_or_none()
        if user:
            resp["user"] = {"id": str(user.id), "properties": []}

    return resp


@router.post("/authserver/validate")
async def authserver_validate(req: ValidationRequest):
    access_token = req.accessToken
    client_token = req.clientToken
    if not access_token or access_token not in _SESSION_TOKENS:
        return Response(status_code=403)
    session = _SESSION_TOKENS[access_token]
    if client_token and session["client_token"] != client_token:
        return Response(status_code=403)
    if session["expires_at"] < int(time.time() * 1000):
        _SESSION_TOKENS.pop(access_token, None)
        return Response(status_code=403)
    return Response(status_code=204)


@router.post("/authserver/invalidate")
async def authserver_invalidate(req: dict):
    access_token = req.get("accessToken")
    _SESSION_TOKENS.pop(access_token, None)
    return Response(status_code=204)


@router.post("/authserver/signout")
async def authserver_signout(req: dict, request: Request, db: AsyncSession = Depends(get_db)):
    await rate_limiter.check(request, db, is_auth_endpoint=True)
    username = req.get("username")
    password = req.get("password")
    if not username or not password:
        raise _yggdrasil_error("ForbiddenOperationException", "Invalid credentials. Invalid username or password.")
    user = (await db.execute(select(User).where(User.email == username))).scalar_one_or_none()
    if not user or not verify_password(password, user.password_hash):
        raise _yggdrasil_error("ForbiddenOperationException", "Invalid credentials. Invalid username or password.")
    for k in list(_SESSION_TOKENS.keys()):
        if _SESSION_TOKENS[k]["user_id"] == user.id:
            _SESSION_TOKENS.pop(k, None)
    rate_limiter.reset(request.client.host, request.url.path)
    return Response(status_code=204)


# ====== sessionserver ======
@router.post("/sessionserver/session/minecraft/join")
async def session_join(req: JoinRequest, request: Request):
    access_token = req.accessToken
    selected_profile = req.selectedProfile
    server_id = req.serverId

    if not all([access_token, selected_profile, server_id]) or access_token not in _SESSION_TOKENS:
        raise _yggdrasil_error("ForbiddenOperationException", "Invalid token.")
    sess = _SESSION_TOKENS[access_token]
    if not sess.get("selected_uuid") or sess["selected_uuid"].replace("-", "") != selected_profile.replace("-", ""):
        raise _yggdrasil_error("ForbiddenOperationException", "Invalid token.")

    _JOIN_TOKENS[server_id] = {
        "selected_uuid": sess["selected_uuid"],
        "access_token": access_token,
        "expires_at": int(time.time() * 1000) + SESSION_TTL * 1000,
    }
    return Response(status_code=204)


@router.get("/sessionserver/session/minecraft/hasJoined")
async def session_has_joined(
    username: str, serverId: str, ip: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    info = _JOIN_TOKENS.get(serverId)
    if not info or info["expires_at"] < int(time.time() * 1000):
        # 本地没找到，尝试 Fallback
        fallback_resp = await fallback_backend.has_joined(db, username, serverId, ip)
        if fallback_resp:
            return fallback_resp
        return Response(status_code=204)

    player = (await db.execute(
        select(Player).where(Player.uuid == info["selected_uuid"], Player.name == username)
    )).scalar_one_or_none()
    if not player:
        return Response(status_code=204)

    # 检查是否被封禁
    owner = (await db.execute(select(User).where(User.id == player.owner_id))).scalar_one_or_none()
    if owner:
        banned_until = getattr(owner, "banned_until", None)
        if banned_until and banned_until > int(time.time() * 1000):
            raise _yggdrasil_error("ForbiddenOperationException", "Account is banned.")

    return await _build_profile_json(db, player, sign=True)


@router.get("/sessionserver/session/minecraft/profile/{uuid}")
async def session_profile(uuid: str, unsigned: bool = True, db: AsyncSession = Depends(get_db)):
    normalized = uuid.replace("-", "")
    player = None

    # 尝试多种格式匹配
    for fmt_uuid in (normalized, uuid):
        player = (await db.execute(select(Player).where(Player.uuid == fmt_uuid))).scalar_one_or_none()
        if player:
            break

    if not player:
        # Fallback to configured services
        fallback_resp = await fallback_backend.get_profile(db, uuid, unsigned)
        if fallback_resp:
            return fallback_resp
        return Response(status_code=204)

    return await _build_profile_json(db, player, sign=(not unsigned))


# ====== profiles by name / bulk ======
@router.get("/api/users/profiles/minecraft/{playerName}")
@router.get("/users/profiles/minecraft/{playerName}")
async def get_profile_by_name(playerName: str, db: AsyncSession = Depends(get_db)):
    """单个玩家名转 UUID"""
    player = (await db.execute(select(Player).where(Player.name == playerName))).scalar_one_or_none()
    if player:
        return {"id": player.uuid.replace("-", ""), "name": player.name}

    # Fallback to configured services
    fallback_resp = await fallback_backend.get_profile_by_name(db, playerName)
    if fallback_resp:
        return fallback_resp

    return Response(status_code=204)


@router.post("/api/profiles/minecraft")
async def query_profiles(names: list[str], db: AsyncSession = Depends(get_db)):
    if not names:
        return []

    # 1. 查询本地
    players = (await db.execute(select(Player).where(Player.name.in_(names[:100])))).scalars().all()
    local_profiles = [{"id": p.uuid.replace("-", ""), "name": p.name} for p in players]

    # 2. 对缺失的名称查询 Fallback
    found_names = {p["name"].lower() for p in local_profiles}
    missing_names = [n for n in names if n.lower() not in found_names]
    if missing_names:
        mojang_profiles = await fallback_backend.bulk_lookup(db, missing_names)
        if isinstance(mojang_profiles, list):
            local_profiles.extend(mojang_profiles)

    return local_profiles


# ====== services lookup ======
@router.get("/api/minecraft/profile/lookup/name/{playerName}")
async def lookup_profile_by_name(playerName: str, db: AsyncSession = Depends(get_db)):
    """Minecraft Services Profile Lookup"""
    player = (await db.execute(select(Player).where(Player.name == playerName))).scalar_one_or_none()
    if player:
        return {"id": player.uuid.replace("-", ""), "name": player.name}

    # Fallback
    fallback_resp = await fallback_backend.services_lookup(db, playerName)
    if fallback_resp:
        return fallback_resp

    return Response(status_code=204)


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
        raise HTTPException(status_code=401, detail="access token required")
    access_token = authorization.removeprefix("Bearer ").strip()
    sess = _SESSION_TOKENS.get(access_token)
    if not sess:
        raise _yggdrasil_error("ForbiddenOperationException", "Unauthorized")

    uuid_clean = uuid.replace("-", "")
    player = (await db.execute(
        select(Player).where(Player.uuid == uuid_clean)
    )).scalar_one_or_none()
    if not player or player.owner_id != sess["user_id"]:
        raise _yggdrasil_error("ForbiddenOperationException", "Unauthorized")

    # 检查大小限制
    data = await file.read()
    max_size_setting = (await db.execute(
        select(SiteSetting).where(SiteSetting.key == "max_texture_size")
    )).scalar_one_or_none()
    max_size_kb = int(max_size_setting.value) if max_size_setting else 1024
    if len(data) > max_size_kb * 1024:
        raise _yggdrasil_error("IllegalArgumentException", "Texture file too large.")

    try:
        h = save_texture(data, kind=texture_type)
    except ValueError as e:
        raise _yggdrasil_error("IllegalArgumentException", str(e))

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
        raise HTTPException(status_code=401, detail="access token required")
    access_token = authorization.removeprefix("Bearer ").strip()
    sess = _SESSION_TOKENS.get(access_token)
    if not sess:
        raise _yggdrasil_error("ForbiddenOperationException", "Unauthorized")

    uuid_clean = uuid.replace("-", "")
    player = (await db.execute(
        select(Player).where(Player.uuid == uuid_clean)
    )).scalar_one_or_none()
    if not player or player.owner_id != sess["user_id"]:
        raise _yggdrasil_error("ForbiddenOperationException", "Unauthorized")
    if texture_type == "skin":
        player.skin_texture_id = None
    elif texture_type == "cape":
        player.cape_texture_id = None
    await db.commit()
    return Response(status_code=204)


# ====== Helpers ======

def _cleanup_expired_tokens():
    """清理过期的会话 token"""
    now = int(time.time() * 1000)
    expired = [k for k, v in _SESSION_TOKENS.items() if v["expires_at"] < now]
    for k in expired:
        _SESSION_TOKENS.pop(k, None)
    expired_join = [k for k, v in _JOIN_TOKENS.items() if v["expires_at"] < now]
    for k in expired_join:
        _JOIN_TOKENS.pop(k, None)
