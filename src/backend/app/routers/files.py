"""文件管理：受控下载（带短期 token）+ 上传到 uploads 目录。

基于原 USTB-Official-Backend 的 McaDownload + FileCatalog 思路简化：
- 文件元数据存数据库表 ManagedFile（路径、可见性、上传者）
- 列表/上传由 admin/teacher 控制
- 下载链接需要短期 download_token（HMAC，5 分钟），普通用户用 /api/files/{id}/grant 申请 token
- visibility: public/authenticated/admin
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from pathlib import Path
from typing import Literal

from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.deps import get_current_admin, get_current_user
from app.models import ManagedFile, User, UserGroup

router = APIRouter(prefix="/api/files", tags=["files"])


VISIBILITY = ("public", "authenticated", "admin")
Visibility = Literal["public", "authenticated", "admin"]


class ManagedFileOut(BaseModel):
    id: int
    name: str
    relative_path: str
    size: int
    content_type: str
    visibility: str
    description: str | None
    created_at: datetime


def _safe_join(base: Path, *parts: str) -> Path:
    target = (base / Path(*parts)).resolve()
    if base.resolve() not in target.parents and target != base.resolve():
        raise HTTPException(status_code=400, detail="invalid path")
    return target


def _sign_token(file_id: int, user_id: int | None, exp: int) -> str:
    msg = f"{file_id}.{user_id or 0}.{exp}".encode()
    sig = hmac.new(settings.jwt_secret.encode(), msg, hashlib.sha256).hexdigest()[:32]
    return f"{exp}.{user_id or 0}.{sig}"


def _verify_token(token: str, file_id: int) -> bool:
    try:
        exp_s, uid_s, sig = token.split(".")
        exp = int(exp_s)
        uid = int(uid_s)
    except Exception:
        return False
    if exp < int(time.time()):
        return False
    expected = _sign_token(file_id, uid or None, exp)
    return hmac.compare_digest(expected, token)


def _ensure_visibility_access(visibility: str, user: User | None) -> None:
    if visibility == "public":
        return
    if user is None:
        raise HTTPException(status_code=401, detail="login required")
    if visibility == "authenticated":
        return
    if visibility == "admin" and user.user_group not in (UserGroup.ADMIN, UserGroup.SUPER_ADMIN):
        raise HTTPException(status_code=403, detail="forbidden")


@router.get("", response_model=list[ManagedFileOut])
async def list_files(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(ManagedFile).order_by(ManagedFile.created_at.desc())
    )).scalars().all()
    return [ManagedFileOut.model_validate(r, from_attributes=True) for r in rows]


@router.post("/upload", response_model=ManagedFileOut)
async def upload_file(
    file: UploadFile = File(...),
    visibility: str = "public",
    description: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_admin),
):
    if visibility not in VISIBILITY:
        raise HTTPException(status_code=400, detail="invalid visibility")
    if not file.filename or "/" in file.filename or "\\" in file.filename or ".." in file.filename:
        raise HTTPException(status_code=400, detail="bad filename")
    base = Path(settings.uploads_directory)
    base.mkdir(parents=True, exist_ok=True)
    rel = f"{int(time.time())}_{secrets.token_hex(4)}_{file.filename}"
    target = _safe_join(base, rel)
    data = await file.read()
    target.write_bytes(data)

    obj = ManagedFile(
        name=file.filename, relative_path=rel, size=len(data),
        content_type=file.content_type or "application/octet-stream",
        visibility=visibility, uploader_id=user.id, description=description,
    )
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    return ManagedFileOut.model_validate(obj, from_attributes=True)


@router.delete("/{file_id}")
async def delete_file(
    file_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    obj = (await db.execute(select(ManagedFile).where(ManagedFile.id == file_id))).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="not found")
    target = _safe_join(Path(settings.uploads_directory), obj.relative_path)
    if target.exists():
        target.unlink()
    await db.delete(obj)
    await db.commit()
    return {"ok": True}


@router.post("/{file_id}/grant")
async def grant_download(
    file_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    obj = (await db.execute(select(ManagedFile).where(ManagedFile.id == file_id))).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="not found")
    _ensure_visibility_access(obj.visibility, user)
    exp = int(time.time()) + 5 * 60
    token = _sign_token(obj.id, user.id, exp)
    return {"token": token, "expires_at": exp, "url": f"/api/files/{file_id}/download?token={token}"}


@router.get("/{file_id}/download")
async def download_file(
    file_id: int,
    token: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    obj = (await db.execute(select(ManagedFile).where(ManagedFile.id == file_id))).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="not found")
    if obj.visibility != "public":
        if not token or not _verify_token(token, obj.id):
            raise HTTPException(status_code=403, detail="invalid token")
    path = _safe_join(Path(settings.uploads_directory), obj.relative_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="missing file")
    return FileResponse(path, media_type=obj.content_type, filename=obj.name)
