# 域名引用索引

> 当前站点域名：`https://www.ustb.world`
> 规划域名：`mc.ustb.edu.cn`

修改域名时，需要同步更新以下文件中的硬编码域名引用。

---

## 必须修改（影响功能）

| 文件 | 行号 | 当前值 | 说明 |
|------|------|--------|------|
| `src/frontend/app/servers/page.tsx` | 21 | `mc.ustb.world` | MC 服务器地址，启动器连接用 |
| `src/frontend/app/servers/page.tsx` | 31 | `mod.ustb.world` | 模组服地址，启动器连接用 |
| `src/frontend/app/layout.tsx` | 16 | `https://mc.ustb.edu.cn` | Next.js `metadataBase`，影响 SEO 元标签和 Open Graph URL 生成 |
| `src/backend/app/routers/csl.py` | 258 | `https://mc.ustb.edu.cn/csl/` | ExtraList 入口 JSON 中的 `root` 字段（**注意**：此值已被动态 URL 解析覆盖，仅在数据库无 `csl_base_url` 且 `SITE_URL` 为默认值且无请求头时才生效，但代码中仍为硬编码默认值） |

## 建议修改（影响文档和注释）

| 文件 | 行号 | 当前值 | 说明 |
|------|------|--------|------|
| `README.md` | 7 | `mc.ustb.edu.cn` | 项目域名说明 |
| `README.md` | 84 | `SITE_URL=https://www.ustb.world` | 部署示例 |
| `README.md` | 313 | `https://mc.ustb.edu.cn/skinapi/` | Yggdrasil API 根地址示例 |
| `README.md` | 321 | `https://mc.ustb.edu.cn/skinapi/.well-known/openid-configuration` | OpenID 端点示例 |
| `README.md` | 363 | `https://mc.ustb.edu.cn/csl/` | CustomSkinAPI 根地址示例 |
| `README.md` | 392 | `https://mc.ustb.edu.cn/csl/ExtraList/vUSTB.json` | ExtraList 下载示例 |
| `README.md` | 398 | `"root": "https://mc.ustb.edu.cn/csl/"` | 手动配置示例 |
| `.env.example` | 9 | `SITE_URL=https://www.ustb.world` | 部署注释示例 |
| `src/caddy/Caddyfile` | 2 | `mc.ustb.edu.cn` | 注释：域名说明 |
| `src/caddy/Caddyfile` | 38 | `https://mc.ustb.edu.cn/csl/` | 注释：根地址示例 |
| `src/backend/app/routers/csl.py` | 18 | `https://mc.ustb.edu.cn/csl/` | 模块文档注释 |

## 可能需要修改（视情况而定）

| 文件 | 行号 | 当前值 | 说明 |
|------|------|--------|------|
| `src/frontend/app/admin/settings/page.tsx` | 27 | `ustb.edu.cn, emails.ustb.edu.cn` | 注册邮箱后缀占位符，与学校邮箱相关，非站点域名 |

## 不需要修改（动态解析）

以下文件中的域名值已通过 **3 级 URL 解析**（数据库 → SITE_URL → 请求头推断）自动适配，修改域名时**无需**改动代码：

- `src/backend/app/config.py` — `site_url` 默认值 `http://localhost`（仅作为兜底）
- `src/backend/app/routers/yggdrasil.py` — skinDomains、材质 URL、ALI 头均动态推断
- `src/backend/app/routers/oauth_provider.py` — OpenID 发现、Device Flow URL 均动态推断
- `src/backend/app/main.py` — ALI 中间件动态推断

> **生产部署提示**：最可靠的方式是在 `.env` 中设置 `SITE_URL=https://<你的域名>`，或在管理员后台"站点设置"中配置 `public_url`。这样即使反向代理未正确传递 `X-Forwarded-*` 头，URL 也能正确解析。
