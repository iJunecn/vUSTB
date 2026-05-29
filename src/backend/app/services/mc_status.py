"""MC 服务器状态服务：Redis 缓存 + 异步刷新。

策略：
- get_status: 优先读 Redis；若过期则返回缓存版本并 fire-and-forget 触发刷新。
- refresh_all: Celery 周期任务调用，刷新数据库中的所有服务器。
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any

import redis.asyncio as aioredis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import AsyncSessionLocal
from app.models import MCServer
from app.utils.mc_ping import query_server_status

logger = logging.getLogger(__name__)

_CACHE_TTL_SECONDS = 60
_KEY_PREFIX = "mc:status:"


def _cache_key(address: str) -> str:
    return _KEY_PREFIX + address


_redis: aioredis.Redis | None = None


def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis


async def _ping_async(address: str) -> dict[str, Any]:
    return await asyncio.to_thread(query_server_status, address)


async def refresh_one(server: MCServer, db: AsyncSession) -> dict[str, Any]:
    status = await _ping_async(server.address)
    server.last_status = status
    server.last_checked_at = datetime.now(timezone.utc)
    await db.commit()
    try:
        await get_redis().setex(_cache_key(server.address), _CACHE_TTL_SECONDS, json.dumps(status))
    except Exception as exc:
        logger.warning("redis setex failed for %s: %s", server.address, exc)
    return status


async def get_status_cached(address: str) -> dict[str, Any] | None:
    try:
        raw = await get_redis().get(_cache_key(address))
    except Exception as exc:
        logger.warning("redis get failed for %s: %s", address, exc)
        return None
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


async def get_status_with_fallback(server: MCServer, db: AsyncSession) -> dict[str, Any]:
    cached = await get_status_cached(server.address)
    if cached:
        return cached
    return await refresh_one(server, db)


async def refresh_all_servers() -> int:
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(MCServer))).scalars().all()
        count = 0
        for s in rows:
            try:
                await refresh_one(s, db)
                count += 1
            except Exception as exc:
                logger.warning("refresh %s failed: %s", s.address, exc)
        return count
