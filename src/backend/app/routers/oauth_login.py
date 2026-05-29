"""OAuth2 client login flows for GitHub, MUA, and USTB providers.

Ported from USTB-Official-Backend/app/routes/auth.py (Flask) to FastAPI.

Endpoints:
- GET /api/auth/oauth/{provider}         — start OAuth flow (generate state, redirect)
- GET /api/auth/oauth/{provider}/callback — exchange code, create/login user, return JWT
"""
from __future__ import annotations

import html
import logging
import secrets
from datetime import datetime, timezone
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import User, UserGroup
from app.services.auth import create_jwt

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth/oauth", tags=["oauth_login"])

# ---------------------------------------------------------------------------
# Provider configuration
# ---------------------------------------------------------------------------

_OAUTH_PROVIDERS = {
    "github": {
        "name": "GitHub",
        "client_id": settings.github_client_id,
        "client_secret": settings.github_client_secret,
        "redirect_uri": settings.github_redirect_uri,
        "authorize_url": "https://github.com/login/oauth/authorize",
        "token_url": "https://github.com/login/oauth/access_token",
        "user_url": "https://api.github.com/user",
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

# In-memory state store (production should use Redis)
_oauth_states: dict[str, dict] = {}  # state -> {provider, code_verifier}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


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
    """Generate PKCE code_verifier and code_challenge (S256)."""
    import base64
    import hashlib

    code_verifier = secrets.token_urlsafe(64)[:128]
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    code_challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return code_verifier, code_challenge


async def _exchange_code(cfg: dict, code: str, code_verifier: str | None = None) -> str:
    """Exchange an authorization code for an access token. Returns the access token string."""
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
    """Fetch user info from the provider. Returns raw JSON dict."""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            cfg["user_url"],
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=400, detail="Failed to get user information")
        return resp.json()


def _normalize_user_info(raw: dict, provider: str) -> dict:
    """Normalize provider-specific user info into a common schema."""
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
    # ustb
    return {
        "provider": "ustb",
        "provider_uid": str(raw.get("id", "")),
        "username": raw.get("username", ""),
        "nickname": html.escape(raw.get("nickname", "")) if raw.get("nickname") else "",
        "email": raw.get("email", ""),
        "avatar_url": raw.get("avatar_url", ""),
    }


async def _find_or_create_user(
    info: dict, db: AsyncSession
) -> User:
    """Find an existing user by OAuth identity or email, or create a new one."""
    provider = info["provider"]
    provider_uid = info["provider_uid"]

    # Try to find by oauth_provider + oauth_uid columns if they exist on User
    # Fallback: find by email
    existing: User | None = None

    # Try matching by email first
    email = info.get("email", "")
    if email:
        existing = (
            await db.execute(select(User).where(User.email == email))
        ).scalar_one_or_none()

    if existing:
        return existing

    # Create new user
    username = info.get("username") or info.get("nickname") or f"{provider}_{provider_uid}"
    # Ensure unique username
    base_username = username
    counter = 1
    while True:
        dup = (
            await db.execute(select(User).where(User.username == username))
        ).scalar_one_or_none()
        if not dup:
            break
        username = f"{base_username}_{counter}"
        counter += 1

    user = User(
        email=email or f"{provider}_{provider_uid}@oauth.local",
        username=username,
        password_hash="!",  # OAuth users have no password
        user_group=UserGroup.USER,
        email_verified=bool(email),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/{provider}")
async def oauth_login(
    provider: str,
    return_to: str | None = Query(None),
):
    """Start an OAuth2 login flow. Redirects the user to the provider's authorization page."""
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

    # Store state
    state_data: dict = {"provider": provider}
    if code_verifier:
        state_data["code_verifier"] = code_verifier
    if return_to:
        state_data["return_to"] = return_to
    _oauth_states[state] = state_data

    auth_url = f"{cfg['authorize_url']}?{urlencode(params)}"
    return RedirectResponse(url=auth_url)


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
    """Handle the OAuth2 callback. Exchanges the code for a token, upserts the user, and returns a JWT."""
    # Validate state
    stored = _oauth_states.pop(state, None)
    if not stored:
        raise HTTPException(status_code=400, detail="Invalid or expired state parameter")
    if stored["provider"] != provider:
        raise HTTPException(status_code=400, detail="Provider mismatch")

    # Check for OAuth error
    if error:
        raise HTTPException(status_code=400, detail=f"OAuth authorization failed: {error}")

    if not code:
        raise HTTPException(status_code=400, detail="Missing authorization code")

    cfg = _get_provider(provider)

    # Exchange code for token
    code_verifier = stored.get("code_verifier")
    access_token = await _exchange_code(cfg, code, code_verifier=code_verifier)

    # Fetch user info
    raw_user_info = await _fetch_user_info(cfg, access_token)
    info = _normalize_user_info(raw_user_info, provider)

    # Find or create user
    user = await _find_or_create_user(info, db)
    if user.is_banned:
        raise HTTPException(status_code=403, detail="账号已被封禁")

    # Issue JWT
    jwt_token = create_jwt(sub=user.id, extra={"provider": provider})

    return OAuthCallbackResponse(
        access_token=jwt_token,
        token_type="Bearer",
        user=user.to_dict(),
    )
