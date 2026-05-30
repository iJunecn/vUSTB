from pydantic import BaseModel, EmailStr, Field
from typing import Optional, Dict, List


# ====== 站点用户认证 ======

class RegisterRequest(BaseModel):
    email: EmailStr
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=8, max_length=128)
    invite_code: Optional[str] = None
    verification_code: Optional[str] = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


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
