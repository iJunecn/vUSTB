from fastapi import FastAPI


def register_routers(app: FastAPI) -> None:
    from app.routers import (
        site_auth, users, yggdrasil, oauth_provider, static_files,
        mc_servers, files, textures, admin,
        public, camera_presets, oauth_login,
        site_routes, microsoft,
    )

    app.include_router(site_auth.router)
    app.include_router(users.router)
    app.include_router(yggdrasil.router, prefix="/api/yggdrasil")
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
