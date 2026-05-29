"""MC 服务器列表与状态接口。

公开接口：
- GET /api/mc-servers              列出所有 is_public=True 的服务器（不含敏感字段）
- GET /api/mc-servers/statuses     批量取实时状态（Redis 缓存优先）
- GET /api/mc-servers/{id}/status  单个服务器实时状态

管理员：
- POST   /api/mc-servers
- PUT    /api/mc-servers/{id}
- DELETE /api/mc-servers/{id}
- POST   /api/mc-servers/{id}/refresh   强制刷新状态
"""
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_admin
from app.models import MCServer, User
from app.services.mc_status import get_status_with_fallback, refresh_one

router = APIRouter(prefix="/api/mc-servers", tags=["mc_servers"])


class MCServerOut(BaseModel):
    id: int
    name: str
    address: str | None = None
    description: str | None = None
    version_hint: str | None = None
    icon_url: str | None = None
    sort_order: int = 0
    is_public: bool = True
    last_checked_at: datetime | None = None
    last_status: dict | None = None

    @classmethod
    def from_orm_public(cls, s: MCServer, *, expose_address: bool) -> "MCServerOut":
        return cls(
            id=s.id, name=s.name,
            address=s.address if expose_address else None,
            description=s.description, version_hint=s.version_hint,
            icon_url=s.icon_url, sort_order=s.sort_order, is_public=s.is_public,
            last_checked_at=s.last_checked_at, last_status=s.last_status,
        )


class MCServerCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    address: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    version_hint: str | None = None
    icon_url: str | None = None
    is_public: bool = True
    sort_order: int = 0
    expose_address: bool = True


class MCServerUpdate(BaseModel):
    name: str | None = None
    address: str | None = None
    description: str | None = None
    version_hint: str | None = None
    icon_url: str | None = None
    is_public: bool | None = None
    sort_order: int | None = None
    expose_address: bool | None = None


# expose_address 通过 description 后续可以做更精细字段，先以列上 is_public 判定 + name 永远暴露
def _expose_address(server: MCServer) -> bool:
    # 简化：所有公共服务器都暴露地址；后续如需"仅展示名"再加专用字段
    return True


@router.get("", response_model=list[MCServerOut])
async def list_servers(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(MCServer).where(MCServer.is_public == True).order_by(MCServer.sort_order, MCServer.id)
    )).scalars().all()
    return [MCServerOut.from_orm_public(s, expose_address=_expose_address(s)) for s in rows]


@router.get("/statuses")
async def server_statuses(db: AsyncSession = Depends(get_db)) -> list[dict[str, Any]]:
    rows = (await db.execute(
        select(MCServer).where(MCServer.is_public == True).order_by(MCServer.sort_order, MCServer.id)
    )).scalars().all()
    out: list[dict[str, Any]] = []
    for s in rows:
        status = await get_status_with_fallback(s, db)
        out.append({
            "id": s.id, "name": s.name,
            "address": s.address if _expose_address(s) else None,
            "icon_url": s.icon_url,
            "version_hint": s.version_hint,
            "status": status,
        })
    return out


@router.get("/{server_id}/status")
async def server_status(server_id: int, db: AsyncSession = Depends(get_db)):
    s = (await db.execute(select(MCServer).where(MCServer.id == server_id))).scalar_one_or_none()
    if not s or not s.is_public:
        raise HTTPException(status_code=404, detail="not found")
    return await get_status_with_fallback(s, db)


# ====== 管理员 ======
@router.post("", response_model=MCServerOut)
async def create_server(
    body: MCServerCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    s = MCServer(
        name=body.name, address=body.address, description=body.description,
        version_hint=body.version_hint, icon_url=body.icon_url,
        is_public=body.is_public, sort_order=body.sort_order,
    )
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return MCServerOut.from_orm_public(s, expose_address=True)


@router.put("/{server_id}", response_model=MCServerOut)
async def update_server(
    server_id: int,
    body: MCServerUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    s = (await db.execute(select(MCServer).where(MCServer.id == server_id))).scalar_one_or_none()
    if not s:
        raise HTTPException(status_code=404, detail="not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        if k == "expose_address":
            continue
        setattr(s, k, v)
    await db.commit()
    await db.refresh(s)
    return MCServerOut.from_orm_public(s, expose_address=True)


@router.delete("/{server_id}")
async def delete_server(
    server_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    s = (await db.execute(select(MCServer).where(MCServer.id == server_id))).scalar_one_or_none()
    if not s:
        raise HTTPException(status_code=404, detail="not found")
    await db.delete(s)
    await db.commit()
    return {"ok": True}


@router.post("/{server_id}/refresh")
async def force_refresh(
    server_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    s = (await db.execute(select(MCServer).where(MCServer.id == server_id))).scalar_one_or_none()
    if not s:
        raise HTTPException(status_code=404, detail="not found")
    status = await refresh_one(s, db)
    return {"ok": True, "status": status}
