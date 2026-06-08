"""CustomSkinAPI 路由（CustomSkinLoader 兼容）。

实现 CustomSkinAPI R2 规范，端点列表见下方路由注册。
"""

import logging
import os
from pathlib import Path
from email.utils import formatdate
from time import mktime

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import Player, Texture, SiteSetting

logger = logging.getLogger("vustb.csl")

router = APIRouter(tags=["csl"])


# 辅助函数

_DEFAULT_SITE_URL = "http://localhost"


async def _get_site_url(db: AsyncSession, request: Request | None = None) -> str:
    """读取站点对外 URL：优先取站点设置 `public_url`，否则取 settings.site_url。

    当 request 可用时，在 SITE_URL 未配置（仍为默认 http://localhost）的情况下
    从请求头推断公开 URL。
    """
    # 1. 数据库站点设置
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
        if host:
            return f"{proto}://{host}"

    return _DEFAULT_SITE_URL


async def _get_csl_base_url(db: AsyncSession, request: Request | None = None) -> str:
    """CustomSkinAPI 根地址。

    规范要求根地址必须以 / 结尾。
    默认为 {site_url}/csl/，可通过站点设置 `csl_base_url` 覆盖。
    """
    row = (await db.execute(
        select(SiteSetting).where(SiteSetting.key == "csl_base_url")
    )).scalar_one_or_none()
    if row and row.value and str(row.value).startswith(("http://", "https://")):
        return str(row.value).rstrip("/") + "/"
    site_url = await _get_site_url(db, request)
    return site_url.rstrip("/") + "/csl/"


def _file_last_modified(path: Path) -> str:
    """返回文件最后修改时间的 HTTP 日期格式（RFC 2822）。"""
    mtime = os.path.getmtime(path)
    return formatdate(timeval=mktime(os.path.localtime(mtime)), localtime=False, usegmt=True)


# 玩家信息

@router.get("/{username}.json")
async def get_player_info(
    username: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """获取玩家信息（CustomSkinAPI R2 规范）。

    请求：GET /{USERNAME}.json
    - USERNAME 大小写不敏感

    响应 200：
    {
        "username": "{大小写正确的玩家名}",
        "textures": {
            "default": "{hash}",
            "slim": "{hash}",
            "cape": "{hash}",
            "elytra": "{hash}"
        }
    }

    响应 404：未找到玩家

    材质字典中的 hash 即为材质文件的资源唯一标识符，
    通过 /textures/{hash} 端点获取实际 PNG 文件。
    """
    # 大小写不敏感查找
    player = (await db.execute(
        select(Player).where(func.lower(Player.name) == username.lower())
    )).scalar_one_or_none()

    if not player:
        raise HTTPException(status_code=404, detail="Player not found")

    # 构建材质字典
    textures = {}

    # 查询皮肤
    if player.skin_texture_id:
        skin_tex = (await db.execute(
            select(Texture).where(Texture.id == player.skin_texture_id)
        )).scalar_one_or_none()
        if skin_tex:
            # CustomSkinAPI 用 "default" 和 "slim" 区分模型
            # 而非 Yggdrasil 的 SKIN + metadata.model
            model_key = "slim" if skin_tex.model == "slim" else "default"
            textures[model_key] = skin_tex.hash
            logger.debug(
                f"CSL player {player.name}: skin hash={skin_tex.hash}, model={model_key}"
            )

    # 查询披风
    if player.cape_texture_id:
        cape_tex = (await db.execute(
            select(Texture).where(Texture.id == player.cape_texture_id)
        )).scalar_one_or_none()
        if cape_tex:
            textures["cape"] = cape_tex.hash
            logger.debug(f"CSL player {player.name}: cape hash={cape_tex.hash}")

    # 构建响应 JSON
    result = {
        "username": player.name,
        "textures": textures,
    }

    return JSONResponse(
        content=result,
        media_type="application/json; charset=utf-8",
        headers={
            # CustomSkinAPI 规范：尽可能返回 Cache-Control / Last-Modified / Content-Length
            "Cache-Control": "public, max-age=60",
            "Access-Control-Allow-Origin": "*",
        },
    )


# 材质文件

@router.head("/textures/{hash}")
@router.get("/textures/{hash}")
async def get_texture(
    hash: str,
    request: Request,
):
    """获取材质文件（CustomSkinAPI R2 规范）。

    请求：GET /textures/{资源唯一标识符}
    - 资源唯一标识符为材质的 SHA-256 哈希（无扩展名）

    响应 200：返回 PNG 文件
    响应 404：资源未找到

    规范要求：
    - Content-Type: image/png
    - 尽可能响应 If-Modified-Since
    - 返回 Content-Length 与 Last-Modified
    - 支持 Cache-Control / Expires
    """
    # 安全校验：防止路径遍历
    if "/" in hash or ".." in hash or "\\" in hash:
        raise HTTPException(status_code=400, detail="Invalid hash")

    # CustomSkinAPI 的 hash 就是文件名（不带 .png 后缀）
    # 但实际文件在 textures_directory 中存储为 {hash}.png
    path = Path(settings.textures_directory) / f"{hash}.png"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Texture not found")

    # 处理 If-Modified-Since（HTTP 304 缓存）
    if request.method == "GET":
        ims = request.headers.get("if-modified-since")
        if ims:
            try:
                from email.utils import parsedate_to_datetime
                from datetime import timezone
                ims_dt = parsedate_to_datetime(ims)
                file_mtime = os.path.getmtime(path)
                # 文件修改时间（UTC）
                from datetime import datetime
                file_dt = datetime.fromtimestamp(file_mtime, tz=timezone.utc)
                # 比较时忽略亚秒精度（HTTP 日期只有秒精度）
                if file_dt.replace(microsecond=0) <= ims_dt:
                    return Response(status_code=304)
            except Exception:
                pass  # 解析失败则忽略，正常返回文件

    headers = {
        "Cache-Control": "public, max-age=604800",  # 7 天，材质哈希不变则内容不变
        "Last-Modified": _file_last_modified(path),
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD",
        "Access-Control-Max-Age": "86400",
    }

    return FileResponse(
        path,
        media_type="image/png",
        headers=headers,
    )


# ExtraList

@router.get("/ExtraList/vUSTB.json")
async def extralist_entry(request: Request, db: AsyncSession = Depends(get_db)):
    """CustomSkinLoader ExtraList 入口文件。

    用户只需在浏览器中打开此 URL 并下载 JSON 文件，
    放入 .minecraft/CustomSkinLoader/ExtraList/ 即可自动加载本站皮肤。

    文件格式：
    {
        "name": "像素北科",
        "type": "CustomSkinAPI",
        "root": "https://mc.ustb.edu.cn/csl/"
    }
    """
    csl_root = await _get_csl_base_url(db, request)
    site_name_row = (await db.execute(
        select(SiteSetting).where(SiteSetting.key == "site_name")
    )).scalar_one_or_none()
    site_name = site_name_row.value if site_name_row else settings.site_name

    return JSONResponse(
        content={
            "name": site_name,
            "type": "CustomSkinAPI",
            "root": csl_root,
        },
        media_type="application/json; charset=utf-8",
        headers={
            "Cache-Control": "public, max-age=3600",
            "Content-Disposition": 'attachment; filename="skycode.json"',
        },
    )
