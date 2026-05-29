import secrets
import string
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func
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


def _generate_code(length: int = 6) -> str:
    return "".join(secrets.choice(string.digits) for _ in range(length))


@router.post("/register", response_model=LoginResponse)
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    existing = (await db.execute(
        select(User).where((User.email == req.email) | (User.username == req.username))
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="邮箱或用户名已被占用")

    # 邀请码校验（若提供）
    invite = None
    if req.invite_code:
        invite = (await db.execute(
            select(InviteCode).where(InviteCode.code == req.invite_code, InviteCode.used == False)
        )).scalar_one_or_none()
        if not invite:
            raise HTTPException(status_code=400, detail="邀请码无效或已被使用")
        if invite.expires_at and invite.expires_at < datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="邀请码已过期")

    # 首个注册用户自动成为超级管理员
    user_count = (await db.execute(select(func.count(User.id)))).scalar() or 0
    group = UserGroup.SUPER_ADMIN if user_count == 0 else UserGroup.USER

    user = User(
        email=req.email,
        username=req.username,
        password_hash=hash_password(req.password),
        user_group=group,
        email_verified=False,
    )
    db.add(user)
    await db.flush()

    if invite:
        invite.used = True
        invite.used_by_id = user.id

    await db.commit()
    await db.refresh(user)

    token = create_jwt(user.id, {"group": user.user_group.value})
    return LoginResponse(access_token=token, user=user.to_dict())


@router.post("/login", response_model=LoginResponse)
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    user = (await db.execute(select(User).where(User.email == req.email))).scalar_one_or_none()
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="邮箱或密码错误")
    if user.is_banned:
        raise HTTPException(status_code=403, detail="账号已被封禁")
    token = create_jwt(user.id, {"group": user.user_group.value})
    return LoginResponse(access_token=token, user=user.to_dict())


@router.post("/send-verification-code")
async def send_verification_code(req: SendVerificationRequest, db: AsyncSession = Depends(get_db)):
    if req.purpose not in ("register", "reset"):
        raise HTTPException(status_code=400, detail="非法用途")

    code = _generate_code()
    vc = VerificationCode(
        email=req.email,
        code=code,
        purpose=req.purpose,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
    )
    db.add(vc)
    await db.commit()
    # 真实环境通过 aiosmtplib 发送；当前返回提示，便于开发联调
    return {"ok": True, "message": "验证码已发送（开发环境请通过日志/数据库查询）"}


@router.post("/reset-password")
async def reset_password(req: ResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    vc = (await db.execute(
        select(VerificationCode).where(
            VerificationCode.email == req.email,
            VerificationCode.code == req.verification_code,
            VerificationCode.purpose == "reset",
            VerificationCode.used == False,
        ).order_by(VerificationCode.id.desc())
    )).scalar_one_or_none()
    if not vc or vc.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="验证码无效或已过期")

    user = (await db.execute(select(User).where(User.email == req.email))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    user.password_hash = hash_password(req.new_password)
    vc.used = True
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
