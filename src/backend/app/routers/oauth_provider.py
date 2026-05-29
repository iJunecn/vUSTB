"""OAuth 2.0 Provider：Authorization Code + Device Flow + OpenID Discovery

端点：
- GET  /.well-known/openid-configuration
- GET  /skinapi/.well-known/openid-configuration   (兼容路径)
- GET  /oauth/jwks
- GET  /oauth/authorize       (前端跳转入口；实际"批准"通过 /oauth/api/approve)
- POST /oauth/api/approve     (前端用户登录后调用以发放 code)
- POST /oauth/token           (code → access_token / device_code → access_token)
- GET  /oauth/userinfo
- POST /oauth/device/code     (设备授权初始端点)
- POST /oauth/device/approve  (前端 device 页用户输入 user_code 后批准)
- GET  /oauth/profile|avatar|email|permissions|skin
"""
import secrets
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
)
from app.services.crypto import crypto

router = APIRouter(tags=["oauth_provider"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _well_known() -> dict:
    base = settings.site_url.rstrip("/")
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
async def openid_config():
    return _well_known()


@router.get("/skinapi/.well-known/openid-configuration")
async def openid_config_skinapi(db: AsyncSession = Depends(get_db)):
    data = _well_known()
    # 设备授权流：共享 client_id
    shared = (await db.execute(
        select(OAuthApp).where(OAuthApp.is_device_shared == True)
    )).scalars().all()
    if shared:
        data["shared_client_ids"] = [str(a.id) for a in shared]
        data["shared_client_id"] = str(shared[0].id)
    return data


@router.get("/oauth/jwks")
async def jwks():
    return crypto.jwks()


# ====== Authorization Code Flow ======
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
    app = (await db.execute(select(OAuthApp).where(OAuthApp.id == int(client_id)))).scalar_one_or_none()
    if not app:
        raise HTTPException(status_code=400, detail="unknown client_id")
    if app.redirect_uri != redirect_uri:
        raise HTTPException(status_code=400, detail="redirect_uri mismatch")

    code = secrets.token_urlsafe(32)
    db.add(AuthorizationCode(
        code=code, client_id=app.id, user_id=user.id,
        redirect_uri=redirect_uri,
        scopes=scope.split() if isinstance(scope, str) else list(scope or []),
        expires_at=_now() + timedelta(minutes=10),
    ))
    await db.commit()
    sep = "&" if "?" in redirect_uri else "?"
    return {"redirect": f"{redirect_uri}{sep}code={code}&state={state}"}


@router.post("/oauth/token")
async def token_endpoint(
    grant_type: str = Form(...),
    code: str | None = Form(None),
    client_id: str | None = Form(None),
    client_secret: str | None = Form(None),
    redirect_uri: str | None = Form(None),
    refresh_token: str | None = Form(None),
    device_code: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
):
    if grant_type == "authorization_code":
        if not all([code, client_id, client_secret, redirect_uri]):
            raise HTTPException(status_code=400, detail="invalid_request")
        app = (await db.execute(select(OAuthApp).where(OAuthApp.id == int(client_id)))).scalar_one_or_none()
        if not app or app.client_secret != client_secret or app.redirect_uri != redirect_uri:
            raise HTTPException(status_code=400, detail="invalid_client")
        ac = (await db.execute(select(AuthorizationCode).where(AuthorizationCode.code == code))).scalar_one_or_none()
        if not ac or ac.used or ac.expires_at < _now() or ac.client_id != app.id:
            raise HTTPException(status_code=400, detail="invalid_grant")
        ac.used = True
        access = secrets.token_urlsafe(48)
        refresh = secrets.token_urlsafe(48)
        db.add(AccessToken(
            token=access, refresh_token=refresh, client_id=app.id, user_id=ac.user_id,
            scopes=ac.scopes, expires_at=_now() + timedelta(hours=1),
        ))
        await db.commit()
        return {"access_token": access, "token_type": "Bearer", "expires_in": 3600,
                "refresh_token": refresh, "scope": " ".join(ac.scopes or [])}

    if grant_type == "refresh_token":
        if not refresh_token:
            raise HTTPException(status_code=400, detail="invalid_request")
        at = (await db.execute(select(AccessToken).where(AccessToken.refresh_token == refresh_token))).scalar_one_or_none()
        if not at:
            raise HTTPException(status_code=400, detail="invalid_grant")
        new_access = secrets.token_urlsafe(48)
        new_refresh = secrets.token_urlsafe(48)
        at.token = new_access
        at.refresh_token = new_refresh
        at.expires_at = _now() + timedelta(hours=1)
        await db.commit()
        return {"access_token": new_access, "token_type": "Bearer", "expires_in": 3600,
                "refresh_token": new_refresh, "scope": " ".join(at.scopes or [])}

    if grant_type == "urn:ietf:params:oauth:grant-type:device_code":
        if not device_code:
            raise HTTPException(status_code=400, detail="invalid_request")
        dc = (await db.execute(select(DeviceCode).where(DeviceCode.device_code == device_code))).scalar_one_or_none()
        if not dc:
            raise HTTPException(status_code=400, detail={"error": "expired_token"})
        if dc.expires_at < _now():
            raise HTTPException(status_code=400, detail={"error": "expired_token"})
        if not dc.approved or not dc.user_id:
            return JSONResponse(status_code=400, content={"error": "authorization_pending"})

        access = secrets.token_urlsafe(48)
        refresh = secrets.token_urlsafe(48)
        db.add(AccessToken(
            token=access, refresh_token=refresh, client_id=dc.client_id,
            user_id=dc.user_id, scopes=dc.scopes, expires_at=_now() + timedelta(hours=1),
        ))

        # 构造 id_token (RS256)
        selected_profile = None
        if dc.selected_player_id:
            p = (await db.execute(select(Player).where(Player.id == dc.selected_player_id))).scalar_one_or_none()
            if p:
                selected_profile = {"id": p.uuid.replace("-", ""), "name": p.name}

        id_token = crypto.sign_id_token({
            "iss": settings.site_url,
            "aud": str(dc.client_id),
            "sub": str(dc.user_id),
            "selectedProfile": selected_profile,
        })
        await db.commit()
        return {"access_token": access, "token_type": "Bearer", "expires_in": 3600,
                "refresh_token": refresh, "id_token": id_token,
                "scope": " ".join(dc.scopes or [])}

    raise HTTPException(status_code=400, detail={"error": "unsupported_grant_type"})


# ====== Device Flow ======
@router.post("/oauth/device/code")
async def device_code(
    client_id: str = Form(...),
    scope: str = Form(""),
    db: AsyncSession = Depends(get_db),
):
    app = (await db.execute(select(OAuthApp).where(OAuthApp.id == int(client_id)))).scalar_one_or_none()
    if not app:
        raise HTTPException(status_code=400, detail="invalid_client")
    dc_code = secrets.token_urlsafe(40)
    user_code = secrets.token_hex(4).upper()
    expires = _now() + timedelta(minutes=10)
    db.add(DeviceCode(
        device_code=dc_code, user_code=user_code, client_id=app.id,
        scopes=scope.split() if scope else [], expires_at=expires,
    ))
    await db.commit()
    verify_url = settings.site_url.rstrip("/") + "/oauth/device"
    return {
        "device_code": dc_code,
        "user_code": user_code,
        "verification_uri": verify_url,
        "verification_uri_complete": f"{verify_url}?user_code={user_code}",
        "expires_in": 600,
        "interval": 5,
    }


@router.post("/oauth/device/approve")
async def device_approve(
    body: dict = Body(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user_code = (body.get("user_code") or "").strip().upper()
    selected_player_id = body.get("selected_player_id")
    dc = (await db.execute(select(DeviceCode).where(DeviceCode.user_code == user_code))).scalar_one_or_none()
    if not dc or dc.expires_at < _now():
        raise HTTPException(status_code=400, detail="invalid or expired user_code")
    dc.user_id = user.id
    dc.approved = True
    dc.selected_player_id = selected_player_id
    await db.commit()
    return {"ok": True}


# ====== userinfo & scope 端点 ======
async def _get_token_user(authorization: str | None, db: AsyncSession) -> tuple[AccessToken, User]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    token = authorization.removeprefix("Bearer ").strip()
    at = (await db.execute(select(AccessToken).where(AccessToken.token == token))).scalar_one_or_none()
    if not at or at.expires_at < _now():
        raise HTTPException(status_code=401, detail="invalid or expired token")
    user = (await db.execute(select(User).where(User.id == at.user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="user not found")
    return at, user


@router.get("/oauth/userinfo")
async def userinfo(authorization: str | None = Header(default=None), db: AsyncSession = Depends(get_db)):
    at, user = await _get_token_user(authorization, db)
    scopes = at.scopes or []
    data = {"sub": str(user.id), "username": user.username, "avatar_url": f"{settings.site_url}/api/users/{user.id}/avatar"}
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
async def oauth_avatar(authorization: str | None = Header(default=None), db: AsyncSession = Depends(get_db)):
    _, user = await _get_token_user(authorization, db)
    return {"avatar_url": f"{settings.site_url}/api/users/{user.id}/avatar"}


@router.get("/oauth/email")
async def oauth_email(authorization: str | None = Header(default=None), db: AsyncSession = Depends(get_db)):
    at, user = await _get_token_user(authorization, db)
    if "email" not in (at.scopes or []):
        raise HTTPException(status_code=403, detail="insufficient_scope")
    return {"email": user.email, "email_verified": user.email_verified}


@router.get("/oauth/permissions")
async def oauth_permissions(authorization: str | None = Header(default=None), db: AsyncSession = Depends(get_db)):
    at, user = await _get_token_user(authorization, db)
    if "permission" not in (at.scopes or []):
        raise HTTPException(status_code=403, detail="insufficient_scope")
    return {"user_group": user.user_group.value}


@router.get("/oauth/skin")
async def oauth_skin(authorization: str | None = Header(default=None), db: AsyncSession = Depends(get_db)):
    at, user = await _get_token_user(authorization, db)
    if "skin" not in (at.scopes or []):
        raise HTTPException(status_code=403, detail="insufficient_scope")
    player = (await db.execute(select(Player).where(Player.owner_id == user.id))).scalars().first()
    if not player or not player.skin_texture_id:
        raise HTTPException(status_code=404, detail="no skin")
    tex = (await db.execute(select(Texture).where(Texture.id == player.skin_texture_id))).scalar_one_or_none()
    if not tex:
        raise HTTPException(status_code=404, detail="texture not found")
    path = f"{settings.textures_directory}/{tex.hash}.png"
    return FileResponse(path, media_type="image/png")
