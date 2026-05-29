"""材质静态文件服务"""
from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, Response

from app.config import settings
from app.utils.image import make_default_steve_head

router = APIRouter(tags=["static"])


@router.get("/static/textures/{filename}")
async def serve_texture(filename: str):
    if "/" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="bad name")
    path = Path(settings.textures_directory) / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="not found")
    return FileResponse(path, media_type="image/png")


@router.get("/api/users/{user_id}/avatar")
async def user_avatar(user_id: int):
    # 默认 Steve 头像；具体头像逻辑后续实现
    return Response(content=make_default_steve_head(), media_type="image/png")
