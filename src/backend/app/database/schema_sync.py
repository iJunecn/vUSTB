"""轻量级 schema 同步：为已存在的表补齐新增列，并为 PostgreSQL enum 类型补齐新增值。

`Base.metadata.create_all` 只会创建缺失的表，不会向已存在的表添加新列，
也不会向已存在的 enum 类型添加新值。
当模型在迭代中新增了字段或 enum 成员（如 point_reason 增加 admin_adjust），
旧数据库会缺少对应列或 enum 值，导致 INSERT 直接抛出 SQL 异常。

这里通过 Inspector 比对实际表结构与 ORM 模型，自动 ALTER TABLE 增列，
并自动 ALTER TYPE ADD VALUE 补齐 enum 值。

注意：asyncpg 在事务中遇到错误会进入 aborted 状态，后续所有 SQL 都失败。
因此本模块对每个 ALTER 操作单独 try/except 并在出错后 rollback 当前事务
的保存点，以避免连锁失败。
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
    try:
        existing = await _existing_columns(conn, table_name)
    except Exception:  # noqa: BLE001
        logger.warning("failed to check columns for %s, skipping rename", table_name)
        return
    if existing is None:
        return
    if old in existing and new not in existing:
        await _safe_execute(
            conn,
            f'ALTER TABLE "{table_name}" RENAME COLUMN "{old}" TO "{new}"',
            f"renamed {table_name}.{old} -> {new}",
        )


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


async def _safe_execute(conn: AsyncConnection, sql: str, description: str) -> bool:
    """在事务中安全执行 SQL，出错时 rollback 保存点以避免事务 aborted。

    asyncpg 在事务中遇到错误会将事务标记为 aborted（InFailedSQLTransactionError），
    后续所有 SQL 都失败。使用 SAVEPOINT 可以在出错后 ROLLBACK TO SAVEPOINT，
    使事务恢复到正常状态，继续执行后续操作。
    """
    # 创建保存点
    await conn.execute(text("SAVEPOINT sp_sync"))
    try:
        await conn.execute(text(sql))
        logger.info("%s", description)
        # 释放保存点（成功时）
        await conn.execute(text("RELEASE SAVEPOINT sp_sync"))
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("failed: %s — %s", description, exc)
        # 回滚到保存点，使事务恢复可用状态
        try:
            await conn.execute(text("ROLLBACK TO SAVEPOINT sp_sync"))
        except Exception as rollback_exc:  # noqa: BLE001
            logger.error("rollback to savepoint also failed: %s", rollback_exc)
        return False


async def sync_schema(conn: AsyncConnection) -> None:
    """对所有 ORM 表执行：先做兼容性重命名，再补齐缺失列，同步 CheckConstraint。

    enum 值同步和 server_default 更新在独立的自动提交事务中执行，
    因为 PostgreSQL 的 ALTER TYPE ADD VALUE 不能在普通事务中运行。
    """
    # 兼容旧版本：verification_codes.purpose -> type
    await _rename_column_if_needed(conn, "verification_codes", "purpose", "type")

    # 确保新增的 enum 类型在 ALTER TABLE 之前就已存在
    # create_all 只为新表创建 enum，已有数据库需要手动创建
    # PostgreSQL 不支持 CREATE TYPE IF NOT EXISTS，用 DO 块 + pg_type 判断
    await _safe_execute(
        conn,
        'DO $$ BEGIN'
        '  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = \'article_status\') THEN'
        '    CREATE TYPE "article_status" AS ENUM (\'draft\', \'published\');'
        '  END IF;'
        ' END $$',
        "created enum type article_status",
    )

    for table in Base.metadata.sorted_tables:
        try:
            existing = await _existing_columns(conn, table.name)
        except Exception:  # noqa: BLE001
            logger.warning("failed to check columns for %s, skipping", table.name)
            continue
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
            await _safe_execute(conn, ddl, f"added {table.name}.{column.name}")

        # 补齐 CheckConstraint（如 pixel_points >= 0）
        for constraint in table.constraints:
            if isinstance(constraint, CheckConstraint) and constraint.name:
                await _safe_execute(
                    conn,
                    f'ALTER TABLE "{table.name}" ADD CONSTRAINT IF NOT EXISTS "{constraint.name}" '
                    f'CHECK ({constraint.sqltext})',
                    f"added constraint {constraint.name} on {table.name}",
                )

    # 更新 server_default：pixel_points 从 0 改为 10
    await _safe_execute(
        conn,
        'ALTER TABLE "point_accounts" ALTER COLUMN "pixel_points" SET DEFAULT 10',
        "updated point_accounts.pixel_points server_default to 10",
    )

    # 为 mc_servers.address 补加唯一约束（模型已声明 unique=True）
    # ON CONFLICT (address) 依赖此约束
    await _safe_execute(
        conn,
        'ALTER TABLE "mc_servers" ADD CONSTRAINT IF NOT EXISTS "uq_mc_servers_address" UNIQUE ("address")',
        "added unique constraint on mc_servers.address",
    )

    # 默认服务器种子数据：按 address 列唯一冲突，已存在则跳过
    default_servers = [
        ("主服", "mc.ustb.world", "Java Edition 1.21.11", "", 0),
        ("长期模组服", "mod.ustb.world", "", "重度机械症", 1),
        ("中短期模组服", "wzsj.ustb.world", "", "亡者世界", 2),
        ("休闲服", "utb.ustb.world", "", "乌托邦探险之旅", 3),
    ]
    for name, address, version_hint, theme, sort_order in default_servers:
        await _safe_execute(
            conn,
            f"INSERT INTO mc_servers (name, address, version_hint, theme, sort_order, is_public) "
            f"VALUES ('{name}', '{address}', '{version_hint}', '{theme}', {sort_order}, true) "
            f"ON CONFLICT (address) DO NOTHING",
            f"seeded default server {name}",
        )


async def sync_enum_values_separate() -> None:
    """在独立连接中同步 enum 值（ALTER TYPE ADD VALUE 需要自动提交事务）。

    必须在 sync_schema 之后单独调用，使用新的数据库连接，
    因为 asyncpg 不允许在普通事务中执行 ALTER TYPE ADD VALUE。
    """
    from app.database import engine

    expected = _collect_enum_types()
    if not expected:
        return

    async with engine.connect() as conn:
        for type_name, values in expected.items():
            existing = await _existing_enum_values(conn, type_name)
            if existing is None:
                # enum 类型不存在，由 create_all 负责创建
                continue
            missing = values - existing
            for val in sorted(missing):
                try:
                    # 使用自动提交模式执行 ALTER TYPE ADD VALUE
                    await conn.execute(
                        text(f'ALTER TYPE "{type_name}" ADD VALUE IF NOT EXISTS \'{val}\'')
                    )
                    # 必须在每次 ALTER TYPE ADD VALUE 后 commit，
                    # 因为 asyncpg 要求此操作在自动提交事务中执行
                    await conn.commit()
                    logger.info("added enum value %s.%s", type_name, val)
                except Exception as exc:  # noqa: BLE001
                    logger.warning("failed to add enum value %s.%s: %s", type_name, val, exc)
                    try:
                        await conn.rollback()
                    except Exception:
                        pass
