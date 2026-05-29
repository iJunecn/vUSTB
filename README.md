# 像素北科 vUSTB

> 北京科技大学元宇宙体素工作坊官网。Minecraft 服务器、皮肤站、3D 校园游览与社区活动的一站式平台。

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL%203.0-blue.svg)](LICENSE)

域名：`mc.ustb.edu.cn`（规划中）

## 架构

```
┌────────────────────────────────────────────┐
│        Caddy 网关（80/443）                  │
├────────────────────────────────────────────┤
│  /         → Next.js (frontend)            │
│  /api/*    → FastAPI (backend) Web API     │
│  /skinapi/*→ FastAPI Yggdrasil + OAuth     │
│  /oauth/*  → FastAPI OAuth Provider        │
│  /static/* → FastAPI 材质静态文件          │
└────────────────────────────────────────────┘
            ↓                  ↓
       PostgreSQL          Redis
```

技术栈：
- **前端**: Next.js 14 (App Router) + React 18 + TypeScript + Tailwind CSS
- **后端**: FastAPI + SQLAlchemy 2.0 (async) + Alembic
- **数据库**: PostgreSQL 16
- **缓存/队列**: Redis 7 + Celery
- **网关**: Caddy 2
- **皮肤协议**: Yggdrasil（兼容 authlib-injector） + OAuth 2.0 Authorization Code + Device Flow

## 目录

```
src/
├── frontend/            # Next.js 应用
├── backend/             # FastAPI 应用
├── caddy/Caddyfile      # 反代配置
└── legacy-wasm-engine/  # 待迁移的 Rust/WASM 3D 引擎
docker-compose.yml
.env.example
```

## 快速开始（生产）

```bash
cp .env.example .env
# 修改 .env 中的密钥与域名

docker compose up -d --build
```

访问：
- 站点首页：http://localhost
- API 健康检查：http://localhost/api/health
- Yggdrasil 元数据：http://localhost/skinapi/

## 本地开发

后端：

```bash
cd src/backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
# 启动 postgres 与 redis（建议用 docker compose up postgres redis -d）
uvicorn app.main:app --reload --port 8000
```

前端：

```bash
cd src/frontend
npm install
BACKEND_INTERNAL_URL=http://localhost:8000 npm run dev
# 浏览器访问 http://localhost:3000
```

## 子模块

- **官网主体** `/`、`/servers`、`/about`、`/activities`、`/campus`
- **皮肤站** `/skin`、`/skin/library`、`/skin/settings`、`/skin/upload`
- **用户中心** `/dashboard/*`
- **管理员后台** `/admin/*`
- **OAuth Provider** `/oauth/authorize`、`/oauth/device`

## Yggdrasil 接入

MC 客户端使用 authlib-injector 时，将 URL 配置为：

```
https://mc.ustb.edu.cn/skinapi/
```

启动器（如 USTBL）走 Device Flow 时，OpenID 配置端点：

```
https://mc.ustb.edu.cn/skinapi/.well-known/openid-configuration
```

## License

[GPL-3.0](LICENSE)

参考与致谢：

- [vSkin](https://github.com/LYOfficial/vSkin) — 皮肤站协议实现
- [Blessing Skin Server](https://github.com/bs-community/blessing-skin-server)
- [mc.sjtu.cn](https://mc.sjtu.cn/) — UI 设计灵感
