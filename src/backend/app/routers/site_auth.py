import re
import secrets
import string
import time
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user
from app.models import User, UserGroup, VerificationCode, InviteCode
from app.services.auth import create_jwt, hash_password, verify_password
from app.utils.schemas import (
    LoginRequest, LoginResponse, RegisterRequest,
    ResetPasswordRequest, SendVerificationRequest, ChangePasswordRequest,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

USERNAME_RE = re.compile(r"^[A-Za-z0-9]+$")
PHONE_RE = re.compile(r"^[0-9+\-\s]{5,32}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _generate_code(length: int = 6) -> str:
    return "".join(secrets.choice(string.digits) for _ in range(length))


def _now_ms() -> int:
    return int(time.time() * 1000)


@router.post("/register", response_model=LoginResponse)
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    if not USERNAME_RE.match(req.username):
        raise HTTPException(status_code=400, detail="用户名仅支持英文字母和数字")
    if not PHONE_RE.match(req.phone):
        raise HTTPException(status_code=400, detail="手机号格式不正确")

    existing = (await db.execute(
        select(User).where(or_(
            User.email == req.email,
            User.username == req.username,
            User.phone == req.phone,
        ))
    )).scalar_one_or_none()
    if existing:
        if existing.email == req.email:
            raise HTTPException(status_code=400, detail="邮箱已被占用")
        if existing.username == req.username:
            raise HTTPException(status_code=400, detail="用户名已被占用")
        if existing.phone == req.phone:
            raise HTTPException(status_code=400, detail="手机号已被占用")
        raise HTTPException(status_code=400, detail="账号信息已被占用")

    # 邀请码校验（若提供）
    invite = None
    if req.invite_code:
        invite = (await db.execute(
            select(InviteCode).where(InviteCode.code == req.invite_code)
        )).scalar_one_or_none()
        if not invite:
            raise HTTPException(status_code=400, detail="邀请码无效")
        if invite.total_uses is not None and invite.used_count >= invite.total_uses:
            raise HTTPException(status_code=400, detail="邀请码已用完")

    # 首个注册用户自动成为超级管理员
    user_count = (await db.execute(select(func.count(User.id)))).scalar() or 0
    group = UserGroup.SUPER_ADMIN if user_count == 0 else UserGroup.USER

    user = User(
        email=req.email,
        username=req.username,
        display_name=req.username,
        phone=req.phone,
        password_hash=hash_password(req.password),
        user_group=group,
        is_admin=1 if group == UserGroup.SUPER_ADMIN else 0,
        email_verified=False,
    )
    db.add(user)
    await db.flush()

    if invite:
        invite.used_count = (invite.used_count or 0) + 1
        if not invite.used_by:
            invite.used_by = req.email

    await db.commit()
    await db.refresh(user)

    token = create_jwt(user.id, {"group": user.user_group.value})
    return LoginResponse(access_token=token, user=user.to_dict())


@router.post("/login", response_model=LoginResponse)
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    identifier = (req.identifier or req.email or "").strip()
    if not identifier:
        raise HTTPException(status_code=400, detail="请输入用户名 / 邮箱 / 手机号")

    user = (await db.execute(
        select(User).where(or_(
            User.username == identifier,
            User.email == identifier,
            User.phone == identifier,
        ))
    )).scalar_one_or_none()
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="账号或密码错误")
    if user.is_banned:
        raise HTTPException(status_code=403, detail="账号已被封禁")
    token = create_jwt(user.id, {"group": user.user_group.value})
    return LoginResponse(access_token=token, user=user.to_dict())


@router.post("/send-verification-code")
async def send_verification_code(req: SendVerificationRequest, db: AsyncSession = Depends(get_db)):
    if req.purpose not in ("register", "reset"):
        raise HTTPException(status_code=400, detail="非法用途")

    code = _generate_code()
    # 同一邮箱 + 用途 上 upsert，避免堆积
    vc = (await db.execute(
        select(VerificationCode).where(
            VerificationCode.email == req.email,
            VerificationCode.type == req.purpose,
        )
    )).scalar_one_or_none()
    expires_at_ms = _now_ms() + 10 * 60 * 1000
    if vc:
        vc.code = code
        vc.expires_at = expires_at_ms
    else:
        db.add(VerificationCode(
            email=req.email,
            code=code,
            type=req.purpose,
            expires_at=expires_at_ms,
            created_at=_now_ms(),
        ))
    await db.commit()
    # 真实环境通过 aiosmtplib 发送；当前返回提示，便于开发联调
    return {"ok": True, "message": "验证码已发送（开发环境请通过日志/数据库查询）"}


@router.post("/reset-password")
async def reset_password(req: ResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    vc = (await db.execute(
        select(VerificationCode).where(
            VerificationCode.email == req.email,
            VerificationCode.code == req.verification_code,
            VerificationCode.type == "reset",
        ).order_by(VerificationCode.id.desc())
    )).scalar_one_or_none()
    if not vc or vc.expires_at < _now_ms():
        raise HTTPException(status_code=400, detail="验证码无效或已过期")

    user = (await db.execute(select(User).where(User.email == req.email))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    user.password_hash = hash_password(req.new_password)
    await db.delete(vc)
    await db.commit()
    return {"ok": True}


@router.post("/change-password")
async def change_password(
    req: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not verify_password(req.old_password, user.password_hash):
        raise HTTPException(status_code=400, detail="旧密码不正确")
    user.password_hash = hash_password(req.new_password)
    await db.commit()
    return {"ok": True}


@router.post("/logout")
async def logout(user: User = Depends(get_current_user)):
    # JWT 无服务器侧吊销；前端清掉 token 即可
    return {"ok": True}
