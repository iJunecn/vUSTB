from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
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


@app.get("/skinapi/")
async def yggdrasil_meta_placeholder():
    return JSONResponse(
        {
            "meta": {
                "serverName": settings.site_name,
                "implementationName": "vUSTB",
                "implementationVersion": "0.1.0",
            },
            "skinDomains": [],
            "signaturePublickey": "",
        }
    )


from app.routers import register_routers  # noqa: E402

register_routers(app)
