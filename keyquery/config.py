from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import os


def _load_env_file(path: Path) -> None:
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key or key in os.environ:
            continue
        if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
            value = value[1:-1]
        os.environ[key] = value


BASE_DIR = Path(__file__).resolve().parents[1]
_load_env_file(BASE_DIR / ".env")
_load_env_file(BASE_DIR / ".env.local")


@dataclass(slots=True)
class Settings:
    database_path: Path
    admin_code: str
    max_keys_per_user: int
    byyt_entity_id: str
    byyt_redirect_uri: str
    byyt_state: str
    port: int

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            database_path=Path(os.environ.get("KEYQUERY_DB_PATH", str(BASE_DIR / "keyquery.sqlite3"))),
            admin_code=os.environ.get("ADMIN_CODE", "admin"),
            max_keys_per_user=max(1, int(os.environ.get("MAX_KEYS_PER_USER", "1"))),
            byyt_entity_id=os.environ.get("BYYT_ENTITY_ID", "YW2025006"),
            byyt_redirect_uri=os.environ.get("BYYT_REDIRECT_URI", "https://byyt.ustb.edu.cn/oauth/login/code"),
            byyt_state=os.environ.get("BYYT_STATE", "null"),
            port=int(os.environ.get("PORT", "7999")),
        )
