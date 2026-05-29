"""MC 服务器状态服务：Redis 缓存 + 异步刷新。

策略：
- get_status: 优先读 Redis；若过期则返回缓存版本并 fire-and-forget 触发刷新。
- refresh_all: Celery 周期任务调用，刷新数据库中的所有服务器。
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
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


# ---------------------------------------------------------------------------
# MOTD segment parser
# ---------------------------------------------------------------------------

# Minecraft color codes mapping
_MC_COLOR_MAP: dict[str, str | None] = {
    "0": "#000000",  # black
    "1": "#0000AA",  # dark_blue
    "2": "#00AA00",  # dark_green
    "3": "#00AAAA",  # dark_aqua
    "4": "#AA0000",  # dark_red
    "5": "#AA00AA",  # dark_purple
    "6": "#FFAA00",  # gold
    "7": "#AAAAAA",  # gray
    "8": "#555555",  # dark_gray
    "9": "#5555FF",  # blue
    "a": "#55FF55",  # green
    "b": "#55FFFF",  # aqua
    "c": "#FF5555",  # red
    "d": "#FF55FF",  # light_purple
    "e": "#FFFF55",  # yellow
    "f": "#FFFFFF",  # white
}

_MC_FORMAT_CODES: set[str] = {
    "k",  # obfuscated
    "l",  # bold
    "m",  # strikethrough
    "n",  # underlined
    "o",  # italic
}

_MC_SECTION_RE = re.compile(r"§([0-9a-fk-or])", re.IGNORECASE)


def parse_motd_segments(motd: str) -> list[dict[str, Any]]:
    """Parse Minecraft color codes (section-sign codes) into structured segments.

    Each segment is a dict with:
        text, color, bold, italic, underlined, strikethrough, obfuscated

    The parser tracks the current formatting state; a color code resets all
    formatting, while format codes are toggled independently.
    """
    if not motd:
        return []

    segments: list[dict[str, Any]] = []
    current_text: list[str] = []
    current_color: str | None = None
    current_bold: bool = False
    current_italic: bool = False
    current_underlined: bool = False
    current_strikethrough: bool = False
    current_obfuscated: bool = False

    def flush() -> None:
        text = "".join(current_text)
        if not text:
            return
        segments.append({
            "text": text,
            "color": current_color,
            "bold": current_bold,
            "italic": current_italic,
            "underlined": current_underlined,
            "strikethrough": current_strikethrough,
            "obfuscated": current_obfuscated,
        })
        current_text.clear()

    i = 0
    while i < len(motd):
        if motd[i] == "§" and i + 1 < len(motd):
            code = motd[i + 1].lower()
            if code in _MC_COLOR_MAP:
                flush()
                current_color = _MC_COLOR_MAP[code]
                current_bold = False
                current_italic = False
                current_underlined = False
                current_strikethrough = False
                current_obfuscated = False
            elif code in _MC_FORMAT_CODES:
                flush()
                if code == "l":
                    current_bold = True
                elif code == "m":
                    current_strikethrough = True
                elif code == "n":
                    current_underlined = True
                elif code == "o":
                    current_italic = True
                elif code == "k":
                    current_obfuscated = True
            elif code == "r":
                flush()
                current_color = None
                current_bold = False
                current_italic = False
                current_underlined = False
                current_strikethrough = False
                current_obfuscated = False
            i += 2
            continue
        current_text.append(motd[i])
        i += 1

    flush()
    return segments
