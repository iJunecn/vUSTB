"""管理员业务逻辑 — 分组设置、用户管理、邀请码、轮播图、回退服务。"""
import os
import re
import secrets
import time
import uuid

from fastapi import HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import User, UserGroup, Player, SiteSetting, InviteCode, FallbackEndpoint
from app.services.auth import hash_password
from app.utils.user_groups import (
    SUPER_ADMIN_GROUP, ADMIN_GROUP, USER_GROUP,
    resolve_user_group, is_admin_group, can_grant_admin,
    get_user_group_meta, normalize_user_group,
)


class AdminBackend:

    async def _get_all_settings(self, db: AsyncSession) -> dict:
        rows = (await db.execute(select(SiteSetting))).scalars().all()
        return {r.key: r.value for r in rows}

    async def _get_setting(self, db: AsyncSession, key: str, default: str = "") -> str:
        row = (await db.execute(
            select(SiteSetting).where(SiteSetting.key == key)
        )).scalar_one_or_none()
        return row.value if row else default

    async def _set_setting(self, db: AsyncSession, key: str, value: str):
        row = (await db.execute(
            select(SiteSetting).where(SiteSetting.key == key)
        )).scalar_one_or_none()
        if row:
            row.value = value
        else:
            db.add(SiteSetting(key=key, value=value))

    def _avatar_url_from_hash(self, avatar_hash: str | None) -> str:
        if avatar_hash:
            return f"/static/textures/{avatar_hash}.png"
        return "/api/public/default-avatar"

    # 分组设置

    async def get_site_settings(self, db: AsyncSession):
        s = await self._get_all_settings(db)
        raw_suffixes = s.get("register_email_suffixes", "")
        if isinstance(raw_suffixes, list):
            register_email_suffixes = [str(item).strip() for item in raw_suffixes if str(item).strip()]
        else:
            register_email_suffixes = [
                item.strip() for item in str(raw_suffixes or "").replace("\n", ",").split(",") if item.strip()
            ]
        return {
            "public_url": s.get("public_url", ""),
            "require_invite": s.get("require_invite", "false") == "true",
            "allow_register": s.get("allow_register", "true") == "true",
            "register_email_suffixes": register_email_suffixes,
            "enable_skin_library": s.get("enable_skin_library", "true") == "true",
            "max_texture_size": int(s.get("max_texture_size", "1024")),
        }

    async def get_security_settings(self, db: AsyncSession):
        s = await self._get_all_settings(db)
        return {
            "rate_limit_enabled": s.get("rate_limit_enabled", "true") == "true",
            "rate_limit_auth_attempts": int(s.get("rate_limit_auth_attempts", "5")),
            "rate_limit_auth_window": int(s.get("rate_limit_auth_window", "15")),
            "enable_strong_password_check": s.get("enable_strong_password_check", "false") == "true",
        }

    async def get_email_settings(self, db: AsyncSession):
        s = await self._get_all_settings(db)
        return {
            "email_verify_enabled": s.get("email_verify_enabled", "false") == "true",
            "email_verify_ttl": int(s.get("email_verify_ttl", "300")),
            "smtp_host": s.get("smtp_host", ""),
            "smtp_port": int(s.get("smtp_port", "465")),
            "smtp_user": s.get("smtp_user", ""),
            "smtp_ssl": s.get("smtp_ssl", "true") == "true",
            "smtp_sender": s.get("smtp_sender", ""),
            "email_template_html": s.get("email_template_html", ""),
        }

    async def save_settings_group(self, db: AsyncSession, group: str, body: dict):
        allowed_keys = {
            "site": [
                "public_url",
                "require_invite", "allow_register", "register_email_suffixes", "enable_skin_library",
                "max_texture_size",
            ],
            "security": ["rate_limit_enabled", "rate_limit_auth_attempts", "rate_limit_auth_window", "enable_strong_password_check"],
            "email": ["email_verify_enabled", "email_verify_ttl", "smtp_host", "smtp_port", "smtp_user", "smtp_password", "smtp_ssl", "smtp_sender", "email_template_html"],
        }

        if group not in allowed_keys:
            raise HTTPException(status_code=400, detail="Invalid settings group")

        for key in allowed_keys[group]:
            if key in body:
                val = body[key]
                if key == "smtp_password" and not val:
                    continue
                if key == "register_email_suffixes":
                    if isinstance(val, list):
                        parts = [str(item).strip() for item in val if str(item).strip()]
                    else:
                        parts = [item.strip() for item in str(val or "").replace("\n", ",").split(",") if item.strip()]
                    val = ",".join(parts)
                if key == "public_url":
                    val = str(val or "").strip().rstrip("/")
                value = "true" if isinstance(val, bool) and val else ("false" if isinstance(val, bool) else str(val))
                await self._set_setting(db, key, value)
        await db.commit()

    # 用户

    async def get_admin_users(self, db: AsyncSession):
        users = (await db.execute(select(User).order_by(User.id))).scalars().all()
        result = []
        for user in users:
            profile_count = (await db.execute(
                select(func.count(Player.id)).where(Player.owner_id == user.id)
            )).scalar_one()
            user_group = resolve_user_group(getattr(user, "user_group", None), user.is_admin)
            result.append({
                "id": str(user.id),
                "email": user.email,
                "display_name": user.display_name or "",
                "avatar_url": self._avatar_url_from_hash(getattr(user, "avatar_hash", None)),
                "is_admin": bool(is_admin_group(user_group)),
                "user_group": user_group,
                "user_group_meta": get_user_group_meta(user_group),
                "banned_until": getattr(user, "banned_until", None),
                "profile_count": profile_count,
            })
        return result

    async def toggle_user_admin(self, db: AsyncSession, user_id: int, actor_id: int):
        if actor_id == user_id:
            raise HTTPException(status_code=403, detail="cannot change own admin status")

        actor = (await db.execute(select(User).where(User.id == actor_id))).scalar_one_or_none()
        if not actor:
            raise HTTPException(status_code=401, detail="actor not found")
        actor_group = resolve_user_group(getattr(actor, "user_group", None), actor.is_admin)
        if not can_grant_admin(actor_group):
            raise HTTPException(status_code=403, detail="only super admin can change admin group")

        target = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
        if not target:
            raise HTTPException(status_code=404, detail="user not found")
        target_group = resolve_user_group(getattr(target, "user_group", None), target.is_admin)

        if target_group == SUPER_ADMIN_GROUP:
            raise HTTPException(status_code=403, detail="cannot change super admin group")

        next_group = USER_GROUP if is_admin_group(target_group) else ADMIN_GROUP
        target.user_group = UserGroup(next_group)
        target.is_admin = 1 if is_admin_group(next_group) else 0
        await db.commit()

    async def set_user_group(self, db: AsyncSession, user_id: int, actor_id: int, user_group: str):
        actor = (await db.execute(select(User).where(User.id == actor_id))).scalar_one_or_none()
        if not actor:
            raise HTTPException(status_code=401, detail="actor not found")
        actor_group = resolve_user_group(getattr(actor, "user_group", None), actor.is_admin)

        target = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
        if not target:
            raise HTTPException(status_code=404, detail="user not found")
        target_group = resolve_user_group(getattr(target, "user_group", None), target.is_admin)

        desired_group = normalize_user_group(user_group)

        if actor_id == user_id:
            if actor_group == SUPER_ADMIN_GROUP and desired_group == SUPER_ADMIN_GROUP:
                target.user_group = UserGroup.SUPER_ADMIN
                await db.commit()
                return
            raise HTTPException(status_code=403, detail="cannot change own user group")

        if target_group == SUPER_ADMIN_GROUP:
            raise HTTPException(status_code=403, detail="cannot change super admin group")
        if desired_group == SUPER_ADMIN_GROUP:
            raise HTTPException(status_code=403, detail="cannot assign super admin group")
        if desired_group == ADMIN_GROUP and not can_grant_admin(actor_group):
            raise HTTPException(status_code=403, detail="only super admin can assign admin group")

        target.user_group = UserGroup(desired_group)
        target.is_admin = 1 if is_admin_group(desired_group) else 0
        await db.commit()

    async def delete_user(self, db: AsyncSession, user_id: int, is_admin_action: bool = False):
        user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=404, detail="user not found")
        user_group = resolve_user_group(getattr(user, "user_group", None), user.is_admin)
        if user_group == SUPER_ADMIN_GROUP and is_admin_action:
            raise HTTPException(status_code=403, detail="cannot delete super admin user")
        await db.delete(user)
        await db.commit()

    async def ban_user(self, db: AsyncSession, user_id: int, banned_until: int, actor_id: int):
        user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=404, detail="user not found")
        user_group = resolve_user_group(getattr(user, "user_group", None), user.is_admin)
        if user_group == SUPER_ADMIN_GROUP:
            raise HTTPException(status_code=403, detail="cannot ban super admin user")
        user.banned_until = banned_until
        await db.commit()
        return banned_until

    async def reset_user_password(self, db: AsyncSession, user_id: int, new_password: str):
        user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=404, detail="user not found")
        user.password_hash = hash_password(new_password)
        await db.commit()
        return {"ok": True}

    async def create_invite(self, db: AsyncSession, code: str, total_uses: int, note: str = ""):
        if code:
            if not (6 <= len(code) <= 32) or not re.match(r"^[a-zA-Z0-9_-]+$", code):
                raise HTTPException(status_code=400, detail="Invalid code format")
        else:
            code = secrets.token_urlsafe(16)

        existing = (await db.execute(select(InviteCode).where(InviteCode.code == code))).scalar_one_or_none()
        if existing:
            raise HTTPException(status_code=400, detail="invite code already exists")

        ic = InviteCode(code=code, total_uses=total_uses, note=note)
        db.add(ic)
        await db.commit()
        return code

    async def upload_carousel_image(self, db: AsyncSession, filename: str, content: bytes):
        directory = settings.carousel_directory
        os.makedirs(directory, exist_ok=True)
        with open(os.path.join(directory, filename), "wb") as f:
            f.write(content)
        return {"filename": filename}

    async def delete_carousel_image(self, db: AsyncSession, filename: str):
        directory = settings.carousel_directory
        file_path = os.path.join(directory, filename)
        if os.path.dirname(os.path.abspath(file_path)) != os.path.abspath(directory):
            raise HTTPException(status_code=400, detail="Invalid filename")
        if os.path.exists(file_path):
            os.remove(file_path)
            return {"ok": True}
        raise HTTPException(status_code=404, detail="File not found")

    async def get_fallback_services(self, db: AsyncSession):
        rows = (await db.execute(
            select(FallbackEndpoint).order_by(FallbackEndpoint.priority.asc(), FallbackEndpoint.id.asc())
        )).scalars().all()
        return [
            {
                "id": r.id,
                "priority": r.priority,
                "session_url": r.session_url,
                "account_url": r.account_url,
                "services_url": r.services_url,
                "cache_ttl": r.cache_ttl,
                "skin_domains": r.skin_domains,
                "enable_profile": r.enable_profile,
                "enable_hasjoined": r.enable_hasjoined,
                "enable_whitelist": r.enable_whitelist,
                "note": r.note,
            }
            for r in rows
        ]


admin_backend = AdminBackend()
