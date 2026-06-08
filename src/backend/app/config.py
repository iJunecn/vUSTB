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

# 爱发电凭据 — 同样 base64 编码存储
_AF_UID_B64 = "NDUwMWZhMGM3MDk4MTFlZTgyMjg1MjU0MDAyNWMzNzc="
_AF_TOK_B64 = "ZDZESnVVa0g0RXN3Uld5WWJRTjhCamNGVENoQXZuM2U="

# SMTP 邮件服务 — base64 编码存储敏感字段
_SMTP_HOST = "mx.jianyuelab.net"
_SMTP_PORT = 465
_SMTP_USER = "noreply@ustb.world"
_SMTP_PWD_B64 = "dXN0YndvcmxkbWFpbA=="
_SMTP_FROM = "像素北科"
_SMTP_SSL = True
_EMAIL_VERIFY_ENABLED = True

# 安全设置 — 硬编码
_REQUIRE_EMAIL_VERIFY = True
_ALLOW_PASSWORD_RESET = True
_REGISTER_EMAIL_SUFFIXES = "xs.ustb.edu.cn,ustb.edu.cn,ustb.world,qq.com"

# 认证过期时间 — 72 小时
_AUTH_EXPIRE_HOURS = 72

# 运行时解码
_GH_CID = _b64.b64decode(_GH_CID_B64).decode()
_GH_CS = _b64.b64decode(_GH_CS_B64).decode()
_AF_UID = _b64.b64decode(_AF_UID_B64).decode()
_AF_TOK = _b64.b64decode(_AF_TOK_B64).decode()
_SMTP_PWD = _b64.b64decode(_SMTP_PWD_B64).decode()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_nested_delimiter="__",
        case_sensitive=False,
        extra="ignore",
    )

    site_name: str = "像素北科"
    site_url: str = "https://www.ustb.world"
    api_url: str = "https://www.ustb.world/skinapi"
    environment: str = "development"

    database_url: str = "postgresql+asyncpg://vustb:vustb@postgres:5432/vustb"
    redis_url: str = "redis://redis:6379/0"

    jwt_secret: str = "change-me-in-production-use-32bytes"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7

    rsa_private_key_path: str = "/data/keys/private.pem"
    rsa_public_key_path: str = "/data/keys/public.pem"

    textures_directory: str = "/data/textures"
    carousel_directory: str = "/data/carousel"
    uploads_directory: str = "/data/uploads"

    cors_allow_origins: List[str] = Field(default_factory=lambda: ["*"])
    cors_allow_credentials: bool = True

    # SMTP — 硬编码，使用 validation_alias 防止环境变量覆盖
    smtp_host: str = Field(default=_SMTP_HOST, validation_alias="_smtp_host_internal")
    smtp_port: int = Field(default=_SMTP_PORT, validation_alias="_smtp_port_internal")
    smtp_user: str = Field(default=_SMTP_USER, validation_alias="_smtp_user_internal")
    smtp_password: str = Field(default=_SMTP_PWD, validation_alias="_smtp_pwd_internal")
    smtp_from: str = Field(default=_SMTP_FROM, validation_alias="_smtp_from_internal")
    smtp_use_tls: bool = Field(default=_SMTP_SSL, validation_alias="_smtp_ssl_internal")

    # 硬编码安全设置
    require_email_verify: bool = Field(default=_REQUIRE_EMAIL_VERIFY, validation_alias="_rev_internal")
    allow_password_reset: bool = Field(default=_ALLOW_PASSWORD_RESET, validation_alias="_apr_internal")
    register_email_suffixes: str = Field(default=_REGISTER_EMAIL_SUFFIXES, validation_alias="_res_internal")
    email_verify_enabled: bool = Field(default=_EMAIL_VERIFY_ENABLED, validation_alias="_eve_internal")

    # 认证过期 — 硬编码 72 小时
    auth_expire_hours: int = Field(default=_AUTH_EXPIRE_HOURS, validation_alias="_aeh_internal")

    # MCA download auth
    mca_base_url: str = "/mca"
    mca_access_level: str = "public"  # public | authenticated | admin

    # GitHub OAuth — 硬编码 base64 编码值
    # 使用 validation_alias 防止环境变量 GITHUB_CLIENT_ID="" 覆盖默认值
    github_client_id: str = Field(
        default=_GH_CID, validation_alias="_gh_cid_internal"
    )
    github_client_secret: str = Field(
        default=_GH_CS, validation_alias="_gh_cs_internal"
    )
    github_redirect_uri: str = Field(
        default=_GH_RURI, validation_alias="_gh_ruri_internal"
    )

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

    # 爱发电 — 硬编码 base64 编码值
    # 同样使用 validation_alias 防止环境变量覆盖
    afdian_user_id: str = Field(
        default=_AF_UID, validation_alias="_af_uid_internal"
    )
    afdian_token: str = Field(
        default=_AF_TOK, validation_alias="_af_tok_internal"
    )

    @model_validator(mode="after")
    def _fill_hardcoded_if_empty(self) -> "Settings":
        """安全网：如果字段被意外清空，用硬编码值回填。"""
        if not self.github_client_id:
            self.github_client_id = _GH_CID
        if not self.github_client_secret:
            self.github_client_secret = _GH_CS
        if not self.github_redirect_uri:
            self.github_redirect_uri = _GH_RURI
        if not self.afdian_user_id:
            self.afdian_user_id = _AF_UID
        if not self.afdian_token:
            self.afdian_token = _AF_TOK
        if not self.smtp_host:
            self.smtp_host = _SMTP_HOST
        if not self.smtp_password:
            self.smtp_password = _SMTP_PWD
        if not self.smtp_user:
            self.smtp_user = _SMTP_USER
        if not self.smtp_from:
            self.smtp_from = _SMTP_FROM
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
