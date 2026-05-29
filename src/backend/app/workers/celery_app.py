"""Celery 应用。Broker 与 Backend 均使用 Redis。"""
from celery import Celery
from celery.schedules import crontab

from app.config import settings

celery_app = Celery(
    "vustb",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["app.workers.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Shanghai",
    enable_utc=True,
)

celery_app.conf.beat_schedule = {
    "refresh-mc-server-status-every-2min": {
        "task": "app.workers.tasks.refresh_mc_status",
        "schedule": 120.0,
    },
}
