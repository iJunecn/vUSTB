"""站点用户业务逻辑 — 从 vSkin SiteBackend 搬运，适配 SQLAlchemy。

包含：登录/注册、验证码、用户信息、角色管理、材质应用、头像设置等。
"""
import hashlib
import os
import random
import re
import string
import time

from fastapi import HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import User, UserGroup, Player, Texture, Wardrobe, SiteSetting, VerificationCode, InviteCode
from app.services.auth import hash_password, verify_password, create_jwt, decode_jwt
from app.utils.image import (
    extract_skin_head_avatar,
    compute_texture_hash_from_image,
    normalize_png,
    validate_texture_dimensions,
    save_texture,
    default_steve_head_avatar,
)
from app.utils.user_groups import (
    SUPER_ADMIN_GROUP, USER_GROUP, resolve_user_group, is_admin_group, get_user_group_meta, normalize_user_group,
)
from app.utils.email_utils import email_sender


class SiteBackend:

    def _site_url(self) -> str:
        return settings.site_url.rstrip("/")

    def _api_url(self) -> str:
        api_url = settings.api_url.rstrip("/")
        return api_url or self._site_url()

    def _avatar_url_from_hash(self, avatar_hash: str | None) -> str:
        site = self._site_url()
        if avatar_hash:
            path = f"/static/textures/{avatar_hash}.png"
            return f"{site}{path}" if site else path
        path = "/api/public/default-avatar"
        api_url = self._api_url()
        return f"{api_url}{path}" if api_url else path

    def build_avatar_url(self, avatar_hash: str | None) -> str:
        return self._avatar_url_from_hash(avatar_hash)

    # ========== Settings helpers ==========

    async def _get_setting(self, db: AsyncSession, key: str, default: str = "") -> str:
        row = (await db.execute(
            select(SiteSetting).where(SiteSetting.key == key)
        )).scalar_one_or_none()
        return row.value if row else default

    async def _get_all_settings(self, db: AsyncSession) -> dict:
        rows = (await db.execute(select(SiteSetting))).scalars().all()
        return {r.key: r.value for r in rows}

    async def _set_setting(self, db: AsyncSession, key: str, value: str):
        row = (await db.execute(
            select(SiteSetting).where(SiteSetting.key == key)
        )).scalar_one_or_none()
        if row:
            row.value = value
        else:
            db.add(SiteSetting(key=key, value=value))

    def _normalize_register_email_suffixes(self, raw_value) -> list[str]:
        if isinstance(raw_value, list):
            parts = raw_value
        else:
            parts = str(raw_value or "").replace("\n", ",").split(",")
        normalized = []
        for item in parts:
            token = str(item).strip().lower()
            if not token:
                continue
            token = token.lstrip("@")
            if token.startswith("."):
                token = token[1:]
            if token:
                normalized.append(token)
        return list(dict.fromkeys(normalized))

    async def _is_register_email_allowed(self, db: AsyncSession, email: str) -> bool:
        raw_suffixes = await self._get_setting(db, "register_email_suffixes", "")
        suffixes = self._normalize_register_email_suffixes(raw_suffixes)
        if not suffixes:
            return True
        if "@" not in email:
            return False
        domain = email.split("@", 1)[1].strip().lower()
        if not domain:
            return False
        for suffix in suffixes:
            if domain == suffix or domain.endswith("." + suffix):
                return True
        return False

    # ========== Auth & User ==========

    async def send_verification_code(self, db: AsyncSession, email: str, type: str):
        enabled = await self._get_setting(db, "email_verify_enabled", "false")
        if enabled != "true":
            raise HTTPException(status_code=400, detail="Email verification is disabled")

        if not re.match(r"[^@]+@[^@]+\.[^@]+", email):
            raise HTTPException(status_code=400, detail="Invalid email format")

        if type == "reset":
            user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
            if not user:
                return {"ok": True, "ttl": 0}

        if type == "register":
            if not await self._is_register_email_allowed(db, email):
                raise HTTPException(status_code=400, detail="Email domain is not allowed")
            user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
            if user:
                raise HTTPException(status_code=400, detail="Email already registered")

        code = "".join(random.choices(string.ascii_uppercase + string.digits, k=8))
        ttl = int(await self._get_setting(db, "email_verify_ttl", "300"))

        # Upsert verification code
        vc = (await db.execute(
            select(VerificationCode).where(VerificationCode.email == email, VerificationCode.type == type)
        )).scalar_one_or_none()
        if vc:
            vc.code = code
            vc.expires_at = int(time.time() * 1000) + ttl * 1000
        else:
            db.add(VerificationCode(email=email, code=code, type=type, expires_at=int(time.time() * 1000) + ttl * 1000))
        await db.commit()

        sent = await email_sender.send_verification_code(db, email, code, type)
        if not sent:
            raise HTTPException(status_code=500, detail="Failed to send verification email")
        return {"ok": True, "ttl": ttl}

    async def verify_code(self, db: AsyncSession, email: str, code: str, type: str) -> bool:
        vc = (await db.execute(
            select(VerificationCode).where(VerificationCode.email == email, VerificationCode.type == type)
        )).scalar_one_or_none()
        if not vc:
            return False
        if str(vc.code).upper() != str(code).upper():
            return False
        if int(time.time() * 1000) > vc.expires_at:
            return False
        return True

    async def login(self, db: AsyncSession, email: str, password: str) -> dict:
        user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=401, detail="Invalid credentials")

        user_group = resolve_user_group(getattr(user, "user_group", None), user.is_admin)

        if not verify_password(password, user.password_hash):
            raise HTTPException(status_code=401, detail="Invalid credentials")

        expire_minutes = int(await self._get_setting(db, "jwt_expire_days", "7")) * 24 * 60
        token = create_jwt(str(user.id), extra={"user_group": user_group, "is_admin": is_admin_group(user_group)}, expire_minutes=expire_minutes)

        return {"token": token, "user_id": str(user.id)}

    async def register(self, db: AsyncSession, email: str, password: str, username: str, invite_code: str = None, verification_code: str = None) -> str:
        if not username or not username.strip():
            raise HTTPException(status_code=400, detail="Username is required")

        username = username.strip()

        # Check display_name uniqueness
        existing_user = (await db.execute(select(User).where(User.display_name == username))).scalar_one_or_none()
        if existing_user:
            raise HTTPException(status_code=400, detail="Username already exists")

        enable_strong = await self._get_setting(db, "enable_strong_password_check", "false") == "true"
        if enable_strong:
            errors = _validate_strong_password(password)
            if errors:
                raise HTTPException(status_code=400, detail="；".join(errors))

        allow_register = await self._get_setting(db, "allow_register", "true")
        if allow_register != "true":
            raise HTTPException(status_code=403, detail="registration is disabled")

        if not await self._is_register_email_allowed(db, email):
            raise HTTPException(status_code=400, detail="Email domain is not allowed")

        email_verify = await self._get_setting(db, "email_verify_enabled", "false") == "true"
        if email_verify:
            if not verification_code:
                raise HTTPException(status_code=400, detail="Verification code required")
            if not await self.verify_code(db, email, verification_code, "register"):
                raise HTTPException(status_code=400, detail="Invalid or expired verification code")
            # Delete code after usage
            vc = (await db.execute(
                select(VerificationCode).where(VerificationCode.email == email, VerificationCode.type == "register")
            )).scalar_one_or_none()
            if vc:
                await db.delete(vc)

        require_invite = await self._get_setting(db, "require_invite", "false") == "true"
        if require_invite:
            if not invite_code:
                raise HTTPException(status_code=400, detail="invite code required")
            ic = (await db.execute(select(InviteCode).where(InviteCode.code == invite_code))).scalar_one_or_none()
            if not ic:
                raise HTTPException(status_code=400, detail="invalid invite code")
            if ic.total_uses is not None and ic.used_count >= ic.total_uses:
                raise HTTPException(status_code=400, detail="invite code has no remaining uses")
            ic.used_count += 1
            if not ic.used_by:
                ic.used_by = email

        # Count users for first-user super_admin
        user_count = (await db.execute(select(func.count(User.id)))).scalar_one()
        is_first_user = user_count == 0

        password_hash = hash_password(password)
        user_group = SUPER_ADMIN_GROUP if is_first_user else USER_GROUP

        user = User(
            email=email,
            username=username,
            display_name=username,
            password_hash=password_hash,
            is_admin=1 if is_admin_group(user_group) else 0,
            user_group=UserGroup(user_group),
        )
        db.add(user)
        await db.flush()

        # Auto-create a profile
        base_name = re.sub(r"[^a-zA-Z0-9_]", "_", email.split("@")[0])[:12]
        profile_name = base_name
        suffix = 1
        while True:
            existing = (await db.execute(select(Player).where(Player.name == profile_name))).scalar_one_or_none()
            if not existing:
                break
            profile_name = f"{base_name}_{suffix}"
            suffix += 1
            if suffix > 100:
                raise HTTPException(status_code=500, detail="无法生成唯一角色名")

        player = Player(uuid=os.urandom(16).hex(), name=profile_name, owner_id=user.id)
        db.add(player)
        await db.commit()
        return str(user.id)

    async def get_user_info(self, db: AsyncSession, user_id: int) -> dict:
        user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=404, detail="user not found")

        players = (await db.execute(select(Player).where(Player.owner_id == user.id))).scalars().all()
        profiles_list = [
            {
                "id": p.uuid,
                "name": p.name,
                "model": "slim" if _player_skin_model(db, p) == "slim" else "default",
                "skin_hash": _player_skin_hash(db, p),
                "cape_hash": _player_cape_hash(db, p),
            }
            for p in players
        ]

        user_group = resolve_user_group(getattr(user, "user_group", None), user.is_admin)
        return {
            "id": str(user.id),
            "email": user.email,
            "display_name": user.display_name,
            "avatar_hash": getattr(user, "avatar_hash", None),
            "avatar_url": self._avatar_url_from_hash(getattr(user, "avatar_hash", None)),
            "is_admin": bool(is_admin_group(user_group)),
            "user_group": user_group,
            "user_group_meta": get_user_group_meta(user_group),
            "banned_until": getattr(user, "banned_until", None),
            "profiles": profiles_list,
        }

    async def set_avatar_from_texture(self, db: AsyncSession, user_id: int, texture_hash: str) -> dict:
        if not texture_hash:
            raise HTTPException(status_code=400, detail="texture hash required")

        tex = (await db.execute(select(Texture).where(Texture.hash == texture_hash))).scalar_one_or_none()
        if not tex:
            raise HTTPException(status_code=403, detail="skin texture not found in your library")

        skin_path = os.path.join(settings.textures_directory, f"{texture_hash}.png")
        if not os.path.isfile(skin_path):
            raise HTTPException(status_code=404, detail="skin file not found")

        with open(skin_path, "rb") as f:
            skin_bytes = f.read()

        avatar_bytes = extract_skin_head_avatar(skin_bytes, output_size=256)
        avatar_hash = hashlib.sha256((str(user_id) + texture_hash + str(time.time())).encode("utf-8")).hexdigest()[:48]
        avatar_path = os.path.join(settings.textures_directory, f"{avatar_hash}.png")
        with open(avatar_path, "wb") as f:
            f.write(avatar_bytes)

        user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
        if user:
            user.avatar_hash = avatar_hash
            await db.commit()

        return {
            "avatar_hash": avatar_hash,
            "avatar_url": self._avatar_url_from_hash(avatar_hash),
        }

    async def refresh_token(self, db: AsyncSession, user_id: int) -> dict:
        user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=404, detail="user not found")

        user_group = resolve_user_group(getattr(user, "user_group", None), user.is_admin)
        is_admin = bool(is_admin_group(user_group))
        expire_minutes = int(await self._get_setting(db, "jwt_expire_days", "7")) * 24 * 60
        token = create_jwt(str(user.id), extra={"user_group": user_group, "is_admin": is_admin}, expire_minutes=expire_minutes)

        return {"token": token, "is_admin": is_admin, "user_group": user_group}

    async def update_user_info(self, db: AsyncSession, user_id: int, data: dict):
        user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
        if not user:
            return

        if "display_name" in data and data["display_name"]:
            new_name = data["display_name"].strip()
            if not new_name:
                raise HTTPException(status_code=400, detail="Username cannot be empty")
            if user.display_name != new_name:
                existing = (await db.execute(select(User).where(User.display_name == new_name, User.id != user_id))).scalar_one_or_none()
                if existing:
                    raise HTTPException(status_code=400, detail="Username already exists")
                user.display_name = new_name
        await db.commit()

    # ========== Profile ==========

    async def create_profile(self, db: AsyncSession, user_id: int, name: str, model: str = "default") -> dict:
        if not name:
            raise HTTPException(status_code=400, detail="name required")
        if not re.match(r"^[a-zA-Z0-9_]{1,16}$", name):
            raise HTTPException(status_code=400, detail="角色名只能包含字母、数字、下划线，长度1-16字符")

        existing = (await db.execute(select(Player).where(Player.name == name))).scalar_one_or_none()
        if existing:
            raise HTTPException(status_code=400, detail="角色名已被占用")

        player = Player(uuid=os.urandom(16).hex(), name=name, owner_id=user_id)
        db.add(player)
        await db.commit()
        await db.refresh(player)
        return {"id": player.uuid, "name": player.name, "model": model}

    async def delete_profile(self, db: AsyncSession, user_id: int, player_uuid: str):
        player = (await db.execute(select(Player).where(Player.uuid == player_uuid, Player.owner_id == user_id))).scalar_one_or_none()
        if not player:
            raise HTTPException(status_code=404, detail="profile not found")
        await db.delete(player)
        await db.commit()

    async def apply_texture_to_profile(self, db: AsyncSession, user_id: int, player_uuid: str, texture_hash: str, texture_type: str):
        # Verify player ownership
        player = (await db.execute(select(Player).where(Player.uuid == player_uuid, Player.owner_id == user_id))).scalar_one_or_none()
        if not player:
            raise ValueError("Profile not yours")

        tex = (await db.execute(select(Texture).where(Texture.hash == texture_hash))).scalar_one_or_none()
        if not tex:
            raise ValueError("Texture not found")

        # Verify user has this texture in wardrobe
        wardrobe = (await db.execute(
            select(Wardrobe).where(Wardrobe.user_id == user_id, Wardrobe.texture_id == tex.id)
        )).scalar_one_or_none()
        if not wardrobe:
            raise ValueError("Texture not found in your library")

        if texture_type.lower() == "skin":
            player.skin_texture_id = tex.id
        elif texture_type.lower() == "cape":
            player.cape_texture_id = tex.id
        else:
            raise ValueError("Invalid texture_type")
        await db.commit()

    async def clear_profile_texture(self, db: AsyncSession, user_id: int, player_uuid: str, texture_type: str):
        player = (await db.execute(select(Player).where(Player.uuid == player_uuid, Player.owner_id == user_id))).scalar_one_or_none()
        if not player:
            raise ValueError("Not allowed")

        if texture_type.lower() == "skin":
            player.skin_texture_id = None
        elif texture_type.lower() == "cape":
            player.cape_texture_id = None
        else:
            raise ValueError("Invalid texture_type")
        await db.commit()

    async def change_password(self, db: AsyncSession, user_id: int, old_password: str, new_password: str):
        user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=404, detail="用户不存在")
        if not verify_password(old_password, user.password_hash):
            raise HTTPException(status_code=403, detail="旧密码错误")
        user.password_hash = hash_password(new_password)
        await db.commit()

    async def reset_password(self, db: AsyncSession, email: str, new_password: str, verification_code: str):
        email_verify = await self._get_setting(db, "email_verify_enabled", "false") == "true"
        if not email_verify:
            raise HTTPException(status_code=403, detail="Password reset via email is disabled")
        if not await self.verify_code(db, email, verification_code, "reset"):
            raise HTTPException(status_code=400, detail="Invalid or expired verification code")
        user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        user.password_hash = hash_password(new_password)
        # Delete code
        vc = (await db.execute(
            select(VerificationCode).where(VerificationCode.email == email, VerificationCode.type == "reset")
        )).scalar_one_or_none()
        if vc:
            await db.delete(vc)
        await db.commit()

    async def delete_user(self, db: AsyncSession, user_id: int, is_admin_action: bool = False):
        user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=404, detail="user not found")
        user_group = resolve_user_group(getattr(user, "user_group", None), user.is_admin)
        if is_admin_group(user_group) and not is_admin_action:
            raise HTTPException(status_code=403, detail="管理员不能删除自己的账号")
        if user_group == SUPER_ADMIN_GROUP and is_admin_action:
            raise HTTPException(status_code=403, detail="cannot delete super admin user")
        await db.delete(user)
        await db.commit()

    async def list_carousel_images(self, db: AsyncSession) -> list[str]:
        directory = settings.carousel_directory
        images: list[str] = []
        if os.path.exists(directory):
            files = os.listdir(directory)
            images = [f for f in files if f.lower().endswith((".png", ".jpg", ".jpeg", ".webp"))]
        images.sort()

        external_urls_raw = await self._get_setting(db, "home_image_urls", "")
        external_urls = [
            line.strip()
            for line in str(external_urls_raw or "").splitlines()
            if line.strip()
        ]
        return [*external_urls, *images]


# ====== Helpers ======

def _validate_strong_password(password: str) -> list[str]:
    errors: list[str] = []
    if len(password) < 6:
        errors.append("密码长度至少6位")
    has_upper = bool(re.search(r"[A-Z]", password))
    has_lower = bool(re.search(r"[a-z]", password))
    has_digit = bool(re.search(r"\d", password))
    has_special = bool(re.search(r"[^\w\s]", password))
    if (has_upper + has_lower + has_digit) == 1 and not has_special:
        errors.append("请使用更复杂的密码")
    return errors


def _player_skin_hash(db: AsyncSession, player: Player) -> str | None:
    """Quick access — use in list context only; for accurate data query the texture."""
    return None  # Will be resolved via join in actual queries


def _player_cape_hash(db: AsyncSession, player: Player) -> str | None:
    return None


site_backend = SiteBackend()
