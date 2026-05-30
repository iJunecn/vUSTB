"""管理员后台 API — 合并 vSkin admin_routes 功能。

需要 admin 或 super_admin 权限。
"""
from __future__ import annotations

import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.deps import get_current_admin, get_current_super_admin, get_current_user
from app.models import (
    User, UserGroup, InviteCode, OAuthApp, SiteSetting, Carousel, FallbackEndpoint,
)
from app.services.admin_backend import admin_backend
from app.services.oauth_backend import oauth_backend
from app.utils.user_groups import is_admin_group, normalize_user_group

router = APIRouter(prefix="/api/admin", tags=["admin"])


# ============== 用户管理 ==============
class UserOut(BaseModel):
    id: int
    email: str
    username: str
    user_group: str
    email_verified: bool
    is_banned: bool
    created_at: datetime


class UserUpdate(BaseModel):
    user_group: str | None = None
    is_banned: bool | None = None


@router.get("/users", response_model=list[UserOut])
async def list_users(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    rows = (await db.execute(select(User).order_by(User.created_at.desc()))).scalars().all()
    return [
        UserOut(
            id=u.id, email=u.email, username=u.username,
            user_group=u.user_group.value, email_verified=u.email_verified,
            is_banned=u.is_banned, created_at=u.created_at,
        )
        for u in rows
    ]


@router.put("/users/{user_id}", response_model=UserOut)
async def update_user(
    user_id: int,
    body: UserUpdate,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_admin),
):
    u = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not u:
        raise HTTPException(status_code=404, detail="not found")
    if body.user_group:
        try:
            group = UserGroup(body.user_group)
        except ValueError:
            raise HTTPException(status_code=400, detail="invalid user_group")
        # 仅 super_admin 可设置 admin 或 super_admin
        if group in (UserGroup.ADMIN, UserGroup.SUPER_ADMIN) and actor.user_group != UserGroup.SUPER_ADMIN:
            raise HTTPException(status_code=403, detail="super_admin required")
        u.user_group = group
    if body.is_banned is not None:
        u.is_banned = body.is_banned
    await db.commit()
    await db.refresh(u)
    return UserOut(
        id=u.id, email=u.email, username=u.username,
        user_group=u.user_group.value, email_verified=u.email_verified,
        is_banned=u.is_banned, created_at=u.created_at,
    )


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_super_admin),
):
    if user_id == actor.id:
        raise HTTPException(status_code=400, detail="cannot delete self")
    u = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not u:
        raise HTTPException(status_code=404, detail="not found")
    await db.delete(u)
    await db.commit()
    return {"ok": True}


# ============== 邀请码 ==============
class InviteOut(BaseModel):
    id: int
    code: str
    total_uses: int | None
    used_count: int
    used_by: str | None
    note: str | None
    created_at: int


class InviteCreate(BaseModel):
    count: int = Field(default=1, ge=1, le=100)


@router.get("/invites", response_model=list[InviteOut])
async def list_invites(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    rows = (await db.execute(
        select(InviteCode).order_by(InviteCode.created_at.desc())
    )).scalars().all()
    return [
        InviteOut(
            id=i.id, code=i.code, total_uses=i.total_uses,
            used_count=i.used_count, used_by=i.used_by,
            note=i.note, created_at=i.created_at,
        )
        for i in rows
    ]


@router.post("/invites", response_model=list[InviteOut])
async def create_invites(
    body: InviteCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    new_items: list[InviteCode] = []
    for _i in range(body.count):
        code = secrets.token_urlsafe(8)
        item = InviteCode(code=code, total_uses=1)
        db.add(item)
        new_items.append(item)
    await db.commit()
    for item in new_items:
        await db.refresh(item)
    return [
        InviteOut(
            id=i.id, code=i.code, total_uses=i.total_uses,
            used_count=i.used_count, used_by=i.used_by,
            note=i.note, created_at=i.created_at,
        )
        for i in new_items
    ]


@router.delete("/invites/{invite_id}")
async def delete_invite(
    invite_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    i = (await db.execute(select(InviteCode).where(InviteCode.id == invite_id))).scalar_one_or_none()
    if not i:
        raise HTTPException(status_code=404, detail="not found")
    await db.delete(i)
    await db.commit()
    return {"ok": True}


# ============== OAuth Apps (vSkin style — see /admin/oauth/apps) ==============
# The vSkin-compatible OAuth app management is at the bottom of this file
# using the oauth_backend service layer. The old Pydantic-model-based
# CRUD endpoints have been replaced.


# ============== 站点设置 ==============
class SettingItem(BaseModel):
    key: str
    value: Any


@router.get("/settings", response_model=list[SettingItem])
async def list_settings(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    rows = (await db.execute(select(SiteSetting).order_by(SiteSetting.key))).scalars().all()
    return [SettingItem(key=s.key, value=s.value) for s in rows]


@router.put("/settings/{key}", response_model=SettingItem)
async def upsert_setting(
    key: str,
    body: SettingItem,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    existing = (await db.execute(select(SiteSetting).where(SiteSetting.key == key))).scalar_one_or_none()
    if existing:
        existing.value = body.value
    else:
        existing = SiteSetting(key=key, value=body.value)
        db.add(existing)
    await db.commit()
    return SettingItem(key=existing.key, value=existing.value)


# ============== 轮播图 ==============
class CarouselOut(BaseModel):
    id: int
    title: str
    image_url: str
    link_url: str | None
    sort_order: int


class CarouselUpsert(BaseModel):
    title: str
    image_url: str
    link_url: str | None = None
    sort_order: int = 0


@router.get("/carousels", response_model=list[CarouselOut])
async def list_carousels(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Carousel).order_by(Carousel.sort_order, Carousel.id))).scalars().all()
    return [
        CarouselOut(id=c.id, title=c.title, image_url=c.image_url, link_url=c.link_url, sort_order=c.sort_order)
        for c in rows
    ]


@router.post("/carousels", response_model=CarouselOut)
async def create_carousel(
    body: CarouselUpsert,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    c = Carousel(**body.model_dump())
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return CarouselOut(id=c.id, title=c.title, image_url=c.image_url, link_url=c.link_url, sort_order=c.sort_order)


@router.delete("/carousels/{cid}")
async def delete_carousel(
    cid: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    c = (await db.execute(select(Carousel).where(Carousel.id == cid))).scalar_one_or_none()
    if not c:
        raise HTTPException(status_code=404, detail="not found")
    await db.delete(c)
    await db.commit()
    return {"ok": True}


# ============== 统计 ==============
@router.get("/stats")
async def stats(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    user_count = (await db.execute(select(func.count(User.id)))).scalar() or 0
    invite_count = (await db.execute(select(func.count(InviteCode.id)))).scalar() or 0
    oauth_app_count = (await db.execute(select(func.count(OAuthApp.app_id)))).scalar() or 0
    return {
        "users": user_count,
        "invites": invite_count,
        "oauth_apps": oauth_app_count,
    }


# ============== Fallback Endpoints ==============
class FallbackEndpointOut(BaseModel):
    id: int
    priority: int
    note: str | None
    session_url: str
    account_url: str | None
    services_url: str | None
    skin_domains: dict | None
    cache_ttl: int
    enable_profile: bool
    enable_hasjoined: bool
    enable_whitelist: bool


class FallbackEndpointCreate(BaseModel):
    priority: int = 0
    note: str | None = None
    session_url: str
    account_url: str | None = None
    services_url: str | None = None
    skin_domains: dict | None = None
    cache_ttl: int = 60
    enable_profile: bool = True
    enable_hasjoined: bool = True
    enable_whitelist: bool = False


class FallbackEndpointUpdate(BaseModel):
    priority: int | None = None
    note: str | None = None
    session_url: str | None = None
    account_url: str | None = None
    services_url: str | None = None
    skin_domains: dict | None = None
    cache_ttl: int | None = None
    enable_profile: bool | None = None
    enable_hasjoined: bool | None = None
    enable_whitelist: bool | None = None


@router.get("/fallback-endpoints", response_model=list[FallbackEndpointOut])
async def list_fallback_endpoints(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    rows = (
        await db.execute(select(FallbackEndpoint).order_by(FallbackEndpoint.priority.desc(), FallbackEndpoint.id))
    ).scalars().all()
    return [
        FallbackEndpointOut(
            id=f.id, priority=f.priority, note=f.note,
            session_url=f.session_url, account_url=f.account_url,
            services_url=f.services_url, skin_domains=f.skin_domains,
            cache_ttl=f.cache_ttl, enable_profile=f.enable_profile,
            enable_hasjoined=f.enable_hasjoined, enable_whitelist=f.enable_whitelist,
        )
        for f in rows
    ]


@router.post("/fallback-endpoints", response_model=FallbackEndpointOut)
async def create_fallback_endpoint(
    body: FallbackEndpointCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    f = FallbackEndpoint(**body.model_dump())
    db.add(f)
    await db.commit()
    await db.refresh(f)
    return FallbackEndpointOut(
        id=f.id, priority=f.priority, note=f.note,
        session_url=f.session_url, account_url=f.account_url,
        services_url=f.services_url, skin_domains=f.skin_domains,
        cache_ttl=f.cache_ttl, enable_profile=f.enable_profile,
        enable_hasjoined=f.enable_hasjoined, enable_whitelist=f.enable_whitelist,
    )


@router.put("/fallback-endpoints/{endpoint_id}", response_model=FallbackEndpointOut)
async def update_fallback_endpoint(
    endpoint_id: int,
    body: FallbackEndpointUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    f = (await db.execute(select(FallbackEndpoint).where(FallbackEndpoint.id == endpoint_id))).scalar_one_or_none()
    if not f:
        raise HTTPException(status_code=404, detail="not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(f, k, v)
    await db.commit()
    await db.refresh(f)
    return FallbackEndpointOut(
        id=f.id, priority=f.priority, note=f.note,
        session_url=f.session_url, account_url=f.account_url,
        services_url=f.services_url, skin_domains=f.skin_domains,
        cache_ttl=f.cache_ttl, enable_profile=f.enable_profile,
        enable_hasjoined=f.enable_hasjoined, enable_whitelist=f.enable_whitelist,
    )


@router.delete("/fallback-endpoints/{endpoint_id}")
async def delete_fallback_endpoint(
    endpoint_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    f = (await db.execute(select(FallbackEndpoint).where(FallbackEndpoint.id == endpoint_id))).scalar_one_or_none()
    if not f:
        raise HTTPException(status_code=404, detail="not found")
    await db.delete(f)
    await db.commit()
    return {"ok": True}


# ============== Mojang Fallback (combined) ==============
class MojangFallbackEndpointOut(BaseModel):
    id: int | None = None
    session_url: str
    account_url: str | None = None
    services_url: str | None = None
    cache_ttl: int = 60
    enabled: bool = True


class MojangFallbackOut(BaseModel):
    strategy: str = "serial"
    endpoints: list[MojangFallbackEndpointOut] = []


class MojangFallbackUpdate(BaseModel):
    strategy: str = "serial"
    endpoints: list[MojangFallbackEndpointOut] = []


@router.get("/mojang-fallback", response_model=MojangFallbackOut)
async def get_mojang_fallback(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    strategy_row = (
        await db.execute(select(SiteSetting).where(SiteSetting.key == "fallback_strategy"))
    ).scalar_one_or_none()
    strategy = strategy_row.value if strategy_row else "serial"

    endpoints = (
        await db.execute(select(FallbackEndpoint).order_by(FallbackEndpoint.priority.desc(), FallbackEndpoint.id))
    ).scalars().all()

    return MojangFallbackOut(
        strategy=strategy,
        endpoints=[
            MojangFallbackEndpointOut(
                id=e.id,
                session_url=e.session_url,
                account_url=e.account_url,
                services_url=e.services_url,
                cache_ttl=e.cache_ttl,
                enabled=e.enable_profile,
            )
            for e in endpoints
        ],
    )


@router.put("/mojang-fallback", response_model=MojangFallbackOut)
async def update_mojang_fallback(
    body: MojangFallbackUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    await _upsert_setting(db, "fallback_strategy", body.strategy)

    # Replace all fallback endpoints
    existing = (await db.execute(select(FallbackEndpoint))).scalars().all()
    for e in existing:
        await db.delete(e)

    for i, ep in enumerate(body.endpoints):
        f = FallbackEndpoint(
            priority=len(body.endpoints) - i,
            session_url=ep.session_url,
            account_url=ep.account_url,
            services_url=ep.services_url,
            cache_ttl=ep.cache_ttl,
            enable_profile=ep.enabled,
            enable_hasjoined=ep.enabled,
            enable_whitelist=False,
        )
        db.add(f)

    await db.commit()

    endpoints = (
        await db.execute(select(FallbackEndpoint).order_by(FallbackEndpoint.priority.desc(), FallbackEndpoint.id))
    ).scalars().all()

    return MojangFallbackOut(
        strategy=body.strategy,
        endpoints=[
            MojangFallbackEndpointOut(
                id=e.id,
                session_url=e.session_url,
                account_url=e.account_url,
                services_url=e.services_url,
                cache_ttl=e.cache_ttl,
                enabled=e.enable_profile,
            )
            for e in endpoints
        ],
    )


# ============== 分组站点设置 ==============

_SETTING_GROUPS: dict[str, list[str]] = {
    "site": [
        "site_name", "site_title", "site_logo", "site_subtitle",
        "footer_text", "filing_icp", "filing_icp_link",
        "filing_mps", "filing_mps_link", "home_image_urls",
    ],
    "security": [
        "allow_register", "require_invite", "register_email_suffixes",
    ],
    "auth": [
        "github_client_id", "github_client_secret", "github_redirect_uri",
        "mua_client_id", "mua_client_secret", "mua_redirect_uri",
        "ustb_client_id", "ustb_client_secret", "ustb_redirect_uri",
    ],
    "email": [
        "smtp_host", "smtp_port", "smtp_user", "smtp_password",
        "smtp_from", "smtp_use_tls", "email_verify_enabled",
    ],
    "microsoft": [
        "msa_client_id", "msa_client_secret",
    ],
    "janus": [
        "janus_url", "janus_token",
    ],
    "fallback": [
        "fallback_session_url", "fallback_account_url",
        "fallback_services_url", "fallback_skin_domains",
        "fallback_cache_ttl", "fallback_enable_profile",
        "fallback_enable_hasjoined", "fallback_enable_whitelist",
    ],
}

_VALID_GROUPS = set(_SETTING_GROUPS.keys())


async def _upsert_setting(db: AsyncSession, key: str, value: Any) -> SiteSetting:
    existing = (await db.execute(select(SiteSetting).where(SiteSetting.key == key))).scalar_one_or_none()
    if existing:
        existing.value = value
    else:
        existing = SiteSetting(key=key, value=value)
        db.add(existing)
    return existing


@router.get("/settings/{group}")
async def get_settings_group(
    group: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    if group not in _VALID_GROUPS:
        raise HTTPException(status_code=400, detail=f"Unknown settings group: {group}")
    keys = _SETTING_GROUPS[group]
    rows = (
        await db.execute(select(SiteSetting).where(SiteSetting.key.in_(keys)))
    ).scalars().all()
    result = {s.key: s.value for s in rows}
    # Fill missing keys with None
    for k in keys:
        if k not in result:
            result[k] = None
    return result


@router.post("/settings/{group}")
async def update_settings_group(
    group: str,
    body: dict[str, Any],
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    if group not in _VALID_GROUPS:
        raise HTTPException(status_code=400, detail=f"Unknown settings group: {group}")
    allowed_keys = set(_SETTING_GROUPS[group])
    for key, value in body.items():
        if key not in allowed_keys:
            raise HTTPException(status_code=400, detail=f"Setting key '{key}' does not belong to group '{group}'")
        await _upsert_setting(db, key, value)
    await db.commit()
    # Return the updated group
    rows = (
        await db.execute(select(SiteSetting).where(SiteSetting.key.in_(allowed_keys)))
    ).scalars().all()
    result = {s.key: s.value for s in rows}
    for k in allowed_keys:
        if k not in result:
            result[k] = None
    return result


@router.post("/site-logo")
async def upload_site_logo(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """Upload a site logo image and save the URL to settings."""
    allowed_types = {"image/png", "image/jpeg", "image/gif", "image/svg+xml", "image/webp"}
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Invalid image type")

    ext_map = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/gif": ".gif",
        "image/svg+xml": ".svg",
        "image/webp": ".webp",
    }
    ext = ext_map.get(file.content_type, ".png")

    upload_dir = settings.carousel_directory
    os.makedirs(upload_dir, exist_ok=True)
    filename = f"site-logo-{uuid.uuid4().hex[:8]}{ext}"
    dest = os.path.join(upload_dir, filename)

    content = await file.read()
    with open(dest, "wb") as f:
        f.write(content)

    # Build a public URL. The static file router serves carousel_directory.
    logo_url = f"/static/carousel/{filename}"

    await _upsert_setting(db, "site_logo", logo_url)
    await db.commit()

    return {"ok": True, "url": logo_url}


# ============== vSkin 兼容: 用户管理增强 ==============

@router.post("/users/{user_id}/toggle-admin")
async def toggle_user_admin(
    user_id: int,
    actor: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    await admin_backend.toggle_user_admin(db, user_id, actor.id)
    return {"ok": True}


@router.post("/users/{user_id}/set-group")
async def set_user_group(
    user_id: int,
    body: dict = Body(...),
    actor: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    user_group = normalize_user_group(body.get("user_group", ""))
    await admin_backend.set_user_group(db, user_id, actor.id, user_group)
    return {"ok": True, "user_group": user_group}


@router.post("/users/{user_id}/ban")
async def ban_user(
    user_id: int,
    body: dict = Body(...),
    actor: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    banned_until = body.get("banned_until")
    if banned_until is None:
        raise HTTPException(status_code=400, detail="banned_until is required")
    res = await admin_backend.ban_user(db, user_id, banned_until, actor.id)
    return {"ok": True, "banned_until": res}


@router.post("/users/{user_id}/unban")
async def unban_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    u = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not u:
        raise HTTPException(status_code=404, detail="not found")
    u.banned_until = None
    await db.commit()
    return {"ok": True}


@router.post("/users/reset-password")
async def reset_user_password(
    body: dict = Body(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    user_id = body.get("user_id")
    new_password = body.get("new_password")
    if not user_id or not new_password:
        raise HTTPException(status_code=400, detail="user_id and new_password required")
    return await admin_backend.reset_user_password(db, int(user_id), new_password)


# ============== vSkin 兼容: 分组设置 ==============

@router.get("/settings/site")
async def get_site_settings(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_admin)):
    return await admin_backend.get_site_settings(db)


@router.post("/settings/site")
async def save_site_settings(body: dict = Body(...), db: AsyncSession = Depends(get_db), _: User = Depends(get_current_admin)):
    await admin_backend.save_settings_group(db, "site", body)
    return {"ok": True}


@router.get("/settings/security")
async def get_security_settings(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_admin)):
    return await admin_backend.get_security_settings(db)


@router.post("/settings/security")
async def save_security_settings(body: dict = Body(...), db: AsyncSession = Depends(get_db), _: User = Depends(get_current_admin)):
    await admin_backend.save_settings_group(db, "security", body)
    return {"ok": True}


@router.get("/settings/email")
async def get_email_settings(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_admin)):
    return await admin_backend.get_email_settings(db)


@router.post("/settings/email")
async def save_email_settings(body: dict = Body(...), db: AsyncSession = Depends(get_db), _: User = Depends(get_current_admin)):
    await admin_backend.save_settings_group(db, "email", body)
    return {"ok": True}


@router.get("/settings/fallback")
async def get_fallback_settings(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_admin)):
    return await admin_backend.get_fallback_services(db)


@router.post("/settings/fallback")
async def save_fallback_settings(body: dict = Body(...), db: AsyncSession = Depends(get_db), _: User = Depends(get_current_admin)):
    await admin_backend.save_settings_group(db, "fallback", body)
    return {"ok": True}


# ============== vSkin 兼容: Carousel 文件上传/删除 ==============

@router.post("/carousel")
async def upload_carousel_file(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in [".png", ".jpg", ".jpeg", ".webp"]:
        raise HTTPException(status_code=400, detail="Unsupported file format")
    filename = f"{uuid.uuid4().hex}{ext}"
    content = await file.read()
    return await admin_backend.upload_carousel_image(db, filename, content)


@router.delete("/carousel/{filename}")
async def delete_carousel_file(filename: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_admin)):
    return await admin_backend.delete_carousel_image(db, filename)


# ============== vSkin 兼容: OAuth App 管理 (vSkin 风格) ==============

@router.get("/oauth/apps")
async def get_oauth_apps_v2(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_admin)):
    return await oauth_backend.list_apps(db)


@router.post("/oauth/apps")
async def create_oauth_app_v2(
    body: dict = Body(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    client_name = body.get("client_name", "")
    redirect_uri = body.get("redirect_uri", "")
    return await oauth_backend.create_app(db, client_name, redirect_uri)


@router.delete("/oauth/apps/{app_id}")
async def delete_oauth_app_v2(app_id: int, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_admin)):
    await oauth_backend.delete_app(db, app_id)
    return {"ok": True}


@router.get("/oauth/meta")
async def get_oauth_meta(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_admin)):
    """返回 OAuth 支持的 scopes 和配置信息"""
    return {
        "supported_scopes": oauth_backend.SUPPORTED_SCOPES,
        "apps": await oauth_backend.list_apps(db),
    }
