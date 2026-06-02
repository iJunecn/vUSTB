# 像素北科 vUSTB

> 北京科技大学元宇宙体素工作坊官网。Minecraft 服务器、皮肤站、3D 打印预约与社区活动的一站式平台。

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL%203.0-blue.svg)](LICENSE)

域名：`mc.ustb.edu.cn`（规划中）

## 架构

```
┌────────────────────────────────────────────┐
│           Caddy 网关（80/443）              │
├────────────────────────────────────────────┤
│  /           → Next.js (frontend)          │
│  /api/*      → FastAPI (backend) Web API   │
│  /skinapi/*  → FastAPI Yggdrasil + OAuth   │
│  /csl/*      → FastAPI CustomSkinAPI      │
│  /oauth/*    → FastAPI OAuth Provider      │
│  /.well-known→ FastAPI OpenID Discovery    │
│  /static/*   → FastAPI 材质静态文件         │
└────────────────────────────────────────────┘
            ↓                  ↓
       PostgreSQL            Redis
```

技术栈：
- **前端**: Next.js 14 (App Router) + React 18 + TypeScript + Tailwind CSS
- **后端**: FastAPI + SQLAlchemy 2.0 (async) + Alembic
- **数据库**: PostgreSQL 16
- **缓存/队列**: Redis 7 + Celery
- **网关**: Caddy 2
- **皮肤协议**: Yggdrasil（兼容 authlib-injector）+ CustomSkinAPI（兼容 CustomSkinLoader）+ OAuth 2.0 Authorization Code + Device Flow

## 目录

```
src/
├── frontend/            # Next.js 应用
│   ├── app/            # 页面路由
│   │   ├── skin/       # 皮肤站页面（首页/皮肤库/上传/配置）
│   │   ├── dashboard/  # 用户中心（面板/资料/角色/安全/衣柜）
│   │   ├── admin/      # 管理后台（用户/材质/角色/动态/打印/设置等）
│   │   ├── oauth/      # OAuth 授权页面
│   │   ├── login/      # 登录
│   │   ├── register/   # 注册
│   │   ├── dynamics/   # 动态发布系统
│   │   ├── print/      # 3D 打印预约
│   │   └── ...
│   ├── components/     # 组件
│   │   └── skin/       # 皮肤站组件（SkinViewer/CapeViewer/SkinAvatar）
│   ├── lib/            # API 客户端
│   ├── config/         # 环境配置
│   └── engine/         # 3D 校园 WASM 引擎
├── backend/             # FastAPI 应用
│   └── app/
│       ├── routers/    # API 路由
│       │   ├── yggdrasil.py    # Yggdrasil 协议
│       │   ├── csl.py          # CustomSkinAPI 协议
│       │   ├── remote_ygg.py   # 远程 Yggdrasil 导入
│       │   ├── site_routes.py  # 站点用户路由（登录/注册/材质/角色）
│       │   ├── admin.py        # 管理员 API
│       │   ├── microsoft.py    # 微软正版验证
│       │   ├── oauth_provider.py # OAuth Provider
│       │   ├── textures.py     # 材质管理
│       │   ├── article.py      # 动态发布
│       │   └── print_booking.py # 3D 打印预约
│       ├── services/  # 业务逻辑
│       ├── models/     # 数据模型
│       └── utils/      # 工具函数
├── caddy/Caddyfile      # 反代配置
└── legacy-wasm-engine/  # 待迁移的 Rust/WASM 3D 引擎
element-skin/             # 原 element-skin 项目（已合并到主站）
docker-compose.yml
.env.example
```

## 快速开始（生产）

```bash
cp .env.example .env
# 修改 .env 中的密钥与域名
# ⚠️ 生产环境必须设置 SITE_URL 为实际域名，例如：
#     SITE_URL=https://www.ustb.world
# 否则 Yggdrasil skinDomains、材质 URL、OpenID 发现等将无法正确解析

docker compose up -d --build
```

> **重要**：`SITE_URL` 影响以下关键功能：
> - **skinDomains 白名单**：authlib-injector 据此校验材质 URL 来源，未匹配的域名会被拦截
> - **材质 URL 生成**：Profile JSON 中的 textures URL 需指向公网可达地址
> - **OpenID 发现**：`/.well-known/openid-configuration` 中的端点 URL
> - **OAuth Device Flow**：`verification_uri` 等回调地址
>
> 若未配置 `SITE_URL`（仍为默认 `http://localhost`），后端会从 Caddy 传入的 `X-Forwarded-Proto` + `Host` 请求头自动推断公开 URL，但显式配置更可靠。也可在管理员后台"站点设置"中设置 `public_url` 覆盖。

访问：
- 站点首页：http://localhost
- API 健康检查：http://localhost/api/health
- Yggdrasil 元数据：http://localhost/skinapi/
- CustomSkinAPI 根地址：http://localhost/csl/

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

---

## 子模块

### 官网主体

- `/` — 首页
- `/servers` — MC 服务器列表
- `/about` — 关于我们
- `/campus` — 3D 校园

### 动态发布系统


| 路由 | 功能 |
|------|------|
| `/dynamics` | 动态列表 — 分类筛选、关键词搜索、置顶展示 |
| `/dynamics/[id]` | 文章详情 — Markdown 渲染、浏览量统计 |
| `/admin/dynamics` | 动态管理 — 文章列表、置顶/删除、分类 CRUD |
| `/admin/dynamics/new` | 创建文章 — Markdown 编辑器、实时预览、图片上传、SEO 设置 |
| `/admin/dynamics/[id]` | 编辑文章 — 同创建页，支持修改已有文章 |
| `/admin/media` | 图片管理 — 上传/浏览/删除媒体文件、复制链接和 Markdown 引用 |

**核心功能：**

- **文章发布**：Markdown 编辑器，支持实时预览、图片上传（插入到光标位置）、GFM 语法（表格、任务列表、删除线等）
- **分类管理**：创建/删除分类，文章按分类筛选
- **置顶功能**：最多 2 篇文章可置顶，按排序展示
- **图片管理**：管理面板可上传/浏览/删除图片，一键复制链接或 Markdown 引用
- **SEO 优化**：每篇文章可设置 SEO 标题、描述、关键词和 URL slug
- **封面图**：支持设置封面图 URL 和替代文本
- **权限控制**：仅超级管理员和管理员可编辑和发表动态
- **浏览统计**：自动记录文章浏览量

**后端 API：**

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/articles` | GET | 文章列表（公开，不含正文） |
| `/api/articles/search` | GET | 搜索文章（公开） |
| `/api/articles/categories` | GET | 分类列表（公开） |
| `/api/articles/count` | GET | 文章总数（公开） |
| `/api/articles/{id}` | GET | 文章详情（公开，含正文，自增浏览量） |
| `/api/admin/articles` | GET | 文章列表（管理员，含定时发布） |
| `/api/admin/articles` | POST | 创建文章（管理员） |
| `/api/admin/articles/{id}` | GET | 获取文章（管理员） |
| `/api/admin/articles/{id}` | PUT | 更新文章（管理员） |
| `/api/admin/articles/{id}` | DELETE | 删除文章（管理员） |
| `/api/admin/article-categories` | GET | 分类列表（管理员） |
| `/api/admin/article-categories` | POST | 创建分类（管理员） |
| `/api/admin/article-categories/{id}` | PUT | 更新分类（管理员） |
| `/api/admin/article-categories/{id}` | DELETE | 删除分类（管理员） |
| `/api/admin/article-media/upload` | POST | 上传媒体文件（管理员） |
| `/api/admin/article-media` | GET | 媒体文件列表（管理员） |
| `/api/admin/article-media/{id}` | DELETE | 删除媒体文件（管理员） |

### 皮肤站

像素北科皮肤站，完整实现 Yggdrasil 与 CustomSkinAPI 两套皮肤协议，支持第三方启动器登录、材质上传/管理、衣柜、公共皮肤库等功能。由 element-skin 项目演化而来，已合并到主站。

**前台页面：**

| 路由 | 功能 |
|------|------|
| `/skin` | 皮肤站首页 — 功能入口（皮肤库、上传、配置引导） |
| `/skin/library` | 皮肤库 — 公开材质浏览、分类筛选、一键收藏到衣柜、3D 预览 |
| `/skin/upload` | 上传材质 — 选择文件 → 3D 预览 → 编辑信息 → 保存到衣柜 |
| `/skin/settings` | 启动器配置 — API 地址复制、拖拽接入、JVM 参数、HMCL/PCL/服务端接入说明 |

**用户中心（皮肤相关）：**

| 路由 | 功能 |
|------|------|
| `/dashboard` | 用户面板 — 材质/角色统计、快速配置启动器、Mojang 服务状态 |
| `/dashboard/wardrobe` | 皮肤衣柜 — 管理上传和收藏的材质、3D 预览、编辑名称/模型/公开状态、应用到角色、设为头像 |
| `/dashboard/roles` | 游戏角色 — 创建角色、绑定材质、微软正版角色导入、远程 Yggdrasil 角色导入 |
| `/dashboard/profile` | 个人资料 — 头像设置（从皮肤截取）、账号信息、修改密码、注销 |
| `/dashboard/security` | 账号安全 — 修改用户名/邮箱/手机号、修改密码 |

**管理员后台（皮肤站相关）：**

| 路由 | 功能 |
|------|------|
| `/admin` | 管理首页 — 统计概览（用户数、邀请码、OAuth 应用） |
| `/admin/textures` | 材质管理 — 全站材质列表、搜索/类型筛选、3D 预览、编辑名称/模型/公开状态、强制下架 |
| `/admin/profiles` | 角色管理 — 全站角色列表、搜索、3D 预览、编辑名称、清除皮肤/披风绑定、删除角色 |
| `/admin/users` | 用户管理 — 列表、切换管理组、封禁/解封、重置密码、删除 |
| `/admin/invites` | 邀请码管理 — 生成、删除 |
| `/admin/settings` | 站点设置 — 分组配置（站点/安全/邮件/微软/Fallback） |
| `/admin/oauth-apps` | OAuth 应用管理 |
| `/admin/mojang` | Mojang 回退配置 |
| `/admin/email` | 邮件设置 |

**皮肤协议支持：**

本项目同时实现两套 Minecraft 皮肤加载协议，覆盖主流启动器与游戏内 Mod：

| 协议 | 适用场景 | 接入方式 |
|------|---------|---------|
| **Yggdrasil**（authlib-injector） | HMCL / PCL2 / BakaXL 等第三方启动器 | 配置 API 根地址 |
| **CustomSkinAPI** R2 | CustomSkinLoader Mod（游戏内直接加载皮肤） | ExtraList 或手动添加加载源 |

### 用户中心

- `/dashboard` — 用户面板（材质/角色统计、快速配置启动器、Mojang 服务状态）
- `/dashboard/profile` — 个人资料（头像设置、账号信息、修改密码、注销账号）
- `/dashboard/roles` — 角色管理（创建角色、绑定材质、微软正版导入、远程皮肤站导入）
- `/dashboard/security` — 安全设置（修改用户名/邮箱/手机号、修改密码）
- `/dashboard/wardrobe` — 皮肤衣柜（材质管理、3D 预览、应用到角色、设为头像）

### 管理员后台

- `/admin` — 管理首页（用户/邀请码/OAuth 应用统计）
- `/admin/textures` — 材质管理（全站材质搜索/筛选/编辑/3D 预览/强制下架）
- `/admin/profiles` — 角色管理（全站角色搜索/编辑/3D 预览/删除）
- `/admin/users` — 用户管理（列表、切换管理组、封禁/解封、重置密码、删除）
- `/admin/invites` — 邀请码管理（生成、删除）
- `/admin/oauth-apps` — OAuth 应用管理
- `/admin/email` — 邮件设置
- `/admin/mojang` — Mojang 回退配置
- `/admin/servers` — 服务器管理
- `/admin/settings` — 站点设置（站点/安全/邮件/微软/Fallback 分组配置）
- `/admin/print` — 打印预约管理

### OAuth Provider

- `/oauth/authorize` — 授权页面
- `/oauth/device` — 设备流页面

### 3D 打印预约系统


| 路由 | 功能 |
|------|------|
| `/print` | 打印预约首页 — 打印机状态展示、设备公告与使用须知、功能入口 |
| `/print/booking` | 创建预约 — 选择打印机/日期/时段、填写文件名与用途、耗材与计费选择、微信支付二维码 |
| `/print/dashboard` | 预约面板 — 本周时间表网格、我的预约记录、预约详情/编辑弹窗、签到/取消操作 |
| `/admin/print` | 打印管理后台 — 概览统计、打印机 CRUD、审批队列、全部预约管理、用户管理、周报导出 |

**核心功能：**

- **打印机状态**：实时展示打印机状态（空闲/已预约/运行中/暂停），首页首次访问弹出使用须知公告
- **在线预约**：选择日期与上午/下午时段，填写文件名与用途，选择自带耗材或社团耗材（单色 ¥0.10/g、多色 ¥0.15/g），自动计算费用
- **预约审批**：管理员审批流程（pending → booked / rejected），支持填写拒绝原因
- **签到运行**：用户到时间后签到开始打印，管理员可强制签到或标记完成
- **预约编辑**：用户可在弹窗中编辑耗材类型、打印类型、重量、支付状态等
- **微信支付**：社团耗材预约时展示支付二维码，用户手动标记支付状态
- **周报管理**：按日期范围导出 Excel 报表（.xlsx），自动生成本周周报记录，查看历史周报
- **用户管理**：管理员查看用户列表、调整用户角色（用户/管理员）
- **打印机管理**：管理员添加/暂停/删除打印机，设置位置与型号信息

**后端 API（`/api/print/*`）：**

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/print/printers` | GET | 打印机列表（公开） |
| `/api/print/printers/{id}/status` | GET | 打印机实时状态（公开） |
| `/api/print/printers` | POST | 创建打印机（管理员） |
| `/api/print/printers/{id}` | PUT | 更新打印机信息（管理员） |
| `/api/print/printers/{id}` | DELETE | 删除打印机（管理员） |
| `/api/print/bookings` | GET | 预约列表（支持 mine、日期过滤） |
| `/api/print/bookings` | POST | 创建预约 |
| `/api/print/bookings/{id}` | GET | 预约详情 |
| `/api/print/bookings/{id}` | PUT | 更新预约 |
| `/api/print/bookings/{id}/cancel` | POST | 取消预约 |
| `/api/print/bookings/{id}/checkin` | POST | 签到 |
| `/api/print/bookings/{id}/complete` | POST | 标记完成（管理员） |
| `/api/print/schedule` | GET | 周时间表（公开） |
| `/api/print/admin/approvals` | GET | 待审批列表（管理员） |
| `/api/print/admin/approve/{id}` | POST | 批准预约（管理员） |
| `/api/print/admin/reject/{id}` | POST | 拒绝预约（管理员） |
| `/api/print/admin/bookings/{id}` | DELETE | 删除预约（管理员） |
| `/api/print/admin/stats` | GET | 统计概览（管理员） |
| `/api/print/admin/reports` | GET | 周报记录列表（管理员） |
| `/api/print/admin/reports/generate` | POST | 生成本周周报（管理员） |
| `/api/print/admin/reports/{id}` | DELETE | 删除周报记录（管理员） |
| `/api/print/admin/reports/export` | GET | 导出 Excel 报表（管理员） |

---

## 皮肤加载协议

### Yggdrasil（authlib-injector）

MC 客户端使用 authlib-injector 时，将 API 根地址配置为：

```
https://mc.ustb.edu.cn/skinapi/
```

> Caddy 会自动将 `/skinapi/*` 重写到内部 `/api/yggdrasil/*`，两个路径均可用，但推荐对外使用 `/skinapi/`。

启动器（如 HMCL、PCL2、BakaXL）走 Device Flow 时，OpenID 配置端点：

```
https://mc.ustb.edu.cn/skinapi/.well-known/openid-configuration
```

**实现的端点（`/api/yggdrasil/*`）：**

| 端点 | 方法 | 说明 |
|------|------|------|
| `/` | GET | Yggdrasil 元数据（signaturePublickey、skinDomains） |
| `/authserver/authenticate` | POST | 登录认证 |
| `/authserver/refresh` | POST | 刷新令牌 |
| `/authserver/validate` | POST | 验证令牌 |
| `/authserver/invalidate` | POST | 使令牌失效 |
| `/authserver/signout` | POST | 登出 |
| `/sessionserver/session/minecraft/join` | POST | 加入服务器 |
| `/sessionserver/session/minecraft/hasJoined` | GET | 服务端验证客户端 |
| `/sessionserver/session/minecraft/profile/{uuid}` | GET | 查询角色属性（含材质签名） |
| `/minecraftservices/publickeys` | POST | 公钥批量查询（MC 1.20+） |
| `/minecraftservices/publickeys/{uuid}` | GET | 单键查询（MC 1.20+） |
| `/api/users/profiles/minecraft/{name}` | GET | 玩家名 → UUID |
| `/api/profiles/minecraft` | POST | 批量玩家名查询 |
| `/api/user/profile/{uuid}/{type}` | PUT | 上传材质 |
| `/api/user/profile/{uuid}/{type}` | DELETE | 删除材质绑定 |

**规范合规性：**

- ✅ Content-Type: `application/json; charset=utf-8`（规范要求）
- ✅ RSA SHA1withRSA 材质签名 + `signatureRequired`（MC 1.20+）
- ✅ `skinDomains` 白名单 + Fallback 服务（自动包含请求 Host + `SITE_URL` + 管理员 `public_url`）
- ✅ `X-Authlib-Injector-API-Location` ALI 自动发现头（中间件自动注入所有 Yggdrasil 响应）
- ✅ `unsigned` 查询参数（签名/无签名切换）
- ✅ 材质 URL 格式：`{base_url}/static/textures/{hash}.png`
- ✅ 材质 Content-Type: `image/png`（防 MIME Sniffing）
- ✅ 材质 Cache-Control: `public, max-age=604800`（7 天缓存）
- ✅ 公开 URL 动态推断：`SITE_URL` 未配置时从 `X-Forwarded-Proto` + `Host` 自动推断

### CustomSkinAPI（CustomSkinLoader）

使用 CustomSkinLoader Mod 的玩家，将本站添加为加载源即可在游戏内加载皮肤。

**CustomSkinAPI 根地址：**

```
https://mc.ustb.edu.cn/csl/
```

> Caddy 会自动将 `/csl/*` 重写到内部 `/api/csl/*`。

**实现的端点（`/api/csl/*`）：**

| 端点 | 方法 | 说明 |
|------|------|------|
| `/{username}.json` | GET | 获取玩家信息（大小写不敏感） |
| `/textures/{hash}` | GET | 获取材质 PNG 文件 |
| `/textures/{hash}` | HEAD | 材质文件 HEAD 请求 |
| `/ExtraList/vUSTB.json` | GET | ExtraList 入口文件（方便用户下载添加） |

**玩家信息 JSON 格式（CustomSkinAPI R2）：**

```json
{
    "username": "TestPlayer",
    "textures": {
        "default": "552a4e8cfa803698ee4dff3fbd6b9499...",
        "slim": "b2c4ef891f01c5a8e2dc8a832bc3a89c...",
        "cape": "aed8c3fc67aae4906b72fa74c27e1586..."
    }
}
```

**用户接入方式（二选一）：**

1. **自动（推荐）**：浏览器下载 `https://mc.ustb.edu.cn/csl/ExtraList/vUSTB.json`，放入 `.minecraft/CustomSkinLoader/ExtraList/` 目录
2. **手动**：编辑 `CustomSkinLoader.json`，在 `loadlist` 中添加：
   ```json
   {
       "name": "像素北科 vUSTB",
       "type": "CustomSkinAPI",
       "root": "https://mc.ustb.edu.cn/csl/"
   }
   ```

**CustomSkinAPI 特性：**

- ✅ 按**玩家名**查询（非 UUID），大小写不敏感
- ✅ 支持 `If-Modified-Since` / `304 Not Modified` 缓存协商
- ✅ 返回 `Last-Modified`、`Content-Length`、`Cache-Control` 头
- ✅ 材质文件缓存 7 天，玩家信息缓存 60 秒
- ✅ CORS 头支持浏览器跨域访问
- ✅ 同时支持 `default` / `slim` 皮肤模型和 `cape` 披风

### OAuth 2.0 Provider

本项目实现完整的 OAuth 2.0 Provider，支持第三方应用接入：

| 端点 | 方法 | 说明 |
|------|------|------|
| `/.well-known/openid-configuration` | GET | OpenID Connect 发现 |
| `/oauth/jwks` | GET | JSON Web Key Set |
| `/oauth/authorize` | GET | 授权页面（Authorization Code） |
| `/oauth/api/approve` | POST | 用户批准授权 |
| `/oauth/token` | POST | 令牌端点（code / device_code → access_token） |
| `/oauth/userinfo` | GET | 用户信息 |
| `/oauth/device/code` | POST | 设备授权码 |
| `/oauth/device/approve` | POST | 设备流用户批准 |
| `/oauth/profile` | GET | 角色信息 |
| `/oauth/avatar` | GET | 角色头像 |
| `/oauth/skin` | GET | 角色皮肤 |

### 微软正版验证

支持通过微软 OAuth 绑定正版 Minecraft 账号，导入正版皮肤和披风：

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/microsoft/auth-url` | GET | 获取微软 OAuth 授权链接 |
| `/api/microsoft/callback` | GET | 微软 OAuth 回调，获取 MC 角色并导入 |
| `/api/microsoft/get-profile` | POST | 使用临时 token 获取 profile 数据 |
| `/api/microsoft/import-profile` | POST | 导入正版角色（含皮肤/披风下载保存） |

### 远程 Yggdrasil 导入

支持从其他 Yggdrasil 皮肤站导入角色和材质：

- 在"游戏角色"页面点击"从其他皮肤站导入"
- 输入远程皮肤站 API 地址、用户名和密码
- 选择要导入的角色，系统自动下载皮肤和披风并创建角色

### 材质管理 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/textures` | GET | 材质列表 |
| `/api/textures/upload` | POST | 上传材质（同时应用到角色） |
| `/api/textures/{id}` | DELETE | 删除材质 |
| `/api/textures/wardrobe` | GET | 衣柜列表 |
| `/api/textures/wardrobe` | POST | 添加到衣柜 |
| `/api/textures/wardrobe/{id}` | DELETE | 从衣柜移除 |
| `/api/textures/library` | GET | 公共皮肤库 |
| `/api/me/textures` | GET | 我的衣柜材质列表 |
| `/api/me/textures` | POST | 上传材质到衣柜 |
| `/api/me/textures/{hash}/{type}` | GET | 材质详情 |
| `/api/me/textures/{hash}/{type}` | PATCH | 修改材质信息（名称/模型/公开） |
| `/api/me/textures/{hash}/{type}` | DELETE | 从衣柜删除材质 |
| `/api/me/textures/{hash}/add` | POST | 添加材质到衣柜（收藏） |
| `/api/me/textures/{hash}/apply` | POST | 将材质应用到角色 |
| `/api/users/{id}/avatar` | GET | 用户头像 |

### 角色/玩家管理 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/players` | GET | 我的角色列表 |
| `/api/players` | POST | 创建角色 |
| `/api/players/{id}` | DELETE | 删除角色 |
| `/api/players/{id}/bind` | POST | 绑定/解绑材质到角色 |
| `/api/me/profiles` | POST | 创建角色（vSkin 兼容） |
| `/api/me/profiles/{pid}` | DELETE | 删除角色 |
| `/api/me/profiles/{pid}/skin` | DELETE | 清除角色皮肤 |
| `/api/me/profiles/{pid}/cape` | DELETE | 清除角色披风 |

### 远程 Yggdrasil 导入 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/remote-ygg/get-profiles` | POST | 从远程皮肤站获取角色列表 |
| `/api/remote-ygg/import-profile` | POST | 导入单个远程角色（含皮肤/披风） |
| `/api/remote-ygg/import-profiles` | POST | 批量导入远程角色 |

### 管理员 API（皮肤站相关）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/admin/textures` | GET | 材质列表（支持搜索/分页/类型筛选） |
| `/api/admin/textures/{hash}` | PATCH | 修改材质信息 |
| `/api/admin/textures/{hash}` | DELETE | 删除材质（同时清理衣柜和角色绑定） |
| `/api/admin/profiles` | GET | 角色列表（支持搜索/分页） |
| `/api/admin/profiles/{id}` | PATCH | 修改角色信息 |
| `/api/admin/profiles/{id}` | DELETE | 删除角色 |
| `/api/admin/profiles/{id}/skin` | PATCH | 设置角色皮肤 |
| `/api/admin/profiles/{id}/cape` | PATCH | 设置角色披风 |
| `/api/admin/official-whitelist` | GET | 白名单列表 |
| `/api/admin/official-whitelist` | POST | 添加白名单 |
| `/api/admin/official-whitelist/{username}` | DELETE | 移除白名单 |
| `/api/admin/carousel` | POST | 上传轮播图 |
| `/api/admin/carousel/{filename}` | DELETE | 删除轮播图 |
| `/api/admin/settings/{group}` | GET | 获取设置组 |
| `/api/admin/settings/{group}` | POST | 保存设置组 |

---

## License

[GPL-3.0](LICENSE)

参考与致谢：
- [USTB-Official-Website](https://github.com/USTB-SkyCode/USTB-Official-Website) 与 [USTB-Official-Backend](https://github.com/USTB-SkyCode/USTB-Official-Backend) 原官网代码与设计灵感
- [vSkin](https://github.com/iJunecn/vSkin) — 皮肤站协议实现
- [vLab-main](https://github.com/iJunecn/vLab) — 3D 打印预约系统原始实现（Express + SQLite）
- [kuno-main](https://github.com/xuemian168/kuno) — 动态发布系统原始实现（Go + Next.js）
- [Blessing Skin Server](https://github.com/bs-community/blessing-skin-server)
- [mc.sjtu.cn](https://mc.sjtu.cn/) — UI 设计灵感
- [CustomSkinLoaderAPI](https://github.com/xfl03/CustomSkinLoaderAPI) — CustomSkinAPI 规范
- [authlib-injector](https://github.com/yushijinhun/authlib-injector) — Yggdrasil 协议规范
