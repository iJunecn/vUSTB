"""GitHub 账号绑定 — 已登录用户绑定/解绑 GitHub 账号。

绑定流程：
1. 前端调用 GET /api/github/auth-url → 获取 GitHub 授权 URL
2. 用户跳转到 GitHub 授权页
3. GitHub 回调 /oauth/redirect（统一入口，由 oauth_login.py 处理分发）
4. oauth_login.py 根据 state 中的 purpose="bind" 执行绑定逻辑
5. 绑定成功后重定向到前端 /dashboard/security?github_bind=success
"""
import secrets
import time
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.deps import get_current_user
from app.models import User

# 复用 oauth_login.py 的 _oauth_states（模块级共享）
from app.routers.oauth_login import _oauth_states

router = APIRouter(prefix="/api/github", tags=["github_bind"])


@router.get("/auth-url")
async def github_bind_auth_url(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取 GitHub OAuth 授权 URL（绑定模式）。"""
    if not settings.github_client_id:
        raise HTTPException(status_code=500, detail="GitHub OAuth 未配置")
    if not settings.github_client_secret:
        raise HTTPException(status_code=500, detail="GitHub OAuth client_secret 未配置")

    state = secrets.token_urlsafe(32)
    _oauth_states[state] = {
        "provider": "github",
        "purpose": "bind",
        "user_id": user.id,
        "expires_at": time.time() + 600,  # 10 分钟
    }

    params = {
        "client_id": settings.github_client_id,
        "redirect_uri": settings.github_redirect_uri,
        "response_type": "code",
        "state": state,
        "scope": "read:user user:email",
    }
    auth_url = f"https://github.com/login/oauth/authorize?{urlencode(params)}"

    return {"auth_url": auth_url, "state": state}


@router.post("/unbind")
async def github_unbind(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """解绑 GitHub 账号。"""
    db_user = (
        await db.execute(select(User).where(User.id == user.id))
    ).scalar_one_or_none()
    if not db_user:
        raise HTTPException(status_code=404, detail="用户不存在")

    if not db_user.github_id:
        raise HTTPException(status_code=400, detail="未绑定 GitHub 账号")

    db_user.github_id = None
    db_user.github_name = None
    await db.commit()

    return {"ok": True, "message": "已解绑 GitHub 账号"}
