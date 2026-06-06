'use client';

import { Download, Github, Boxes, Users, Shield, Compass } from 'lucide-react';

const GITHUB_RELEASES = 'https://github.com/LYOfficial/USTBL/releases';
const GITHUB_REPO = 'https://github.com/LYOfficial/USTBL';

export default function LauncherPage() {
  return (
    <div className="launcher-page">
      {/* ── Hero ── */}
      <section className="launcher-hero">
        <p className="section-kicker" style={{ marginBottom: 16 }}>USTBL</p>
        <h1 className="launcher-hero-title">像素北科启动器</h1>
        <p className="launcher-hero-subtitle">
          专为 USTB 像素北科工程适配的 Minecraft 启动器，
          集成版本管理、多账号登录、OAuth 认证与校园发现。
        </p>
        <div className="launcher-hero-actions">
          <a href={GITHUB_RELEASES} target="_blank" rel="noreferrer" className="btn-primary" style={{ padding: '12px 28px', fontSize: 15 }}>
            <Download style={{ width: 18, height: 18 }} /> 下载 USTBL
          </a>
          <a href={GITHUB_REPO} target="_blank" rel="noreferrer" className="btn-ghost" style={{ padding: '12px 28px', fontSize: 15 }}>
            <Github style={{ width: 18, height: 18 }} /> GitHub
          </a>
        </div>
        <div className="launcher-hero-screenshot">
          <img src="/img/launcher/home.png" alt="USTBL 启动器首页" />
        </div>
      </section>

      {/* ── Feature Overview Cards ── */}
      <section className="launcher-feature-grid">
        <div className="launcher-feature-card">
          <div className="launcher-feature-card-icon" style={{ background: 'color-mix(in srgb, #2f78ba 12%, transparent)', color: '#2f78ba' }}>
            <Boxes style={{ width: 22, height: 22 }} />
          </div>
          <h3 className="launcher-feature-card-title">版本管理</h3>
          <p className="launcher-feature-card-desc">
            轻松管理多个 Minecraft 版本与模组加载器，一键创建、切换和删除实例。
          </p>
        </div>
        <div className="launcher-feature-card">
          <div className="launcher-feature-card-icon" style={{ background: 'color-mix(in srgb, #22c55e 12%, transparent)', color: '#22c55e' }}>
            <Users style={{ width: 22, height: 22 }} />
          </div>
          <h3 className="launcher-feature-card-title">多账号切换</h3>
          <p className="launcher-feature-card-desc">
            同时登录多个 Minecraft 账户，在不同实例间随时切换，无需重复登录。
          </p>
        </div>
        <div className="launcher-feature-card">
          <div className="launcher-feature-card-icon" style={{ background: 'color-mix(in srgb, #a855f7 12%, transparent)', color: '#a855f7' }}>
            <Shield style={{ width: 22, height: 22 }} />
          </div>
          <h3 className="launcher-feature-card-title">像素北科 OAuth</h3>
          <p className="launcher-feature-card-desc">
            通过 OAuth 设备流认证无缝接入像素北科官网账户，安全便捷完成登录绑定。
          </p>
        </div>
        <div className="launcher-feature-card">
          <div className="launcher-feature-card-icon" style={{ background: 'color-mix(in srgb, #eab308 12%, transparent)', color: '#eab308' }}>
            <Compass style={{ width: 22, height: 22 }} />
          </div>
          <h3 className="launcher-feature-card-title">发现页面</h3>
          <p className="launcher-feature-card-desc">
            浏览社团新闻动态与校内整合包，在启动器内获取最新资源并一键安装。
          </p>
        </div>
      </section>

      {/* ── Version Management ── */}
      <section className="launcher-section">
        <div className="launcher-section-text">
          <span className="launcher-section-kicker">版本管理</span>
          <h2 className="launcher-section-title">版本管理，<br />简单直观</h2>
          <p className="launcher-section-desc">
            USTBL 提供清晰的实例管理界面，每个实例独立维护版本、模组加载器和运行参数。
            无论是原版、Fabric 还是 Forge，都可以一键创建并快速切换。
          </p>
        </div>
        <div className="launcher-section-img">
          <img src="/img/launcher/instances.png" alt="实例页面 — 版本管理" />
        </div>
      </section>

      {/* ── Multi-account ── */}
      <section className="launcher-section launcher-section--reverse">
        <div className="launcher-section-text">
          <span className="launcher-section-kicker">多账号登录</span>
          <h2 className="launcher-section-title">多账号同时登录，<br />随时切换</h2>
          <p className="launcher-section-desc">
            不再需要反复输入密码。支持离线账户与在线账户并存，在不同实例中绑定不同角色，
            一键完成账户切换。
          </p>
        </div>
        <div className="launcher-section-img">
          <img src="/img/launcher/accounts.png" alt="账户页面 — 多账号切换" />
        </div>
      </section>

      {/* ── OAuth Device Flow ── */}
      <section className="launcher-highlight">
        <span className="launcher-section-kicker">OAuth 设备流认证</span>
        <h2 className="launcher-highlight-title">无缝接入像素北科官网</h2>
        <p className="launcher-highlight-desc">
          USTBL 使用 OAuth 2.0 设备流认证协议，在启动器中输入验证码，
          于像素北科官网完成授权即可绑定账户，安全便捷，无需手动复制令牌。
        </p>
        <div className="launcher-highlight-screenshots">
          <div className="launcher-section-img">
            <img src="/img/launcher/oauth1.png" alt="OAuth 设备流认证 — 步骤一" />
          </div>
          <div className="launcher-section-img">
            <img src="/img/launcher/oauth2.png" alt="OAuth 设备流认证 — 步骤二" />
          </div>
        </div>
      </section>

      {/* ── Discover ── */}
      <div className="launcher-discover-grid">
        <div className="launcher-discover-col">
          <span className="launcher-section-kicker">发现 · 社团新闻</span>
          <h2 className="launcher-discover-col-title">社团动态，触手可及</h2>
          <p className="launcher-discover-col-desc">
            浏览像素北科社团最新新闻与公告，在启动器中即可获取动态更新，不错过任何重要信息。
          </p>
          <div className="launcher-section-img">
            <img src="/img/launcher/discover-news.png" alt="发现页面 — 社团新闻" />
          </div>
        </div>
        <div className="launcher-discover-col">
          <span className="launcher-section-kicker">发现 · 校内整合包</span>
          <h2 className="launcher-discover-col-title">校内整合包，一键安装</h2>
          <p className="launcher-discover-col-desc">
            浏览和下载专为北科学生准备的整合包，涵盖休闲、模组与校园主题，
            在启动器中一键安装即刻体验。
          </p>
          <div className="launcher-section-img">
            <img src="/img/launcher/discover-packs.png" alt="发现页面 — 校内整合包" />
          </div>
        </div>
      </div>

      {/* ── Top Menu ── */}
      <section className="launcher-menu-showcase">
        <span className="launcher-section-kicker">界面设计</span>
        <h2 className="launcher-section-title" style={{ margin: '0 auto 12px' }}>
          一目了然的顶部菜单
        </h2>
        <p className="launcher-section-desc" style={{ maxWidth: 480, margin: '0 auto' }}>
          清晰的导航栏让你在首页、实例、账户与发现之间自由穿梭，功能入口一览无余。
        </p>
        <div className="launcher-section-img">
          <img src="/img/launcher/menu.png" alt="启动器顶部菜单" />
        </div>
      </section>

      {/* ── Download CTA ── */}
      <section className="launcher-cta">
        <h2 className="launcher-cta-title">立即下载 USTBL</h2>
        <p className="launcher-cta-desc">
          专为像素北科工程打造的 Minecraft 启动器，开箱即用。
        </p>
        <div className="launcher-cta-actions">
          <a href={GITHUB_RELEASES} target="_blank" rel="noreferrer" className="btn-primary" style={{ padding: '12px 28px', fontSize: 15 }}>
            <Download style={{ width: 18, height: 18 }} /> 前往下载
          </a>
          <a href={GITHUB_REPO} target="_blank" rel="noreferrer" className="btn-ghost" style={{ padding: '12px 28px', fontSize: 15 }}>
            <Github style={{ width: 18, height: 18 }} /> 查看源码
          </a>
        </div>
      </section>
    </div>
  );
}
