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
from app.deps import get_current_admin, get_current_super_admin, get_current_user, get_current_server_content_manager
from app.models import (
    User, UserGroup, InviteCode, OAuthApp, SiteSetting, Carousel, FallbackEndpoint,
    PointAccount, PointTransaction, PointType, PointReason,
    Texture, Player, Wardrobe,
)
from app.services.admin_backend import admin_backend
from app.services.oauth_backend import oauth_backend
from app.services.auth import hash_password
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
    phone: str | None = None
    real_name: str | None = None
    student_id: str | None = None
    github_name: str | None = None


class UserUpdate(BaseModel):
    user_group: str | None = None
    is_banned: bool | None = None


class UserCreate(BaseModel):
    email: str
    username: str
    phone: str = ""
    password: str
    user_group: str = "user"


@router.post("/users", response_model=UserOut)
async def create_user(
    body: UserCreate,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_admin),
):
    """管理员手动创建用户（跳过邀请码和邮箱验证）。"""
    # 检查重复
    existing = (await db.execute(
        select(User).where((User.email == body.email) | (User.username == body.username))
    )).scalar_one_or_none()
    if existing:
        if existing.email == body.email:
            raise HTTPException(status_code=400, detail="邮箱已被占用")
        raise HTTPException(status_code=400, detail="用户名已被占用")

    # 验证 user_group 权限
    try:
        group = UserGroup(body.user_group)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid user_group")
    if group in (UserGroup.ADMIN, UserGroup.SUPER_ADMIN) and actor.user_group != UserGroup.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="仅超级管理员可创建管理员")

    user = User(
        email=body.email,
        username=body.username,
        display_name=body.username,
        phone=body.phone,
        password_hash=hash_password(body.password),
        user_group=group,
        is_admin=1 if group in (UserGroup.ADMIN, UserGroup.SUPER_ADMIN) else 0,
        email_verified=False,
    )
    db.add(user)
    await db.flush()

    # 自动创建默认角色
    import re
    base_name = re.sub(r"[^a-zA-Z0-9_]", "_", body.email.split("@")[0])[:12]
    profile_name = base_name
    suffix = 1
    while True:
        existing_p = (await db.execute(
            select(Player).where(Player.name == profile_name)
        )).scalar_one_or_none()
        if not existing_p:
            break
        profile_name = f"{base_name}_{suffix}"
        suffix += 1
        if suffix > 100:
            break

    import os as _os
    player = Player(uuid=_os.urandom(16).hex, name=profile_name, owner_id=user.id)
    db.add(player)

    # 赠送 10 像素积分
    acct = PointAccount(user_id=user.id, pixel_points=10, shell_points=0)
    db.add(acct)
    await db.flush()
    tx = PointTransaction(
        user_id=user.id,
        type=PointType.PIXEL,
        amount=10,
        reason=PointReason.REGISTER,
        balance_after=10,
    )
    db.add(tx)

    await db.commit()
    await db.refresh(user)
    return UserOut(
        id=user.id, email=user.email, username=user.username,
        user_group=user.user_group.value, email_verified=user.email_verified,
        is_banned=user.is_banned, created_at=user.created_at,
        phone=user.phone, real_name=user.real_name,
        student_id=user.student_id, github_name=user.github_name,
    )


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
            phone=u.phone, real_name=u.real_name,
            student_id=u.student_id, github_name=u.github_name,
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
        phone=u.phone, real_name=u.real_name,
        student_id=u.student_id, github_name=u.github_name,
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

    # Clean up related records that lack CASCADE on FK
    from app.models import PointAccount, PointTransaction, Booking, AccessToken, DeviceCode
    from app.models import Article, ArticleMedia

    # Delete point transactions & account
    pt_rows = (await db.execute(
        select(PointTransaction).where(PointTransaction.user_id == user_id)
    )).scalars().all()
    for pt in pt_rows:
        await db.delete(pt)
    pa = (await db.execute(
        select(PointAccount).where(PointAccount.user_id == user_id)
    )).scalar_one_or_none()
    if pa:
        await db.delete(pa)

    # Nullify article author references (keep articles, remove author link)
    art_rows = (await db.execute(
        select(Article).where(Article.author_id == user_id)
    )).scalars().all()
    for a in art_rows:
        a.author_id = None

    # Nullify article media uploader references
    media_rows = (await db.execute(
        select(ArticleMedia).where(ArticleMedia.uploader_id == user_id)
    )).scalars().all()
    for m in media_rows:
        m.uploader_id = None

    # Delete bookings
    booking_rows = (await db.execute(
        select(Booking).where(Booking.user_id == user_id)
    )).scalars().all()
    for b in booking_rows:
        await db.delete(b)

    # Delete OAuth access tokens
    token_rows = (await db.execute(
        select(AccessToken).where(AccessToken.user_id == user_id)
    )).scalars().all()
    for t in token_rows:
        await db.delete(t)

    # Nullify device code user references
    dc_rows = (await db.execute(
        select(DeviceCode).where(DeviceCode.user_id == user_id)
    )).scalars().all()
    for dc in dc_rows:
        dc.user_id = None

    # Delete user's players (and their wardrobe entries) before textures
    # to avoid FK violation: players.skin_texture_id / cape_texture_id → textures.id
    # Even with ondelete="SET NULL" in the model, existing DBs may not have it yet.
    player_rows = (await db.execute(
        select(Player).where(Player.owner_id == user_id)
    )).scalars().all()
    for p in player_rows:
        # Remove wardrobe entries for this player's textures first
        if p.skin_texture_id:
            w_skin = (await db.execute(
                select(Wardrobe).where(Wardrobe.texture_id == p.skin_texture_id)
            )).scalars().all()
            for w in w_skin:
                await db.delete(w)
        if p.cape_texture_id:
            w_cape = (await db.execute(
                select(Wardrobe).where(Wardrobe.texture_id == p.cape_texture_id)
            )).scalars().all()
            for w in w_cape:
                await db.delete(w)
        await db.delete(p)

    # Nullify any remaining player references to this user's textures
    # (handles players owned by OTHER users that reference this user's textures)
    user_texture_ids = (await db.execute(
        select(Texture.id).where(Texture.uploader_id == user_id)
    )).scalars().all()
    if user_texture_ids:
        ref_players = (await db.execute(
            select(Player).where(
                (Player.skin_texture_id.in_(user_texture_ids)) |
                (Player.cape_texture_id.in_(user_texture_ids))
            )
        )).scalars().all()
        for p in ref_players:
            if p.skin_texture_id in user_texture_ids:
                p.skin_texture_id = None
            if p.cape_texture_id in user_texture_ids:
                p.cape_texture_id = None

    # Delete wardrobe entries for this user's textures
    if user_texture_ids:
        w_rows = (await db.execute(
            select(Wardrobe).where(Wardrobe.texture_id.in_(user_texture_ids))
        )).scalars().all()
        for w in w_rows:
            await db.delete(w)

    await db.delete(u)
    await db.commit()
    return {"ok": True}


# ============== 用户积分管理 ==============

class UserPointsUpdate(BaseModel):
    pixel_points: int | None = Field(None, ge=0)
    shell_points: int | None = Field(None, ge=0)


@router.get("/users/{user_id}/points")
async def get_user_points(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_super_admin),
):
    """超级管理员查看用户积分。"""
    u = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not u:
        raise HTTPException(status_code=404, detail="not found")
    acct = (
        await db.execute(select(PointAccount).where(PointAccount.user_id == user_id))
    ).scalar_one_or_none()
    if not acct:
        return {"pixel_points": 10, "shell_points": 0}
    return {"pixel_points": acct.pixel_points, "shell_points": acct.shell_points}


@router.put("/users/{user_id}/points")
async def set_user_points(
    user_id: int,
    body: UserPointsUpdate,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_super_admin),
):
    """超级管理员直接设置用户积分（非增减，设绝对值），并写流水。"""
    u = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not u:
        raise HTTPException(status_code=404, detail="not found")

    acct = (
        await db.execute(select(PointAccount).where(PointAccount.user_id == user_id))
    ).scalar_one_or_none()
    if not acct:
        acct = PointAccount(user_id=user_id, pixel_points=10, shell_points=0)
        db.add(acct)
        await db.flush()

    result = {"pixel_points": acct.pixel_points, "shell_points": acct.shell_points}

    if body.pixel_points is not None:
        diff = body.pixel_points - acct.pixel_points
        if diff != 0:
            acct.pixel_points = body.pixel_points
            db.add(PointTransaction(
                user_id=user_id,
                type=PointType.PIXEL,
                amount=diff,
                reason=PointReason.ADMIN_ADJUST,
                ref_id=f"admin:{actor.id}",
                balance_after=acct.pixel_points,
            ))
        result["pixel_points"] = body.pixel_points

    if body.shell_points is not None:
        diff = body.shell_points - acct.shell_points
        if diff != 0:
            acct.shell_points = body.shell_points
            db.add(PointTransaction(
                user_id=user_id,
                type=PointType.SHELL,
                amount=diff,
                reason=PointReason.ADMIN_ADJUST,
                ref_id=f"admin:{actor.id}",
                balance_after=acct.shell_points,
            ))
        result["shell_points"] = body.shell_points

    await db.commit()
    return {"ok": True, **result}


# ============== 邀请码 ==============
class InviteOut(BaseModel):
    id: int
    code: str
    total_uses: int | None
    used_count: int
    used_by: str | None
    note: str | None
    target_group: str | None
    created_at: int


class InviteCreate(BaseModel):
    count: int = Field(default=1, ge=1, le=100)
    target_group: str | None = None


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
            note=i.note, target_group=i.target_group,
            created_at=i.created_at,
        )
        for i in rows
    ]


@router.post("/invites", response_model=list[InviteOut])
async def create_invites(
    body: InviteCreate,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    # 权限检查：非管理员/教师/服务器管理员不能创建邀请码
    if actor.user_group not in (UserGroup.SUPER_ADMIN, UserGroup.ADMIN, UserGroup.TEACHER, UserGroup.SERVER_MANAGER):
        raise HTTPException(status_code=403, detail="需要管理员或教师权限才能创建邀请码")

    # target_group 权限控制
    target_group = body.target_group
    if target_group:
        # 标准化
        target_group = target_group.lower().strip()
        if target_group == "super_admin":
            raise HTTPException(status_code=403, detail="不能通过邀请码授予超级管理员身份")
        if target_group == "admin" and actor.user_group != UserGroup.SUPER_ADMIN:
            raise HTTPException(status_code=403, detail="仅超级管理员可创建管理员邀请码")
        if target_group == "server_manager" and actor.user_group not in (UserGroup.SUPER_ADMIN, UserGroup.ADMIN):
            raise HTTPException(status_code=403, detail="仅管理员可创建服务器管理员邀请码")
        if target_group == "teacher" and actor.user_group not in (UserGroup.SUPER_ADMIN, UserGroup.ADMIN, UserGroup.TEACHER):
            raise HTTPException(status_code=403, detail="无权创建教师邀请码")
        # 验证 target_group 值合法
        if target_group not in ("admin", "teacher", "server_manager"):
            raise HTTPException(status_code=400, detail="target_group 只能是 admin、teacher 或 server_manager")
    else:
        target_group = None

    new_items: list[InviteCode] = []
    for _i in range(body.count):
        code = secrets.token_urlsafe(8)
        item = InviteCode(code=code, total_uses=1, target_group=target_group)
        db.add(item)
        new_items.append(item)
    await db.commit()
    for item in new_items:
        await db.refresh(item)
    return [
        InviteOut(
            id=i.id, code=i.code, total_uses=i.total_uses,
            used_count=i.used_count, used_by=i.used_by,
            note=i.note, target_group=i.target_group,
            created_at=i.created_at,
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
        "public_url",
    ],
    "security": [
        "allow_register", "require_invite", "register_email_suffixes",
    ],
    "auth": [
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


# ============== vSkin 兼容: 材质管理 ==============

class AdminTextureOut(BaseModel):
    hash: str
    type: str
    model: str
    name: str
    is_public: bool
    uploader: int | None = None
    uploader_name: str | None = None
    uploader_display_name: str | None = None
    uploader_email: str | None = None
    created_at: datetime | None = None


@router.get("/textures", response_model=list[AdminTextureOut])
async def admin_list_textures(
    q: str = "",
    type: str = "",
    cursor: str | None = None,
    limit: int = 200,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_server_content_manager),
):
    """管理员材质列表（vSkin 兼容，支持搜索和分页）"""
    base_q = select(Texture)
    if type in ("skin", "cape"):
        base_q = base_q.where(Texture.type == type)
    if q:
        base_q = base_q.where(Texture.name.ilike(f"%{q}%"))
    if cursor:
        # cursor-based: use created_at as cursor
        try:
            import datetime as _dt
            cursor_dt = _dt.datetime.fromisoformat(cursor)
            base_q = base_q.where(Texture.created_at < cursor_dt)
        except (ValueError, TypeError):
            pass

    rows = (await db.execute(
        base_q.order_by(Texture.created_at.desc()).limit(limit + 1)
    )).scalars().all()

    # 获取上传者信息
    uploader_ids = list(set(t.uploader_id for t in rows if t.uploader_id))
    uploader_map = {}
    if uploader_ids:
        users = (await db.execute(select(User).where(User.id.in_(uploader_ids)))).scalars().all()
        uploader_map = {u.id: u for u in users}

    has_next = len(rows) > limit
    items = rows[:limit]

    return [
        AdminTextureOut(
            hash=t.hash,
            type=t.type,
            model=t.model,
            name=t.name,
            is_public=t.is_public,
            uploader=t.uploader_id,
            uploader_name=uploader_map[t.uploader_id].username if t.uploader_id in uploader_map else None,
            uploader_display_name=uploader_map[t.uploader_id].display_name if t.uploader_id in uploader_map else None,
            uploader_email=uploader_map[t.uploader_id].email if t.uploader_id in uploader_map else None,
            created_at=t.created_at,
        )
        for t in items
    ]


@router.patch("/textures/{texture_hash}")
async def admin_patch_texture(
    texture_hash: str,
    body: dict = Body(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_server_content_manager),
):
    """管理员修改材质信息"""
    tex = (await db.execute(select(Texture).where(Texture.hash == texture_hash))).scalar_one_or_none()
    if not tex:
        raise HTTPException(status_code=404, detail="Texture not found")
    if "model" in body and body["model"] in ("classic", "slim") and tex.type == "skin":
        tex.model = body["model"]
    if "note" in body and body["note"] is not None:
        tex.name = body["note"]
    if "is_public" in body and body["is_public"] is not None:
        tex.is_public = bool(body["is_public"])
    await db.commit()
    return {"ok": True}


@router.delete("/textures/{texture_hash}")
async def admin_delete_texture(
    texture_hash: str,
    type: str = "",
    user_id: int | None = None,
    force: bool = False,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_server_content_manager),
):
    """管理员删除材质"""
    q = select(Texture).where(Texture.hash == texture_hash)
    if type in ("skin", "cape"):
        q = q.where(Texture.type == type)
    tex = (await db.execute(q)).scalar_one_or_none()
    if not tex:
        raise HTTPException(status_code=404, detail="Texture not found")
    # Remove wardrobe entries
    from app.models import Wardrobe
    wardrobes = (await db.execute(
        select(Wardrobe).where(Wardrobe.texture_id == tex.id)
    )).scalars().all()
    for w in wardrobes:
        await db.delete(w)
    # Unbind from players
    from app.models import Player
    players_skin = (await db.execute(
        select(Player).where(Player.skin_texture_id == tex.id)
    )).scalars().all()
    for p in players_skin:
        p.skin_texture_id = None
    players_cape = (await db.execute(
        select(Player).where(Player.cape_texture_id == tex.id)
    )).scalars().all()
    for p in players_cape:
        p.cape_texture_id = None
    await db.delete(tex)
    await db.commit()
    return {"ok": True}


# ============== vSkin 兼容: 角色管理 ==============

class AdminProfileOut(BaseModel):
    id: int
    name: str
    model: str
    skin_hash: str | None = None
    cape_hash: str | None = None
    user_id: int | None = None
    owner_email: str | None = None
    owner_display_name: str | None = None


@router.get("/profiles", response_model=list[AdminProfileOut])
async def admin_list_profiles(
    q: str = "",
    cursor: str | None = None,
    limit: int = 200,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_server_content_manager),
):
    """管理员角色列表"""
    base_q = select(Player)
    if q:
        base_q = base_q.where(Player.name.ilike(f"%{q}%"))

    rows = (await db.execute(
        base_q.order_by(Player.created_at.desc()).limit(limit)
    )).scalars().all()

    # 获取 owner 信息
    owner_ids = list(set(p.owner_id for p in rows))
    owner_map = {}
    if owner_ids:
        users = (await db.execute(select(User).where(User.id.in_(owner_ids)))).scalars().all()
        owner_map = {u.id: u for u in users}

    result = []
    for p in rows:
        skin_hash = None
        cape_hash = None
        skin_model = "default"
        if p.skin_texture_id:
            tex = (await db.execute(select(Texture).where(Texture.id == p.skin_texture_id))).scalar_one_or_none()
            if tex:
                skin_hash = tex.hash
                skin_model = tex.model if tex.model == "slim" else "default"
        if p.cape_texture_id:
            tex = (await db.execute(select(Texture).where(Texture.id == p.cape_texture_id))).scalar_one_or_none()
            if tex:
                cape_hash = tex.hash

        owner = owner_map.get(p.owner_id)
        result.append(AdminProfileOut(
            id=p.id,
            name=p.name,
            model=skin_model,
            skin_hash=skin_hash,
            cape_hash=cape_hash,
            user_id=p.owner_id,
            owner_email=owner.email if owner else None,
            owner_display_name=owner.display_name if owner else None,
        ))

    return result


@router.patch("/profiles/{profile_id}")
async def admin_patch_profile(
    profile_id: int,
    body: dict = Body(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_server_content_manager),
):
    """管理员修改角色"""
    p = (await db.execute(select(Player).where(Player.id == profile_id))).scalar_one_or_none()
    if not p:
        raise HTTPException(status_code=404, detail="Profile not found")
    if "name" in body and body["name"]:
        p.name = body["name"]
    await db.commit()
    return {"ok": True}


@router.delete("/profiles/{profile_id}")
async def admin_delete_profile(
    profile_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_server_content_manager),
):
    """管理员删除角色"""
    p = (await db.execute(select(Player).where(Player.id == profile_id))).scalar_one_or_none()
    if not p:
        raise HTTPException(status_code=404, detail="Profile not found")
    await db.delete(p)
    await db.commit()
    return {"ok": True}


@router.patch("/profiles/{profile_id}/skin")
async def admin_patch_profile_skin(
    profile_id: int,
    body: dict = Body(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_server_content_manager),
):
    """管理员设置角色皮肤"""
    p = (await db.execute(select(Player).where(Player.id == profile_id))).scalar_one_or_none()
    if not p:
        raise HTTPException(status_code=404, detail="Profile not found")
    hash_val = body.get("hash")
    if not hash_val:
        p.skin_texture_id = None
    else:
        tex = (await db.execute(select(Texture).where(Texture.hash == hash_val, Texture.type == "skin"))).scalar_one_or_none()
        if not tex:
            raise HTTPException(status_code=404, detail="Texture not found")
        p.skin_texture_id = tex.id
    await db.commit()
    return {"ok": True}


@router.patch("/profiles/{profile_id}/cape")
async def admin_patch_profile_cape(
    profile_id: int,
    body: dict = Body(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_server_content_manager),
):
    """管理员设置角色披风"""
    p = (await db.execute(select(Player).where(Player.id == profile_id))).scalar_one_or_none()
    if not p:
        raise HTTPException(status_code=404, detail="Profile not found")
    hash_val = body.get("hash")
    if not hash_val:
        p.cape_texture_id = None
    else:
        tex = (await db.execute(select(Texture).where(Texture.hash == hash_val, Texture.type == "cape"))).scalar_one_or_none()
        if not tex:
            raise HTTPException(status_code=404, detail="Texture not found")
        p.cape_texture_id = tex.id
    await db.commit()
    return {"ok": True}


# ============== vSkin 兼容: 白名单管理 ==============

class WhitelistEntryOut(BaseModel):
    username: str
    created_at: int | None = None


@router.get("/official-whitelist", response_model=list[WhitelistEntryOut])
async def admin_get_whitelist(
    endpoint_id: int = 0,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """管理员获取白名单列表（vSkin 兼容）"""
    # 白名单基于 Player 表 — 在 vUSTB 中所有已注册角色即视为白名单
    # 若需要与特定 Fallback 端点联动，可扩展此逻辑
    rows = (await db.execute(select(Player).order_by(Player.name))).scalars().all()
    return [WhitelistEntryOut(username=p.name) for p in rows]


@router.post("/official-whitelist")
async def admin_add_whitelist_user(
    body: dict = Body(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """管理员添加白名单用户（vSkin 兼容 — 仅记录，vUSTB 自动白名单）"""
    username = body.get("username", "")
    endpoint_id = body.get("endpoint_id", 0)
    if not username:
        raise HTTPException(status_code=400, detail="username required")
    return {"ok": True}


@router.delete("/official-whitelist/{username}")
async def admin_remove_whitelist_user(
    username: str,
    endpoint_id: int = 0,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """管理员移除白名单用户（vSkin 兼容）"""
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
    description = body.get("description", "")
    set_as_device_shared_client = bool(body.get("set_as_device_shared_client", False))
    return await oauth_backend.create_app(db, client_name, redirect_uri, description, set_as_device_shared_client)


@router.put("/oauth/apps/{app_id}")
async def update_oauth_app_v2(
    app_id: int,
    body: dict = Body(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    client_name = body.get("client_name", "")
    redirect_uri = body.get("redirect_uri", "")
    description = body.get("description")
    set_as_device_shared_client = body.get("set_as_device_shared_client")
    return await oauth_backend.update_app(db, app_id, client_name, redirect_uri, description, set_as_device_shared_client)


@router.post("/oauth/apps/{app_id}/reset-secret")
async def reset_oauth_app_secret_v2(
    app_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    return await oauth_backend.reset_app_secret(db, app_id)


@router.delete("/oauth/apps/{app_id}")
async def delete_oauth_app_v2(app_id: int, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_admin)):
    await oauth_backend.delete_app(db, app_id)
    return {"ok": True}


@router.get("/oauth/meta")
async def get_oauth_meta(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_admin)):
    """返回 OAuth 支持的 scopes、端点 URL 和设备流设置"""
    return await oauth_backend.admin_meta(db)


@router.get("/oauth/device-settings")
async def get_oauth_device_settings(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_admin)):
    return await oauth_backend.get_admin_device_settings(db)


@router.post("/oauth/device-settings")
async def save_oauth_device_settings(
    body: dict = Body(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    return await oauth_backend.save_admin_device_settings(db, body)
