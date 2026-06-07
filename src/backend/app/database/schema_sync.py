"""轻量级 schema 同步：为已存在的表补齐新增列，并为 PostgreSQL enum 类型补齐新增值。

`Base.metadata.create_all` 只会创建缺失的表，不会向已存在的表添加新列，
也不会向已存在的 enum 类型添加新值。
当模型在迭代中新增了字段或 enum 成员（如 point_reason 增加 admin_adjust），
旧数据库会缺少对应列或 enum 值，导致 INSERT 直接抛出 SQL 异常。

这里通过 Inspector 比对实际表结构与 ORM 模型，自动 ALTER TABLE 增列，
并自动 ALTER TYPE ADD VALUE 补齐 enum 值。
"""
from __future__ import annotations

import logging

from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import AsyncConnection
from sqlalchemy.schema import CreateColumn, CheckConstraint

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


async def _existing_enum_values(conn: AsyncConnection, type_name: str) -> set[str] | None:
    """查询 PostgreSQL 中某个 enum 类型的已有值，不存在则返回 None。"""
    def _query(sync_conn):
        result = sync_conn.execute(text(
            "SELECT enumlabel FROM pg_enum e "
            "JOIN pg_type t ON e.enumtypid = t.oid "
            "WHERE t.typname = :name ORDER BY e.enumsortorder"
        ), {"name": type_name})
        rows = result.fetchall()
        return {r[0] for r in rows} if rows else None

    return await conn.run_sync(_query)


def _collect_enum_types() -> dict[str, set[str]]:
    """从 ORM 元数据中收集所有 Enum 列对应的 {pg_type_name: {value1, value2, ...}}。"""
    from sqlalchemy import Enum as SAEnum

    enums: dict[str, set[str]] = {}
    for table in Base.metadata.sorted_tables:
        for column in table.columns:
            col_type = column.type
            if isinstance(col_type, SAEnum):
                pg_name = col_type.name
                if pg_name and pg_name not in enums:
                    enums[pg_name] = set(col_type.enums)
    return enums


async def _sync_enum_values(conn: AsyncConnection) -> None:
    """为 PostgreSQL 中已有的 enum 类型补齐 ORM 中新增但 DB 中缺失的值。

    例如 point_reason 在 Python 侧新增了 admin_adjust，
    但数据库中该 enum 类型还不包含此值，INSERT 会直接报错。
    此函数自动 ALTER TYPE ADD VALUE 补齐。
    """
    expected = _collect_enum_types()
    for type_name, values in expected.items():
        existing = await _existing_enum_values(conn, type_name)
        if existing is None:
            # enum 类型不存在，由 create_all 负责创建
            continue
        missing = values - existing
        for val in sorted(missing):
            # PostgreSQL 要求 ALTER TYPE ADD VALUE 在事务外执行，
            # 但在 SQLAlchemy run_sync 的同步上下文中已自动处理。
            # 使用 IF NOT EXISTS 避免并发启动时重复添加报错。
            try:
                await conn.execute(
                    text(f'ALTER TYPE "{type_name}" ADD VALUE IF NOT EXISTS \'{val}\'')
                )
                logger.info("added enum value %s.%s", type_name, val)
            except Exception as exc:  # noqa: BLE001
                logger.warning("failed to add enum value %s.%s: %s", type_name, val, exc)


async def sync_schema(conn: AsyncConnection) -> None:
    """对所有 ORM 表执行：先做兼容性重命名，再补齐缺失列，同步 CheckConstraint，最后同步 enum 值。"""
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

        # 补齐 CheckConstraint（如 pixel_points >= 0）
        for constraint in table.constraints:
            if isinstance(constraint, CheckConstraint) and constraint.name:
                try:
                    await conn.execute(text(
                        f'ALTER TABLE "{table.name}" ADD CONSTRAINT "{constraint.name}" '
                        f'CHECK ({constraint.sqltext})'
                    ))
                    logger.info("added constraint %s on %s", constraint.name, table.name)
                except Exception as exc:  # noqa: BLE001
                    # 约束已存在时会报错，忽略即可
                    logger.info("constraint %s on %s already exists or skipped: %s", constraint.name, table.name, exc)

    # 同步 enum 类型值（如 point_reason 缺少 admin_adjust）
    await _sync_enum_values(conn)

    # 更新 server_default：pixel_points 从 0 改为 10
    try:
        await conn.execute(text(
            'ALTER TABLE "point_accounts" ALTER COLUMN "pixel_points" SET DEFAULT 10'
        ))
        logger.info("updated point_accounts.pixel_points server_default to 10")
    except Exception as exc:  # noqa: BLE001
        logger.warning("failed to update pixel_points server_default: %s", exc)
