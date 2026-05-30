"""速率限制器 — 从 vSkin 搬运，适配 SQLAlchemy + SiteSetting 表。"""
import time
from collections import defaultdict
from typing import Dict, Tuple

from fastapi import HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import SiteSetting


class RateLimiter:
    """基于内存的简易速率限制器，配置从数据库 SiteSetting 表读取。"""

    def __init__(self) -> None:
        self._attempts: Dict[Tuple[str, str], list] = defaultdict(list)

    async def _get_setting(self, db: AsyncSession, key: str, default: str) -> str:
        row = (await db.execute(
            select(SiteSetting).where(SiteSetting.key == key)
        )).scalar_one_or_none()
        return row.value if row else default

    async def is_enabled(self, db: AsyncSession) -> bool:
        enabled = await self._get_setting(db, "rate_limit_enabled", "true")
        return enabled.lower() == "true"

    def _clean_old_attempts(self, ip: str, endpoint: str, window_seconds: int):
        current_time = time.time()
        key = (ip, endpoint)
        self._attempts[key] = [
            (ts, count)
            for ts, count in self._attempts[key]
            if current_time - ts < window_seconds
        ]

    async def _check_limit(self, ip: str, endpoint: str, max_val: int, window_seconds: int, db: AsyncSession) -> bool:
        if not await self.is_enabled(db):
            return True

        self._clean_old_attempts(ip, endpoint, window_seconds)
        key = (ip, endpoint)
        current_attempts = sum(count for _, count in self._attempts[key])

        if current_attempts >= max_val:
            return False

        self._attempts[key].append((time.time(), 1))
        return True

    async def check(self, request: Request, db: AsyncSession, is_auth_endpoint: bool = False):
        if not await self.is_enabled(db):
            return

        ip = request.client.host if request.client else "0.0.0.0"
        endpoint = request.url.path

        if is_auth_endpoint:
            max_attempts = int(await self._get_setting(db, "rate_limit_auth_attempts", "5"))
            window_minutes = int(await self._get_setting(db, "rate_limit_auth_window", "15"))
            if not await self._check_limit(ip, endpoint, max_attempts, window_minutes * 60, db):
                raise HTTPException(status_code=429, detail="Too many attempts. Please try again later.")
        else:
            if not await self._check_limit(ip, endpoint, 100, 60, db):
                raise HTTPException(status_code=429, detail="Rate limit exceeded. Please slow down.")

    def reset(self, ip: str, endpoint: str):
        key = (ip, endpoint)
        if key in self._attempts:
            del self._attempts[key]


# 全局单例
rate_limiter = RateLimiter()
