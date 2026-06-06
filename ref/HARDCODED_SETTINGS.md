# 硬编码设置文档

本文档记录了 vUSTB 项目中所有硬编码的站点设置及其代码位置，便于后续维护。

> 硬编码设置无法通过管理面板（`/admin/settings`）修改，确保关键配置不被随意更改。
> 敏感字段（密码、密钥等）以 Base64 编码存储，与 GitHub OAuth、爱发电凭据同模式。

---

## 1. 安全设置

| 设置项 | 硬编码值 | 代码位置 |
|--------|---------|---------|
| 注册需要邮箱验证 | `true` | `src/backend/app/config.py` → `_REQUIRE_EMAIL_VERIFY` |
| 允许密码重置 | `true` | `src/backend/app/config.py` → `_ALLOW_PASSWORD_RESET` |
| 注册邮箱后缀 | `xs.ustb.edu.cn, ustb.edu.cn, ustb.world, qq.com` | `src/backend/app/config.py` → `_REGISTER_EMAIL_SUFFIXES` |

**生效逻辑**：`src/backend/app/services/site_backend.py` 中 `_get_setting()` 方法优先返回硬编码值；`src/backend/app/routers/site_auth.py` 中 `register()` 和 `send_verification_code()` 端点直接读取 `settings` 对象。

**前端**：`src/frontend/app/admin/settings/page.tsx` — 安全设置标签页展示为只读，标注"硬编码"。

---

## 2. 认证过期

| 设置项 | 硬编码值 | 代码位置 |
|--------|---------|---------|
| JWT 过期时间 | 72 小时（259200 秒） | `src/backend/app/config.py` → `_AUTH_EXPIRE_HOURS = 72` |
| Refresh Token 过期时间 | 72 小时 | 同上 |

**生效逻辑**：`src/backend/app/services/site_backend.py` → `login()` 方法中 `expire_minutes = settings.auth_expire_hours * 60`；`src/backend/app/routers/site_auth.py` → `register()` 和 `login()` 端点中使用 `settings.auth_expire_hours * 60`。

---

## 3. 邮件服务（SMTP）

| 设置项 | 硬编码值 | 代码位置 |
|--------|---------|---------|
| SMTP 主机 | `mx.jianyuelab.net` | `src/backend/app/config.py` → `_SMTP_HOST` |
| SMTP 端口 | `465` | `src/backend/app/config.py` → `_SMTP_PORT` |
| SMTP 用户名 | `noreply` | `src/backend/app/config.py` → `_SMTP_USER` |
| SMTP 密码 | *(Base64 编码)* | `src/backend/app/config.py` → `_SMTP_PWD_B64` |
| 发件人名称 | `像素北科` | `src/backend/app/config.py` → `_SMTP_FROM` |
| 使用 SSL | `true` | `src/backend/app/config.py` → `_SMTP_SSL` |
| 启用邮箱验证 | `true` | `src/backend/app/config.py` → `_EMAIL_VERIFY_ENABLED` |

**生效逻辑**：`src/backend/app/utils/email_utils.py` → `EmailSender._get_settings()` 直接从 `app.config.settings` 读取，不再从数据库 `SiteSetting` 表读取。

**邮件模板**：`src/backend/app/utils/email_utils.py` → `_default_template()` — 蓝白现代风格，顶部含"像素北科"品牌标识。

---

## 4. GitHub OAuth（原有硬编码）

| 设置项 | 代码位置 |
|--------|---------|
| Client ID | `src/backend/app/config.py` → `_GH_CID_B64` |
| Client Secret | `src/backend/app/config.py` → `_GH_CS_B64` |
| Redirect URI | `src/backend/app/config.py` → `_GH_RURI` |

---

## 5. 爱发电（原有硬编码）

| 设置项 | 代码位置 |
|--------|---------|
| User ID | `src/backend/app/config.py` → `_AF_UID_B64` |
| Token | `src/backend/app/config.py` → `_AF_TOK_B64` |

---

## 6. 基本设置（非硬编码）

以下设置仍可通过管理面板修改：

| 设置项 | 代码位置 |
|--------|---------|
| 对外访问地址 (`public_url`) | 数据库 `site_settings` 表 |
| 材质 URL 基地址 (`texture_base_url`) | 数据库 `site_settings` 表 |
| 启用皮肤库 (`enable_skin_library`) | 数据库 `site_settings` 表 |

---

## 如何修改硬编码值

1. 编辑 `src/backend/app/config.py`，修改对应的常量（敏感值使用 Base64 编码）
2. 修改后需重启后端服务使配置生效
3. 同步更新前端显示值：`src/frontend/app/admin/settings/page.tsx` 中对应的 `HARDCODED_*` 常量
