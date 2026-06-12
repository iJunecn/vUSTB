'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  BookOpen,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  Circle,
  Compass,
  Cpu,
  Gamepad2,
  GraduationCap,
  Sparkles,
} from 'lucide-react';

/* ============================================================================
 * Type definitions
 * ========================================================================== */

type SectionKind = 'chapter' | 'sub';

type SubItem = {
  id: string;
  label: string;
  kind?: SectionKind;
};

type GuideSection = {
  id: string;
  number: string;
  title: string;
  shortTitle: string;
  summary: string;
  icon: React.ComponentType<{ style?: React.CSSProperties }>;
  accent: string;
  defaultOpen?: boolean;
  items: SubItem[];
};

/* ============================================================================
 * Table of contents — top-level chapters and their sub-sections
 * ========================================================================== */

const GUIDE: GuideSection[] = [
  {
    id: 'platform',
    number: '01',
    title: '像素北科平台介绍',
    shortTitle: '平台介绍',
    summary: '了解像素北科是做什么的、有什么功能、怎么导航到对应的页面。',
    icon: Compass,
    accent: '#2f78ba',
    defaultOpen: true,
    items: [
      { id: 'platform-overview', label: '平台能为你做什么' },
      { id: 'platform-url', label: '网站地址' },
      { id: 'platform-nav', label: '主要页面导览' },
      { id: 'platform-account', label: '角色与账号' },
    ],
  },
  {
    id: 'minecraft',
    number: '02',
    title: 'Minecraft 基础教程',
    shortTitle: 'MC 基础',
    summary: '从 Java 安装到游戏配置、整合包与模组材质的完整入门流程。',
    icon: Gamepad2,
    accent: '#22c55e',
    items: [
      { id: 'mc-java', label: '一、Java 安装' },
      { id: 'mc-launcher', label: '二、下载启动器' },
      { id: 'mc-launcher-settings', label: '三、启动器设置' },
      { id: 'mc-install', label: '四、安装游戏' },
      { id: 'mc-modpack', label: '五、整合包安装' },
      { id: 'mc-server', label: '六、加入服务器' },
      { id: 'mc-mods', label: '七、模组安装' },
      { id: 'mc-resourcepack', label: '八、材质包安装' },
      { id: 'mc-shader', label: '九、光影包安装' },
      { id: 'mc-faq', label: '十、常见问题排查' },
    ],
  },
  {
    id: 'ustbl',
    number: '03',
    title: 'USTBL 启动器详细教程',
    shortTitle: 'USTBL 启动器',
    summary: '专门为像素北科服务器适配的启动器，从下载、登录到发现页面。',
    icon: Cpu,
    accent: '#a855f7',
    items: [
      { id: 'ustbl-intro', label: '一、什么是 USTBL' },
      { id: 'ustbl-download', label: '二、下载与安装' },
      { id: 'ustbl-login', label: '三、首次启动与账号登录' },
      { id: 'ustbl-instance', label: '四、创建与配置实例' },
      { id: 'ustbl-discover', label: '五、使用「发现」页面' },
      { id: 'ustbl-launch', label: '六、启动游戏' },
      { id: 'ustbl-faq', label: '七、常见问题' },
    ],
  },
  {
    id: 'servers',
    number: '04',
    title: '如何游玩 USTB Servers 服务器',
    shortTitle: '游玩服务器',
    summary: '从打开官网到进入服务器：服务器列表、连接方式与首次进服须知。',
    icon: Sparkles,
    accent: '#eab308',
    items: [
      { id: 'srv-list', label: '一、当前可玩的服务器' },
      { id: 'srv-prep', label: '二、连接前的准备' },
      { id: 'srv-add', label: '三、添加服务器' },
    ],
  },
];

/* ============================================================================
 * Reading progress — derives from scroll position relative to content area
 * ========================================================================== */

function useReadingProgress(containerRef: React.RefObject<HTMLElement | null>) {
  const [progress, setProgress] = useState(0);
  const [activeId, setActiveId] = useState<string>('platform-overview');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let rafId = 0;
    const onScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const rect = container.getBoundingClientRect();
        const total = container.scrollHeight - window.innerHeight;
        const scrolled = Math.max(0, -rect.top);
        const ratio = total > 0 ? Math.min(1, scrolled / total) : 0;
        setProgress(ratio);

        // Determine the most visible sub-section
        const headings = container.querySelectorAll<HTMLElement>('[data-section-anchor]');
        const viewportMid = window.innerHeight * 0.32;
        let bestId = activeId;
        let bestDist = Infinity;
        headings.forEach((el) => {
          const id = el.getAttribute('data-section-anchor');
          if (!id) return;
          const r = el.getBoundingClientRect();
          const dist = Math.abs(r.top - viewportMid);
          if (r.top < window.innerHeight && r.bottom > 0 && dist < bestDist) {
            bestDist = dist;
            bestId = id;
          }
        });
        if (bestId !== activeId) setActiveId(bestId);
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef]);

  return { progress, activeId };
}

function useIsMobile(breakpoint = 1024) {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth < breakpoint);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [breakpoint]);
  return mobile;
}

/* ============================================================================
 * Sidebar — sticky TOC with collapsible chapters
 * ========================================================================== */

function GuideSidebar({
  progress,
  activeId,
  openChapters,
  toggleChapter,
  onJump,
  visible,
  onClose,
}: {
  progress: number;
  activeId: string;
  openChapters: Set<string>;
  toggleChapter: (id: string) => void;
  onJump: (id: string) => void;
  visible: boolean;
  onClose: () => void;
}) {
  // Map activeId → its parent chapter id, so we can auto-expand the active one
  const activeChapter = useCallback(() => {
    for (const ch of GUIDE) {
      if (ch.items.some((it) => it.id === activeId)) return ch.id;
    }
    return GUIDE[0].id;
  }, [activeId]);

  return (
    <aside className={`guide-sidebar ${visible ? 'is-visible' : ''}`}>
      <div className="guide-sidebar-inner">
        <div className="guide-sidebar-header">
          <div className="guide-sidebar-title">
            <BookOpen style={{ width: 16, height: 16, color: 'var(--color-primary)' }} />
            <span>教程大纲</span>
          </div>
          <button
            className="guide-sidebar-close"
            aria-label="关闭大纲"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="guide-sidebar-progress">
          <div className="guide-sidebar-progress-track">
            <div
              className="guide-sidebar-progress-bar"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <span className="guide-sidebar-progress-text">
            阅读进度 {Math.round(progress * 100)}%
          </span>
        </div>

        <nav className="guide-toc">
          {GUIDE.map((ch) => {
            const isOpen = openChapters.has(ch.id) || activeChapter() === ch.id;
            const Icon = ch.icon;
            const isActiveChapter = activeChapter() === ch.id;
            return (
              <div key={ch.id} className={`guide-toc-chapter ${isActiveChapter ? 'is-active' : ''}`}>
                <button
                  className="guide-toc-chapter-btn"
                  onClick={() => toggleChapter(ch.id)}
                  aria-expanded={isOpen}
                >
                  <span className="guide-toc-chevron">
                    {isOpen ? <ChevronDown style={{ width: 14, height: 14 }} /> : <ChevronRight style={{ width: 14, height: 14 }} />}
                  </span>
                  <span className="guide-toc-num" style={{ color: ch.accent }}>{ch.number}</span>
                  <span className="guide-toc-icon" style={{ color: ch.accent }}>
                    <Icon />
                  </span>
                  <span className="guide-toc-chapter-label">{ch.title}</span>
                </button>
                {isOpen && (
                  <ul className="guide-toc-list">
                    {ch.items.map((it) => {
                      const isActive = activeId === it.id;
                      return (
                        <li key={it.id}>
                          <button
                            className={`guide-toc-item ${isActive ? 'is-active' : ''}`}
                            onClick={() => onJump(it.id)}
                          >
                            <span className="guide-toc-dot">
                              {isActive ? (
                                <CheckCircle2 style={{ width: 13, height: 13, color: 'var(--color-primary)' }} />
                              ) : (
                                <Circle style={{ width: 11, height: 11, color: 'var(--color-text-light)', opacity: 0.5 }} />
                              )}
                            </span>
                            <span className="guide-toc-label">{it.label}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </nav>

        <div className="guide-sidebar-footer">
          <p>遇到问题？</p>
          <a className="guide-sidebar-link" href="https://qm.qq.com/q/737880867" target="_blank" rel="noreferrer">
            加入官方社群 (QQ 群 737880867)
          </a>
        </div>
      </div>
    </aside>
  );
}

/* ============================================================================
 * Content helpers
 * ========================================================================== */

function Callout({ tone = 'info', children }: { tone?: 'info' | 'tip' | 'warn'; children: React.ReactNode }) {
  const style =
    tone === 'tip'
      ? { background: 'color-mix(in srgb, #22c55e 8%, transparent)', borderColor: '#22c55e' }
      : tone === 'warn'
        ? { background: 'color-mix(in srgb, #ef4444 8%, transparent)', borderColor: '#ef4444' }
        : { background: 'color-mix(in srgb, var(--color-primary) 8%, transparent)', borderColor: 'var(--color-primary)' };
  return (
    <div className="guide-callout" style={style}>
      <div className="guide-callout-body">{children}</div>
    </div>
  );
}

function GuideFigure({ src, alt, caption }: { src: string; alt: string; caption?: string }) {
  return (
    <figure className="guide-figure">
      <img src={src} alt={alt} loading="lazy" />
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

function SectionHeader({ number, title, summary, accent, id }: { number: string; title: string; summary: string; accent: string; id: string }) {
  return (
    <header className="guide-section-header" id={id} data-section-anchor={id}>
      <span className="guide-section-num" style={{ color: accent }}>第 {number} 章</span>
      <h2 className="guide-section-title">{title}</h2>
      <p className="guide-section-summary">{summary}</p>
    </header>
  );
}

function SubHeader({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3 className="guide-subheader" id={id} data-section-anchor={id}>
      {children}
    </h3>
  );
}

/* ============================================================================
 * Page
 * ========================================================================== */

export default function GuidePage() {
  const contentRef = useRef<HTMLElement>(null);
  const { progress, activeId } = useReadingProgress(contentRef);
  const isMobile = useIsMobile();
  const [openChapters, setOpenChapters] = useState<Set<string>>(
    () => new Set(GUIDE.filter((c) => c.defaultOpen).map((c) => c.id)),
  );
  const [tocOpen, setTocOpen] = useState(false);

  const toggleChapter = useCallback((id: string) => {
    setOpenChapters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const jumpTo = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const offset = 72;
    const top = el.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top, behavior: 'smooth' });
    if (isMobile) setTocOpen(false);
  }, [isMobile]);

  // Lock background scroll when mobile drawer is open
  useEffect(() => {
    if (!isMobile) return;
    document.body.style.overflow = tocOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [tocOpen, isMobile]);

  return (
    <div className="guide-page">
      {/* ── Hero ── */}
      <section className="guide-hero">
        <p className="section-kicker" style={{ marginBottom: 16 }}>BEGINNER&apos;S GUIDE</p>
        <h1 className="guide-hero-title">新手指南</h1>
        <p className="guide-hero-subtitle">
          从零开始玩转像素北科：认识平台、安装 Minecraft、使用 USTBL 启动器，加入校园服务器。
        </p>

        <div className="guide-hero-stats">
          <div className="guide-hero-stat">
            <span className="guide-hero-stat-num">{GUIDE.length}</span>
            <span className="guide-hero-stat-label">个章节</span>
          </div>
          <div className="guide-hero-stat">
            <span className="guide-hero-stat-num">
              {GUIDE.reduce((sum, ch) => sum + ch.items.length, 0)}
            </span>
            <span className="guide-hero-stat-label">个小节</span>
          </div>
          <div className="guide-hero-stat">
            <span className="guide-hero-stat-num">~30</span>
            <span className="guide-hero-stat-label">分钟阅读</span>
          </div>
        </div>

        <div className="guide-hero-actions">
          <button
            className="btn-primary"
            onClick={() => jumpTo('platform')}
            style={{ padding: '12px 28px', fontSize: 15, display: 'inline-flex', alignItems: 'center', gap: 8 }}
          >
            <GraduationCap style={{ width: 18, height: 18 }} /> 开始阅读
          </button>
          <button
            className="btn-ghost"
            onClick={() => setTocOpen(true)}
            style={{ padding: '12px 28px', fontSize: 15, display: 'inline-flex', alignItems: 'center', gap: 8 }}
          >
            <BookOpen style={{ width: 18, height: 18 }} /> 查看大纲
          </button>
        </div>
      </section>

      {/* ── Mobile TOC toggle (sticky) ── */}
      {isMobile && (
        <button
          className="guide-toc-fab"
          onClick={() => setTocOpen(true)}
          aria-label="打开教程大纲"
        >
          <BookOpen style={{ width: 18, height: 18 }} />
          <span>大纲 · {Math.round(progress * 100)}%</span>
        </button>
      )}

      {/* ── Main layout ── */}
      <div className="guide-layout">
        <GuideSidebar
          progress={progress}
          activeId={activeId}
          openChapters={openChapters}
          toggleChapter={toggleChapter}
          onJump={jumpTo}
          visible={isMobile ? tocOpen : true}
          onClose={() => setTocOpen(false)}
        />

        {/* Mobile overlay */}
        {isMobile && tocOpen && (
          <div className="guide-sidebar-overlay" onClick={() => setTocOpen(false)} />
        )}

        <main ref={contentRef} className="guide-content article-content prose-markdown">
          {/* ============================================================
           * Chapter 01 — Platform intro
           * ========================================================== */}
          <SectionHeader
            id="platform"
            number="01"
            title="像素北科平台介绍"
            summary="在开始之前，先了解这个平台能做什么、有什么页面、怎么注册账号。"
            accent="#2f78ba"
          />
          <p>
            欢迎来到<strong>「像素北科」（vUSTB）</strong>！
          </p>
          <p>
            像素北科是<strong>北京科技大学元宇宙体素工作坊</strong>的官方平台。我们面向校内师生，
            提供 Minecraft 服务器、皮肤站、3D 打印预约、动态资讯与社区活动等一站式服务。
            即使你从未接触过 Minecraft，只要按照本教程一步步操作，也能顺利加入我们的世界。
          </p>

          <SubHeader id="platform-overview">平台能为你做什么</SubHeader>
          <ul>
            <li><strong>Minecraft 服务器</strong>：由元宇宙体素工作坊运营的多个 Minecraft 主题服务器，覆盖原版、模组、休闲等多种玩法。</li>
            <li><strong>皮肤站</strong>：免费、开放的 Minecraft 皮肤与披风托管平台，支持上传、收藏、3D 预览，可与游戏内实时同步。</li>
            <li><strong>用户中心</strong>：管理你的游戏角色、账号安全与个人资料。</li>
            <li><strong>动态资讯</strong>：浏览社团新闻、活动公告与教程文章，第一时间了解校园动态。</li>
            <li><strong>3D 打印预约</strong>：工作坊内 3D 打印机的在线预约与计费系统。</li>
            <li><strong>3D 校园</strong>：基于 Web 技术的三维校园场景展示。</li>
          </ul>

          <SubHeader id="platform-url">网站地址</SubHeader>
          <p>像素北科的官方网址为：</p>
          <p>
            <a href="https://www.ustb.world/" target="_blank" rel="noreferrer">
              <strong>https://www.ustb.world/</strong>
            </a>
          </p>
          <GuideFigure src="/img/guide/1.png" alt="像素北科官网首页" caption="官网首页：左侧是导航与项目导览" />

          <SubHeader id="platform-nav">主要页面导览</SubHeader>
          <p>
            打开首页后，你可以通过顶部导航栏访问下列页面。本教程的其余章节将围绕以下页面展开：
          </p>
          <div className="guide-table-wrap">
            <table>
              <thead>
                <tr><th>页面</th><th>地址</th><th>作用</th></tr>
              </thead>
              <tbody>
                <tr><td>首页</td><td><code>/</code></td><td>平台总览、活动公告与最新资讯</td></tr>
                <tr><td>服务器</td><td><code>/servers</code></td><td>查看所有 Minecraft 服务器的在线状态与连接地址</td></tr>
                <tr><td>启动器</td><td><code>/launcher</code></td><td>下载 USTBL 启动器，了解其功能特性</td></tr>
                <tr><td>关于</td><td><code>/about</code></td><td>团队介绍、工作坊历史、加入方式</td></tr>
                <tr><td>动态</td><td><code>/dynamics</code></td><td>浏览社团发布的图文教程、活动公告</td></tr>
                <tr><td>皮肤站</td><td><code>/skin</code></td><td>上传、收藏与预览皮肤 / 披风</td></tr>
                <tr><td>用户中心</td><td><code>/dashboard</code></td><td>管理账号、角色、材质与安全设置</td></tr>
              </tbody>
            </table>
          </div>
          <GuideFigure src="/img/guide/2.png" alt="顶部导航栏" caption="顶部导航栏：从左到右依次为首页 / 服务器 / 启动器 / 关于 / 动态 / 皮肤站" />
          <Callout tone="info">
            如果你只是想玩服务器，最关心的两个页面是 <strong>「启动器下载」</strong> 和 <strong>「服务器列表」</strong>—— 后续章节会分别讲解。
          </Callout>

          <SubHeader id="platform-account">角色与账号</SubHeader>
          <p>像素北科使用一套统一的账号体系：</p>
          <ul>
            <li>
              <strong>注册账号</strong>：在 <code>/register</code> 页面填写邀请码、邮箱、密码即可创建账号。
              校内同学也可使用学校邮箱注册以解锁更多功能。
            </li>
            <li>
              <strong>角色（Profile）</strong>：账号下可创建多个 Minecraft 游戏角色（一个角色对应一个游戏 ID）。
              每个角色可以单独绑定皮肤与披风。
            </li>
            <li>
              <strong>皮肤协议</strong>：平台同时实现了 <code>Yggdrasil</code>（authlib-injector）和
              <code>CustomSkinAPI</code> 两套皮肤协议，几乎兼容所有主流启动器与游戏内 Mod。
            </li>
          </ul>
          <GuideFigure src="/img/guide/3.png" alt="注册页面" caption="注册页面：填写邀请码、邮箱、密码后即可创建账号" />
          <p>注册并登录后，建议先到 <strong>用户中心 → 安全</strong> 修改初始密码，再到 <strong>皮肤站</strong> 上传你的第一张皮肤。</p>
          <GuideFigure src="/img/guide/4.png" alt="用户中心 — 安全设置" caption="用户中心 — 安全设置" />

          {/* ============================================================
           * Chapter 02 — Minecraft basics
           * ========================================================== */}
          <SectionHeader
            id="minecraft"
            number="02"
            title="Minecraft 基础教程"
            summary="从 Java 安装到游戏配置、整合包与模组材质的完整入门流程。"
            accent="#22c55e"
          />
          <blockquote>
            <p>
              <strong>摘要：</strong>Minecraft 作为一个开放包容的游戏，欢迎所有新玩家的加入。
              但是由于 Minecraft 本身并不如其他国产手游一般易于使用，新入坑的玩家大多都会遇到很多问题。
              本文将以 Windows 系统为操作平台，贯彻 Minecraft 从安装到游玩的全过程，为新入坑玩家提供一份详细的操作指南。
            </p>
          </blockquote>

          <SubHeader id="mc-java">一、Java 安装</SubHeader>
          <p>
            Java 是编写 Minecraft 的语言。如果没有 Java，电脑将无法理解游戏代码想要做什么。
            因此 Java 是游玩 Minecraft 所必须的依赖。接下来的内容将以 Windows 系统为例，展示 Java 的安装过程。
          </p>

          <h4>1. Java 版本选择</h4>
          <p>由于 Minecraft 的存续时间很长，其开发跨越了多个 Java 版本。通常来说，Java 与 Minecraft 游戏版本存在下表中的对应关系：</p>
          <div className="guide-table-wrap">
            <table>
              <thead>
                <tr><th>游戏版本</th><th>Java 版本</th></tr>
              </thead>
              <tbody>
                <tr><td>1.16.5 及以下</td><td>Java 8</td></tr>
                <tr><td>1.17 ~ 1.20.1</td><td>Java 17</td></tr>
                <tr><td>1.20.1 ~ 1.21.11</td><td>Java 21</td></tr>
                <tr><td>26.1 及以上</td><td>Java 25</td></tr>
              </tbody>
            </table>
          </div>
          <p>你需要根据你的游戏版本，选择对应的 Java 版本进行下载。通常不正确的 Java 版本可能导致您无法进行游戏，请务必注意。</p>
          <Callout tone="tip">
            如果你只是玩像素北科的服务器，可以暂时跳过手动安装 Java。后续章节介绍的 USTBL 启动器已经内置了 Java 切换功能，会在启动实例时自动选择合适的版本。
          </Callout>

          <h4>2. Java 下载</h4>
          <p>你可以从下面的这些地址下载到所需版本的 Java。</p>
          <div className="guide-table-wrap">
            <table>
              <thead>
                <tr><th>下载源</th><th>下载地址</th></tr>
              </thead>
              <tbody>
                <tr><td>微软 OpenJDK</td><td><a href="https://learn.microsoft.com/zh-cn/java/openjdk/download" target="_blank" rel="noreferrer">learn.microsoft.com / java / openjdk</a></td></tr>
                <tr><td>Azul JDK</td><td><a href="https://www.azul.com/downloads/?os=windows&architecture=x86-64-bit&package=jdk#zulu" target="_blank" rel="noreferrer">azul.com / downloads</a></td></tr>
              </tbody>
            </table>
          </div>
          <p>给出的两个地址选其一即可。进入网页后，请找到你需要的 Java 版本，下载类型为 <code>.msi</code> 的文件。例如，我想要下载 Windows 系统的 Java 21，在微软 OpenJDK 和 Azul JDK 中分别应如下操作。</p>
          <div className="guide-figure-grid">
            <GuideFigure src="/img/guide/5.png" alt="在微软 OpenJDK 下载 Java" />
            <GuideFigure src="/img/guide/6.png" alt="在 Azul JDK 下载 Java" />
          </div>
          <p>下载完成后，请找到你下载的文件。默认状态下，你下载的文件会在 <code>{`C:/Users/{你的电脑用户名}/Downloads`}</code> 文件夹下。</p>

          <h4>3. Java 安装</h4>
          <p>
            双击你刚刚下载的 <code>.msi</code> 文件，按照引导一路选 <strong>「下一步」</strong> 即可完成 Java 的安装。
            如果系统弹出用户账户控制（UAC）询问是否允许此应用对设备进行更改，请选择 <strong>「是」</strong>。
          </p>
          <p>安装完成后，按下 <code>Win + R</code> 打开「运行」窗口，输入 <code>cmd</code> 并回车，在打开的命令行窗口中输入：</p>
          <pre><code>java -version</code></pre>
          <p>如果看到版本号输出（例如 <code>openjdk version &quot;21.0.x&quot;</code>），说明 Java 已经正确安装。</p>
          <GuideFigure src="/img/guide/7.png" alt="java -version 验证安装" caption="（例图安装的是 Java 17，同理）" />

          <SubHeader id="mc-launcher">二、下载启动器</SubHeader>
          <p>
            Minecraft 游戏本体是一个 Java 文件，无法直接双击被执行。你需要使用启动器启动游戏。
            但官方启动器使用起来相对较为复杂，下面我将介绍两种由社区维护的启动器的用法，
            其他启动器的用法也基本大同小异。如果你是像素北科服务器的玩家，更推荐使用专为本站适配的 <strong>USTBL 启动器</strong>，
            详见后文 <a href="#ustbl">USTBL 启动器详细教程</a> 章节。
          </p>

          <h4>1. USTBL</h4>
          <p>USTBL 是贝壳专用的启动器，适配各类贝壳玩家需求，详见 <a href="#ustbl">USTBL 启动器详细教程</a>。</p>

          <h4>2. PCL2</h4>
          <p>PCL2 启动器全称 <em>Plain Craft Launcher 2</em>，是由龙腾猫跃开发的一款易于使用的启动器，整合了大量模组、材质、光影等资源。</p>
          <GuideFigure src="/img/guide/8.png" alt="PCL2 启动器界面" />
          <p>该启动器发布于爱发电。但启动器本身是免费的，无需赞助。</p>
          <ul>
            <li>下载地址：<a href="https://ifdian.net/p/0164034c016c11ebafcb52540025c377" target="_blank" rel="noreferrer">ifdian.net</a></li>
            <li>使用教程：<a href="https://zhuanlan.zhihu.com/p/704716178" target="_blank" rel="noreferrer">知乎专栏</a></li>
            <li>常见问题：<a href="https://shimo.im/docs/qKPttVvXKqPD8YDC" target="_blank" rel="noreferrer">shimo 文档</a></li>
          </ul>

          <h4>3. HMCL</h4>
          <p>HMCL 启动器全称 <em>Hello Minecraft Launcher</em>，历史悠久，代码开源。</p>
          <GuideFigure src="/img/guide/9.png" alt="HMCL 启动器界面" />
          <ul>
            <li>下载地址：<a href="https://hmcl.huangyuhui.net/" target="_blank" rel="noreferrer">hmcl.huangyuhui.net</a></li>
            <li>使用教程：<a href="https://mc.sjtu.cn/tutorial/#title-9" target="_blank" rel="noreferrer">SJTU 教程</a></li>
            <li>常见问题：<a href="https://docs.hmcl.net/faq.html" target="_blank" rel="noreferrer">docs.hmcl.net</a></li>
          </ul>

          <SubHeader id="mc-launcher-settings">三、启动器设置</SubHeader>
          <p>在下载好启动器后，需要对启动器进行一些设置，以方便后续的游玩。</p>

          <h4>1. PCL2 启动器设置</h4>
          <p>
            请将下载好的 PCL2 启动器放在一个独立的文件夹中。双击打开，启动器会生成一个名为 <code>PCL</code> 的文件夹。
            这是 PCL2 启动器运行所必需的，请勿删除。可以没有 <code>.minecraft</code> 文件夹。文件示例如图所示。
          </p>
          <GuideFigure src="/img/guide/10.png" alt="PCL2 文件夹结构" />
          <p>
            打开启动器后，可选择你的登录方式。如果你没有购买过 Minecraft 正版账号，请选择 <strong>离线模式</strong>。
            如果你有正版 Minecraft 账号，推荐你选择 <strong>正版登录</strong>。
            离线账号需填入你的游戏 ID，<strong>强烈建议填写非中文字符的 ID</strong>，否则可能在部分服务器中遇到兼容问题。
          </p>
          <GuideFigure src="/img/guide/11.png" alt="PCL2 登录界面" />
          <p>
            点击上方的 <strong>【设置】</strong>，配置 <strong>【启动选项】</strong> 中的 <strong>【默认版本隔离】</strong> 为 <strong>【隔离所有版本】</strong>，
            <strong>【Java】</strong> 为 <strong>【自动选择（推荐）】</strong>。配置 <strong>【内存分配】</strong> 为自动配置。
          </p>

          <h4>2. HMCL 设置</h4>
          <p>
            将下载好的 HMCL 放在一个独立的文件夹中。双击打开。此时 HMCL 会尝试下载必要资源并在目录中生成一个名为 <code>.hmcl</code> 的隐藏文件夹。
          </p>
          <p>
            打开启动器后，在左上角的账户一栏中，点击 <strong>添加账户</strong>。
            如果你没有购买过 Minecraft 正版账号，请选择 <strong>离线模式</strong>。
            如果你有正版 Minecraft 账号，推荐你选择 <strong>微软账户</strong>。
            离线账号需填入你的游戏 ID，<strong>强烈建议填写非中文字符的 ID</strong>。
          </p>
          <GuideFigure src="/img/guide/12.png" alt="HMCL 添加账户" />
          <p>
            返回到启动器首页。点击下方 <strong>【通用】</strong> 中的 <strong>【设置】</strong>。
            配置 <strong>【全局游戏设置】</strong> 中的 <strong>【游戏 Java】</strong> 为 <strong>【自动选择合适的 Java】</strong>，
            <strong>【版本隔离】</strong> 为 <strong>【各实例独立】</strong>，<strong>【游戏内存】</strong> 为 <strong>【自动分配内存】</strong>。
          </p>

          <SubHeader id="mc-install">四、安装游戏</SubHeader>
          <p>启动器已经配置好了，但是游戏本体还没有安装。</p>

          <h4>1. PCL2 安装游戏</h4>
          <p>
            点击启动器上方的 <strong>【下载】</strong>，在 <strong>【正式版】</strong> 中选择你要安装的原版游戏版本并点击。
            如果你需要安装 Forge、NeoForge 或 Fabric，请一并选择。随后点击下方的 <strong>开始下载</strong>，稍等片刻，即可完成游戏的安装。
          </p>
          <GuideFigure src="/img/guide/13.png" alt="PCL2 安装游戏版本" />

          <h4>2. HMCL 安装游戏</h4>
          <p>
            点击左侧的 <strong>【下载】</strong>，选择你想要下载的游戏版本并点击。
            如果你需要安装 Forge、NeoForge 或 Fabric，请一并选择。随后点击下方的 <strong>安装</strong>，稍等片刻，即可完成游戏的安装。
          </p>
          <GuideFigure src="/img/guide/14.png" alt="HMCL 安装游戏版本" />

          <SubHeader id="mc-modpack">五、整合包安装</SubHeader>
          <p>
            在绝大多数情况下，服务器会将游戏以整合包的方式进行分发。
            大多数整合包的安装方式都是将整合包文件直接拖入启动器首页，确认版本名后，即可自动安装。
          </p>
          <p>
            整合包文件通常为 <code>zip</code> 压缩包或 <code>mrpack</code> 文件。
            如果安装失败，请双击打开压缩文件，检查里面是不是还套了一层，
            如果是，请直接解压压缩文件，并使用其中的启动器直接启动，或将整合包文件导入启动器中。
          </p>
          <GuideFigure src="/img/guide/15.png" alt="将整合包拖入启动器" />

          <SubHeader id="mc-server">六、加入服务器</SubHeader>
          <p>
            打开游戏并等待游戏加载完成后，点击 <strong>多人游戏</strong>，选择 <strong>【添加服务器】</strong>。
            第一栏为方便玩家识别服务器的名称，内容不限；第二栏为服务器地址。
          </p>
          <GuideFigure src="/img/guide/16.png" alt="多人游戏 - 添加服务器" />
          <p>
            <strong>特别注意，服务器地址格式通常为 <code>域名</code> 或 <code>域名:端口号</code> 或 <code>IP:端口号</code></strong>。
            域名和端口号之间的冒号应当为英文冒号。确认无误后，点击 <strong>保存</strong>，
            然后就可以在多人游戏列表中看到你刚刚保存的服务器了。双击即可进入服务器。
          </p>
          <GuideFigure src="/img/guide/17.png" alt="多人游戏 - 服务器列表" />

          <SubHeader id="mc-mods">七、模组安装</SubHeader>
          <p>
            对于需要额外安装模组的情况，你需要将模组的 <code>.jar</code> 文件复制一份到当前版本的模组文件夹中。
            模组文件夹的路径为启动器同级的 <code>{`.minecraft/versions/{你的游戏版本名}/mods`}</code> 文件夹内。
            你也可以通过启动器的版本设置 → 模组管理快速打开这个文件夹。
          </p>
          <Callout tone="warn">
            <strong>注意：</strong>在完成模组变更后，你必须完全退出游戏，重新进入，才能生效。
          </Callout>
          <GuideFigure src="/img/guide/18.png" alt="模组文件夹" />

          <SubHeader id="mc-resourcepack">八、材质包安装</SubHeader>
          <p>
            材质包通常是一个 <code>.zip</code> 压缩文件。<strong>不要解压</strong>，将材质包复制到材质包文件夹中。
            材质包文件夹的路径为启动器同级的 <code>{`.minecraft/versions/{你的游戏版本名}/resourcepacks`}</code> 文件夹内。
            在完成添加后，你需要在游戏设置 → 视频设置 → 资源包选项中，
            将你添加到左侧的材质包，通过点击图标的操作移动到右侧变为启用状态。
          </p>
          <Callout tone="tip">
            <strong>注意：</strong>材质包的更新支持热重载，无需退出重启游戏即可生效。
          </Callout>
          <GuideFigure src="/img/guide/19.png" alt="材质包文件夹" />

          <SubHeader id="mc-shader">九、光影包安装</SubHeader>
          <p>
            光影包需要你先安装任意光影加载器模组（如 OptiFine、Iris 等）。
            然后将你下载到的光影包 <code>.zip</code> 文件复制到启动器同级的
            <code>{`.minecraft/versions/{你的游戏版本名}/shaderpacks`}</code> 文件夹中，<strong>不要解压</strong>。
            然后在游戏 → 视频设置 → shaderpacks（光影选项）中，选择你添加的光影。
          </p>
          <Callout tone="tip">
            <strong>注意：</strong>光影包的更新支持热重载，无需退出重启游戏即可生效。
          </Callout>
          <GuideFigure src="/img/guide/20.png" alt="光影包文件夹" />

          <SubHeader id="mc-faq">十、常见问题排查</SubHeader>
          <p>在完成上面九个步骤后，你应当已经可以正常进入服务器了。万一遇到问题，可以按下面的清单自检：</p>
          <ol>
            <li>
              <strong>游戏无法启动 / 黑屏 / 闪退</strong>
              <ul>
                <li>检查 Java 版本是否与游戏版本匹配（参见第一节表格）。</li>
                <li>在启动器中将「内存分配」提高至 <code>4096 MB</code> 或以上再试。</li>
                <li>关闭占用显卡的其它程序（LOL、OBS、视频播放器等），并确保显卡驱动为最新。</li>
              </ul>
            </li>
            <li>
              <strong>连接服务器超时 / 无法连接</strong>
              <ul>
                <li>确认服务器地址和端口号是否填写正确，注意是<strong>英文冒号</strong>。</li>
                <li>部分学校宿舍网或公司网会屏蔽游戏端口，可尝试切换到手机热点。</li>
              </ul>
            </li>
            <li>
              <strong>登录时提示「无效的会话」或皮肤加载失败</strong>
              <ul>
                <li>多为本地时间与网络时间不同步。开启系统「自动设置时间」并重启启动器即可。</li>
                <li>如果你使用了第三方皮肤站或 OAuth 登录，请先确认账号已在 <code>/dashboard</code> 中创建至少一个游戏角色。</li>
              </ul>
            </li>
          </ol>
          <Callout tone="info">
            如果你确认了上面的所有问题仍然无法解决，欢迎加入 USTB MC Servers 官方社群（QQ 群：<strong>737880867</strong>），
            附上启动器日志、报错截图与你的游戏版本号，会有同学协助排查。
          </Callout>

          {/* ============================================================
           * Chapter 03 — USTBL
           * ========================================================== */}
          <SectionHeader
            id="ustbl"
            number="03"
            title="USTBL 启动器详细教程"
            summary="专门为像素北科服务器适配的启动器，从下载、登录到发现页面。"
            accent="#a855f7"
          />
          <blockquote>
            <p>本章节面向 <strong>像素北科服务器</strong> 的玩家。USTBL（USTB Launcher）是专为像素北科工程适配的 Minecraft 启动器，相比通用启动器有两大优势：</p>
            <ol>
              <li><strong>内置 OAuth 设备流认证</strong>：用官网账号即可一键登录，免去手动粘贴令牌的繁琐。</li>
              <li><strong>「发现」页面</strong>：直接在启动器内浏览社团动态与下载校内整合包，无需再去网站翻找。</li>
            </ol>
          </blockquote>

          <SubHeader id="ustbl-intro">一、什么是 USTBL</SubHeader>
          <p>USTBL 启动器是一款开源、跨平台的 Minecraft 启动器，针对像素北科工程做了深度适配。它的主要特性包括：</p>
          <ul>
            <li><strong>版本管理</strong>：原版、Forge、NeoForge、Fabric 等多版本 / 模组加载器一键创建实例。</li>
            <li><strong>多账号切换</strong>：同时登录多个 Minecraft 账号（离线 / 官网 OAuth / 微软正版），在不同实例间自由切换。</li>
            <li><strong>OAuth 设备流认证</strong>：通过像素北科官网账号完成绑定，全程在浏览器授权，无需在启动器里输入密码。</li>
            <li><strong>发现页面</strong>：在启动器内浏览社团新闻和校内整合包，资源更新及时。</li>
          </ul>
          <GuideFigure src="/img/guide/21.png" alt="USTBL 启动器首页" />

          <SubHeader id="ustbl-download">二、下载与安装</SubHeader>
          <h4>1. 从官网下载（推荐）</h4>
          <p>打开浏览器，访问像素北科官网的启动器页面：</p>
          <p>
            <a href="https://www.ustb.world/launcher" target="_blank" rel="noreferrer">
              <strong>https://www.ustb.world/launcher</strong>
            </a>
          </p>
          <p>
            点击页面中央的 <strong>「下载 USTBL」</strong> 按钮，展开后会显示来自「北科网盘」的最新版本下载列表。
            点击对应平台的文件即可开始下载（Windows 一般选 <code>USTBL-xxx-windows-x86_64.exe</code> 或
            <code>...setup.exe</code> 形式的安装包）。
          </p>
          <GuideFigure src="/img/guide/22.png" alt="官网 USTBL 下载页面" />

          <h4>2. 从 GitHub 下载</h4>
          <p>如果官网下载速度较慢，也可以前往 GitHub Releases 页面下载：</p>
          <p>
            <a href="https://github.com/LYOfficial/USTBL/releases" target="_blank" rel="noreferrer">
              <strong>https://github.com/LYOfficial/USTBL/releases</strong>
            </a>
          </p>
          <p>在 <strong>Assets</strong> 区域找到对应系统的安装包下载。</p>

          <h4>3. 安装</h4>
          <p>
            双击下载好的安装包，按照引导选择安装目录并完成安装。
            建议将 USTBL 安装在 <strong>非系统盘</strong>（如 <code>D:\USTBL</code>）的独立文件夹下，
            方便后续备份与迁移。
          </p>
          <p>安装完成后，桌面上会出现 USTBL 的快捷方式。双击即可启动。</p>

          <SubHeader id="ustbl-login">三、首次启动与账号登录</SubHeader>
          <h4>1. 选择登录方式</h4>
          <p>USTBL 启动器打开后，进入 <strong>账户</strong> 页面，点击 <strong>「添加账户」</strong>。会看到三种登录方式：</p>
          <div className="guide-table-wrap">
            <table>
              <thead>
                <tr><th>登录方式</th><th>适用场景</th></tr>
              </thead>
              <tbody>
                <tr><td>离线登录</td><td>没有像素北科账号，或只是想用任意 ID 进入离线游戏</td></tr>
                <tr><td>像素北科 OAuth</td><td>已注册像素北科账号（<strong>强烈推荐</strong>）</td></tr>
                <tr><td>微软账户</td><td>拥有正版 Minecraft 账号，希望同步微软皮肤</td></tr>
              </tbody>
            </table>
          </div>
          <GuideFigure src="/img/guide/23.png" alt="USTBL 添加账户" />

          <h4>2. 通过 OAuth 登录像素北科账号（推荐）</h4>
          <p>如果你在像素北科官网已经注册了账号，推荐使用 <strong>像素北科 OAuth</strong> 登录，步骤如下：</p>
          <ol>
            <li>选择 <strong>「像素北科 OAuth」</strong>，启动器会生成一个 6 位或更长的 <strong>设备码</strong>，并提示你前往官网完成授权。</li>
            <li>在同一台电脑或手机上打开浏览器，访问 <code>https://www.ustb.world/oauth/device</code>（或启动器提示中的具体 URL）。</li>
            <li>在官网页面中 <strong>登录</strong> 你的像素北科账号（如已登录会自动跳过此步）。</li>
            <li>输入启动器中显示的 <strong>设备码</strong>，并点击 <strong>「授权」</strong>。</li>
            <li>启动器中会显示「登录成功」，并自动跳到账号列表。</li>
          </ol>
          <div className="guide-figure-grid">
            <GuideFigure src="/img/guide/24.png" alt="OAuth 设备码" />
            <GuideFigure src="/img/guide/25.png" alt="OAuth 登录" />
            <GuideFigure src="/img/guide/26.png" alt="OAuth 授权" />
            <GuideFigure src="/img/guide/27.png" alt="登录成功" />
          </div>
          <Callout tone="tip">
            设备码通常 5 分钟内有效，过期后请在启动器中重新发起。
            授权后该设备会自动出现在 <code>/dashboard/security</code> 的「已授权设备」列表中，如发现陌生设备可一键吊销。
          </Callout>

          <h4>3. 通过微软账户登录（正版玩家）</h4>
          <p>
            选择 <strong>「微软账户」</strong>，按照提示在浏览器中登录你的微软账号并授权 Minecraft 即可。
            注意此流程需要科学上网访问微软服务，过程与官方启动器相同。
          </p>

          <h4>4. 通过离线登录</h4>
          <p>
            如果你没有像素北科账号，可以暂时选择 <strong>「离线登录」</strong> 输入任意游戏 ID 进入游戏。
            但要游玩像素北科服务器，请确保该 ID 与你在官网创建的角色名一致，否则会因认证失败而无法进入。
          </p>

          <SubHeader id="ustbl-instance">四、创建与配置实例</SubHeader>
          <p>
            实例（Instance）相当于一组独立的游戏配置：版本、模组加载器、内存、Java 等参数。
            一个实例对应一个独立的 <code>.minecraft</code> 子目录。
          </p>

          <h4>1. 创建新实例</h4>
          <p>进入 <strong>实例</strong> 页面，点击 <strong>「添加与导入 → 安装新实例」</strong>。依次填写：</p>
          <ul>
            <li><strong>游戏版本</strong>：根据你要玩的服务器选择（如 <code>1.21.1</code>）。像素北科主服推荐 <code>1.21.x</code>。</li>
            <li><strong>模组加载器</strong>：根据整合包的要求选择 <code>Vanilla</code> / <code>Fabric</code> / <code>Forge</code> / <code>NeoForge</code>，不确定时先选 <code>Vanilla</code>。</li>
            <li><strong>实例名</strong>：建议使用能直接看出主题的名字，如 <code>ustb-休闲</code>、<code>ustb-模组</code>。</li>
            <li><strong>实例描述</strong>：简单介绍这个实例。</li>
            <li><strong>图标</strong>（可选）：从本地选一张图片作为实例卡片缩略图。</li>
          </ul>
          <p>填好后点击 <strong>「创建」</strong>，USTBL 会自动从 Mojang 官方下载游戏文件并完成安装。</p>

          <h4>2. 调整实例设置</h4>
          <p>在实例列表中点击实例右上角的 <strong>「设置」</strong> 按钮，可以调整：</p>
          <div className="guide-table-wrap">
            <table>
              <thead>
                <tr><th>设置项</th><th>推荐值</th><th>说明</th></tr>
              </thead>
              <tbody>
                <tr><td>Java 路径</td><td>自动选择</td><td>启动器会自动选择对应版本的 Java</td></tr>
                <tr><td>内存分配</td><td>4096 MB 或自动</td><td>模组服推荐 6144 MB 以上</td></tr>
                <tr><td>游戏窗口标题</td><td>留空</td><td>使用实例名作为窗口标题</td></tr>
                <tr><td>启动前检查 Java</td><td>开启</td><td>防止 Java 不匹配导致崩溃</td></tr>
                <tr><td>游戏分辨率</td><td>854×480 或全屏</td><td>根据显示器自行选择</td></tr>
              </tbody>
            </table>
          </div>

          <h4>3. 一键导入整合包</h4>
          <p>如果你已经从其他地方或者启动器的「发现」页面下载了 <code>.mrpack</code> 整合包（详见下一节），可以把整合包文件 <strong>拖拽</strong> 到 USTBL 的实例列表中，效果相同。</p>
          <GuideFigure src="/img/guide/28.png" alt="导入整合包" />

          <SubHeader id="ustbl-discover">五、使用「发现」页面</SubHeader>
          <p>「发现」页是 USTBL 启动器相比通用启动器最大的特色之一。它会从像素北科官网拉取最新内容，分为两个标签：</p>

          <h4>1. 社团新闻</h4>
          <p>
            展示像素北科工作坊发布的最新动态、活动公告与教程文章。
            点击任一文章可以在启动器内查看正文，重要公告请认真阅读。
          </p>
          <GuideFigure src="/img/guide/29.png" alt="发现 — 社团新闻" />

          <h4>2. 整合包</h4>
          <p>这是玩像素北科服务器最常用的入口：</p>
          <ul>
            <li>浏览 Xplus 或 USTB 官方发布的整合包（如「主服整合包」、「模组服整合包」、「休闲服整合包」等）。</li>
            <li>每个整合包卡片会显示 <strong>服务器名称、版本号、模组加载器、大小、更新日期</strong> 等信息。</li>
            <li>点击 <strong>「下载」</strong> 按钮即可下载 <code>.mrpack</code> 整合包文件；下载完成后点击 <strong>「导入」</strong> 自动创建实例。</li>
          </ul>
          <div className="guide-figure-grid">
            <GuideFigure src="/img/guide/30.png" alt="发现 — 整合包列表" />
            <GuideFigure src="/img/guide/31.png" alt="整合包详情" />
            <GuideFigure src="/img/guide/32.png" alt="整合包导入" />
          </div>

          <SubHeader id="ustbl-launch">六、启动游戏</SubHeader>
          <p>
            完成上面所有步骤后，回到 <strong>实例</strong> 页面，点击目标实例卡片上的 <strong>「启动实例」</strong> 按钮。
            USTBL 会进行最后的环境检查（Java、版本完整性、文件占用等），几秒后游戏窗口就会弹出。
            游戏加载完毕即可在多人游戏列表中看到之前添加的服务器，双击进入即可。
          </p>
          <GuideFigure src="/img/guide/33.png" alt="启动实例" />

          <SubHeader id="ustbl-faq">七、常见问题</SubHeader>
          <ol>
            <li>
              <strong>OAuth 登录时浏览器一直转圈 / 显示超时</strong>
              <ul>
                <li>多为代理或网络问题。先确认你能正常打开 <code>https://www.ustb.world/</code>，再重新发起设备码。</li>
              </ul>
            </li>
            <li>
              <strong>「未找到该 ID 对应的角色」</strong>
              <ul>
                <li>说明你在官网 <code>/dashboard/roles</code> 还没有创建游戏角色。先到官网创建至少一个角色，并保证角色名与启动器登录的 ID 一致。</li>
              </ul>
            </li>
            <li>
              <strong>整合包导入后游戏崩溃</strong>
              <ul>
                <li>检查 Java 版本是否匹配（模组服通常需要 Java 17 或 21）。</li>
                <li>在实例设置中把「内存分配」调高到 6144 MB。</li>
                <li>仍崩溃时，可在 <code>/dynamics</code> 文章中搜索该整合包对应的「已知问题」列表。</li>
              </ul>
            </li>
          </ol>

          {/* ============================================================
           * Chapter 04 — Servers
           * ========================================================== */}
          <SectionHeader
            id="servers"
            number="04"
            title="如何游玩 USTB Servers 服务器"
            summary="从打开官网到进入服务器：服务器列表、连接方式与首次进服须知。"
            accent="#eab308"
          />
          <blockquote>
            <p>本章节面向已经准备好 USTBL 启动器、并完成账号注册的同学，将完整演示「从打开官网到进入服务器」的全过程。</p>
          </blockquote>

          <SubHeader id="srv-list">一、当前可玩的服务器</SubHeader>
          <p>像素北科目前在 <code>/servers</code> 页面提供如下服务器（请以官网实时状态为准）：</p>
          <div className="guide-table-wrap">
            <table>
              <thead>
                <tr><th>标签</th><th>域名</th><th>主题 / 版本</th><th>适合人群</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>主服</td>
                  <td><code>mc.ustb.world</code></td>
                  <td>Java Edition 1.21.11</td>
                  <td>想体验完整像素北科校园的官方玩家</td>
                </tr>
                <tr>
                  <td>模组服</td>
                  <td><code>mod.ustb.world</code></td>
                  <td>主题：重度机械症</td>
                  <td>喜欢科技、模组玩法的同学</td>
                </tr>
                <tr>
                  <td>休闲服</td>
                  <td><code>utb.ustb.world</code></td>
                  <td>主题：乌托邦探险之旅</td>
                  <td>喜欢轻量休闲玩法与剧情向探索的同学</td>
                </tr>
              </tbody>
            </table>
          </div>
          <Callout tone="tip">
            <strong>建议：</strong>对新手玩家而言，<strong>主服</strong> 是最简单的入门选择。
            <strong>模组服</strong> 和 <strong>休闲服</strong> 需要先下载对应的整合包，请确认你的电脑性能能够流畅运行后再尝试。
          </Callout>

          <SubHeader id="srv-prep">二、连接前的准备</SubHeader>
          <Callout tone="info">
            如果已有并登录正版账号，则可不必再使用 USTBL 皮肤站账号。
          </Callout>
          <ol>
            <li>
              <strong>注册并登录像素北科账号</strong>：访问 <a href="https://www.ustb.world/register" target="_blank" rel="noreferrer"><code>https://www.ustb.world/register</code></a> 注册账号；
              注册成功后到 <code>/dashboard/roles</code> 创建一个游戏角色（角色名 = 你在游戏里的 ID）。
            </li>
            <li><strong>下载并安装 USTBL 启动器</strong>：参见上一章节。</li>
            <li><strong>在 USTBL 中添加 OAuth 账号</strong>（或离线账号，但 ID 必须与角色名一致）。</li>
            <li>
              <strong>保证网络通畅</strong>：在 <code>mc.ustb.world</code>、<code>mod.ustb.world</code>、<code>utb.ustb.world</code> 三个域名上至少能 ping 通。
              如果使用校园网一般都能直连。
            </li>
          </ol>

          <SubHeader id="srv-add">三、添加服务器</SubHeader>
          <p>
            如果你想用其他启动器（如官方启动器、HMCL、PCL2）连接，
            或想用自己已经调好的实例连接 USTB Servers，可以采用「手动添加服务器」的方式。
          </p>
          <ol>
            <li>打开游戏，进入 <strong>多人游戏</strong> 页面。</li>
            <li>点击 <strong>「添加服务器」</strong>。</li>
            <li>填写：
              <ul>
                <li><strong>服务器名称</strong>：任意，例如 <code>USTB-主服</code>。</li>
                <li><strong>服务器地址</strong>：根据上表填写，例如 <code>mc.ustb.world</code>。</li>
              </ul>
            </li>
            <li>点击 <strong>「保存」</strong>，服务器会出现在列表中。</li>
            <li>双击加入即可。</li>
          </ol>

          <p className="guide-end-note">🎉 教程到此结束 —— 祝你游玩愉快！</p>
        </main>
      </div>
    </div>
  );
}
