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
from app.models import User, UserGroup, VerificationCode, InviteCode, PointAccount, PointTransaction, PointType, PointReason
from app.services.auth import create_jwt, hash_password, verify_password
from app.config import settings
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

    # 注册邮箱后缀校验
    allowed_suffixes = [s.strip().lower() for s in settings.register_email_suffixes.split(",") if s.strip()]
    if allowed_suffixes:
        if "@" not in req.email:
            raise HTTPException(status_code=400, detail="邮箱格式不正确")
        domain = req.email.split("@", 1)[1].strip().lower()
        if not any(domain == s or domain.endswith("." + s) for s in allowed_suffixes):
            raise HTTPException(
                status_code=400,
                detail=f"仅支持以下邮箱后缀注册：{', '.join('@' + s for s in allowed_suffixes)}",
            )

    # 邮箱验证码校验（必须）
    if settings.require_email_verify:
        if not req.verification_code:
            raise HTTPException(status_code=400, detail="注册需要邮箱验证码")
        vc = (await db.execute(
            select(VerificationCode).where(
                VerificationCode.email == req.email,
                VerificationCode.type == "register",
            ).order_by(VerificationCode.id.desc())
        )).scalar_one_or_none()
        if not vc or vc.expires_at < _now_ms() or str(vc.code) != str(req.verification_code):
            raise HTTPException(status_code=400, detail="验证码无效或已过期")
        # 验证通过后删除验证码
        await db.delete(vc)

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

    # 邀请码身份赋权：如果邀请码有 target_group 且不是首个用户，使用邀请码身份
    if invite and invite.target_group and user_count > 0:
        try:
            group = UserGroup(invite.target_group)
        except ValueError:
            pass  # 无效 target_group，保持默认 user

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

    # If an oauth_token was provided, auto-bind the third-party account
    if req.oauth_token:
        try:
            from app.routers.oauth_login import _pending_oauth
            import time as _time

            pending = _pending_oauth.pop(req.oauth_token, None)
            if pending and _time.time() <= pending.get("expires_at", 0):
                provider = pending.get("provider", "")
                if provider == "github":
                    # Check if this GitHub account is already bound
                    github_id = pending.get("github_id")
                    if github_id:
                        existing_bound = (
                            await db.execute(select(User).where(User.github_id == github_id))
                        ).scalar_one_or_none()
                        if not existing_bound:
                            user.github_id = github_id
                            user.github_name = pending.get("github_name", "")
                elif provider == "ustb_sso":
                    student_id = pending.get("student_id")
                    if student_id:
                        existing_bound = (
                            await db.execute(select(User).where(User.student_id == student_id))
                        ).scalar_one_or_none()
                        if not existing_bound:
                            user.real_name = pending.get("real_name") or user.real_name
                            user.student_id = student_id
        except Exception as e:
            # Don't fail registration if binding fails
            import logging
            logging.getLogger(__name__).warning("Failed to auto-bind OAuth during registration: %s", e)

    if invite:
        invite.used_count = (invite.used_count or 0) + 1
        if not invite.used_by:
            invite.used_by = req.email

    # 赠送 10 像素积分
    acct = PointAccount(user_id=user.id, pixel_points=10, shell_points=0)
    db.add(acct)
    await db.flush()
    tx = PointTransaction(
        user_id=user.id,
        type=PointType.PIXEL,
        amount=10,
        reason=PointReason.REGISTER,
        balance_after=10,
    )
    db.add(tx)

    await db.commit()
    await db.refresh(user)

    token = create_jwt(user.id, {"group": user.user_group.value}, expire_minutes=settings.auth_expire_hours * 60)
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
    token = create_jwt(user.id, {"group": user.user_group.value}, expire_minutes=settings.auth_expire_hours * 60)
    return LoginResponse(access_token=token, user=user.to_dict())


@router.post("/send-verification-code")
async def send_verification_code(req: SendVerificationRequest, db: AsyncSession = Depends(get_db)):
    if req.purpose not in ("register", "reset"):
        raise HTTPException(status_code=400, detail="非法用途")

    # 注册时校验邮箱后缀
    if req.purpose == "register":
        allowed_suffixes = [s.strip().lower() for s in settings.register_email_suffixes.split(",") if s.strip()]
        if allowed_suffixes:
            if "@" not in req.email:
                raise HTTPException(status_code=400, detail="邮箱格式不正确")
            domain = req.email.split("@", 1)[1].strip().lower()
            if not any(domain == s or domain.endswith("." + s) for s in allowed_suffixes):
                raise HTTPException(
                    status_code=400,
                    detail=f"仅支持以下邮箱后缀注册：{', '.join('@' + s for s in allowed_suffixes)}",
                )

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

    # 实际发送邮件
    from app.utils.email_utils import email_sender
    sent = await email_sender.send_verification_code(db, req.email, code, req.purpose)
    if not sent:
        raise HTTPException(status_code=500, detail="验证码邮件发送失败，请稍后重试")

    return {"ok": True, "message": "验证码已发送，请查收邮件"}


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
