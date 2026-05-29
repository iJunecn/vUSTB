from datetime import datetime

from sqlalchemy import String, DateTime, JSON, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class SceneCameraPreset(Base):
    __tablename__ = "scene_camera_presets"

    preset_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    position: Mapped[dict] = mapped_column(JSON, nullable=False)
    look_target: Mapped[dict] = mapped_column(JSON, nullable=False)
    perspective_mode: Mapped[str | None] = mapped_column(String(32), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
