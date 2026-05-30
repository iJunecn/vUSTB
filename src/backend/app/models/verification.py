from sqlalchemy import String, Integer, BigInteger, DateTime, ForeignKey, func, Boolean
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class VerificationCode(Base):
    __tablename__ = "verification_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(16), nullable=False)
    type: Mapped[str] = mapped_column(String(32), nullable=False, server_default="register")  # register / reset
    expires_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    created_at: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False, server_default="0")


class InviteCode(Base):
    __tablename__ = "invite_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    total_uses: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)
    used_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False, server_default="0")
    used_by: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False, server_default="0")
