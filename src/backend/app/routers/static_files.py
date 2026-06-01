"""材质静态文件服务

为 Yggdrasil 材质（皮肤/披风）提供静态文件响应，并添加适合 MC 客户端
重复请求的 Cache-Control 头。

同时提供用户头像接口。
"""
import os
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import User, Texture, Player
from app.utils.image import default_steve_head_avatar, extract_skin_head_avatar

router = APIRouter(tags=["static"])


# ====== 材质文件 ======

@router.head("/static/textures/{filename}")
@router.get("/static/textures/{filename}")
async def serve_texture(filename: str):
    """提供材质 PNG 文件。

    MC 客户端会反复请求同一材质 URL，设置长缓存可大幅减少带宽和延迟。
    Cache-Control: public, max-age=604800（7 天）——材质哈希不变则内容不变。
    """
    if "/" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="bad name")
    path = Path(settings.textures_directory) / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="not found")
    return FileResponse(
        path,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=604800"},
    )


# ====== 用户头像 ======

@router.get("/api/users/{user_id}/avatar")
async def user_avatar(user_id: int, db: AsyncSession = Depends(get_db)):
    """获取用户头像"""
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        return Response(
            content=default_steve_head_avatar(output_size=256),
            media_type="image/png",
            headers={"Cache-Control": "public, max-age=3600"},
        )

    avatar_hash = getattr(user, "avatar_hash", None)
    if avatar_hash:
        avatar_path = Path(settings.textures_directory) / f"{avatar_hash}.png"
        if avatar_path.exists():
            return FileResponse(
                avatar_path,
                media_type="image/png",
                headers={"Cache-Control": "public, max-age=3600"},
            )

    # 如果没有自定义头像，尝试用皮肤截脸
    players = (await db.execute(select(Player).where(Player.owner_id == user.id))).scalars().all()
    if players:
        player = players[0]
        if player.skin_texture_id:
            tex = (await db.execute(select(Texture).where(Texture.id == player.skin_texture_id))).scalar_one_or_none()
            if tex:
                skin_path = Path(settings.textures_directory) / f"{tex.hash}.png"
                if skin_path.exists():
                    with open(skin_path, "rb") as f:
                        skin_bytes = f.read()
                    try:
                        avatar_bytes = extract_skin_head_avatar(skin_bytes, output_size=256)
                        return Response(
                            content=avatar_bytes,
                            media_type="image/png",
                            headers={"Cache-Control": "public, max-age=3600"},
                        )
                    except Exception:
                        pass

    # 最终 fallback: Steve 头像
    return Response(
        content=default_steve_head_avatar(output_size=256),
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=3600"},
    )
