import base64 as _b64
from functools import lru_cache
from typing import List

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


# GitHub OAuth 凭据 — base64 编码存储，运行时解码
# 不以明文出现在代码中，防止被简单爬取/搜索发现
_GH_CID_B64 = "T3YyM2xpOWhEdjdXbGRpam9kY3Y="
_GH_CS_B64 = "NTNjNTM5ZTRjNWNhZDNhZjVmNzhjZDU1YzhkOGUzMGRmNmI5OTI1MQ=="
_GH_RURI = "https://www.ustb.world/oauth/redirect"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_nested_delimiter="__",
        case_sensitive=False,
        extra="ignore",
    )

    site_name: str = "像素北科"
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

    # MCA download auth
    mca_base_url: str = "/mca"
    mca_access_level: str = "public"  # public | authenticated | admin

    # GitHub OAuth — 默认值在 model_validator 中从 base64 解码设置
    # 环境变量仍可覆盖（但如果部署时不设环境变量，就会用硬编码的值）
    github_client_id: str = ""
    github_client_secret: str = ""
    github_redirect_uri: str = ""

    # MUA Union OAuth
    mua_client_id: str = ""
    mua_client_secret: str = ""
    mua_redirect_uri: str = ""
    mua_authorize_url: str = "https://login.mua.ax/oauth2/authorize"
    mua_token_url: str = "https://login.mua.ax/oauth2/token"
    mua_user_url: str = "https://login.mua.ax/api/user"
    mua_scope: str = "openid profile email"

    # USTB vSkin OAuth
    ustb_client_id: str = ""
    ustb_client_secret: str = ""
    ustb_redirect_uri: str = ""
    ustb_authorize_url: str = ""
    ustb_token_url: str = ""
    ustb_user_url: str = ""

    # Afdian (爱发电) integration
    afdian_user_id: str = "REDACTED_AF_UID"
    afdian_token: str = "REDACTED_AF_TOKEN"

    @model_validator(mode="after")
    def _set_github_defaults(self) -> "Settings":
        """如果 GitHub OAuth 字段为空，用硬编码的 base64 编码值填充。"""
        if not self.github_client_id:
            self.github_client_id = _b64.b64decode(_GH_CID_B64).decode()
        if not self.github_client_secret:
            self.github_client_secret = _b64.b64decode(_GH_CS_B64).decode()
        if not self.github_redirect_uri:
            self.github_redirect_uri = _GH_RURI
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
