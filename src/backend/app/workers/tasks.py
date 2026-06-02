"""Celery 任务定义。"""
import asyncio
import logging

from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)

# Celery worker 是同步进程，但任务需要跑异步代码。
# 不能用 asyncio.run()：它每次创建新 event loop，而 SQLAlchemy engine
# 的连接池和 aioredis 客户端绑定在旧 loop 上，导致
# "Future attached to a different loop" 错误。
# 解决：每个 worker 进程维护一个持久 event loop，跨任务复用。
_loop: asyncio.AbstractEventLoop | None = None


def _get_loop() -> asyncio.AbstractEventLoop:
    global _loop
    if _loop is None or _loop.is_closed():
        _loop = asyncio.new_event_loop()
        asyncio.set_event_loop(_loop)
    return _loop


@celery_app.task(name="app.workers.tasks.refresh_mc_status")
def refresh_mc_status() -> int:
    """周期性刷新所有 MC 服务器状态。"""
    from app.services.mc_status import refresh_all_servers

    try:
        return _get_loop().run_until_complete(refresh_all_servers())
    except Exception as exc:
        logger.exception("refresh_mc_status failed: %s", exc)
        return -1
