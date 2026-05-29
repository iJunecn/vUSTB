"""Camera preset CRUD endpoints."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_admin
from app.models import User
from app.models.scene_camera_preset import SceneCameraPreset

router = APIRouter(prefix="/api/camera-presets", tags=["camera_presets"])


class PresetOut(BaseModel):
    preset_key: str
    position: dict
    look_target: dict
    perspective_mode: str | None = None
    updated_at: datetime | None = None


class PresetUpsert(BaseModel):
    position: dict
    look_target: dict
    perspective_mode: str | None = None


@router.get("", response_model=list[PresetOut])
async def list_presets(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(SceneCameraPreset))).scalars().all()
    return [
        PresetOut(
            preset_key=p.preset_key,
            position=p.position,
            look_target=p.look_target,
            perspective_mode=p.perspective_mode,
            updated_at=p.updated_at,
        )
        for p in rows
    ]


@router.put("/{preset_key}", response_model=PresetOut)
async def upsert_preset(
    preset_key: str,
    body: PresetUpsert,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    existing = (
        await db.execute(select(SceneCameraPreset).where(SceneCameraPreset.preset_key == preset_key))
    ).scalar_one_or_none()
    if existing:
        existing.position = body.position
        existing.look_target = body.look_target
        existing.perspective_mode = body.perspective_mode
    else:
        existing = SceneCameraPreset(
            preset_key=preset_key,
            position=body.position,
            look_target=body.look_target,
            perspective_mode=p.perspective_mode,
        )
        db.add(existing)
    await db.commit()
    await db.refresh(existing)
    return PresetOut(
        preset_key=existing.preset_key,
        position=existing.position,
        look_target=existing.look_target,
        perspective_mode=existing.perspective_mode,
        updated_at=existing.updated_at,
    )


@router.delete("/{preset_key}")
async def delete_preset(
    preset_key: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    existing = (
        await db.execute(select(SceneCameraPreset).where(SceneCameraPreset.preset_key == preset_key))
    ).scalar_one_or_none()
    if not existing:
        raise HTTPException(status_code=404, detail="not found")
    await db.delete(existing)
    await db.commit()
    return {"ok": True}
