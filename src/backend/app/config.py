from functools import lru_cache
from typing import List
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_nested_delimiter="__",
        case_sensitive=False,
        extra="ignore",
    )

    site_name: str = "像素北科 vUSTB"
    site_url: str = "http://localhost"
    api_url: str = "http://localhost/skinapi"
    environment: str = "development"

    database_url: str = "postgresql+asyncpg://vustb:vustb@postgres:5432/vustb"
    redis_url: str = "redis://redis:6379/0"

    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7

    rsa_private_key_path: str = "/data/keys/private.pem"
    rsa_public_key_path: str = "/data/keys/public.pem"

    textures_directory: str = "/data/textures"
    carousel_directory: str = "/data/carousel"
    uploads_directory: str = "/data/uploads"

    cors_allow_origins: List[str] = Field(default_factory=lambda: ["*"])
    cors_allow_credentials: bool = True

    smtp_host: str = ""
    smtp_port: int = 465
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_use_tls: bool = True

    github_client_id: str = ""
    github_client_secret: str = ""
    github_redirect_uri: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
