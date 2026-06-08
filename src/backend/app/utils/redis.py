"""共享 Redis 客户端。"""
import json
import logging
from typing import Any

import redis.asyncio as aioredis

from app.config import settings

logger = logging.getLogger(__name__)

_redis: aioredis.Redis | None = None


def get_redis() -> aioredis.Redis:
    """获取共享 Redis 客户端（懒初始化）。"""
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis


# JSON 序列化便捷方法


async def set_json(key: str, data: dict, ex: int | None = None) -> None:
    """将 dict 序列化为 JSON 存入 Redis，可选 TTL（秒）。"""
    r = get_redis()
    await r.set(key, json.dumps(data, ensure_ascii=False), ex=ex)


async def get_json(key: str) -> dict | None:
    """从 Redis 读取 JSON 并反序列化为 dict。key 不存在返回 None。"""
    r = get_redis()
    raw = await r.get(key)
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None


async def delete(key: str) -> None:
    """删除一个 key。"""
    r = get_redis()
    await r.delete(key)


async def exists(key: str) -> bool:
    """检查 key 是否存在。"""
    r = get_redis()
    return bool(await r.exists(key))
