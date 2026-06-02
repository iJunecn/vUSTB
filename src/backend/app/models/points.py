"""积分系统模型 — 像素积分 + 贝壳积分。"""

from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import String, Integer, DateTime, Enum, Text, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class PointType(str, PyEnum):
    PIXEL = "pixel"
    SHELL = "shell"


class PointReason(str, PyEnum):
    REGISTER = "register"
    CHECKIN = "checkin"
    UPLOAD_SKIN = "upload_skin"
    CREATE_PLAYER = "create_player"
    PRINT_BOOKING = "print_booking"
    PRINT_REFUND = "print_refund"
    PRINT_CANCEL = "print_cancel"
    RECHARGE = "recharge"
    ADMIN_ADJUST = "admin_adjust"


class PointAccount(Base):
    """用户积分账户 — 每用户一行。"""
    __tablename__ = "point_accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), unique=True, nullable=False, index=True
    )
    pixel_points: Mapped[int] = mapped_column(Integer, default=0, nullable=False, server_default="0")
    shell_points: Mapped[int] = mapped_column(Integer, default=0, nullable=False, server_default="0")
    last_checkin: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "user_id": self.user_id,
            "pixel_points": self.pixel_points,
            "shell_points": self.shell_points,
            "last_checkin": self.last_checkin.isoformat() if self.last_checkin else None,
        }


class PointTransaction(Base):
    """积分流水 — 每笔变动一行。"""
    __tablename__ = "point_transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=False, index=True
    )
    type: Mapped[PointType] = mapped_column(
        Enum(PointType, name="point_type"), nullable=False
    )
    amount: Mapped[int] = mapped_column(Integer, nullable=False, comment="正数=收入, 负数=支出")
    reason: Mapped[PointReason] = mapped_column(
        Enum(PointReason, name="point_reason"), nullable=False
    )
    ref_id: Mapped[str | None] = mapped_column(String(128), nullable=True, comment="关联 ID（预约 ID / 订单号等）")
    balance_after: Mapped[int] = mapped_column(Integer, nullable=False, comment="变动后余额")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "user_id": self.user_id,
            "type": self.type.value,
            "amount": self.amount,
            "reason": self.reason.value,
            "ref_id": self.ref_id,
            "balance_after": self.balance_after,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
