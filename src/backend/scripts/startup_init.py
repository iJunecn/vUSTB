"""启动期初始化：等待 DB、创建表（开发兜底）、生成 RSA 密钥。"""
import asyncio
import logging
from sqlalchemy import text

from app.database import Base, engine
from app.database.schema_sync import sync_schema
from app import models  # noqa: F401
from app.config import settings

logger = logging.getLogger("startup")


async def wait_for_db(retries: int = 30, delay: float = 1.0) -> None:
    for i in range(retries):
        try:
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
            return
        except Exception as exc:  # noqa: BLE001
            logger.warning("waiting for db (%s/%s): %s", i + 1, retries, exc)
            await asyncio.sleep(delay)
    raise RuntimeError("database not reachable")


async def ensure_schema() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # 为已存在的旧表补齐模型迭代后新增的列，避免 select 时 SQL 报错
        # 导致老账号无法登录、重新注册又被唯一约束挡住。
        await sync_schema(conn)


def ensure_keys() -> None:
    from scripts.gen_key import generate_rsa_keypair
    generate_rsa_keypair()


async def run() -> None:
    await wait_for_db()
    await ensure_schema()
    ensure_keys()
    logger.info("startup init done; env=%s", settings.environment)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run())
