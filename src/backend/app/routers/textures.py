"""材质（皮肤/披风）管理：上传、衣柜、公共库、绑定到角色。"""
from __future__ import annotations

import uuid as uuid_lib
from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.deps import get_current_user
from app.models import Texture, Wardrobe, Player, User
from app.utils.image import save_texture

router = APIRouter(prefix="/api/textures", tags=["textures"])


class TextureOut(BaseModel):
    id: int
    hash: str
    type: str
    model: str
    name: str
    is_public: bool
    uploader_id: int
    created_at: datetime
    url: str

    @classmethod
    def of(cls, t: Texture) -> "TextureOut":
        base = "/static/textures/"
        return cls(
            id=t.id, hash=t.hash, type=t.type, model=t.model, name=t.name,
            is_public=t.is_public, uploader_id=t.uploader_id, created_at=t.created_at,
            url=base + t.hash + ".png",
        )


@router.post("/upload", response_model=TextureOut)
async def upload_texture(
    file: UploadFile = File(...),
    type: str = Form("skin"),
    model: str = Form("classic"),
    name: str | None = Form(None),
    is_public: bool = Form(False),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if type not in ("skin", "cape"):
        raise HTTPException(status_code=400, detail="invalid type")
    if model not in ("classic", "slim"):
        raise HTTPException(status_code=400, detail="invalid model")
    data = await file.read()
    h = save_texture(data, kind=type)
    existing = (await db.execute(select(Texture).where(Texture.hash == h))).scalar_one_or_none()
    if existing:
        # add to user's wardrobe
        already = (await db.execute(
            select(Wardrobe).where(Wardrobe.user_id == user.id, Wardrobe.texture_id == existing.id)
        )).scalar_one_or_none()
        if not already:
            db.add(Wardrobe(user_id=user.id, texture_id=existing.id))
            await db.commit()
        return TextureOut.of(existing)
    t = Texture(
        hash=h, type=type, model=model if type == "skin" else "classic",
        name=name or f"{type}-{h[:8]}", is_public=bool(is_public), uploader_id=user.id,
    )
    db.add(t)
    await db.flush()
    db.add(Wardrobe(user_id=user.id, texture_id=t.id))
    await db.commit()
    await db.refresh(t)
    return TextureOut.of(t)


@router.get("/wardrobe", response_model=list[TextureOut])
async def my_wardrobe(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rows = (await db.execute(
        select(Texture).join(Wardrobe, Wardrobe.texture_id == Texture.id)
        .where(Wardrobe.user_id == user.id).order_by(Wardrobe.created_at.desc())
    )).scalars().all()
    return [TextureOut.of(t) for t in rows]


@router.delete("/wardrobe/{texture_id}")
async def remove_from_wardrobe(
    texture_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    row = (await db.execute(
        select(Wardrobe).where(Wardrobe.user_id == user.id, Wardrobe.texture_id == texture_id)
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    await db.delete(row)
    await db.commit()
    return {"ok": True}


@router.get("/library", response_model=list[TextureOut])
async def public_library(
    type: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    q = select(Texture).where(Texture.is_public == True)
    if type in ("skin", "cape"):
        q = q.where(Texture.type == type)
    rows = (await db.execute(q.order_by(Texture.created_at.desc()).limit(120))).scalars().all()
    return [TextureOut.of(t) for t in rows]


@router.post("/library/{texture_id}/collect")
async def collect_to_wardrobe(
    texture_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    t = (await db.execute(
        select(Texture).where(Texture.id == texture_id, Texture.is_public == True)
    )).scalar_one_or_none()
    if not t:
        raise HTTPException(status_code=404, detail="not found")
    already = (await db.execute(
        select(Wardrobe).where(Wardrobe.user_id == user.id, Wardrobe.texture_id == t.id)
    )).scalar_one_or_none()
    if not already:
        db.add(Wardrobe(user_id=user.id, texture_id=t.id))
        await db.commit()
    return {"ok": True}


# ---------------- Players (MC 角色) ----------------
players_router = APIRouter(prefix="/api/players", tags=["players"])


class PlayerOut(BaseModel):
    id: int
    uuid: str
    name: str
    skin_texture_id: int | None
    cape_texture_id: int | None
    skin_url: str | None = None
    cape_url: str | None = None
    created_at: datetime


class PlayerCreate(BaseModel):
    name: str


class PlayerBind(BaseModel):
    skin_texture_id: int | None = None
    cape_texture_id: int | None = None
    clear_skin: bool = False
    clear_cape: bool = False


async def _player_out(p: Player, db: AsyncSession) -> PlayerOut:
    base = "/static/textures/"
    skin_url = None
    cape_url = None
    if p.skin_texture_id:
        t = (await db.execute(select(Texture).where(Texture.id == p.skin_texture_id))).scalar_one_or_none()
        if t:
            skin_url = base + t.hash + ".png"
    if p.cape_texture_id:
        t = (await db.execute(select(Texture).where(Texture.id == p.cape_texture_id))).scalar_one_or_none()
        if t:
            cape_url = base + t.hash + ".png"
    return PlayerOut(
        id=p.id, uuid=p.uuid, name=p.name,
        skin_texture_id=p.skin_texture_id, cape_texture_id=p.cape_texture_id,
        skin_url=skin_url, cape_url=cape_url, created_at=p.created_at,
    )


@players_router.get("", response_model=list[PlayerOut])
async def list_my_players(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rows = (await db.execute(
        select(Player).where(Player.owner_id == user.id).order_by(Player.created_at)
    )).scalars().all()
    return [await _player_out(p, db) for p in rows]


@players_router.post("", response_model=PlayerOut)
async def create_player(
    body: PlayerCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    name = body.name.strip()
    if not (2 <= len(name) <= 24) or any(c.isspace() for c in name):
        raise HTTPException(status_code=400, detail="invalid name")
    existing = (await db.execute(select(Player).where(Player.name == name))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="name taken")
    p = Player(
        uuid=uuid_lib.uuid4().hex,
        name=name,
        owner_id=user.id,
    )
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return await _player_out(p, db)


@players_router.delete("/{player_id}")
async def delete_player(
    player_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    p = (await db.execute(
        select(Player).where(Player.id == player_id, Player.owner_id == user.id)
    )).scalar_one_or_none()
    if not p:
        raise HTTPException(status_code=404, detail="not found")
    await db.delete(p)
    await db.commit()
    return {"ok": True}


@players_router.post("/{player_id}/bind", response_model=PlayerOut)
async def bind_player(
    player_id: int,
    body: PlayerBind,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    p = (await db.execute(
        select(Player).where(Player.id == player_id, Player.owner_id == user.id)
    )).scalar_one_or_none()
    if not p:
        raise HTTPException(status_code=404, detail="not found")
    if body.clear_skin:
        p.skin_texture_id = None
    elif body.skin_texture_id is not None:
        t = (await db.execute(select(Texture).where(Texture.id == body.skin_texture_id))).scalar_one_or_none()
        if not t or t.type != "skin":
            raise HTTPException(status_code=400, detail="invalid skin texture")
        p.skin_texture_id = t.id
    if body.clear_cape:
        p.cape_texture_id = None
    elif body.cape_texture_id is not None:
        t = (await db.execute(select(Texture).where(Texture.id == body.cape_texture_id))).scalar_one_or_none()
        if not t or t.type != "cape":
            raise HTTPException(status_code=400, detail="invalid cape texture")
        p.cape_texture_id = t.id
    await db.commit()
    await db.refresh(p)
    return await _player_out(p, db)
