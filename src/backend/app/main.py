from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
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


# ====== Yggdrasil 规范错误统一处理 ======
# 规范要求：错误响应的 {error, errorMessage} 必须位于顶层 JSON 对象，不能被
# FastAPI 默认的 {"detail": ...} 信封包裹。
from app.routers.yggdrasil import YggdrasilError  # noqa: E402


def _is_yggdrasil_path(request: Request) -> bool:
    p = request.url.path
    return p.startswith("/api/yggdrasil") or p.startswith("/skinapi")


@app.exception_handler(YggdrasilError)
async def _yggdrasil_exception_handler(_request: Request, exc: YggdrasilError):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.error, "errorMessage": exc.errorMessage},
    )


@app.exception_handler(RequestValidationError)
async def _validation_exception_handler(request: Request, exc: RequestValidationError):
    if _is_yggdrasil_path(request):
        return JSONResponse(
            status_code=400,
            content={
                "error": "IllegalArgumentException",
                "errorMessage": "Invalid request payload.",
            },
        )
    # 非 Yggdrasil 路径走 FastAPI 默认格式
    return JSONResponse(status_code=422, content={"detail": exc.errors()})


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "vustb-backend", "version": "0.1.0"}


# ====== 挂载静态文件 ======
# 注：textures 目录由 app.routers.static_files 提供路由（支持 Cache-Control 等头），
# 不再使用 StaticFiles 挂载，否则路由优先级问题会导致自定义头丢失。
# carousel 目录仍使用 StaticFiles 挂载。
if os.path.exists(settings.carousel_directory):
    app.mount("/static/carousel", StaticFiles(directory=settings.carousel_directory), name="carousel")


# ====== 注册路由 ======
from app.routers import register_routers  # noqa: E402

register_routers(app)
