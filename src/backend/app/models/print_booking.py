"""3D 打印机预约系统模型。"""

from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import String, Integer, Float, Boolean, DateTime, Enum, Text, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class BookingStatus(str, PyEnum):
    PENDING = "pending"
    BOOKED = "booked"
    RUNNING = "running"
    DONE = "done"
    CANCELLED = "cancelled"
    REJECTED = "rejected"


class SlotType(str, PyEnum):
    AM = "AM"
    PM = "PM"


class PrintType(str, PyEnum):
    SINGLE = "single"
    MULTI = "multi"


class Printer3D(Base):
    """3D 打印机。"""
    __tablename__ = "printers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False, comment="打印机名称")
    location: Mapped[str | None] = mapped_column(String(255), nullable=True, comment="位置")
    model: Mapped[str | None] = mapped_column(String(128), nullable=True, comment="型号")
    is_paused: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, comment="是否暂停使用")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Booking(Base):
    """打印预约。"""
    __tablename__ = "bookings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    printer_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("printers.id"), nullable=True, index=True)
    date: Mapped[str] = mapped_column(String(10), nullable=False, comment="预约日期 YYYY-MM-DD")
    slot_type: Mapped[SlotType] = mapped_column(
        Enum(SlotType, name="slot_type"), nullable=False, comment="AM/PM"
    )
    own_filament: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, comment="是否自带耗材")
    print_type: Mapped[PrintType] = mapped_column(
        Enum(PrintType, name="print_type"), default=PrintType.SINGLE, nullable=False, comment="单色/多色"
    )
    weight: Mapped[float] = mapped_column(Float, default=0, nullable=False, comment="重量(g)")
    cost: Mapped[float] = mapped_column(Float, default=0, nullable=False, comment="费用(元)")
    file_name: Mapped[str | None] = mapped_column(String(255), nullable=True, comment="文件名")
    purpose: Mapped[str | None] = mapped_column(Text, nullable=True, comment="用途")
    is_paid: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, comment="是否已支付")
    status: Mapped[BookingStatus] = mapped_column(
        Enum(BookingStatus, name="booking_status"), default=BookingStatus.PENDING, nullable=False
    )
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True, comment="拒绝原因")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "user_id": self.user_id,
            "printer_id": self.printer_id,
            "date": self.date,
            "slot_type": self.slot_type.value,
            "own_filament": self.own_filament,
            "print_type": self.print_type.value,
            "weight": self.weight,
            "cost": self.cost,
            "file_name": self.file_name,
            "purpose": self.purpose,
            "is_paid": self.is_paid,
            "status": self.status.value,
            "rejection_reason": self.rejection_reason,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class WeeklyReport(Base):
    """周报。"""
    __tablename__ = "weekly_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    start_date: Mapped[str] = mapped_column(String(10), nullable=False)
    end_date: Mapped[str] = mapped_column(String(10), nullable=False)
    file_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
