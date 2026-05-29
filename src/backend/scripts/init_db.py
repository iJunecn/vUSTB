"""数据库表自动创建脚本（开发用，生产建议用 alembic）"""
import asyncio

from app.database import Base, engine
from app import models  # noqa: F401  确保所有模型被导入注册到 Base.metadata


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("[init_db] all tables created")


if __name__ == "__main__":
    asyncio.run(init_db())
