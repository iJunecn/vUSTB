"""MC 服务器状态服务：Redis 缓存 + 异步刷新。

策略：
- get_status: 优先读 Redis；若过期则返回缓存版本并 fire-and-forget 触发刷新。
- refresh_all: Celery 周期任务调用，刷新数据库中的所有服务器。

检测方式：
- 使用 motd.minebbs.com API（/api/status?host=xxx）查询服务器状态，
  避免因部署环境网络限制导致直连 MC 端口超时/失败。
- 若 API 不可达，回退到本地 socket 直连（mc_ping.py）。
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timezone
from typing import Any

import httpx
import redis.asyncio as aioredis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import AsyncSessionLocal
from app.models import MCServer

logger = logging.getLogger(__name__)

_CACHE_TTL_SECONDS = 60
_KEY_PREFIX = "mc:status:"
_MOTD_API_BASE = "https://motd.minebbs.com"


def _cache_key(address: str) -> str:
    return _KEY_PREFIX + address


_redis: aioredis.Redis | None = None


def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis


def _extract_motd_text(motd: Any) -> str:
    """从 motd.minebbs.com 返回的 motd 字段中提取纯文本。

    motd 可能是：
    - 字符串（plain text）
    - JSON Text Component dict（如 {"extra": [...], "text": "..."}）
    - JSON Text Component list
    """
    if motd is None:
        return ""
    if isinstance(motd, str):
        # 去掉 §x 颜色代码
        return re.sub(r"§[0-9a-fk-or]", "", motd, flags=re.IGNORECASE)
    if isinstance(motd, list):
        return "".join(_extract_motd_text(item) for item in motd)
    if isinstance(motd, dict):
        parts: list[str] = []
        if "text" in motd:
            parts.append(_extract_motd_text(motd.get("text")))
        if "extra" in motd:
            parts.append(_extract_motd_text(motd.get("extra")))
        return "".join(parts)
    return re.sub(r"§[0-9a-fk-or]", "", str(motd), flags=re.IGNORECASE)


def _map_motd_api_response(data: dict[str, Any], address: str) -> dict[str, Any]:
    """将 motd.minebbs.com /api/status 返回值映射为内部统一格式。

    API 返回格式：
    - online: {"type":"Java","status":"online","host":"...","motd":...,"pureMotd":"...",
               "version":"...","protocol":774,"players":{"online":0,"max":1952,"sample":"无"},
               "icon":"data:image/png;base64,...","delay":79,"cached":false}
    - offline: {"status":"offline","host":"...","error":"..."}
    """
    if data.get("status") != "online":
        return {
            "status": "offline",
            "type": data.get("type", "unknown").lower() if data.get("type") else "unknown",
            "host": data.get("host", address),
            "delay_ms": data.get("delay", 0),
        }

    server_type = data.get("type", "java").lower()  # "java" or "bedrock"
    players_data = data.get("players", {})
    sample_raw = players_data.get("sample")
    # sample 可能是字符串（如 "无"）或列表
    sample_list: list[str] = []
    if isinstance(sample_raw, list):
        sample_list = [p.get("name", "") if isinstance(p, dict) else str(p)
                       for p in sample_raw if p]
    elif isinstance(sample_raw, str) and sample_raw not in ("无", "None", ""):
        sample_list = [sample_raw]

    # motd 文本：优先用 pureMotd（API 已剥离颜色代码），其次自行解析
    motd_text = data.get("pureMotd") or _extract_motd_text(data.get("motd"))

    return {
        "status": "online",
        "type": server_type,
        "host": data.get("host", address),
        "motd": motd_text,
        "version": data.get("version"),
        "protocol": data.get("protocol"),
        "players": {
            "online": players_data.get("online"),
            "max": players_data.get("max"),
            "sample": sample_list,
        },
        "favicon": data.get("icon"),
        "delay_ms": data.get("delay", 0),
    }


async def _query_motd_api(address: str) -> dict[str, Any]:
    """通过 motd.minebbs.com API 查询服务器状态。

    请求: GET /api/status?host=<address>
    超时: 8 秒
    """
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                f"{_MOTD_API_BASE}/api/status",
                params={"host": address},
            )
            resp.raise_for_status()
            data = resp.json()
            return _map_motd_api_response(data, address)
    except Exception as exc:
        logger.warning("motd API query failed for %s: %s", address, exc)
        return None


async def _ping_local_fallback(address: str) -> dict[str, Any]:
    """本地 socket 直连回退（仅在 motd API 不可达时使用）。"""
    from app.utils.mc_ping import query_server_status
    return await asyncio.to_thread(query_server_status, address)


async def _ping_async(address: str) -> dict[str, Any]:
    """查询服务器状态：优先 motd API，不可达则回退到本地直连。"""
    result = await _query_motd_api(address)
    if result is not None:
        return result
    logger.info("motd API unreachable, falling back to local ping for %s", address)
    return await _ping_local_fallback(address)


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
