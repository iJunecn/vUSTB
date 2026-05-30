"""轻量级 schema 同步：为已存在的表补齐新增列。

`Base.metadata.create_all` 只会创建缺失的表，不会向已存在的表添加新列。
当模型在迭代中新增了字段（如 users 表增加 display_name / is_admin / banned_until），
旧数据库会缺少对应列，导致 SELECT 查询直接抛出 SQL 异常，原有账号既无法登录、
也无法重新注册。

这里通过 Inspector 比对实际表结构与 ORM 模型，自动 ALTER TABLE 增列。
为兼容已弃用字段，特别处理 verification_codes 的 purpose → type 重命名。
"""
from __future__ import annotations

import logging

from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import AsyncConnection
from sqlalchemy.schema import CreateColumn

from app.database import Base

logger = logging.getLogger("schema_sync")


async def _existing_columns(conn: AsyncConnection, table_name: str) -> set[str]:
    def _inspect(sync_conn):
        insp = inspect(sync_conn)
        if not insp.has_table(table_name):
            return None
        return {col["name"] for col in insp.get_columns(table_name)}

    return await conn.run_sync(_inspect)


def _column_ddl(table, column) -> str:
    """生成 PostgreSQL 兼容的 ADD COLUMN DDL 片段。

    若列声明为 NOT NULL 但没有 server_default，向已有数据的表添加会失败；
    此时退化为 NULL，避免阻塞启动。后续可通过填值脚本回填。
    """
    from sqlalchemy.dialects import postgresql

    col_ddl = str(CreateColumn(column).compile(dialect=postgresql.dialect())).strip()
    if "NOT NULL" in col_ddl and column.server_default is None and column.default is None:
        col_ddl = col_ddl.replace(" NOT NULL", "")
    return f'ALTER TABLE "{table.name}" ADD COLUMN IF NOT EXISTS {col_ddl}'


async def _rename_column_if_needed(
    conn: AsyncConnection, table_name: str, old: str, new: str
) -> None:
    existing = await _existing_columns(conn, table_name)
    if existing is None:
        return
    if old in existing and new not in existing:
        await conn.execute(
            text(f'ALTER TABLE "{table_name}" RENAME COLUMN "{old}" TO "{new}"')
        )
        logger.info("renamed %s.%s -> %s", table_name, old, new)


async def sync_schema(conn: AsyncConnection) -> None:
    """对所有 ORM 表执行：先做兼容性重命名，再补齐缺失列。"""
    # 兼容旧版本：verification_codes.purpose -> type
    await _rename_column_if_needed(conn, "verification_codes", "purpose", "type")

    for table in Base.metadata.sorted_tables:
        existing = await _existing_columns(conn, table.name)
        if existing is None:
            # 表不存在，由 create_all 负责创建
            continue
        for column in table.columns:
            if column.name in existing:
                continue
            if column.primary_key:
                # 主键变更不在自动同步范围内
                continue
            ddl = _column_ddl(table, column)
            try:
                await conn.execute(text(ddl))
                logger.info("added %s.%s", table.name, column.name)
            except Exception as exc:  # noqa: BLE001
                logger.warning("failed to add %s.%s: %s", table.name, column.name, exc)
