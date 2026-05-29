"""Celery 任务定义。"""
import asyncio
import logging

from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="app.workers.tasks.refresh_mc_status")
def refresh_mc_status() -> int:
    """周期性刷新所有 MC 服务器状态。"""
    from app.services.mc_status import refresh_all_servers

    try:
        return asyncio.run(refresh_all_servers())
    except Exception as exc:
        logger.exception("refresh_mc_status failed: %s", exc)
        return -1
