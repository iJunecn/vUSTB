from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings

import os


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 确保 texture/carousel 目录存在
    os.makedirs(settings.textures_directory, exist_ok=True)
    os.makedirs(settings.carousel_directory, exist_ok=True)
    yield


app = FastAPI(
    title="vUSTB API",
    description="像素北科 / 北京科技大学元宇宙体素工作坊 统一后端 API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins,
    allow_credentials=settings.cors_allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "vustb-backend", "version": "0.1.0"}


# ====== 挂载静态文件 ======
# textures 目录
if os.path.exists(settings.textures_directory):
    app.mount("/static/textures", StaticFiles(directory=settings.textures_directory), name="textures")

# carousel 目录
if os.path.exists(settings.carousel_directory):
    app.mount("/static/carousel", StaticFiles(directory=settings.carousel_directory), name="carousel")


# ====== 注册路由 ======
from app.routers import register_routers  # noqa: E402

register_routers(app)
