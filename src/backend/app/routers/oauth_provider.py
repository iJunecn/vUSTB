"""OAuth 2.0 Provider：授权码 + 设备流 + OpenID Discovery。

端点列表见下方路由注册。
"""
import time
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Form, HTTPException, Header, Request, Body
from fastapi.responses import JSONResponse, FileResponse, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.deps import get_current_user
from app.models import (
    OAuthApp, AuthorizationCode, AccessToken, DeviceCode, User, Player, Texture,
    SiteSetting,
)
from app.services.crypto import crypto
from app.services.oauth_backend import oauth_backend

router = APIRouter(tags=["oauth_provider"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


_DEFAULT_SITE_URL = "http://localhost"


async def _resolve_base_url(request: Request | None = None, db: AsyncSession | None = None) -> str:
    """解析站点对外 URL，优先使用数据库/配置值，其次请求头推断。"""
    # 1. 数据库站点设置
    if db:
        row = (await db.execute(
            select(SiteSetting).where(SiteSetting.key == "public_url")
        )).scalar_one_or_none()
        if row and row.value:
            url = str(row.value).rstrip("/")
            if url and url != _DEFAULT_SITE_URL:
                return url

    # 2. 环境变量（非默认值）
    configured = (settings.site_url or "").rstrip("/")
    if configured and configured != _DEFAULT_SITE_URL:
        return configured

    # 3. 从请求头推断
    if request:
        proto = (request.headers.get("x-forwarded-proto") or
                 request.headers.get("x-forwarded-scheme") or
                 request.url.scheme)
        host = (request.headers.get("x-forwarded-host") or
                request.headers.get("host"))
        if not host and request.url.hostname:
            host = request.url.hostname
            if request.url.port and request.url.port not in (80, 443):
                host = f"{host}:{request.url.port}"
        if host:
            return f"{proto}://{host}"

    return _DEFAULT_SITE_URL


def _well_known(base: str) -> dict:
    base = base.rstrip("/")
    return {
        "issuer": base,
        "authorization_endpoint": base + "/oauth/authorize",
        "token_endpoint": base + "/oauth/token",
        "userinfo_endpoint": base + "/oauth/userinfo",
        "jwks_uri": base + "/oauth/jwks",
        "device_authorization_endpoint": base + "/oauth/device/code",
        "response_types_supported": ["code"],
        "grant_types_supported": [
            "authorization_code", "refresh_token",
            "urn:ietf:params:oauth:grant-type:device_code",
        ],
        "scopes_supported": [
            "openid", "offline_access", "userinfo", "profile", "avatar",
            "email", "permission", "skin",
            "Yggdrasil.PlayerProfiles.Select", "Yggdrasil.Server.Join",
        ],
        "id_token_signing_alg_values_supported": ["RS256"],
        "subject_types_supported": ["public"],
    }


@router.get("/.well-known/openid-configuration")
async def openid_config(request: Request, db: AsyncSession = Depends(get_db)):
    base = await _resolve_base_url(request, db)
    return _well_known(base)


@router.get("/api/yggdrasil/.well-known/openid-configuration")
async def openid_config_yggdrasil(request: Request, db: AsyncSession = Depends(get_db)):
    base = await _resolve_base_url(request, db)
    return await oauth_backend.openid_configuration(db)


@router.get("/oauth/jwks")
async def jwks():
    return crypto.jwks()


# 授权预览

@router.get("/oauth/authorize/check")
async def authorize_check(
    client_id: int,
    redirect_uri: str,
    state: str = "",
    scope: str = "userinfo",
    db: AsyncSession = Depends(get_db),
):
    """返回授权页预览信息。"""
    return await oauth_backend.build_authorize_preview(db, client_id, redirect_uri, state, scope)


# 授权码模式
@router.post("/oauth/api/approve")
async def approve_authorize(
    body: dict = Body(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """前端授权页提交：返回 redirect_uri?code=...&state=..."""
    client_id = body.get("client_id")
    redirect_uri = body.get("redirect_uri")
    state = body.get("state", "")
    scope = body.get("scope", "userinfo")

    if not client_id or not redirect_uri:
        raise HTTPException(status_code=400, detail="missing params")

    result = await oauth_backend.authorize_decision(
        db, user_id=user.id, client_id=int(client_id),
        redirect_uri=redirect_uri, state=state, approved=True, scope=scope,
    )
    return {"redirect": result["redirect_url"]}


@router.post("/oauth/token")
async def token_endpoint(
    request: Request,
    grant_type: str = Form(...),
    code: str | None = Form(None),
    client_id: str | None = Form(None),
    client_secret: str | None = Form(None),
    redirect_uri: str | None = Form(None),
    refresh_token: str | None = Form(None),
    device_code: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await oauth_backend.token_endpoint(
            db,
            grant_type=grant_type,
            code=code,
            client_id=int(client_id) if client_id else None,
            client_secret=client_secret,
            redirect_uri=redirect_uri,
            device_code=device_code,
            refresh_token=refresh_token,
        )
        return result
    except oauth_backend.OAuthProtocolError as e:
        return JSONResponse(
            status_code=e.status_code,
            content={"error": e.error, "error_description": e.description or e.error},
        )


# 设备授权流
@router.post("/oauth/device/code")
async def device_code_endpoint(
    request: Request,
    client_id: str = Form(...),
    scope: str = Form(""),
    db: AsyncSession = Depends(get_db),
):
    return await oauth_backend.create_device_authorization(db, int(client_id), scope)


@router.post("/oauth/device/approve")
async def device_approve(
    body: dict = Body(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user_code = (body.get("user_code") or "").strip().upper()
    approved = body.get("approved", True)  # default approve, allow deny
    return await oauth_backend.decide_device_authorization(db, user.id, user_code, approved)


# 用户信息端点
async def _get_token_user(authorization: str | None, db: AsyncSession) -> tuple[AccessToken, User]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    token = authorization.removeprefix("Bearer ").strip()
    at = (await db.execute(select(AccessToken).where(AccessToken.access_token == token))).scalar_one_or_none()
    if not at or at.expires_at < _now().timestamp() * 1000:
        raise HTTPException(status_code=401, detail="invalid or expired token")
    user = (await db.execute(select(User).where(User.id == at.user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="user not found")
    return at, user


@router.get("/oauth/userinfo")
async def userinfo(request: Request, authorization: str | None = Header(default=None), db: AsyncSession = Depends(get_db)):
    at, user = await _get_token_user(authorization, db)
    scopes = at.scope.split() if at.scope else []
    base = await _resolve_base_url(request, db)
    data = {"sub": str(user.id), "username": user.username, "avatar_url": f"{base}/api/users/{user.id}/avatar"}
    if "email" in scopes:
        data["email"] = user.email
    if "permission" in scopes:
        data["user_group"] = user.user_group.value
    return data


@router.get("/oauth/profile")
async def oauth_profile(authorization: str | None = Header(default=None), db: AsyncSession = Depends(get_db)):
    _, user = await _get_token_user(authorization, db)
    return {"sub": str(user.id), "username": user.username}


@router.get("/oauth/avatar")
async def oauth_avatar(request: Request, authorization: str | None = Header(default=None), db: AsyncSession = Depends(get_db)):
    _, user = await _get_token_user(authorization, db)
    base = await _resolve_base_url(request, db)
    return {"avatar_url": f"{base}/api/users/{user.id}/avatar"}


@router.get("/oauth/email")
async def oauth_email(authorization: str | None = Header(default=None), db: AsyncSession = Depends(get_db)):
    at, user = await _get_token_user(authorization, db)
    if "email" not in (at.scope.split() if at.scope else []):
        raise HTTPException(status_code=403, detail="insufficient_scope")
    return {"email": user.email, "email_verified": user.email_verified}


@router.get("/oauth/permissions")
async def oauth_permissions(authorization: str | None = Header(default=None), db: AsyncSession = Depends(get_db)):
    at, user = await _get_token_user(authorization, db)
    if "permission" not in (at.scope.split() if at.scope else []):
        raise HTTPException(status_code=403, detail="insufficient_scope")
    return {"user_group": user.user_group.value}


@router.get("/oauth/skin")
async def oauth_skin(authorization: str | None = Header(default=None), db: AsyncSession = Depends(get_db)):
    at, user = await _get_token_user(authorization, db)
    if "skin" not in (at.scope.split() if at.scope else []):
        raise HTTPException(status_code=403, detail="insufficient_scope")
    result = await oauth_backend.get_skin_info(db, at.access_token)
    return FileResponse(result["path"], media_type="image/png")
