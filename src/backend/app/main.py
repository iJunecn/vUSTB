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
    os.makedirs(settings.textures_directory, exist_ok=True)
    os.makedirs(settings.carousel_directory, exist_ok=True)
    yield


app = FastAPI(
    title="像素北科 API",
    description="像素北科 / 北京科技大学元宇宙体素工作坊 统一后端 API",
    version="0.1.0",
    lifespan=lifespan,
)

_DEFAULT_SITE_URL = "http://localhost"


# Yggdrasil ALI 中间件
@app.middleware("http")
async def yggdrasil_ali_middleware(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/yggdrasil"):
        configured = (settings.site_url or "").rstrip("/")
        if configured and configured != _DEFAULT_SITE_URL:
            base = configured
        else:
            proto = (request.headers.get("x-forwarded-proto") or
                     request.headers.get("x-forwarded-scheme") or
                     request.url.scheme)
            host = (request.headers.get("x-forwarded-host") or
                    request.headers.get("host"))
            base = f"{proto}://{host}" if host else _DEFAULT_SITE_URL
        response.headers["X-Authlib-Injector-API-Location"] = base.rstrip("/") + "/skinapi/"
    return response

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins,
    allow_credentials=settings.cors_allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Yggdrasil 错误格式：顶层 {error, errorMessage}，不走 FastAPI 默认信封
from app.routers.yggdrasil import YggdrasilError  # noqa: E402


def _is_yggdrasil_path(request: Request) -> bool:
    p = request.url.path
    return p.startswith("/api/yggdrasil") or p.startswith("/skinapi")


@app.exception_handler(YggdrasilError)
async def _yggdrasil_exception_handler(_request: Request, exc: YggdrasilError):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.error, "errorMessage": exc.errorMessage},
        media_type="application/json; charset=utf-8",
    )


@app.exception_handler(RequestValidationError)
async def _validation_exception_handler(request: Request, exc: RequestValidationError):
    if _is_yggdrasil_path(request):
        return JSONResponse(
            status_code=400,
            content={"error": "IllegalArgumentException", "errorMessage": "Invalid request payload."},
            media_type="application/json; charset=utf-8",
        )
    return JSONResponse(status_code=422, content={"detail": exc.errors()})


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "vustb-backend", "version": "0.1.0"}


# 静态文件挂载（textures 由 static_files 路由提供，carousel 用 StaticFiles）
if os.path.exists(settings.carousel_directory):
    app.mount("/static/carousel", StaticFiles(directory=settings.carousel_directory), name="carousel")


from app.routers import register_routers  # noqa: E402

register_routers(app)
