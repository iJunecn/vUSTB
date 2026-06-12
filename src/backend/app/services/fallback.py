"""Fallback 转发后端。"""
import asyncio
import logging
from typing import Optional, List, Dict, Any, Callable

import aiohttp
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import FallbackEndpoint, SiteSetting

logger = logging.getLogger("vustb.fallback")


class FallbackBackend:
    """Fallback 转发后端：按优先级将请求转发至配置的外部 Yggdrasil 服务。"""

    async def _resolve_fallbacks(self, db: AsyncSession) -> tuple[list[dict], str]:
        rows = (await db.execute(
            select(FallbackEndpoint).order_by(FallbackEndpoint.priority.asc(), FallbackEndpoint.id.asc())
        )).scalars().all()

        services = [
            {
                "id": r.id,
                "priority": r.priority,
                "session_url": r.session_url,
                "account_url": r.account_url,
                "services_url": r.services_url,
                "cache_ttl": r.cache_ttl,
                "skin_domains": r.skin_domains,
                "enable_profile": r.enable_profile,
                "enable_hasjoined": r.enable_hasjoined,
                "enable_whitelist": r.enable_whitelist,
                "note": r.note,
            }
            for r in rows
        ]

        strategy_row = (await db.execute(
            select(SiteSetting).where(SiteSetting.key == "fallback_strategy")
        )).scalar_one_or_none()
        strategy = strategy_row.value if strategy_row else "serial"

        return services, strategy

    async def _run_fallbacks(self, services: list[dict], strategy: str, request_func: Callable):
        if not services:
            return None

        async with aiohttp.ClientSession() as session:
            async def run_one(service: dict):
                return await request_func(service, session)

            if strategy == "parallel":
                tasks = [asyncio.create_task(run_one(s)) for s in services]
                try:
                    for task in asyncio.as_completed(tasks):
                        result = await task
                        if result is not None:
                            for other in tasks:
                                if other is not task:
                                    other.cancel()
                            return result
                finally:
                    for task in tasks:
                        if not task.done():
                            task.cancel()
                return None

            for service in services:
                result = await run_one(service)
                if result is not None:
                    return result
        return None

    async def has_joined(self, db: AsyncSession, username: str, serverId: str, ip: Optional[str] = None) -> Optional[Response]:
        services, strategy = await self._resolve_fallbacks(db)
        if not services:
            return None

        async def request_has_joined(service: dict, session: aiohttp.ClientSession):
            if not service.get("enable_hasjoined", True):
                return None

            session_url = service.get("session_url")
            if not session_url:
                return None

            params = {"username": username, "serverId": serverId}
            if ip:
                params["ip"] = ip

            target_url = f"{session_url}/session/minecraft/hasJoined"
            try:
                async with session.get(target_url, params=params, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                    if resp.status == 200:
                        content = await resp.read()
                        return Response(content=content, status_code=200, media_type="application/json")
            except Exception as e:
                logger.error(f"[Fallback] hasJoined failed: {e} | Service: {service.get('id')}")
            return None

        return await self._run_fallbacks(services, strategy, request_has_joined)

    async def get_profile(self, db: AsyncSession, uuid: str, unsigned: bool = True) -> Optional[Response]:
        services, strategy = await self._resolve_fallbacks(db)

        async def request_profile(service: dict, session: aiohttp.ClientSession):
            if not service.get("enable_profile", True):
                return None

            session_url = service.get("session_url")
            if not session_url:
                return None

            target_url = f"{session_url}/session/minecraft/profile/{uuid}?unsigned={str(unsigned).lower()}"
            try:
                async with session.get(target_url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                    if resp.status == 200:
                        content = await resp.read()
                        return Response(content=content, status_code=200, media_type="application/json")
            except Exception as e:
                logger.error(f"[Fallback] Profile fetch failed: {e} | Service: {service.get('id')}")
            return None

        return await self._run_fallbacks(services, strategy, request_profile)

    async def get_profile_by_name(self, db: AsyncSession, playerName: str) -> Optional[Response]:
        services, strategy = await self._resolve_fallbacks(db)

        async def request_uuid(service: dict, session: aiohttp.ClientSession):
            if not service.get("enable_profile", True):
                return None

            account_url = service.get("account_url")
            if not account_url:
                return None

            target_url = f"{account_url}/users/profiles/minecraft/{playerName}"
            try:
                async with session.get(target_url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                    if resp.status == 200:
                        content = await resp.read()
                        return Response(content=content, status_code=200, media_type="application/json")
            except Exception as e:
                logger.error(f"[Fallback] UUID lookup failed: {e} | Service: {service.get('id')}")
            return None

        return await self._run_fallbacks(services, strategy, request_uuid)

    async def bulk_lookup(self, db: AsyncSession, names: List[str]) -> Optional[List[Dict]]:
        services, strategy = await self._resolve_fallbacks(db)

        async def request_bulk(service: dict, session: aiohttp.ClientSession):
            if not service.get("enable_profile", True):
                return None

            account_url = service.get("account_url")
            if not account_url:
                return None

            target_url = f"{account_url}/profiles/minecraft"
            try:
                async with session.post(target_url, json=names, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                    if resp.status == 200:
                        return await resp.json()
            except Exception as e:
                logger.error(f"[Fallback] Bulk lookup failed: {e} | Service: {service.get('id')}")
            return None

        return await self._run_fallbacks(services, strategy, request_bulk)

    async def services_lookup(self, db: AsyncSession, playerName: str) -> Optional[Response]:
        services, strategy = await self._resolve_fallbacks(db)

        async def request_services_lookup(service: dict, session: aiohttp.ClientSession):
            if not service.get("enable_profile", True):
                return None

            services_url = service.get("services_url")
            if not services_url:
                return None

            target_url = f"{services_url}/minecraft/profile/lookup/name/{playerName}"
            try:
                async with session.get(target_url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                    if resp.status == 200:
                        content = await resp.read()
                        return Response(content=content, status_code=200, media_type="application/json")
            except Exception as e:
                logger.error(f"[Fallback] Services lookup failed: {e} | Service: {service.get('id')}")
            return None

        return await self._run_fallbacks(services, strategy, request_services_lookup)


fallback_backend = FallbackBackend()
