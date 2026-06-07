from datetime import datetime
from sqlalchemy import String, Integer, DateTime, JSON, Boolean, func, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class MCServer(Base):
    __tablename__ = "mc_servers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    address: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)  # host:port
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    version_hint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    theme: Mapped[str | None] = mapped_column(String(128), nullable=True)
    is_public: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    icon_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    last_status: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
