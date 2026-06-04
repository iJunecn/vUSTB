from pydantic import BaseModel, EmailStr, Field
from typing import Optional, Dict, List


# ====== 站点用户认证 ======

class RegisterRequest(BaseModel):
    email: EmailStr
    username: str = Field(min_length=3, max_length=32)
    phone: str = Field(min_length=5, max_length=32)
    password: str = Field(min_length=8, max_length=128)
    invite_code: Optional[str] = None
    verification_code: Optional[str] = None
    oauth_token: Optional[str] = None


class LoginRequest(BaseModel):
    # 用户名 / 邮箱 / 手机号
    identifier: Optional[str] = None
    password: str
    # 兼容旧前端：若客户端仍发送 email 字段，作为 identifier 回退
    email: Optional[str] = None


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class SendVerificationRequest(BaseModel):
    email: EmailStr
    purpose: str = "register"  # register / reset


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    new_password: str = Field(min_length=8, max_length=128)
    verification_code: str


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str = Field(min_length=8, max_length=128)


class UpdateProfileRequest(BaseModel):
    username: Optional[str] = Field(default=None, min_length=3, max_length=32)
    email: Optional[EmailStr] = None
    phone: Optional[str] = Field(default=None, min_length=5, max_length=32)
    real_name: Optional[str] = Field(default=None, max_length=64)
    student_id: Optional[str] = Field(default=None, max_length=32)
    display_name: Optional[str] = Field(default=None, max_length=64)


# ====== Yggdrasil 协议请求体 — 从 vSkin 搬运 ======

class Agent(BaseModel):
    name: str = "Minecraft"
    version: int = 1


class AuthRequest(BaseModel):
    username: str
    password: str
    clientToken: Optional[str] = None
    requestUser: bool = False
    agent: Optional[Agent] = None


class RefreshRequest(BaseModel):
    accessToken: str
    clientToken: Optional[str] = None
    requestUser: bool = False
    selectedProfile: Optional[Dict] = None


class ValidationRequest(BaseModel):
    accessToken: str
    clientToken: Optional[str] = None


class JoinRequest(BaseModel):
    accessToken: str
    selectedProfile: str
    serverId: str
