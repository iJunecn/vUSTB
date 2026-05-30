from datetime import datetime
from sqlalchemy import String, Integer, BigInteger, DateTime, ForeignKey, JSON, Boolean, func, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class OAuthApp(Base):
    __tablename__ = "oauth_apps"

    app_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client_name: Mapped[str] = mapped_column(String(128), nullable=False)
    client_secret_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    redirect_uri: Mapped[str] = mapped_column(String(512), nullable=False)
    created_at: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False, server_default="0")
    updated_at: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False, server_default="0")


class AuthorizationCode(Base):
    __tablename__ = "oauth_authorization_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    app_id: Mapped[int] = mapped_column(ForeignKey("oauth_apps.app_id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    redirect_uri: Mapped[str] = mapped_column(String(512), nullable=False)
    scope: Mapped[str] = mapped_column(String(512), nullable=False, server_default="userinfo")
    expires_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    used: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class AccessToken(Base):
    __tablename__ = "oauth_access_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    access_token: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    refresh_token: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True, index=True)
    app_id: Mapped[int] = mapped_column(ForeignKey("oauth_apps.app_id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    scope: Mapped[str] = mapped_column(String(512), nullable=False, server_default="userinfo")
    expires_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    refresh_expires_at: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default="0")


class DeviceCode(Base):
    __tablename__ = "oauth_device_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    device_code: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    user_code: Mapped[str] = mapped_column(String(16), unique=True, nullable=False, index=True)
    app_id: Mapped[int] = mapped_column(ForeignKey("oauth_apps.app_id", ondelete="CASCADE"), nullable=False)
    scope: Mapped[str] = mapped_column(String(512), nullable=False, server_default="openid offline_access Yggdrasil.PlayerProfiles.Select Yggdrasil.Server.Join")
    status: Mapped[str] = mapped_column(String(32), nullable=False, server_default="pending")
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    expires_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    interval_seconds: Mapped[int] = mapped_column(Integer, nullable=False, server_default="5")
