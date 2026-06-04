from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
import sqlite3
from pathlib import Path
from typing import Iterator

from .byyt import ByytUserInfo


@dataclass(slots=True)
class KeyRecord:
    id: int
    key_value: str
    bound_student_id: str | None
    bound_user_name: str | None
    bound_user_name_alt: str | None
    bound_user_school: str | None
    bound_user_school_alt: str | None
    bound_at: str | None

    def to_dict(self) -> dict[str, str | int | None]:
        return {
            "id": self.id,
            "key_value": self.key_value,
            "bound_student_id": self.bound_student_id,
            "bound_user_name": self.bound_user_name,
            "bound_user_name_alt": self.bound_user_name_alt,
            "bound_user_school": self.bound_user_school,
            "bound_user_school_alt": self.bound_user_school_alt,
            "bound_at": self.bound_at,
        }


@dataclass(slots=True)
class ClaimResult:
    status: str
    record: KeyRecord | None = None
    message: str = ""
    claimed_count: int = 0
    remaining_count: int = 0


class KeyStore:
    def __init__(self, database_path: Path) -> None:
        self.database_path = database_path
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.database_path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            yield connection
            connection.commit()
        finally:
            connection.close()

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS key_entries (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    key_value TEXT NOT NULL,
                    bound_student_id TEXT,
                    bound_user_name TEXT,
                    bound_user_name_alt TEXT,
                    bound_user_school TEXT,
                    bound_user_school_alt TEXT,
                    bound_at TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_key_entries_bound_student_id
                    ON key_entries(bound_student_id);
                CREATE INDEX IF NOT EXISTS idx_key_entries_bound_at
                    ON key_entries(bound_at);
                """
            )

    @staticmethod
    def _row_to_record(row: sqlite3.Row) -> KeyRecord:
        return KeyRecord(
            id=row["id"],
            key_value=row["key_value"],
            bound_student_id=row["bound_student_id"],
            bound_user_name=row["bound_user_name"],
            bound_user_name_alt=row["bound_user_name_alt"],
            bound_user_school=row["bound_user_school"],
            bound_user_school_alt=row["bound_user_school_alt"],
            bound_at=row["bound_at"],
        )

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")

    def list_keys(self) -> list[KeyRecord]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM key_entries ORDER BY CASE WHEN bound_at IS NULL THEN 0 ELSE 1 END, id ASC"
            ).fetchall()
        return [self._row_to_record(row) for row in rows]

    def get_user_claims(self, student_id: str) -> list[KeyRecord]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM key_entries WHERE bound_student_id = ? ORDER BY bound_at DESC, id DESC",
                (student_id,),
            ).fetchall()
        return [self._row_to_record(row) for row in rows]

    def count_user_claims(self, student_id: str) -> int:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT COUNT(*) AS count FROM key_entries WHERE bound_student_id = ?",
                (student_id,),
            ).fetchone()
        return int(row["count"] if row else 0)

    def count_available_keys(self) -> int:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT COUNT(*) AS count FROM key_entries WHERE bound_student_id IS NULL",
            ).fetchone()
        return int(row["count"] if row else 0)

    def add_keys(self, key_values: list[str]) -> int:
        values = [value.strip() for value in key_values if value and value.strip()]
        if not values:
            return 0
        with self._connect() as connection:
            connection.executemany(
                "INSERT INTO key_entries (key_value) VALUES (?)",
                [(value,) for value in values],
            )
        return len(values)

    def get_key(self, key_id: int) -> KeyRecord | None:
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM key_entries WHERE id = ?", (key_id,)).fetchone()
        return self._row_to_record(row) if row else None

    def claim_key_for_user(self, user: ByytUserInfo, max_keys_per_user: int) -> ClaimResult:
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            claimed_count_row = connection.execute(
                "SELECT COUNT(*) AS count FROM key_entries WHERE bound_student_id = ?",
                (user.user_id,),
            ).fetchone()
            claimed_count = int(claimed_count_row["count"] if claimed_count_row else 0)
            remaining_count = max(0, max_keys_per_user - claimed_count)
            if remaining_count <= 0:
                return ClaimResult(
                    status="limit_reached",
                    message="你已经领取到上限了",
                    claimed_count=claimed_count,
                    remaining_count=0,
                )

            row = connection.execute(
                "SELECT * FROM key_entries WHERE bound_student_id IS NULL ORDER BY id ASC LIMIT 1"
            ).fetchone()
            if not row:
                return ClaimResult(
                    status="empty",
                    message="当前没有可领取的 Key 了",
                    claimed_count=claimed_count,
                    remaining_count=remaining_count,
                )

            key_id = int(row["id"])
            bound_at = self._now()
            cursor = connection.execute(
                """
                UPDATE key_entries
                SET bound_student_id = ?,
                    bound_user_name = ?,
                    bound_user_name_alt = ?,
                    bound_user_school = ?,
                    bound_user_school_alt = ?,
                    bound_at = ?
                WHERE id = ? AND bound_student_id IS NULL
                """,
                (
                    user.user_id,
                    user.user_name,
                    user.user_name_alt,
                    user.user_school,
                    user.user_school_alt,
                    bound_at,
                    key_id,
                ),
            )
            if cursor.rowcount != 1:
                return ClaimResult(
                    status="conflict",
                    message="该 Key 已被其他用户领取，请重试",
                    claimed_count=claimed_count,
                    remaining_count=remaining_count,
                )
            updated_row = connection.execute("SELECT * FROM key_entries WHERE id = ?", (key_id,)).fetchone()
            record = self._row_to_record(updated_row)
            return ClaimResult(
                status="claimed",
                record=record,
                message="申领成功",
                claimed_count=claimed_count + 1,
                remaining_count=max(0, max_keys_per_user - claimed_count - 1),
            )

    def bind_key(self, key_id: int, user: ByytUserInfo) -> KeyRecord:
        with self._connect() as connection:
            bound_at = self._now()
            cursor = connection.execute(
                """
                UPDATE key_entries
                SET bound_student_id = ?,
                    bound_user_name = ?,
                    bound_user_name_alt = ?,
                    bound_user_school = ?,
                    bound_user_school_alt = ?,
                    bound_at = ?
                WHERE id = ?
                """,
                (
                    user.user_id,
                    user.user_name,
                    user.user_name_alt,
                    user.user_school,
                    user.user_school_alt,
                    bound_at,
                    key_id,
                ),
            )
            if cursor.rowcount != 1:
                raise KeyError(f"Key {key_id} not found")
            row = connection.execute("SELECT * FROM key_entries WHERE id = ?", (key_id,)).fetchone()
        return self._row_to_record(row)

    def unbind_key(self, key_id: int) -> KeyRecord:
        with self._connect() as connection:
            cursor = connection.execute(
                """
                UPDATE key_entries
                SET bound_student_id = NULL,
                    bound_user_name = NULL,
                    bound_user_name_alt = NULL,
                    bound_user_school = NULL,
                    bound_user_school_alt = NULL,
                    bound_at = NULL
                WHERE id = ?
                """,
                (key_id,),
            )
            if cursor.rowcount != 1:
                raise KeyError(f"Key {key_id} not found")
            row = connection.execute("SELECT * FROM key_entries WHERE id = ?", (key_id,)).fetchone()
        return self._row_to_record(row)

    def delete_key(self, key_id: int) -> None:
        with self._connect() as connection:
            cursor = connection.execute("DELETE FROM key_entries WHERE id = ?", (key_id,))
            if cursor.rowcount != 1:
                raise KeyError(f"Key {key_id} not found")
