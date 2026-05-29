"""管理员后台 API。需要 admin 或 super_admin 权限。"""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_admin, get_current_super_admin
from app.models import (
    User, UserGroup, InviteCode, OAuthApp, SiteSetting, Carousel,
)

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
    used: bool
    used_by_id: int | None
    created_at: datetime


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
            id=i.id, code=i.code, used=i.used,
            used_by_id=i.used_by_id, created_at=i.created_at,
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
        item = InviteCode(code=code)
        db.add(item)
        new_items.append(item)
    await db.commit()
    for item in new_items:
        await db.refresh(item)
    return [
        InviteOut(
            id=i.id, code=i.code, used=i.used,
            used_by_id=i.used_by_id, created_at=i.created_at,
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


# ============== OAuth Apps ==============
class OAuthAppOut(BaseModel):
    id: int
    name: str
    description: str | None
    client_secret: str
    redirect_uri: str
    scopes: list[str]
    is_device_shared: bool
    created_at: datetime


class OAuthAppCreate(BaseModel):
    name: str
    description: str | None = None
    redirect_uri: str
    scopes: list[str] = Field(default_factory=lambda: ["userinfo"])
    is_device_shared: bool = False


class OAuthAppUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    redirect_uri: str | None = None
    scopes: list[str] | None = None
    is_device_shared: bool | None = None
    regenerate_secret: bool = False


@router.get("/oauth-apps", response_model=list[OAuthAppOut])
async def list_oauth_apps(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    rows = (await db.execute(select(OAuthApp).order_by(OAuthApp.created_at.desc()))).scalars().all()
    return [
        OAuthAppOut(
            id=a.id, name=a.name, description=a.description, client_secret=a.client_secret,
            redirect_uri=a.redirect_uri, scopes=a.scopes or [],
            is_device_shared=a.is_device_shared, created_at=a.created_at,
        )
        for a in rows
    ]


@router.post("/oauth-apps", response_model=OAuthAppOut)
async def create_oauth_app(
    body: OAuthAppCreate,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_admin),
):
    a = OAuthApp(
        name=body.name, description=body.description,
        client_secret=secrets.token_urlsafe(32),
        redirect_uri=body.redirect_uri, scopes=body.scopes,
        is_device_shared=body.is_device_shared, owner_id=actor.id,
    )
    db.add(a)
    await db.commit()
    await db.refresh(a)
    return OAuthAppOut(
        id=a.id, name=a.name, description=a.description, client_secret=a.client_secret,
        redirect_uri=a.redirect_uri, scopes=a.scopes or [],
        is_device_shared=a.is_device_shared, created_at=a.created_at,
    )


@router.put("/oauth-apps/{app_id}", response_model=OAuthAppOut)
async def update_oauth_app(
    app_id: int,
    body: OAuthAppUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    a = (await db.execute(select(OAuthApp).where(OAuthApp.id == app_id))).scalar_one_or_none()
    if not a:
        raise HTTPException(status_code=404, detail="not found")
    data = body.model_dump(exclude_unset=True)
    if data.pop("regenerate_secret", False):
        a.client_secret = secrets.token_urlsafe(32)
    for k, v in data.items():
        setattr(a, k, v)
    await db.commit()
    await db.refresh(a)
    return OAuthAppOut(
        id=a.id, name=a.name, description=a.description, client_secret=a.client_secret,
        redirect_uri=a.redirect_uri, scopes=a.scopes or [],
        is_device_shared=a.is_device_shared, created_at=a.created_at,
    )


@router.delete("/oauth-apps/{app_id}")
async def delete_oauth_app(
    app_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    a = (await db.execute(select(OAuthApp).where(OAuthApp.id == app_id))).scalar_one_or_none()
    if not a:
        raise HTTPException(status_code=404, detail="not found")
    await db.delete(a)
    await db.commit()
    return {"ok": True}


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
    oauth_app_count = (await db.execute(select(func.count(OAuthApp.id)))).scalar() or 0
    return {
        "users": user_count,
        "invites": invite_count,
        "oauth_apps": oauth_app_count,
    }
