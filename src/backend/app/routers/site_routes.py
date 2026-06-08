"""站点用户路由 — 从 vSkin site_routes 搬运，适配 SQLAlchemy。

包含：登录/注册、验证码、密码重置、用户信息、角色管理、
材质管理、公共设置、OAuth 2.0 授权端点等。
"""
from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import User, Player, Texture, Wardrobe, SiteSetting, FallbackEndpoint, PointAccount, PointTransaction, PointType, PointReason
from app.services.auth import decode_jwt
from app.services.oauth_backend import oauth_backend
from app.services.site_backend import site_backend
from app.utils.image import default_steve_head_avatar, save_texture
from app.utils.rate_limiter import rate_limiter

router = APIRouter(tags=["site"])

security = HTTPBearer(auto_error=False)


async def _deduct_pixel_points(
    db: AsyncSession, user_id: int, amount: int, reason: PointReason, ref_id: str | None = None
) -> PointAccount:
    """扣减像素积分，余额不足时抛 403。"""
    acct = (
        await db.execute(select(PointAccount).where(PointAccount.user_id == user_id))
    ).scalar_one_or_none()
    if not acct:
        raise HTTPException(status_code=403, detail="像素积分不足")
    if acct.pixel_points < amount:
        raise HTTPException(status_code=403, detail=f"像素积分不足，需要 {amount}，当前 {acct.pixel_points}")
    acct.pixel_points -= amount
    tx = PointTransaction(
        user_id=user_id,
        type=PointType.PIXEL,
        amount=-amount,
        reason=reason,
        ref_id=ref_id,
        balance_after=acct.pixel_points,
    )
    db.add(tx)
    return acct


def _get_bearer_token(request: Request) -> str:
    """从请求头获取 OAuth Bearer token"""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    access_token = auth_header[7:].strip()
    if not access_token:
        raise HTTPException(status_code=401, detail="missing bearer token")
    return access_token


async def _get_jwt_user_id(creds: HTTPAuthorizationCredentials = Depends(security)) -> int:
    """从 JWT 获取 user_id（用于 site 登录态）"""
    payload = decode_jwt(creds.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="invalid or expired token")
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="invalid token")
    return int(user_id)


async def _get_jwt_user_id_optional(creds: HTTPAuthorizationCredentials = Depends(security)) -> int | None:
    """可选认证：有 token 返回 user_id，无 token 返回 None"""
    if not creds:
        return None
    payload = decode_jwt(creds.credentials)
    if not payload:
        return None
    user_id = payload.get("sub")
    return int(user_id) if user_id else None


# 登录/注册/验证码

@router.post("/api/site-login")
async def site_login(req: dict, request: Request, db: AsyncSession = Depends(get_db)):
    await rate_limiter.check(request, db, is_auth_endpoint=True)
    result = await site_backend.login(db, req.get("email", ""), req.get("password", ""))
    rate_limiter.reset(request.client.host, request.url.path)
    return result


@router.post("/api/register")
async def register(req: dict, request: Request, db: AsyncSession = Depends(get_db)):
    await rate_limiter.check(request, db, is_auth_endpoint=True)
    email = req.get("email", "")
    password = req.get("password", "")
    username = req.get("username", "")
    invite = req.get("invite")
    code = req.get("code")

    if not email or not password or not username:
        raise HTTPException(status_code=400, detail="email, password and username required")

    user_id = await site_backend.register(db, email, password, username, invite, code)
    return {"id": user_id}


@router.post("/api/send-verification-code")
async def send_code(req: dict, request: Request, db: AsyncSession = Depends(get_db)):
    await rate_limiter.check(request, db, is_auth_endpoint=True)
    email = req.get("email", "")
    type_ = req.get("type", "register")
    if not email:
        raise HTTPException(status_code=400, detail="email required")
    return await site_backend.send_verification_code(db, email, type_)


@router.post("/api/reset-password")
async def reset_password(req: dict, request: Request, db: AsyncSession = Depends(get_db)):
    await rate_limiter.check(request, db, is_auth_endpoint=True)
    email = req.get("email", "")
    password = req.get("password", "")
    code = req.get("code", "")
    if not email or not password or not code:
        raise HTTPException(status_code=400, detail="email, password and code required")
    await site_backend.reset_password(db, email, password, code)
    return {"ok": True}


# 当前用户

@router.get("/api/me")
async def me(user_id: int = Depends(_get_jwt_user_id), db: AsyncSession = Depends(get_db)):
    return await site_backend.get_user_info(db, user_id)


@router.post("/api/me/avatar/from-texture")
async def me_set_avatar_from_texture(
    body: dict = Body(...),
    user_id: int = Depends(_get_jwt_user_id),
    db: AsyncSession = Depends(get_db),
):
    texture_hash = body.get("hash")
    return await site_backend.set_avatar_from_texture(db, user_id, texture_hash)


@router.post("/api/me/refresh-token")
async def refresh_jwt(user_id: int = Depends(_get_jwt_user_id), db: AsyncSession = Depends(get_db)):
    return await site_backend.refresh_token(db, user_id)


@router.patch("/api/me")
async def me_update(
    body: dict = Body(...),
    user_id: int = Depends(_get_jwt_user_id),
    db: AsyncSession = Depends(get_db),
):
    await site_backend.update_user_info(db, user_id, body)
    return {"ok": True}


@router.delete("/api/me")
async def delete_me(user_id: int = Depends(_get_jwt_user_id), db: AsyncSession = Depends(get_db)):
    await site_backend.delete_user(db, user_id, is_admin_action=False)
    return {"ok": True}


@router.post("/api/me/password")
async def change_password(
    body: dict = Body(...),
    user_id: int = Depends(_get_jwt_user_id),
    db: AsyncSession = Depends(get_db),
):
    await site_backend.change_password(db, user_id, body.get("old_password", ""), body.get("new_password", ""))
    return {"ok": True, "message": "密码修改成功"}


# 角色管理

@router.post("/api/me/profiles")
async def create_profile(
    body: dict = Body(...),
    user_id: int = Depends(_get_jwt_user_id),
    db: AsyncSession = Depends(get_db),
):
    # 创建角色消耗 5 像素积分
    await _deduct_pixel_points(db, user_id, 5, PointReason.CREATE_PLAYER)
    result = await site_backend.create_profile(db, user_id, body.get("name"), body.get("model", "default"))
    return result


@router.delete("/api/me/profiles/{pid}")
async def delete_profile(pid: int, user_id: int = Depends(_get_jwt_user_id), db: AsyncSession = Depends(get_db)):
    await site_backend.delete_profile(db, user_id, pid)
    return {"ok": True}


@router.delete("/api/me/profiles/{pid}/skin")
async def clear_profile_skin(pid: int, user_id: int = Depends(_get_jwt_user_id), db: AsyncSession = Depends(get_db)):
    await site_backend.clear_profile_texture(db, user_id, pid, "skin")
    return {"ok": True}


@router.delete("/api/me/profiles/{pid}/cape")
async def clear_profile_cape(pid: int, user_id: int = Depends(_get_jwt_user_id), db: AsyncSession = Depends(get_db)):
    await site_backend.clear_profile_texture(db, user_id, pid, "cape")
    return {"ok": True}


# 材质管理

@router.post("/api/me/textures")
async def upload_texture_to_library(
    file: UploadFile = File(...),
    texture_type: str = Form(...),
    note: str = Form(""),
    is_public: str = Form("false"),
    model: str = Form("default"),
    user_id: int = Depends(_get_jwt_user_id),
    db: AsyncSession = Depends(get_db),
):
    # 上传皮肤消耗 1 像素积分
    await _deduct_pixel_points(db, user_id, 1, PointReason.UPLOAD_SKIN)

    content = await file.read()
    public_bool = is_public.lower() == "true"

    try:
        h = save_texture(content, kind=texture_type)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    existing = (await db.execute(select(Texture).where(Texture.hash == h))).scalar_one_or_none()
    if existing:
        tex = existing
        # 更新 note/model/is_public 如果提供了
        if note and not existing.name:
            existing.name = note
        if texture_type == "skin" and model in ("slim", "classic"):
            existing.model = model
        existing.is_public = existing.is_public or public_bool
    else:
        tex = Texture(
            hash=h, type=texture_type,
            model=model if texture_type == "skin" else "classic",
            name=note or f"{texture_type}-{h[:8]}",
            is_public=public_bool,
            uploader_id=user_id,
        )
        db.add(tex)
        await db.flush()

    # 确保在衣柜中
    already = (await db.execute(
        select(Wardrobe).where(Wardrobe.user_id == user_id, Wardrobe.texture_id == tex.id)
    )).scalar_one_or_none()
    if not already:
        db.add(Wardrobe(user_id=user_id, texture_id=tex.id))

    await db.commit()
    return {"hash": h, "type": texture_type, "name": note or f"{texture_type}-{h[:8]}", "is_public": 1 if public_bool else 0, "model": model}


@router.get("/api/me/textures")
async def list_my_textures(user_id: int = Depends(_get_jwt_user_id), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(Texture).join(Wardrobe, Wardrobe.texture_id == Texture.id)
        .where(Wardrobe.user_id == user_id).order_by(Wardrobe.created_at.desc())
    )).scalars().all()
    base_url = "/static/textures/"
    return [
        {
            "id": r.id,
            "hash": r.hash,
            "type": r.type,
            "name": r.name,
            "model": r.model,
            "is_public": r.is_public,
            "url": base_url + r.hash + ".png",
        }
        for r in rows
    ]


@router.get("/api/me/textures/{hash}/{texture_type}")
async def get_my_texture_detail(
    hash: str, texture_type: str,
    user_id: int = Depends(_get_jwt_user_id),
    db: AsyncSession = Depends(get_db),
):
    tex = (await db.execute(
        select(Texture).where(Texture.hash == hash, Texture.type == texture_type)
    )).scalar_one_or_none()
    if not tex:
        raise HTTPException(status_code=404, detail="Texture not found")

    # 确认用户有权限访问
    wardrobe = (await db.execute(
        select(Wardrobe).where(Wardrobe.user_id == user_id, Wardrobe.texture_id == tex.id)
    )).scalar_one_or_none()
    if not wardrobe and tex.uploader_id != user_id:
        raise HTTPException(status_code=404, detail="Texture not found")

    base_url = "/static/textures/"
    return {
        "id": tex.id,
        "hash": tex.hash,
        "type": tex.type,
        "name": tex.name,
        "model": tex.model,
        "is_public": tex.is_public,
        "uploader_id": tex.uploader_id,
        "created_at": tex.created_at,
        "url": base_url + tex.hash + ".png",
    }


@router.patch("/api/me/textures/{hash}/{texture_type}")
async def update_my_texture(
    hash: str, texture_type: str,
    body: dict = Body(...),
    user_id: int = Depends(_get_jwt_user_id),
    db: AsyncSession = Depends(get_db),
):
    tex = (await db.execute(
        select(Texture).where(Texture.hash == hash, Texture.type == texture_type)
    )).scalar_one_or_none()
    if not tex:
        raise HTTPException(status_code=404, detail="Texture not found")

    if tex.uploader_id != user_id:
        raise HTTPException(status_code=403, detail="Not your texture")

    if "note" in body and body["note"] is not None:
        tex.name = body["note"]
    if "model" in body and body["model"] is not None and texture_type == "skin":
        tex.model = body["model"]
    if "is_public" in body and body["is_public"] is not None:
        tex.is_public = bool(body["is_public"])

    await db.commit()
    base_url = "/static/textures/"
    return {
        "ok": True,
        "id": tex.id,
        "hash": tex.hash,
        "type": tex.type,
        "name": tex.name,
        "model": tex.model,
        "is_public": tex.is_public,
        "url": base_url + tex.hash + ".png",
    }


@router.delete("/api/me/textures/{hash}/{texture_type}")
async def delete_my_texture(
    hash: str, texture_type: str,
    user_id: int = Depends(_get_jwt_user_id),
    db: AsyncSession = Depends(get_db),
):
    tex = (await db.execute(
        select(Texture).where(Texture.hash == hash, Texture.type == texture_type)
    )).scalar_one_or_none()
    if not tex:
        raise HTTPException(status_code=404, detail="Texture not found")

    # 从衣柜移除
    wardrobe = (await db.execute(
        select(Wardrobe).where(Wardrobe.user_id == user_id, Wardrobe.texture_id == tex.id)
    )).scalar_one_or_none()
    if wardrobe:
        await db.delete(wardrobe)

    await db.commit()
    return {"ok": True}


@router.post("/api/me/textures/{hash}/add")
async def add_texture_to_wardrobe(
    hash: str,
    user_id: int = Depends(_get_jwt_user_id),
    db: AsyncSession = Depends(get_db),
):
    tex = (await db.execute(select(Texture).where(Texture.hash == hash))).scalar_one_or_none()
    if not tex:
        raise HTTPException(status_code=404, detail="Texture not found in library")

    already = (await db.execute(
        select(Wardrobe).where(Wardrobe.user_id == user_id, Wardrobe.texture_id == tex.id)
    )).scalar_one_or_none()
    if not already:
        db.add(Wardrobe(user_id=user_id, texture_id=tex.id))
        await db.commit()
    return {"ok": True}


@router.post("/api/me/textures/{hash}/apply")
async def apply_texture_to_profile(
    hash: str,
    body: dict = Body(...),
    user_id: int = Depends(_get_jwt_user_id),
    db: AsyncSession = Depends(get_db),
):
    profile_id = body.get("profile_id")
    texture_type = body.get("texture_type")
    if profile_id is not None:
        profile_id = int(profile_id)
    try:
        await site_backend.apply_texture_to_profile(db, user_id, profile_id, hash, texture_type)
        return {"ok": True}
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e))


@router.post("/api/textures/upload")
async def textures_upload(
    file: UploadFile = File(...),
    uuid: str = Form(...),
    texture_type: str = Form(...),
    model: str = Form(""),
    is_public: str = Form("false"),
    user_id: int = Depends(_get_jwt_user_id),
    db: AsyncSession = Depends(get_db),
):
    """上传材质并应用到角色"""
    content = await file.read()
    public_bool = is_public.lower() == "true"

    try:
        h = save_texture(content, kind=texture_type)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # 保存材质
    existing = (await db.execute(select(Texture).where(Texture.hash == h))).scalar_one_or_none()
    if existing:
        tex = existing
    else:
        tex = Texture(
            hash=h, type=texture_type,
            model=model if texture_type == "skin" and model == "slim" else "classic",
            name=f"Direct upload to profile {uuid}",
            is_public=public_bool,
            uploader_id=user_id,
        )
        db.add(tex)
        await db.flush()

    # 确保在衣柜中
    already = (await db.execute(
        select(Wardrobe).where(Wardrobe.user_id == user_id, Wardrobe.texture_id == tex.id)
    )).scalar_one_or_none()
    if not already:
        db.add(Wardrobe(user_id=user_id, texture_id=tex.id))

    # 应用到角色
    try:
        try:
            player_id = int(uuid)
        except (ValueError, TypeError):
            player = (await db.execute(select(Player).where(Player.uuid == uuid, Player.owner_id == user_id))).scalar_one_or_none()
            if not player:
                raise ValueError("Profile not found")
            player_id = player.id
        await site_backend.apply_texture_to_profile(db, user_id, player_id, h, texture_type)
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e))

    await db.commit()
    return {"ok": True}


# 公共皮肤库

@router.get("/api/public/skin-library")
async def get_skin_library(
    page: int = 1,
    limit: int = 20,
    texture_type: str | None = None,
    user_id: int | None = Depends(_get_jwt_user_id_optional),
    db: AsyncSession = Depends(get_db),
):
    enabled_row = (await db.execute(
        select(SiteSetting).where(SiteSetting.key == "enable_skin_library")
    )).scalar_one_or_none()
    enabled = enabled_row.value if enabled_row else "true"
    if enabled != "true":
        raise HTTPException(status_code=403, detail="Skin library is disabled by administrator")

    offset = (page - 1) * limit

    from app.utils.user_groups import resolve_user_group, SUPER_ADMIN_GROUP
    if user_id is not None:
        user_row = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
        user_group = resolve_user_group(
            getattr(user_row, "user_group", None),
            getattr(user_row, "is_admin", 0),
        ) if user_row else "user"
        if user_group == SUPER_ADMIN_GROUP:
            base_q = select(Texture)
            count_q = select(func.count(Texture.id))
        else:
            base_q = select(Texture).where(
                or_(Texture.is_public == True, Texture.uploader_id == user_id)
            )
            count_q = select(func.count(Texture.id)).where(
                or_(Texture.is_public == True, Texture.uploader_id == user_id)
            )
    else:
        base_q = select(Texture).where(Texture.is_public == True)
        count_q = select(func.count(Texture.id)).where(Texture.is_public == True)

    if texture_type in ("skin", "cape"):
        base_q = base_q.where(Texture.type == texture_type)
        count_q = count_q.where(Texture.type == texture_type)

    total = (await db.execute(count_q)).scalar_one()

    items = (await db.execute(
        base_q.order_by(Texture.created_at.desc()).offset(offset).limit(limit)
    )).scalars().all()

    uploader_ids = list(set(t.uploader_id for t in items if t.uploader_id))
    uploader_names = {}
    if uploader_ids:
        users = (await db.execute(select(User).where(User.id.in_(uploader_ids)))).scalars().all()
        uploader_names = {u.id: u.display_name for u in users}

    base_url = "/static/textures/"
    return {
        "total": total,
        "items": [
            {
                "hash": t.hash,
                "type": t.type,
                "is_public": t.is_public,
                "uploader": t.uploader_id,
                "uploader_name": uploader_names.get(t.uploader_id, ""),
                "created_at": t.created_at,
                "model": t.model,
                "name": t.name,
                "url": base_url + t.hash + ".png",
            }
            for t in items
        ],
    }


# 公共设置

@router.get("/api/public/settings")
async def get_public_settings(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(SiteSetting))).scalars().all()
    s = {r.key: r.value for r in rows}

    # 获取 fallback 服务信息
    fallbacks = (await db.execute(
        select(FallbackEndpoint).order_by(FallbackEndpoint.priority.asc(), FallbackEndpoint.id.asc())
    )).scalars().all()
    primary = fallbacks[0] if fallbacks else None

    site_name = s.get("site_name", settings.site_name)
    raw_suffixes = s.get("register_email_suffixes", "")
    if isinstance(raw_suffixes, list):
        suffix_list = [str(item).strip() for item in raw_suffixes if str(item).strip()]
    else:
        suffix_list = [item.strip() for item in str(raw_suffixes or "").replace("\n", ",").split(",") if item.strip()]

    # 归一化邮箱后缀
    normalized_suffixes = []
    for item in suffix_list:
        token = str(item).strip().lower()
        token = token.lstrip("@")
        if token.startswith("."):
            token = token[1:]
        if token:
            normalized_suffixes.append(token)
    normalized_suffixes = list(dict.fromkeys(normalized_suffixes))

    return {
        "site_name": site_name,
        "site_title": s.get("site_title", site_name),
        "site_logo": s.get("site_logo", ""),
        "site_subtitle": s.get("site_subtitle", "简洁、高效、现代的 Minecraft 皮肤管理站"),
        "public_url": s.get("public_url", ""),
        "allow_register": s.get("allow_register", "true") == "true",
        "register_email_suffixes": normalized_suffixes,
        "enable_skin_library": s.get("enable_skin_library", "true") == "true",
        "email_verify_enabled": s.get("email_verify_enabled", "false") == "true",
        "footer_text": s.get("footer_text", ""),
        "filing_icp": s.get("filing_icp", ""),
        "filing_icp_link": s.get("filing_icp_link", ""),
        "filing_mps": s.get("filing_mps", ""),
        "filing_mps_link": s.get("filing_mps_link", ""),
        "mojang_status_urls": {
            "session": getattr(primary, "session_url", "https://sessionserver.mojang.com") if primary else "https://sessionserver.mojang.com",
            "account": getattr(primary, "account_url", "https://api.mojang.com") if primary else "https://api.mojang.com",
            "services": getattr(primary, "services_url", "https://api.minecraftservices.com") if primary else "https://api.minecraftservices.com",
        },
    }


@router.get("/api/public/carousel")
async def get_carousel(db: AsyncSession = Depends(get_db)):
    return await site_backend.list_carousel_images(db)


@router.get("/api/public/default-avatar")
async def get_default_avatar():
    png_data = default_steve_head_avatar(output_size=256)
    return Response(content=png_data, media_type="image/png")


# OAuth 2.0

@router.get("/api/oauth/authorize/check")
async def oauth_authorize_check(
    client_id: int = Query(...),
    redirect_uri: str = Query(...),
    state: str = Query(default=""),
    scope: str = Query(default="userinfo"),
    db: AsyncSession = Depends(get_db),
):
    return await oauth_backend.build_authorize_preview(db, client_id, redirect_uri, state, scope)


@router.post("/api/oauth/authorize/decision")
async def oauth_authorize_decision(
    body: dict = Body(...),
    user_id: int = Depends(_get_jwt_user_id),
    db: AsyncSession = Depends(get_db),
):
    client_id = body.get("client_id")
    redirect_uri = body.get("redirect_uri")
    state = body.get("state", "")
    approved = bool(body.get("approved", False))
    scope = body.get("scope", "basic")
    if client_id is None or not redirect_uri:
        raise HTTPException(status_code=400, detail="client_id and redirect_uri required")
    return await oauth_backend.authorize_decision(
        db, user_id=int(user_id), client_id=int(client_id),
        redirect_uri=redirect_uri, state=state, approved=approved, scope=scope,
    )


@router.get("/api/.well-known/openid-configuration")
async def openid_configuration(db: AsyncSession = Depends(get_db)):
    return await oauth_backend.openid_configuration(db)


@router.get("/api/oauth/jwks")
async def oauth_jwks():
    return oauth_backend.jwks()


@router.post("/api/oauth/device/code")
async def oauth_device_code(
    client_id: int = Form(...),
    scope: str = Form(default="openid offline_access Yggdrasil.PlayerProfiles.Select Yggdrasil.Server.Join"),
    db: AsyncSession = Depends(get_db),
):
    return await oauth_backend.create_device_authorization(db, client_id=client_id, scope=scope)


@router.get("/api/oauth/device/authorize/check")
async def oauth_device_authorize_check(user_code: str = Query(...), db: AsyncSession = Depends(get_db)):
    return await oauth_backend.build_device_preview(db, user_code)


@router.post("/api/oauth/device/authorize/decision")
async def oauth_device_authorize_decision(
    body: dict = Body(...),
    user_id: int = Depends(_get_jwt_user_id),
    db: AsyncSession = Depends(get_db),
):
    user_code = body.get("user_code", "")
    approved = bool(body.get("approved", False))
    if not user_code:
        raise HTTPException(status_code=400, detail="user_code required")
    return await oauth_backend.decide_device_authorization(db, user_id=user_id, user_code=user_code, approved=approved)


@router.post("/api/oauth/token")
async def oauth_token(
    grant_type: str = Form(...),
    code: str | None = Form(default=None),
    client_id: int | None = Form(default=None),
    client_secret: str | None = Form(default=None),
    redirect_uri: str | None = Form(default=None),
    device_code: str | None = Form(default=None),
    refresh_token: str | None = Form(default=None),
    db: AsyncSession = Depends(get_db),
):
    return await oauth_backend.token_endpoint(
        db, grant_type=grant_type, code=code,
        client_id=client_id, client_secret=client_secret,
        redirect_uri=redirect_uri, device_code=device_code,
        refresh_token=refresh_token,
    )


@router.get("/api/oauth/userinfo")
async def oauth_userinfo(request: Request, db: AsyncSession = Depends(get_db)):
    access_token = _get_bearer_token(request)
    return await oauth_backend.get_userinfo(db, access_token)


@router.get("/api/oauth/skin")
async def oauth_skin(request: Request, db: AsyncSession = Depends(get_db)):
    access_token = _get_bearer_token(request)
    skin_info = await oauth_backend.get_skin_info(db, access_token)
    return FileResponse(
        skin_info["path"],
        media_type="image/png",
        filename=f"{skin_info['profile_name']}.png",
        headers={
            "X-VUSTB-Profile-Id": skin_info["profile_id"],
            "X-VUSTB-Profile-Name": skin_info["profile_name"],
            "X-VUSTB-Skin-Hash": skin_info["skin_hash"],
            "X-VUSTB-Skin-Model": skin_info["model"],
            "Cache-Control": "private, max-age=300",
        },
    )
