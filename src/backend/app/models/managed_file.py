from datetime import datetime
from sqlalchemy import String, Integer, DateTime, BigInteger, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ManagedFile(Base):
    __tablename__ = "managed_files"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    relative_path: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    size: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    content_type: Mapped[str] = mapped_column(String(128), default="application/octet-stream")
    visibility: Mapped[str] = mapped_column(String(32), default="public", nullable=False)
    uploader_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    description: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
