"""OAuth 2.0 业务逻辑 — 从 vSkin OAuthBackend 搬运，适配 SQLAlchemy + PostgreSQL。

支持授权码模式、设备授权流、JWKS、id_token RS256 签名等。
"""
import base64
import hashlib
import json
import os
import secrets
import time
from urllib.parse import urlencode

import jwt
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import User, Player, Texture, SiteSetting, OAuthApp, AuthorizationCode as OAuthCodeModel, AccessToken as OAuthAccessTokenModel, DeviceCode as OAuthDeviceCodeModel
from app.services.crypto import crypto
from app.utils.user_groups import resolve_user_group, get_user_group_meta, is_admin_group


class OAuthProtocolError(Exception):
    def __init__(self, error: str, description: str | None = None, status_code: int = 400):
        self.error = error
        self.description = description
        self.status_code = status_code
        super().__init__(description or error)


class OAuthBackend:
    SUPPORTED_SCOPES = {
        "userinfo": {"label": "用户基础信息", "description": "读取用户ID、用户名和头像"},
        "profile": {"label": "用户名", "description": "读取用户名（显示名称）"},
        "avatar": {"label": "头像", "description": "读取头像地址"},
        "email": {"label": "邮箱", "description": "读取邮箱地址"},
        "skin": {"label": "当前皮肤", "description": "读取当前正在使用的皮肤 PNG 源图"},
        "permission": {"label": "权限组", "description": "读取用户权限组信息"},
        "openid": {"label": "OpenID 登录", "description": "签发 id_token 供启动器完成登录"},
        "offline_access": {"label": "离线刷新", "description": "允许客户端获取 refresh_token 并续期登录"},
        "Yggdrasil.PlayerProfiles.Select": {"label": "角色选择", "description": "允许启动器读取当前选中角色信息"},
        "Yggdrasil.Server.Join": {"label": "服务器会话", "description": "允许启动器完成联机服登录所需的认证流程"},
    }

    DEVICE_DEFAULT_SCOPE = "openid offline_access Yggdrasil.PlayerProfiles.Select Yggdrasil.Server.Join"
    DEVICE_SCOPE_KEYS = {"openid", "offline_access", "Yggdrasil.PlayerProfiles.Select", "Yggdrasil.Server.Join"}

    # ====== Settings helpers ======

    async def _get_setting(self, db: AsyncSession, key: str, default: str = "") -> str:
        row = (await db.execute(select(SiteSetting).where(SiteSetting.key == key))).scalar_one_or_none()
        return row.value if row else default

    async def _set_setting(self, db: AsyncSession, key: str, value: str):
        row = (await db.execute(select(SiteSetting).where(SiteSetting.key == key))).scalar_one_or_none()
        if row:
            row.value = value
        else:
            db.add(SiteSetting(key=key, value=value))

    def _site_url(self) -> str:
        return settings.site_url.rstrip("/")

    def _api_url(self) -> str:
        return settings.api_url.rstrip("/") or self._site_url()

    def _issuer(self) -> str:
        return self._api_url() or self._site_url()

    def _verification_uri(self) -> str:
        site_url = self._site_url()
        return f"{site_url}/device" if site_url else "/device"

    # ====== Device flow settings ======

    async def _device_default_redirect_uri(self, db: AsyncSession) -> str:
        return await self._get_setting(db, "oauth_device_default_redirect_uri", "https://oauth.ustb.world/")

    async def _device_expires_in(self, db: AsyncSession) -> int:
        raw = await self._get_setting(db, "oauth_device_expires_in", "")
        try:
            return max(300, int(raw)) if raw else 900
        except (TypeError, ValueError):
            return 900

    async def _device_interval(self, db: AsyncSession) -> int:
        raw = await self._get_setting(db, "oauth_device_interval", "")
        try:
            return max(5, int(raw)) if raw else 5
        except (TypeError, ValueError):
            return 5

    def _parse_shared_client_ids(self, value) -> list[int]:
        if value in (None, ""):
            return []
        if isinstance(value, (list, tuple, set)):
            chunks = list(value)
        else:
            chunks = str(value).split(",")
        result: list[int] = []
        for chunk in chunks:
            try:
                final = int(str(chunk).strip())
            except (TypeError, ValueError):
                continue
            if final > 0 and final not in result:
                result.append(final)
        return result

    async def _shared_client_ids(self, db: AsyncSession) -> list[int]:
        value = await self._get_setting(db, "oauth_device_shared_client_ids", "")
        final = self._parse_shared_client_ids(value)
        if final:
            return final
        legacy_value = await self._get_setting(db, "oauth_device_shared_client_id", "")
        final = self._parse_shared_client_ids(legacy_value)
        return final

    async def _set_shared_client_ids(self, db: AsyncSession, app_ids: list[int]):
        final_ids = self._parse_shared_client_ids(app_ids)
        payload = ",".join(str(app_id) for app_id in final_ids)
        legacy = str(final_ids[0]) if final_ids else ""
        await self._set_setting(db, "oauth_device_shared_client_ids", payload)
        await self._set_setting(db, "oauth_device_shared_client_id", legacy)

    async def _add_shared_client_id(self, db: AsyncSession, app_id: int):
        shared_client_ids = await self._shared_client_ids(db)
        if int(app_id) not in shared_client_ids:
            shared_client_ids.append(int(app_id))
            await self._set_shared_client_ids(db, shared_client_ids)

    async def _remove_shared_client_id(self, db: AsyncSession, app_id: int):
        shared_client_ids = [item for item in await self._shared_client_ids(db) if int(item) != int(app_id)]
        await self._set_shared_client_ids(db, shared_client_ids)

    async def get_admin_device_settings(self, db: AsyncSession) -> dict:
        shared_client_ids = await self._shared_client_ids(db)
        return {
            "shared_client_id": shared_client_ids[0] if shared_client_ids else None,
            "shared_client_ids": shared_client_ids,
            "expires_in": await self._device_expires_in(db),
            "interval": await self._device_interval(db),
            "default_redirect_uri": await self._device_default_redirect_uri(db),
        }

    async def save_admin_device_settings(self, db: AsyncSession, body: dict) -> dict:
        shared_client_ids = body.get("shared_client_ids", None)
        if shared_client_ids is None:
            legacy_shared_client_id = body.get("shared_client_id")
            if legacy_shared_client_id in (None, ""):
                final_shared_client_ids: list[int] = []
            else:
                final_shared_client_ids = self._parse_shared_client_ids([legacy_shared_client_id])
        else:
            final_shared_client_ids = self._parse_shared_client_ids(shared_client_ids)

        for app_id in final_shared_client_ids:
            app = (await db.execute(select(OAuthApp).where(OAuthApp.app_id == app_id))).scalar_one_or_none()
            if not app:
                raise HTTPException(status_code=404, detail="oauth app not found")

        await self._set_shared_client_ids(db, final_shared_client_ids)

        expires_in = body.get("expires_in")
        if expires_in is not None:
            try:
                expires_final = max(300, int(expires_in))
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="expires_in invalid")
            await self._set_setting(db, "oauth_device_expires_in", str(expires_final))

        interval = body.get("interval")
        if interval is not None:
            try:
                interval_final = max(5, int(interval))
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="interval invalid")
            await self._set_setting(db, "oauth_device_interval", str(interval_final))

        default_redirect_uri = body.get("default_redirect_uri")
        if default_redirect_uri is not None:
            await self._set_setting(
                db,
                "oauth_device_default_redirect_uri",
                self._normalize_redirect_uri(default_redirect_uri),
            )

        await db.commit()
        return await self.get_admin_device_settings(db)

    # ====== Scope helpers ======

    def _parse_scope(self, scope: str, default_scope: str = "userinfo", allowed_scopes: set[str] | None = None) -> tuple[str, list[str]]:
        raw = (scope or default_scope).replace(",", " ")
        chunks = [x.strip() for x in raw.split(" ") if x.strip()]
        if not chunks:
            chunks = [x.strip() for x in default_scope.split(" ") if x.strip()]
        result: list[str] = []
        for item in chunks:
            if item == "basic":
                item = "userinfo"
            if item not in self.SUPPORTED_SCOPES:
                raise HTTPException(status_code=400, detail=f"unsupported scope: {item}")
            if allowed_scopes is not None and item not in allowed_scopes:
                raise HTTPException(status_code=400, detail=f"unsupported scope: {item}")
            if item not in result:
                result.append(item)
        return " ".join(result), result

    def _has_scope(self, scope_text: str, item: str) -> bool:
        _, scopes = self._parse_scope(scope_text)
        return item in scopes

    def _scope_items(self, scopes: list[str]) -> list[dict]:
        display_scopes = list(scopes)
        if "userinfo" in display_scopes:
            display_scopes = [x for x in display_scopes if x not in {"profile", "avatar"}]
        items = []
        for key in display_scopes:
            meta = self.SUPPORTED_SCOPES.get(key, {})
            items.append({"key": key, "label": meta.get("label", key), "description": meta.get("description", "")})
        return items

    # ====== Secret/code helpers ======

    def _hash_secret(self, secret: str) -> str:
        return hashlib.sha256(secret.encode("utf-8")).hexdigest()

    def _make_secret(self) -> str:
        return secrets.token_urlsafe(36)

    def _make_code(self) -> str:
        return secrets.token_urlsafe(32)

    def _make_access_token(self) -> str:
        return secrets.token_urlsafe(40)

    def _make_refresh_token(self) -> str:
        return secrets.token_urlsafe(40)

    def _make_device_code(self) -> str:
        return secrets.token_urlsafe(48)

    def _make_user_code(self) -> str:
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        raw = "".join(secrets.choice(alphabet) for _ in range(8))
        return f"{raw[:4]}-{raw[4:]}"

    def _normalize_user_code(self, user_code: str) -> str:
        compact = "".join(ch for ch in str(user_code or "").upper() if ch.isalnum())
        if len(compact) != 8:
            raise HTTPException(status_code=400, detail="invalid user_code")
        return f"{compact[:4]}-{compact[4:]}"

    def _normalize_redirect_uri(self, redirect_uri: str) -> str:
        if not redirect_uri:
            raise HTTPException(status_code=400, detail="redirect_uri required")
        value = str(redirect_uri).strip()
        if not (value.startswith("http://") or value.startswith("https://")):
            raise HTTPException(status_code=400, detail="redirect_uri must start with http:// or https://")
        return value

    def _mask_secret(self, secret: str) -> str:
        if len(secret) <= 8:
            return "*" * len(secret)
        return secret[:4] + "*" * (len(secret) - 8) + secret[-4:]

    # ====== Avatar/Skin URL helpers ======

    def _avatar_url_from_hash(self, avatar_hash: str | None) -> str:
        site = self._site_url()
        if avatar_hash:
            path = f"/static/textures/{avatar_hash}.png"
            return f"{site}{path}" if site else path
        path = "/api/public/default-avatar"
        api_url = self._api_url()
        return f"{api_url}{path}" if api_url else path

    def _skin_url_from_hash(self, skin_hash: str) -> str:
        path = f"/static/textures/{skin_hash}.png"
        site = self._site_url()
        return f"{site}{path}" if site else path

    def _texture_file_path(self, texture_hash: str) -> str | None:
        file_path = os.path.join(settings.textures_directory, f"{texture_hash}.png")
        if os.path.isfile(file_path):
            return file_path
        return None

    # ====== App management ======

    async def list_apps(self, db: AsyncSession) -> list[dict]:
        rows = (await db.execute(select(OAuthApp).order_by(OAuthApp.app_id.asc()))).scalars().all()
        shared_client_ids = set(await self._shared_client_ids(db))
        default_redirect_uri = await self._device_default_redirect_uri(db)
        return [
            {
                "app_id": r.app_id,
                "client_name": r.client_name,
                "description": r.description,
                "redirect_uri": r.redirect_uri,
                "is_device_shared": int(r.app_id) in shared_client_ids,
                "can_use_for_device_flow": True,
                "recommended_device_redirect_uri": default_redirect_uri,
                "created_at": r.created_at,
                "updated_at": r.updated_at,
            }
            for r in rows
        ]

    async def create_app(self, db: AsyncSession, client_name: str, redirect_uri: str, description: str = "", set_as_device_shared_client: bool = False) -> dict:
        final_name = (client_name or "").strip()
        final_redirect_uri = self._normalize_redirect_uri(redirect_uri)
        secret = self._make_secret()
        now = int(time.time() * 1000)
        app = OAuthApp(
            client_name=final_name,
            client_secret_hash=self._hash_secret(secret),
            redirect_uri=final_redirect_uri,
            description=description or None,
            is_device_shared=set_as_device_shared_client,
            created_at=now,
            updated_at=now,
        )
        db.add(app)
        await db.commit()
        await db.refresh(app)

        if set_as_device_shared_client:
            await self._add_shared_client_id(db, app.app_id)

        return {
            "app_id": app.app_id,
            "client_name": final_name,
            "description": description or None,
            "redirect_uri": final_redirect_uri,
            "client_secret": secret,
            "client_secret_masked": self._mask_secret(secret),
            "is_device_shared": set_as_device_shared_client,
        }

    async def update_app(self, db: AsyncSession, app_id: int, client_name: str, redirect_uri: str, description: str | None = None, set_as_device_shared_client: bool | None = None) -> dict:
        app = (await db.execute(select(OAuthApp).where(OAuthApp.app_id == app_id))).scalar_one_or_none()
        if not app:
            raise HTTPException(status_code=404, detail="oauth app not found")
        final_name = (client_name or "").strip()
        final_redirect_uri = self._normalize_redirect_uri(redirect_uri)
        now = int(time.time() * 1000)
        app.client_name = final_name
        app.redirect_uri = final_redirect_uri
        app.updated_at = now
        if description is not None:
            app.description = description or None
        if set_as_device_shared_client is True:
            app.is_device_shared = True
            await self._add_shared_client_id(db, app_id)
        elif set_as_device_shared_client is False:
            app.is_device_shared = False
            await self._remove_shared_client_id(db, app_id)
        await db.commit()
        return {"ok": True}

    async def reset_app_secret(self, db: AsyncSession, app_id: int) -> dict:
        app = (await db.execute(select(OAuthApp).where(OAuthApp.app_id == app_id))).scalar_one_or_none()
        if not app:
            raise HTTPException(status_code=404, detail="oauth app not found")
        secret = self._make_secret()
        now = int(time.time() * 1000)
        app.client_secret_hash = self._hash_secret(secret)
        app.updated_at = now
        await db.commit()
        return {
            "app_id": app_id,
            "client_secret": secret,
            "client_secret_masked": self._mask_secret(secret),
        }

    async def delete_app(self, db: AsyncSession, app_id: int):
        app = (await db.execute(select(OAuthApp).where(OAuthApp.app_id == app_id))).scalar_one_or_none()
        if not app:
            raise HTTPException(status_code=404, detail="oauth app not found")
        await self._remove_shared_client_id(db, app_id)
        await db.delete(app)
        await db.commit()

    # ====== Admin meta ======

    async def admin_meta(self, db: AsyncSession) -> dict:
        site_url = self._site_url()
        api_url = self._api_url()
        device_settings = await self.get_admin_device_settings(db)
        return {
            "authorize_endpoint": f"{site_url}/oauth/authorize" if site_url else "/oauth/authorize",
            "token_endpoint": f"{api_url}/oauth/token" if api_url else "/oauth/token",
            "device_authorization_endpoint": f"{api_url}/oauth/device/code" if api_url else "/oauth/device/code",
            "jwks_uri": f"{api_url}/oauth/jwks" if api_url else "/oauth/jwks",
            "openid_configuration_url": f"{api_url}/.well-known/openid-configuration" if api_url else "/.well-known/openid-configuration",
            "verification_uri": f"{site_url}/device" if site_url else "/device",
            "userinfo_endpoint": f"{api_url}/oauth/userinfo" if api_url else "/oauth/userinfo",
            "supported_scopes": self.SUPPORTED_SCOPES,
            "device_settings": device_settings,
        }

    # ====== OpenID Configuration ======

    async def openid_configuration(self, db: AsyncSession) -> dict:
        issuer = self._issuer()
        shared_client_ids = await self._shared_client_ids(db)

        payload = {
            "issuer": issuer,
            "authorization_endpoint": f"{issuer}/oauth/authorize/check",
            "device_authorization_endpoint": f"{issuer}/oauth/device/code",
            "token_endpoint": f"{issuer}/oauth/token",
            "jwks_uri": f"{issuer}/oauth/jwks",
            "userinfo_endpoint": f"{issuer}/oauth/userinfo",
            "response_types_supported": ["code"],
            "grant_types_supported": ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:device_code"],
            "subject_types_supported": ["public"],
            "id_token_signing_alg_values_supported": ["RS256"],
            "token_endpoint_auth_methods_supported": ["client_secret_post", "client_secret_basic"],
            "claims_supported": ["sub", "preferred_username", "selectedProfile"],
            "scopes_supported": list(self.SUPPORTED_SCOPES.keys()),
        }
        if shared_client_ids:
            payload["shared_client_id"] = str(shared_client_ids[0])
            payload["shared_client_ids"] = [str(s) for s in shared_client_ids]
        return payload

    def jwks(self) -> dict:
        return crypto.jwks()

    # ====== Authorization flow ======

    async def build_authorize_preview(self, db: AsyncSession, client_id: int, redirect_uri: str, state: str = "", scope: str = "userinfo") -> dict:
        app = (await db.execute(select(OAuthApp).where(OAuthApp.app_id == client_id))).scalar_one_or_none()
        if not app:
            raise HTTPException(status_code=400, detail="invalid client_id")
        final_redirect_uri = self._normalize_redirect_uri(redirect_uri)
        if final_redirect_uri != app.redirect_uri:
            raise HTTPException(status_code=400, detail="redirect_uri mismatch")

        normalized_scope, parsed_scopes = self._parse_scope(scope)
        site_name = await self._get_setting(db, "site_name", "像素北科")
        return {
            "app_id": app.app_id,
            "client_name": app.client_name,
            "requester_name": app.client_name or "第三方应用",
            "site_name": site_name,
            "redirect_uri": app.redirect_uri,
            "state": state or "",
            "scope": normalized_scope,
            "scope_items": self._scope_items(parsed_scopes),
        }

    async def authorize_decision(self, db: AsyncSession, user_id: int, client_id: int, redirect_uri: str, state: str, approved: bool, scope: str = "userinfo") -> dict:
        app = (await db.execute(select(OAuthApp).where(OAuthApp.app_id == client_id))).scalar_one_or_none()
        if not app:
            raise HTTPException(status_code=400, detail="invalid client_id")
        final_redirect_uri = self._normalize_redirect_uri(redirect_uri)
        if final_redirect_uri != app.redirect_uri:
            raise HTTPException(status_code=400, detail="redirect_uri mismatch")

        if not approved:
            params = {"error": "access_denied"}
            if state:
                params["state"] = state
            return {"redirect_url": f"{final_redirect_uri}?{urlencode(params)}"}

        normalized_scope, _ = self._parse_scope(scope)
        code = self._make_code()
        now = int(time.time() * 1000)
        expires_at = now + 5 * 60 * 1000

        ac = OAuthCodeModel(code=code, app_id=client_id, user_id=user_id, redirect_uri=final_redirect_uri, scope=normalized_scope, expires_at=expires_at)
        db.add(ac)
        await db.commit()

        params = {"code": code}
        if state:
            params["state"] = state
        return {"redirect_url": f"{final_redirect_uri}?{urlencode(params)}"}

    # ====== Token endpoint ======

    async def _issue_tokens(self, db: AsyncSession, app_id: int, user_id: int, scope_text: str) -> dict:
        now = int(time.time())
        access_expires_in = 7200
        refresh_expires_in = 2592000
        expires_at_ms = (now + access_expires_in) * 1000
        refresh_expires_at_ms = (now + refresh_expires_in) * 1000

        access_token = self._make_access_token()
        refresh_token = self._make_refresh_token()
        id_token = None

        if self._has_scope(scope_text, "openid"):
            user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
            if not user:
                raise HTTPException(status_code=401, detail="user not found")
            profile = await self._get_selected_profile_for_user(db, user_id)
            id_token = crypto.sign_id_token(
                {
                    "iss": self._issuer(),
                    "aud": str(app_id),
                    "sub": str(user.id),
                    "preferred_username": user.display_name,
                    "selectedProfile": self._build_selected_profile_payload(db, profile) if profile else None,
                },
                ttl_seconds=access_expires_in,
            )

        at = OAuthAccessTokenModel(
            access_token=access_token,
            refresh_token=refresh_token,
            app_id=app_id,
            user_id=user_id,
            scope=scope_text,
            expires_at=expires_at_ms,
            refresh_expires_at=refresh_expires_at_ms,
        )
        db.add(at)
        await db.commit()

        payload = {
            "access_token": access_token,
            "token_type": "Bearer",
            "expires_in": access_expires_in,
            "refresh_token": refresh_token,
            "scope": scope_text,
        }
        if id_token:
            payload["id_token"] = id_token
        return payload

    async def exchange_code(self, db: AsyncSession, code: str, client_id: int, client_secret: str, redirect_uri: str) -> dict:
        app = (await db.execute(select(OAuthApp).where(OAuthApp.app_id == client_id))).scalar_one_or_none()
        if not app:
            raise HTTPException(status_code=400, detail="invalid client")
        if self._hash_secret(client_secret or "") != app.client_secret_hash:
            raise HTTPException(status_code=401, detail="invalid client")

        final_redirect_uri = self._normalize_redirect_uri(redirect_uri)
        ac = (await db.execute(select(OAuthCodeModel).where(OAuthCodeModel.code == code))).scalar_one_or_none()
        if not ac:
            raise HTTPException(status_code=400, detail="invalid code")
        if ac.used:
            raise HTTPException(status_code=400, detail="code already used")
        now = int(time.time() * 1000)
        if now > ac.expires_at:
            raise HTTPException(status_code=400, detail="code expired")
        if ac.app_id != client_id:
            raise HTTPException(status_code=400, detail="code client mismatch")
        if ac.redirect_uri != final_redirect_uri:
            raise HTTPException(status_code=400, detail="redirect_uri mismatch")

        ac.used = True
        await db.commit()

        return await self._issue_tokens(db, client_id, ac.user_id, ac.scope or "userinfo")

    async def token_endpoint(self, db: AsyncSession, grant_type: str, code: str | None = None, client_id: int | None = None, client_secret: str | None = None, redirect_uri: str | None = None, device_code: str | None = None, refresh_token: str | None = None) -> dict:
        if grant_type == "authorization_code":
            if client_id is None or not code or not client_secret or not redirect_uri:
                raise HTTPException(status_code=400, detail="code, client_id, client_secret and redirect_uri required")
            return await self.exchange_code(db, code, client_id, client_secret, redirect_uri)

        if grant_type == "urn:ietf:params:oauth:grant-type:device_code":
            if client_id is None or not device_code:
                raise OAuthProtocolError("invalid_request", "client_id and device_code required")
            return await self.exchange_device_code(db, client_id, device_code)

        if grant_type == "refresh_token":
            if client_id is None or not refresh_token:
                raise OAuthProtocolError("invalid_request", "client_id and refresh_token required")
            return await self._refresh_token(db, client_id, refresh_token)

        raise OAuthProtocolError("unsupported_grant_type", "unsupported grant_type")

    # ====== Device flow ======

    async def create_device_authorization(self, db: AsyncSession, client_id: int, scope: str) -> dict:
        normalized_scope, _ = self._parse_scope(scope, default_scope=self.DEVICE_DEFAULT_SCOPE, allowed_scopes=self.DEVICE_SCOPE_KEYS)
        expires_in = await self._device_expires_in(db)
        interval = await self._device_interval(db)
        device_code = self._make_device_code()
        user_code = self._make_user_code()
        expires_at = int(time.time() * 1000) + expires_in * 1000

        dc = OAuthDeviceCodeModel(device_code=device_code, user_code=user_code, app_id=client_id, scope=normalized_scope, status="pending", expires_at=expires_at, interval_seconds=interval)
        db.add(dc)
        await db.commit()

        verification_uri = self._verification_uri()
        return {
            "device_code": device_code,
            "user_code": user_code,
            "verification_uri": verification_uri,
            "verification_uri_complete": f"{verification_uri}?{urlencode({'user_code': user_code})}",
            "expires_in": expires_in,
            "interval": interval,
        }

    async def build_device_preview(self, db: AsyncSession, user_code: str) -> dict:
        normalized_user_code = self._normalize_user_code(user_code)
        dc = (await db.execute(select(OAuthDeviceCodeModel).where(OAuthDeviceCodeModel.user_code == normalized_user_code))).scalar_one_or_none()
        if not dc:
            raise HTTPException(status_code=404, detail="设备授权码不存在")
        now = int(time.time() * 1000)
        if now > dc.expires_at:
            raise HTTPException(status_code=400, detail="设备授权码已过期")

        app = (await db.execute(select(OAuthApp).where(OAuthApp.app_id == dc.app_id))).scalar_one_or_none()
        if not app:
            raise HTTPException(status_code=404, detail="OAuth 应用不存在")

        site_name = await self._get_setting(db, "site_name", "像素北科")
        _, parsed_scopes = self._parse_scope(dc.scope or self.DEVICE_DEFAULT_SCOPE, default_scope=self.DEVICE_DEFAULT_SCOPE, allowed_scopes=self.DEVICE_SCOPE_KEYS)
        return {
            "user_code": normalized_user_code,
            "status": dc.status,
            "requester_name": app.client_name or "授权设备",
            "client_name": app.client_name,
            "site_name": site_name,
            "scope": dc.scope or self.DEVICE_DEFAULT_SCOPE,
            "scope_items": self._scope_items(parsed_scopes),
            "expires_at": dc.expires_at,
        }

    async def decide_device_authorization(self, db: AsyncSession, user_id: int, user_code: str, approved: bool) -> dict:
        normalized_user_code = self._normalize_user_code(user_code)
        dc = (await db.execute(select(OAuthDeviceCodeModel).where(OAuthDeviceCodeModel.user_code == normalized_user_code))).scalar_one_or_none()
        if not dc:
            raise HTTPException(status_code=404, detail="设备授权码不存在")
        now = int(time.time() * 1000)
        if now > dc.expires_at:
            raise HTTPException(status_code=400, detail="设备授权码已过期")
        if dc.status not in {"pending", "approved"}:
            raise HTTPException(status_code=400, detail="设备授权状态不可变更")

        if approved:
            dc.status = "approved"
            dc.user_id = user_id
        else:
            dc.status = "denied"
        await db.commit()
        return {"ok": True, "status": dc.status}

    async def exchange_device_code(self, db: AsyncSession, client_id: int, device_code: str) -> dict:
        dc = (await db.execute(select(OAuthDeviceCodeModel).where(OAuthDeviceCodeModel.device_code == device_code, OAuthDeviceCodeModel.app_id == client_id))).scalar_one_or_none()
        if not dc:
            raise OAuthProtocolError("expired_token", "device_code is invalid or expired")
        now = int(time.time() * 1000)
        if now > dc.expires_at:
            raise OAuthProtocolError("expired_token", "device_code expired")
        if dc.status == "pending":
            raise OAuthProtocolError("authorization_pending", "authorization pending")
        if dc.status == "denied":
            raise OAuthProtocolError("access_denied", "authorization denied")
        if dc.status == "consumed":
            raise OAuthProtocolError("expired_token", "device_code already consumed")
        if dc.status != "approved" or not dc.user_id:
            raise OAuthProtocolError("authorization_pending", "authorization pending")

        payload = await self._issue_tokens(db, client_id, dc.user_id, dc.scope or self.DEVICE_DEFAULT_SCOPE)
        dc.status = "consumed"
        await db.commit()
        return payload

    # ====== Userinfo ======

    async def get_userinfo(self, db: AsyncSession, access_token: str) -> dict:
        at = (await db.execute(select(OAuthAccessTokenModel).where(OAuthAccessTokenModel.access_token == access_token))).scalar_one_or_none()
        if not at:
            raise HTTPException(status_code=401, detail="invalid token")
        now = int(time.time() * 1000)
        if now > at.expires_at:
            raise HTTPException(status_code=401, detail="token expired")

        user = (await db.execute(select(User).where(User.id == at.user_id))).scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=401, detail="invalid token")

        scope_text = at.scope or "userinfo"
        payload = {"sub": str(user.id), "app_id": at.app_id, "scope": scope_text}

        if self._has_scope(scope_text, "userinfo") or self._has_scope(scope_text, "profile"):
            payload["username"] = user.display_name
            payload["display_name"] = user.display_name
        if self._has_scope(scope_text, "userinfo") or self._has_scope(scope_text, "avatar"):
            payload["avatar_url"] = self._avatar_url_from_hash(getattr(user, "avatar_hash", None))
        if self._has_scope(scope_text, "email"):
            payload["email"] = user.email
        if self._has_scope(scope_text, "permission"):
            user_group = resolve_user_group(getattr(user, "user_group", None), user.is_admin)
            payload["user_group"] = user_group
            payload["user_group_meta"] = get_user_group_meta(user_group)
            payload["is_admin"] = bool(is_admin_group(user_group))
        return payload

    async def get_skin_info(self, db: AsyncSession, access_token: str) -> dict:
        at = (await db.execute(select(OAuthAccessTokenModel).where(OAuthAccessTokenModel.access_token == access_token))).scalar_one_or_none()
        if not at:
            raise HTTPException(status_code=401, detail="invalid token")
        now = int(time.time() * 1000)
        if now > at.expires_at:
            raise HTTPException(status_code=401, detail="token expired")
        if not self._has_scope(at.scope or "", "skin"):
            raise HTTPException(status_code=403, detail="missing skin scope")

        profile = await self._get_selected_profile_for_user(db, at.user_id)
        if not profile:
            raise HTTPException(status_code=404, detail="profile not found")

        skin_tex = None
        if profile.skin_texture_id:
            skin_tex = (await db.execute(select(Texture).where(Texture.id == profile.skin_texture_id))).scalar_one_or_none()
        if not skin_tex:
            raise HTTPException(status_code=404, detail="skin not found")

        file_path = self._texture_file_path(skin_tex.hash)
        if not file_path:
            raise HTTPException(status_code=404, detail="skin file not found")

        return {
            "path": file_path,
            "skin_hash": skin_tex.hash,
            "skin_url": self._skin_url_from_hash(skin_tex.hash),
            "profile_id": profile.uuid,
            "profile_name": profile.name,
            "model": "slim" if skin_tex.model == "slim" else "default",
        }

    # ====== Refresh token ======

    async def _refresh_token(self, db: AsyncSession, client_id: int, refresh_token: str) -> dict:
        at = (await db.execute(select(OAuthAccessTokenModel).where(OAuthAccessTokenModel.refresh_token == refresh_token, OAuthAccessTokenModel.app_id == client_id))).scalar_one_or_none()
        if not at:
            raise OAuthProtocolError("invalid_grant", "refresh_token is invalid")
        now = int(time.time() * 1000)
        if now > at.refresh_expires_at:
            await db.delete(at)
            await db.commit()
            raise OAuthProtocolError("invalid_grant", "refresh_token expired")
        user_id = at.user_id
        scope = at.scope or "userinfo"
        await db.delete(at)
        await db.commit()
        return await self._issue_tokens(db, client_id, user_id, scope)

    # ====== Profile helpers ======

    async def _get_selected_profile_for_user(self, db: AsyncSession, user_id: int):
        """Get the most recently used player for a user, fallback to first player with skin."""
        players = (await db.execute(select(Player).where(Player.owner_id == user_id))).scalars().all()
        if not players:
            return None
        # Try to find a player with skin
        for p in players:
            if p.skin_texture_id:
                return p
        return players[0]

    def _build_selected_profile_payload(self, db: AsyncSession, player) -> dict:
        textures_payload = {
            "timestamp": int(time.time() * 1000),
            "profileId": player.uuid,
            "profileName": player.name,
            "textures": {},
        }
        site_url = self._site_url().rstrip("/")
        base_texture_url = f"{site_url}/static/textures/" if site_url else "/static/textures/"

        # These would need to be resolved synchronously; for the id_token
        # we build a simplified version. The full texture resolution happens
        # in the Yggdrasil routes.
        return {
            "id": player.uuid,
            "name": player.name,
        }


oauth_backend = OAuthBackend()
