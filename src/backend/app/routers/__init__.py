import os
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.config import settings


def register_routers(app: FastAPI) -> None:
    from app.routers import (
        site_auth, users, yggdrasil, oauth_provider, static_files,
        mc_servers, files, textures, admin,
        public, camera_presets, oauth_login,
        site_routes, microsoft, print_booking, article,
        csl,
    )

    app.include_router(site_auth.router)
    app.include_router(users.router)
    app.include_router(yggdrasil.router, prefix="/api/yggdrasil")
    app.include_router(csl.router, prefix="/api/csl")
    app.include_router(oauth_provider.router)
    app.include_router(static_files.router)
    app.include_router(mc_servers.router)
    app.include_router(files.router)
    app.include_router(textures.router)
    app.include_router(textures.players_router)
    app.include_router(admin.router)
    app.include_router(public.router)
    app.include_router(camera_presets.router)
    app.include_router(oauth_login.router)
    app.include_router(site_routes.router)
    app.include_router(microsoft.router)
    app.include_router(print_booking.router)

    # 动态 / 文章发布系统
    app.include_router(article.public_router)
    app.include_router(article.admin_router)
    app.include_router(article.cat_admin_router)
    app.include_router(article.media_router)

    # 文章媒体静态文件
    article_media_dir = os.path.join(settings.carousel_directory, "..", "article_media")
    article_media_dir = os.path.normpath(article_media_dir)
    os.makedirs(article_media_dir, exist_ok=True)
    if os.path.exists(article_media_dir):
        app.mount("/static/article_media", StaticFiles(directory=article_media_dir), name="article_media")
