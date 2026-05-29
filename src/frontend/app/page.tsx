'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useUserStore } from '@/stores/user';
import { api } from '@/lib/api';
import { HeroCarousel } from '@/components/home/hero-carousel';
import { ArrowRight, Users, Wifi, WifiOff } from 'lucide-react';

type SiteSettings = {
  site_name?: string;
  site_title?: string;
  site_subtitle?: string;
};

type ServerStatus = {
  id: number;
  name: string;
  address?: string;
  status?: string;
  players_online?: number;
  players_max?: number;
  version?: string;
  motd?: string;
  icon?: string;
};

export default function HomePage() {
  const { user, loaded, hydrate } = useUserStore();
  const [settings, setSettings] = useState<SiteSettings>({});
  const [servers, setServers] = useState<ServerStatus[]>([]);

  useEffect(() => { hydrate(); }, [hydrate]);

  useEffect(() => {
    api.get<SiteSettings>('/public/settings')
      .then((r) => setSettings(r.data))
      .catch(() => {});

    api.get<ServerStatus[]>('/mc-servers/statuses')
      .then((r) => setServers(r.data))
      .catch(() => {});
  }, []);

  const siteName = settings.site_title || settings.site_name || '像素北科';
  const siteSubtitle = settings.site_subtitle || '简洁、高效、现代的 Minecraft 社区';
  const onlineCount = servers.filter((s) => s.status === 'online').length;

  return (
    <>
      {/* Hero Section — vSkin HomeView */}
      <div className="home-container">
        <HeroCarousel />

        <div className="hero-section">
          <div className="hero-content animate-fade-in">
            <h1 className="hero-title">{siteName}</h1>
            <p className="hero-subtitle">{siteSubtitle}</p>
            <div className="hero-actions">
              {loaded && user ? (
                <Link href="/dashboard" className="hero-btn hero-btn-primary">
                  进入个人面板
                </Link>
              ) : (
                <>
                  <Link href="/login" className="hero-btn hero-btn-primary">
                    登录账号
                  </Link>
                  <Link href="/register" className="hero-btn hero-btn-secondary">
                    即刻注册
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Server Summary Section — USTB McServers */}
      <section className="container py-16">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
            <div>
              <p className="section-kicker">Server Status</p>
              <h2 className="text-3xl md:text-4xl font-bold mt-1" style={{ color: 'var(--color-heading)' }}>
                服务器列表
              </h2>
              <p className="mt-2" style={{ color: 'var(--color-text-light)' }}>
                像素北科 Minecraft 服务器在线状态
              </p>
            </div>
            <div className="flex gap-3">
              <div className="surface-card p-4 text-center min-w-[120px]">
                <p className="section-kicker">节点总数</p>
                <p className="text-2xl font-bold mt-1" style={{ color: 'var(--color-heading)' }}>{servers.length}</p>
              </div>
              <div className="surface-card p-4 text-center min-w-[120px]" style={{ borderColor: 'var(--color-primary)', borderWidth: 2 }}>
                <p className="section-kicker">在线节点</p>
                <p className="text-2xl font-bold mt-1" style={{ color: 'var(--color-primary)' }}>{onlineCount}</p>
              </div>
            </div>
          </div>

          {servers.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {servers.slice(0, 6).map((s) => (
                <ServerStatusCard key={s.id} server={s} />
              ))}
            </div>
          ) : (
            <p style={{ color: 'var(--color-text-light)' }}>暂无服务器状态，等待后端缓存写入。</p>
          )}

          {servers.length > 6 && (
            <div className="mt-6 text-center">
              <Link href="/servers" className="btn-ghost inline-flex items-center gap-2">
                查看全部服务器 <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* Quick Entry Cards */}
      <section className="container pb-16">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
          <QuickCard href="/skin" icon={<PaletteIcon />} title="皮肤站" desc="完整 Yggdrasil 协议支持，自定义皮肤与披风" accent="var(--color-primary)" />
          <QuickCard href="/campus" icon={<MapIcon />} title="3D 校园游览" desc="像素重建北科校园，浏览器即可漫游" accent="#5DCEDA" />
          <QuickCard href="/about" icon={<Users className="w-8 h-8" />} title="加入我们" desc="了解像素北科，成为社区的一员" accent="#E8923C" />
        </div>
      </section>
    </>
  );
}

function ServerStatusCard({ server }: { server: ServerStatus }) {
  const isOnline = server.status === 'online';
  return (
    <div className="surface-card hoverable p-4">
      <div className="flex items-center gap-3 mb-3">
        {server.icon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={server.icon} alt="" className="w-10 h-10 rounded-full border-2 object-cover" style={{ borderColor: 'var(--color-border)' }} />
        ) : (
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: 'var(--color-primary)' }}>MC</div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold truncate" style={{ color: 'var(--color-heading)' }}>{server.name}</h3>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${isOnline ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-800/30 dark:text-gray-400'}`}>
              {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {isOnline ? '在线' : '离线'}
            </span>
          </div>
          <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--color-text-light)' }}>
            {server.version || '未知版本'} {server.address ? `· ${server.address}` : ''}
          </p>
        </div>
      </div>
      {server.motd && (
        <p className="text-xs mb-2 truncate" style={{ color: 'var(--color-text-light)' }}>{server.motd}</p>
      )}
      <div className="flex items-center justify-between text-xs" style={{ color: 'var(--color-text-light)' }}>
        <span>玩家 {server.players_online ?? '—'} / {server.players_max ?? '—'}</span>
      </div>
    </div>
  );
}

function QuickCard({ href, icon, title, desc, accent }: { href: string; icon: React.ReactNode; title: string; desc: string; accent: string }) {
  return (
    <Link href={href} className="surface-card hoverable p-6 group block">
      <div className="mb-4" style={{ color: accent }}>{icon}</div>
      <h3 className="text-lg font-semibold mb-2 group-hover:underline" style={{ color: 'var(--color-heading)' }}>{title}</h3>
      <p className="text-sm" style={{ color: 'var(--color-text-light)' }}>{desc}</p>
    </Link>
  );
}

function PaletteIcon() {
  return (
    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.5" cy="6.5" r="2" /><circle cx="17.5" cy="10.5" r="2" /><circle cx="8.5" cy="7.5" r="2" /><circle cx="6.5" cy="12.5" r="2" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
    </svg>
  );
}

function MapIcon() {
  return (
    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
      <line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="22" />
    </svg>
  );
}
