"""OAuth2 登录流程（GitHub / MUA / USTB）。"""
from __future__ import annotations

import html
import logging
import secrets
import time
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.deps import get_current_user
from app.models import User
from app.services.auth import create_jwt
from app.utils.redis import get_json, set_json, delete

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth/oauth", tags=["oauth_login"])

# Redis 状态存储

_STATE_KEY_PREFIX = "oauth:state:"
_PENDING_KEY_PREFIX = "oauth:pending:"


async def save_oauth_state(state: str, data: dict) -> None:
    """保存 OAuth state 到 Redis，TTL 10 分钟。"""
    await set_json(f"{_STATE_KEY_PREFIX}{state}", data, ex=600)


async def load_oauth_state(state: str) -> dict | None:
    """从 Redis 读取 OAuth state。"""
    return await get_json(f"{_STATE_KEY_PREFIX}{state}")


async def pop_oauth_state(state: str) -> dict | None:
    """读取并删除 OAuth state（一次性使用）。"""
    data = await get_json(f"{_STATE_KEY_PREFIX}{state}")
    if data:
        await delete(f"{_STATE_KEY_PREFIX}{state}")
    return data


async def store_pending_oauth(oauth_token: str, data: dict) -> None:
    """保存 pending OAuth 数据到 Redis，TTL 10 分钟。被 ustb_sso.py 和本模块调用。"""
    await set_json(f"{_PENDING_KEY_PREFIX}{oauth_token}", data, ex=600)


async def pop_pending_oauth(oauth_token: str) -> dict | None:
    """读取并删除 pending OAuth 数据。"""
    data = await get_json(f"{_PENDING_KEY_PREFIX}{oauth_token}")
    if data:
        await delete(f"{_PENDING_KEY_PREFIX}{oauth_token}")
    return data


async def get_pending_oauth(oauth_token: str) -> dict | None:
    """读取 pending OAuth 数据（不删除）。"""
    return await get_json(f"{_PENDING_KEY_PREFIX}{oauth_token}")


# OAuth 提供方配置

_OAUTH_PROVIDERS = {
    "github": {
        "name": "GitHub",
        "client_id": settings.github_client_id,
        "client_secret": settings.github_client_secret,
        "redirect_uri": settings.github_redirect_uri,
        "authorize_url": "https://github.com/login/oauth/authorize",
        "token_url": "https://github.com/login/oauth/access_token",
        "user_url": "https://api.github.com/user",
        "user_email_url": "https://api.github.com/user/emails",
        "scope": "read:user user:email",
        "supports_pkce": False,
    },
    "mua": {
        "name": "MUA Union",
        "client_id": settings.mua_client_id,
        "client_secret": settings.mua_client_secret,
        "redirect_uri": settings.mua_redirect_uri,
        "authorize_url": settings.mua_authorize_url,
        "token_url": settings.mua_token_url,
        "user_url": settings.mua_user_url,
        "scope": settings.mua_scope,
        "supports_pkce": False,
    },
    "ustb": {
        "name": "USTB vSkin",
        "client_id": settings.ustb_client_id,
        "client_secret": settings.ustb_client_secret,
        "redirect_uri": settings.ustb_redirect_uri,
        "authorize_url": settings.ustb_authorize_url,
        "token_url": settings.ustb_token_url,
        "user_url": settings.ustb_user_url,
        "scope": "openid profile email",
        "supports_pkce": True,
    },
}


# 工具函数


def _get_provider(provider: str) -> dict:
    cfg = _OAUTH_PROVIDERS.get(provider)
    if not cfg:
        raise HTTPException(status_code=400, detail=f"Unknown OAuth provider: {provider}")
    if not cfg["client_id"] or not cfg["client_secret"]:
        raise HTTPException(status_code=500, detail=f'{cfg["name"]} OAuth 配置不完整')
    if not cfg["redirect_uri"]:
        raise HTTPException(status_code=500, detail=f'{cfg["name"]} 回调URI未配置')
    return cfg


def _generate_pkce() -> tuple[str, str]:
    """生成 PKCE code_verifier/code_challenge。"""
    import base64
    import hashlib

    code_verifier = secrets.token_urlsafe(64)[:128]
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    code_challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return code_verifier, code_challenge


async def _exchange_code(cfg: dict, code: str, code_verifier: str | None = None) -> str:
    """用授权码换取 access_token。"""
    data = {
        "client_id": cfg["client_id"],
        "client_secret": cfg["client_secret"],
        "code": code,
        "redirect_uri": cfg["redirect_uri"],
        "grant_type": "authorization_code",
    }
    if code_verifier:
        data["code_verifier"] = code_verifier

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            cfg["token_url"],
            data=data,
            headers={"Accept": "application/json"},
        )
        if resp.status_code != 200:
            logger.warning("Token exchange failed for %s: HTTP %s", cfg["name"], resp.status_code)
            raise HTTPException(status_code=400, detail="Failed to exchange code for token")
        token_info = resp.json()

    access_token = token_info.get("access_token")
    if not access_token:
        raise HTTPException(status_code=400, detail="No access token received")
    return access_token


async def _fetch_user_info(cfg: dict, access_token: str) -> dict:
    """获取用户信息。"""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            cfg["user_url"],
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=400, detail="Failed to get user information")
        return resp.json()


async def _fetch_github_user_email(access_token: str) -> str | None:
    """获取 GitHub 主验证邮箱。"""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://api.github.com/user/emails",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            if resp.status_code == 200:
                emails = resp.json()
                for e in emails:
                    if e.get("primary") and e.get("verified"):
                        return e.get("email")
    except Exception:
        pass
    return None


def _normalize_user_info(raw: dict, provider: str) -> dict:
    """统一不同提供方的用户信息格式。"""
    if provider == "github":
        return {
            "provider": "github",
            "provider_uid": str(raw.get("id", "")),
            "username": raw.get("login", ""),
            "nickname": html.escape(raw.get("name", "")) if raw.get("name") else "",
            "email": raw.get("email", ""),
            "avatar_url": raw.get("avatar_url", ""),
        }
    if provider == "mua":
        return {
            "provider": "mua",
            "provider_uid": str(raw.get("id", "")),
            "username": raw.get("username", ""),
            "nickname": html.escape(raw.get("nickname", "")) if raw.get("nickname") else "",
            "email": raw.get("email", ""),
            "avatar_url": raw.get("avatar_url", ""),
        }
    return {
        "provider": "ustb",
        "provider_uid": str(raw.get("id", "")),
        "username": raw.get("username", ""),
        "nickname": html.escape(raw.get("nickname", "")) if raw.get("nickname") else "",
        "email": raw.get("email", ""),
        "avatar_url": raw.get("avatar_url", ""),
    }


async def _find_user_by_oauth(info: dict, db: AsyncSession) -> User | None:
    """按 OAuth 标识查找用户。"""
    provider = info["provider"]
    provider_uid = info["provider_uid"]

    if provider == "github":
        user = (
            await db.execute(select(User).where(User.github_id == provider_uid))
        ).scalar_one_or_none()
        if user:
            return user

        email = info.get("email", "")
        if email:
            user = (
                await db.execute(select(User).where(User.email == email))
            ).scalar_one_or_none()
            if user:
                user.github_id = provider_uid
                user.github_name = info.get("username", "")
                await db.commit()
                await db.refresh(user)
                return user

    email = info.get("email", "")
    if email:
        user = (
            await db.execute(select(User).where(User.email == email))
        ).scalar_one_or_none()
        if user:
            return user

    return None


async def _store_pending_oauth_async(info: dict) -> str:
    """暂存 OAuth 信息到 Redis，返回绑定用 token。"""
    oauth_token = secrets.token_urlsafe(32)
    provider = info["provider"]
    pending: dict = {
        "provider": provider,
        "created_at": time.time(),
        "expires_at": time.time() + 600,
    }
    if provider == "github":
        pending["github_id"] = info["provider_uid"]
        pending["github_name"] = info.get("username", "")
        pending["email"] = info.get("email", "")
    elif provider == "ustb_sso":
        pending["real_name"] = info.get("real_name", "")
        pending["student_id"] = info.get("student_id", "")

    await store_pending_oauth(oauth_token, pending)
    return oauth_token


# 端点


@router.get("/{provider}")
async def oauth_login(
    provider: str,
    return_to: str | None = Query(None),
):
    """发起 OAuth 登录，重定向到提供方。"""
    cfg = _get_provider(provider)

    state = secrets.token_urlsafe(32)
    params: dict[str, str] = {
        "client_id": cfg["client_id"],
        "redirect_uri": cfg["redirect_uri"],
        "response_type": "code",
        "state": state,
    }

    code_verifier: str | None = None
    if cfg.get("supports_pkce"):
        code_verifier, code_challenge = _generate_pkce()
        params["code_challenge"] = code_challenge
        params["code_challenge_method"] = "S256"

    if cfg.get("scope"):
        params["scope"] = cfg["scope"]

    state_data: dict = {
        "provider": provider,
        "purpose": "login",
        "expires_at": time.time() + 600,
    }
    if code_verifier:
        state_data["code_verifier"] = code_verifier
    if return_to:
        state_data["return_to"] = return_to
    await save_oauth_state(state, state_data)

    auth_url = f"{cfg['authorize_url']}?{urlencode(params)}"
    return RedirectResponse(url=auth_url)


# GitHub 回调


async def _handle_github_callback(
    code: str | None,
    state: str | None,
    error: str | None,
    db: AsyncSession,
):
    """处理 GitHub OAuth 回调。"""
    if error:
        logger.warning("GitHub OAuth error: %s", error)
        frontend_url = settings.site_url
        return RedirectResponse(url=f"{frontend_url}/login?oauth_error={error}")

    if not code or not state:
        return RedirectResponse(url=f"{settings.site_url}/login?oauth_error=missing_params")

    stored = await pop_oauth_state(state)
    if not stored:
        return RedirectResponse(url=f"{settings.site_url}/login?oauth_error=invalid_state")

    if time.time() > stored.get("expires_at", 0):
        return RedirectResponse(url=f"{settings.site_url}/login?oauth_error=state_expired")

    provider = stored.get("provider", "github")
    purpose = stored.get("purpose", "login")
    cfg = _get_provider(provider)

    code_verifier = stored.get("code_verifier")
    access_token = await _exchange_code(cfg, code, code_verifier=code_verifier)

    raw_user_info = await _fetch_user_info(cfg, access_token)
    info = _normalize_user_info(raw_user_info, provider)

    if provider == "github" and not info.get("email"):
        email = await _fetch_github_user_email(access_token)
        if email:
            info["email"] = email

    frontend_url = settings.site_url.rstrip("/")

    # 绑定流程
    if purpose == "bind":
        user_id = stored.get("user_id")
        if not user_id:
            logger.warning("GitHub bind: no user_id in state")
            return RedirectResponse(url=f"{frontend_url}/dashboard/security?github_bind=error")

        db_user = (
            await db.execute(select(User).where(User.id == user_id))
        ).scalar_one_or_none()
        if not db_user:
            logger.warning("GitHub bind: user %s not found in DB", user_id)
            return RedirectResponse(url=f"{frontend_url}/dashboard/security?github_bind=error")

        github_id = info["provider_uid"]
        github_name = info.get("username", "")
        logger.info("GitHub bind: user_id=%s, github_id=%s, github_name=%s", user_id, github_id, github_name)

        existing_bound = (
            await db.execute(select(User).where(User.github_id == github_id))
        ).scalar_one_or_none()
        if existing_bound and existing_bound.id != user_id:
            return RedirectResponse(
                url=f"{frontend_url}/dashboard/security?github_bind=error&msg=already_bound"
            )

        db_user.github_id = github_id
        db_user.github_name = github_name
        await db.commit()
        await db.refresh(db_user)
        logger.info("GitHub bind committed: github_id=%s, github_name=%s", db_user.github_id, db_user.github_name)

        return RedirectResponse(url=f"{frontend_url}/dashboard/security?github_bind=success")

    # 登录流程
    user = await _find_user_by_oauth(info, db)

    if user:
        if user.is_banned:
            return RedirectResponse(url=f"{frontend_url}/login?oauth_error=banned")

        jwt_token = create_jwt(sub=user.id, extra={"provider": provider})
        return RedirectResponse(url=f"{frontend_url}/login?access_token={jwt_token}")

    oauth_token = await _store_pending_oauth_async(info)

    redirect_params = {"oauth_token": oauth_token}
    if provider == "github":
        redirect_params["github_login"] = info.get("username", "")

    return RedirectResponse(
        url=f"{frontend_url}/register?{urlencode(redirect_params)}"
    )


# MUA/USTB 回调


class OAuthCallbackResponse(BaseModel):
    access_token: str
    token_type: str = "Bearer"
    user: dict


@router.get("/{provider}/callback")
async def oauth_callback(
    provider: str,
    state: str = Query(...),
    code: str | None = Query(None),
    error: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """处理 OAuth 回调。"""
    if provider == "github":
        return await _handle_github_callback(code, state, error, db)

    stored = await pop_oauth_state(state)
    if not stored:
        raise HTTPException(status_code=400, detail="Invalid or expired state parameter")
    if stored["provider"] != provider:
        raise HTTPException(status_code=400, detail="Provider mismatch")

    if error:
        raise HTTPException(status_code=400, detail=f"OAuth authorization failed: {error}")

    if not code:
        raise HTTPException(status_code=400, detail="Missing authorization code")

    cfg = _get_provider(provider)

    code_verifier = stored.get("code_verifier")
    access_token = await _exchange_code(cfg, code, code_verifier=code_verifier)

    raw_user_info = await _fetch_user_info(cfg, access_token)
    info = _normalize_user_info(raw_user_info, provider)

    user = await _find_user_by_oauth(info, db)
    if not user:
        oauth_token = await _store_pending_oauth_async(info)
        frontend_url = settings.site_url.rstrip("/")
        redirect_params = {"oauth_token": oauth_token}
        return RedirectResponse(
            url=f"{frontend_url}/register?{urlencode(redirect_params)}"
        )

    if user.is_banned:
        raise HTTPException(status_code=403, detail="账号已被封禁")

    jwt_token = create_jwt(sub=user.id, extra={"provider": provider})

    return OAuthCallbackResponse(
        access_token=jwt_token,
        token_type="Bearer",
        user=user.to_dict(),
    )


# 注册后绑定


@router.post("/bind-pending")
async def bind_pending_oauth(
    body: dict = Body(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """注册后绑定第三方 OAuth。"""
    oauth_token = body.get("oauth_token", "")
    if not oauth_token:
        raise HTTPException(status_code=400, detail="缺少 oauth_token")

    pending = await pop_pending_oauth(oauth_token)
    if not pending:
        raise HTTPException(status_code=400, detail="oauth_token 无效或已过期")

    if time.time() > pending.get("expires_at", 0):
        raise HTTPException(status_code=400, detail="oauth_token 已过期")

    provider = pending["provider"]

    db_user = (
        await db.execute(select(User).where(User.id == user.id))
    ).scalar_one_or_none()
    if not db_user:
        raise HTTPException(status_code=404, detail="用户不存在")

    if provider == "github":
        github_id = pending.get("github_id")
        if not github_id:
            raise HTTPException(status_code=400, detail="缺少 GitHub ID")

        existing_bound = (
            await db.execute(select(User).where(User.github_id == github_id))
        ).scalar_one_or_none()
        if existing_bound and existing_bound.id != user.id:
            raise HTTPException(status_code=400, detail="该 GitHub 账号已被其他用户绑定")

        db_user.github_id = github_id
        db_user.github_name = pending.get("github_name", "")
        if pending.get("email") and (not db_user.email or db_user.email.endswith("@oauth.local")):
            email_dup = (
                await db.execute(select(User).where(User.email == pending["email"], User.id != user.id))
            ).scalar_one_or_none()
            if not email_dup:
                db_user.email = pending["email"]

    elif provider == "ustb_sso":
        real_name = pending.get("real_name")
        student_id = pending.get("student_id")
        if not student_id:
            raise HTTPException(status_code=400, detail="缺少学号")

        existing_bound = (
            await db.execute(select(User).where(User.student_id == student_id))
        ).scalar_one_or_none()
        if existing_bound and existing_bound.id != user.id:
            raise HTTPException(status_code=400, detail="该学号已被其他用户绑定")

        if real_name:
            db_user.real_name = real_name
        if student_id:
            db_user.student_id = student_id

    await db.commit()

    return {
        "ok": True,
        "message": f"已绑定 {provider} 账号",
        "provider": provider,
    }


# 验证待绑定 token


@router.get("/pending-info")
async def get_pending_oauth_info(
    oauth_token: str = Query(...),
):
    """读取待绑定 OAuth 信息（不消费）。"""
    pending = await get_pending_oauth(oauth_token)
    if not pending:
        raise HTTPException(status_code=404, detail="oauth_token 无效或已过期")

    if time.time() > pending.get("expires_at", 0):
        await delete(f"{_PENDING_KEY_PREFIX}{oauth_token}")
        raise HTTPException(status_code=410, detail="oauth_token 已过期")

    provider = pending["provider"]
    result: dict = {"provider": provider}

    if provider == "github":
        result["github_name"] = pending.get("github_name", "")
        result["email"] = pending.get("email", "")
    elif provider == "ustb_sso":
        result["real_name"] = pending.get("real_name", "")
        result["student_id"] = pending.get("student_id", "")

    return result
