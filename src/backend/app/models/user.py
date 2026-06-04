from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import String, Integer, BigInteger, DateTime, Enum, Boolean, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class UserGroup(str, PyEnum):
    SUPER_ADMIN = "super_admin"
    ADMIN = "admin"
    TEACHER = "teacher"
    USER = "user"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(64), nullable=False, server_default="", index=True)
    phone: Mapped[str | None] = mapped_column(String(32), unique=True, nullable=True, index=True)
    real_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    student_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    github_id: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True, index=True)
    github_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    user_group: Mapped[UserGroup] = mapped_column(
        Enum(UserGroup, name="user_group"), default=UserGroup.USER, nullable=False
    )
    is_admin: Mapped[int] = mapped_column(Integer, default=0, nullable=False, server_default="0")
    avatar_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_banned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    banned_until: Mapped[int | None] = mapped_column(BigInteger, nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "email": self.email,
            "username": self.username,
            "display_name": self.display_name,
            "phone": self.phone,
            "real_name": self.real_name,
            "student_id": self.student_id,
            "github_id": self.github_id,
            "github_name": self.github_name,
            "user_group": self.user_group.value,
            "avatar_hash": self.avatar_hash,
            "email_verified": self.email_verified,
            "is_banned": self.is_banned,
            "banned_until": self.banned_until,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
