from fastapi import FastAPI


def register_routers(app: FastAPI) -> None:
    from app.routers import (
        site_auth, users, yggdrasil, oauth_provider, static_files,
        mc_servers, files, textures, admin,
    )

    app.include_router(site_auth.router)
    app.include_router(users.router)
    app.include_router(yggdrasil.router)
    app.include_router(oauth_provider.router)
    app.include_router(static_files.router)
    app.include_router(mc_servers.router)
    app.include_router(files.router)
    app.include_router(textures.router)
    app.include_router(textures.players_router)
    app.include_router(admin.router)
