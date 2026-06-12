"""MC 服务器状态服务（Redis 缓存 + 异步刷新）。"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
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

# API 端点
_MCSTATUS_API = "https://api.mcstatus.io/v2/status/java"
_MOTD_API_BASE = "https://motd.minebbs.com"

# 浏览器 UA — motd.minebbs.com 需要浏览器 UA 才不返回 567
_BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


def _cache_key(address: str) -> str:
    return _KEY_PREFIX + address


_redis: aioredis.Redis | None = None


def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis


def _strip_format_codes(value: str) -> str:
    return re.sub(r"§[0-9a-fk-or]", "", value, flags=re.IGNORECASE)


def _extract_motd_text(motd: Any) -> str:
    """从 JSON Text Component 中递归提取纯文本。

    兼容 motd.minebbs.com 返回的 motd 字段格式：
    - 字符串
    - dict（{"extra": [...], "text": "..."}）
    - list
    """
    if motd is None:
        return ""
    if isinstance(motd, str):
        return _strip_format_codes(motd)
    if isinstance(motd, list):
        return "".join(_extract_motd_text(item) for item in motd)
    if isinstance(motd, dict):
        parts: list[str] = []
        if "text" in motd:
            parts.append(_extract_motd_text(motd.get("text")))
        if "extra" in motd:
            parts.append(_extract_motd_text(motd.get("extra")))
        return "".join(parts)
    return _strip_format_codes(str(motd))


# mcstatus.io 响应映射
def _map_mcstatus_response(data: dict[str, Any], address: str, elapsed_ms: int) -> dict[str, Any]:
    """将 api.mcstatus.io /v2/status/java 返回值映射为内部格式。

    在线时返回:
    {"online":true,"host":"...","port":25565,"ip_address":"...",
     "srv_record":{"host":"mcname.ustb.world","port":12001},
     "version":{"name_raw":"...","name_clean":"...","protocol":47},
     "players":{"online":0,"max":1952,"list":[...]},
     "motd":{"raw":"§1§l...","clean":"...","html":"..."},
     "icon":"data:image/png;base64,..."}

    离线时返回:
    {"online":false,"host":"...","port":25565,"ip_address":"..."}
    """
    if not data.get("online"):
        return {
            "status": "offline",
            "type": "java",
            "host": address,
            "delay_ms": elapsed_ms,
        }

    srv = data.get("srv_record") or {}
    host_display = f"{srv.get('host', data.get('host', address))}:{srv.get('port', data.get('port', 25565))}" if srv else address

    motd_data = data.get("motd", {})
    # 优先用 clean（已剥离颜色代码），其次 raw 再自行清理
    motd_text = (motd_data.get("clean") or _strip_format_codes(motd_data.get("raw", ""))) if motd_data else ""

    players_data = data.get("players", {})
    player_list = players_data.get("list", [])
    sample = [p.get("name", "") if isinstance(p, dict) else str(p) for p in player_list if p]

    version_data = data.get("version", {})

    return {
        "status": "online",
        "type": "java",
        "host": host_display,
        "motd": motd_text,
        "version": version_data.get("name_clean") or version_data.get("name_raw"),
        "protocol": version_data.get("protocol"),
        "players": {
            "online": players_data.get("online"),
            "max": players_data.get("max"),
            "sample": sample,
        },
        "favicon": data.get("icon"),
        "delay_ms": elapsed_ms,
    }


# motd.minebbs.com 响应映射
def _map_motd_api_response(data: dict[str, Any], address: str) -> dict[str, Any]:
    """将 motd.minebbs.com /api/status 返回值映射为内部格式。

    在线: {"type":"Java","status":"online","host":"...","motd":...,"pureMotd":"...",
           "version":"...","protocol":774,"players":{"online":0,"max":1952,"sample":"无"},
           "icon":"data:image/png;base64,...","delay":79}
    离线: {"status":"offline","host":"...","error":"..."}
    """
    if data.get("status") != "online":
        return {
            "status": "offline",
            "type": data.get("type", "unknown").lower() if data.get("type") else "unknown",
            "host": data.get("host", address),
            "delay_ms": data.get("delay", 0),
        }

    server_type = data.get("type", "java").lower()
    players_data = data.get("players", {})
    sample_raw = players_data.get("sample")
    sample_list: list[str] = []
    if isinstance(sample_raw, list):
        sample_list = [p.get("name", "") if isinstance(p, dict) else str(p)
                       for p in sample_raw if p]
    elif isinstance(sample_raw, str) and sample_raw not in ("无", "None", ""):
        sample_list = [sample_raw]

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


# API 查询
async def _query_mcstatus_api(address: str) -> dict[str, Any]:
    """通过 api.mcstatus.io 查询 Java 服务器状态（主选 API）。

    请求: GET /v2/status/java/<address>
    该 API 对服务端请求友好，自动解析 SRV 记录。
    """
    start = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{_MCSTATUS_API}/{address}")
            resp.raise_for_status()
            data = resp.json()
            elapsed = int((time.monotonic() - start) * 1000)
            return _map_mcstatus_response(data, address, elapsed)
    except Exception as exc:
        logger.warning("mcstatus.io query failed for %s: %s", address, exc)
        return None


async def _query_motd_api(address: str) -> dict[str, Any]:
    """通过 motd.minebbs.com API 查询服务器状态（备选）。

    请求: GET /api/status?host=<address>
    需要浏览器 UA，数据中心 IP 可能返回 567。
    """
    try:
        async with httpx.AsyncClient(timeout=8.0, headers={"User-Agent": _BROWSER_UA}) as client:
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
    """本地 socket 直连回退（仅在所有远程 API 不可达时使用）。"""
    from app.utils.mc_ping import query_server_status
    return await asyncio.to_thread(query_server_status, address)


async def _ping_async(address: str) -> dict[str, Any]:
    """查询服务器状态：mcstatus.io → motd.minebbs.com → 本地直连。"""
    # 1. 主选: api.mcstatus.io
    result = await _query_mcstatus_api(address)
    if result is not None:
        return result

    # 2. 备选: motd.minebbs.com
    result = await _query_motd_api(address)
    if result is not None:
        return result

    # 3. 兜底: 本地 socket 直连
    logger.info("all remote APIs unreachable, falling back to local ping for %s", address)
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


# MOTD 解析

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
