from sqlalchemy import String, Integer, JSON, Boolean
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class FallbackEndpoint(Base):
    __tablename__ = "fallback_endpoints"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    session_url: Mapped[str] = mapped_column(String(512), nullable=False)
    account_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    services_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    skin_domains: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    cache_ttl: Mapped[int] = mapped_column(Integer, default=60, nullable=False)
    enable_profile: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    enable_hasjoined: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    enable_whitelist: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
