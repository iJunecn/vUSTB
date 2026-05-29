# 像素北科 vUSTB — Legacy Rust/WASM 3D 渲染引擎归档

此目录用于暂存来自 `USTB-Official-Website` 的自研 Rust + WebAssembly 3D 渲染引擎。

## 现状

- 本次合并重写中，3D 校园游览（`/campus`）页面**仅做占位**，未集成 WASM 渲染。
- 原始 WASM 代码体积大、依赖 Rust 工具链，且与 Next.js 集成需要专门评估。

## 后续迁移计划

1. 将原 `USTB-Official-Website/core/`（Rust crate）整体复制到此目录
2. 用 `wasm-pack build --target web` 产出 ES Module
3. 在 `src/frontend/components/campus/EngineHost.tsx` 中用 `"use client"` + `dynamic(() => import(...), { ssr: false })` 加载
4. 资源包编译流水线（原 `scripts/BlockPaser/`）保留为独立步骤，输出物挂载到 Caddy `/packs/*`

当前 `/campus` 页面会显示一个"敬请期待"的占位界面，并提供项目介绍。
