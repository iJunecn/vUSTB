'use client';

import { useEffect, useState } from 'react';
import { useUserStore } from '@/stores/user';
import { rawApi } from '@/lib/api';
import { Shirt, Users, Copy, MousePointerClick, Check, Loader2, AlertTriangle, RefreshCw, Coins, CalendarCheck } from 'lucide-react';

type MojangStatusUrls = {
  session: string;
  account: string;
  services: string;
};

type PublicSettings = {
  site_url?: string;
  site_name?: string;
  site_title?: string;
  mojang_status_urls?: MojangStatusUrls;
};

export default function DashboardHome() {
  const user = useUserStore((s) => s.user);
  const [textureCount, setTextureCount] = useState(0);
  const [profileCount, setProfileCount] = useState(0);
  const [pixelPoints, setPixelPoints] = useState(0);
  const [shellPoints, setShellPoints] = useState(0);
  const [lastCheckin, setLastCheckin] = useState<string | null>(null);
  const [checkinLoading, setCheckinLoading] = useState(false);
  const [checkinMessage, setCheckinMessage] = useState<string | null>(null);
  const [apiUrl, setApiUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [mojangUrls, setMojangUrls] = useState<MojangStatusUrls | null>(null);
  const [mojangHealth, setMojangHealth] = useState<Record<string, 'checking' | 'online' | 'offline'>>({});
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);

  useEffect(() => {
    // Load public settings
    rawApi.get<PublicSettings>('/api/public/settings').then((r) => {
      const data = r.data;
      const base = (data.site_url || window.location.origin).replace(/\/$/, '');
      setApiUrl(`${base}/skinapi/`);
      if (data.mojang_status_urls) {
        setMojangUrls(data.mojang_status_urls);
      }
    }).catch(() => {
      setApiUrl(`${window.location.origin}/skinapi/`);
    });

    // Load personal stats
    if (user) {
      rawApi.get<any[]>('/api/me/textures').then((r) => {
        setTextureCount(r.data.length);
      }).catch(() => {});

      rawApi.get<any>('/api/me').then((r) => {
        if (r.data?.profiles) {
          setProfileCount(r.data.profiles.length);
        }
      }).catch(() => {});

      rawApi.get<any[]>('/api/players').then((r) => {
        setProfileCount(r.data.length);
      }).catch(() => {});

      // Load points
      rawApi.get<{ pixel_points: number; shell_points: number; last_checkin: string | null }>('/api/points/account').then((r) => {
        setPixelPoints(r.data.pixel_points);
        setShellPoints(r.data.shell_points);
        setLastCheckin(r.data.last_checkin);
      }).catch(() => {});
    }
  }, [user]);

  async function handleCheckin() {
    setCheckinLoading(true);
    setCheckinMessage(null);
    try {
      const r = await rawApi.post('/api/points/checkin');
      setPixelPoints(r.data.pixel_points);
      setLastCheckin(new Date().toISOString());
      setCheckinMessage(r.data.message || '签到成功！');
    } catch (err: any) {
      const detail = err?.response?.data?.detail || '签到失败';
      setCheckinMessage(detail);
    } finally {
      setCheckinLoading(false);
    }
  }

  async function copyApiUrl() {
    if (!apiUrl) return;
    try {
      await navigator.clipboard.writeText(apiUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = apiUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  async function checkMojangStatus() {
    if (!mojangUrls) return;
    setIsCheckingStatus(true);
    const health: Record<string, 'checking' | 'online' | 'offline'> = {};

    for (const [key, url] of Object.entries(mojangUrls)) {
      health[key] = 'checking';
      setMojangHealth({ ...health });
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        await fetch(url, { mode: 'no-cors', signal: controller.signal });
        clearTimeout(timeoutId);
        health[key] = 'online';
      } catch {
        health[key] = 'offline';
      }
      setMojangHealth({ ...health });
    }
    setIsCheckingStatus(false);
  }

  useEffect(() => {
    if (mojangUrls) checkMojangStatus();
  }, [mojangUrls]);

  // 判断今天是否已签到（北京时间 UTC+8）
  const alreadyCheckedIn = (() => {
    if (!lastCheckin) return false;
    const now = new Date();
    const bjOffset = 8 * 60;
    const nowBj = new Date(now.getTime() + (bjOffset + now.getTimezoneOffset()) * 60000);
    const lastBj = new Date(new Date(lastCheckin).getTime() + (bjOffset + new Date(lastCheckin).getTimezoneOffset()) * 60000);
    return nowBj.toDateString() === lastBj.toDateString();
  })();

  if (!user) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      {/* Welcome header */}
      <div>
        <p className="section-kicker" style={{ marginBottom: 8 }}>DASHBOARD</p>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-heading)', margin: 0 }}>
          欢迎回来, {user.display_name || user.username}
        </h1>
        <p style={{ fontSize: 15, color: 'var(--color-text-light)', marginTop: 4 }}>
          在这里管理你的账户、皮肤与 Minecraft 角色。
        </p>
      </div>

      {/* Stats cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        <StatsCard
          label="像素积分"
          value={pixelPoints}
          icon={<Coins style={{ width: 28, height: 28 }} />}
          gradientClass="bg-gradient-purple"
        />
        <StatsCard
          label="贝壳积分"
          value={shellPoints}
          icon={<Coins style={{ width: 28, height: 28 }} />}
          gradientClass="bg-gradient-blue"
        />
        <StatsCard
          label="材质数量"
          value={textureCount}
          icon={<Shirt style={{ width: 28, height: 28 }} />}
          gradientClass="bg-gradient-purple"
        />
        <StatsCard
          label="角色数量"
          value={profileCount}
          icon={<Users style={{ width: 28, height: 28 }} />}
          gradientClass="bg-gradient-blue"
        />
      </div>

      {/* Daily checkin */}
      <div className="surface-card" style={{ padding: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-heading)', margin: '0 0 4px 0' }}>
            每日签到
          </h2>
          <p style={{ fontSize: 14, color: 'var(--color-text-light)', margin: 0 }}>
            每天签到可获得 2 像素积分
          </p>
          {checkinMessage && (
            <p style={{ fontSize: 13, color: checkinMessage.includes('成功') ? '#22c55e' : '#ef4444', margin: '4px 0 0', fontWeight: 500 }}>
              {checkinMessage}
            </p>
          )}
        </div>
        <button
          onClick={handleCheckin}
          disabled={checkinLoading || alreadyCheckedIn}
          className={alreadyCheckedIn ? 'btn-ghost' : 'btn-primary'}
          style={{
            padding: '10px 24px', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8,
            opacity: alreadyCheckedIn ? 0.5 : 1,
          }}
        >
          {checkinLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : alreadyCheckedIn ? <Check style={{ width: 18, height: 18 }} /> : <CalendarCheck style={{ width: 18, height: 18 }} />}
          {alreadyCheckedIn ? '已签到' : '签到'}
        </button>
      </div>

      {/* Quick Config Section */}
      <div className="surface-card" style={{ padding: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-heading)', margin: '0 0 16px 0' }}>
          快速配置启动器
        </h2>
        <p style={{ fontSize: 14, color: 'var(--color-text-light)', marginBottom: 16, textAlign: 'center' }}>
          将下方的 API 地址复制到您的启动器，或直接拖动"添加到启动器"按钮到支持 authlib-injector 的启动器窗口中。
        </p>
        <div style={{ display: 'flex', gap: 8, maxWidth: 500, margin: '0 auto 16px', width: '100%' }}>
          <input
            value={apiUrl}
            readOnly
            className="input"
            style={{ flex: 1, fontFamily: 'monospace', fontSize: 13 }}
          />
          <button onClick={copyApiUrl} className="btn-primary" style={{ padding: '8px 16px', fontSize: 13, whiteSpace: 'nowrap' }}>
            {copied ? <Check style={{ width: 14, height: 14 }} /> : <Copy style={{ width: 14, height: 14 }} />}
            {copied ? '已复制' : '复制'}
          </button>
        </div>
        <div style={{ textAlign: 'center' }}>
          <a
            href={`authlib-injector:yggdrasil-server:${encodeURIComponent(apiUrl)}`}
            className="btn-primary"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '10px 24px', borderRadius: 24, fontSize: 14, fontWeight: 500,
              textDecoration: 'none', transition: 'transform 0.2s',
            }}
            title="拖动我到启动器"
          >
            <MousePointerClick style={{ width: 16, height: 16 }} />
            拖拽添加到启动器
          </a>
        </div>
      </div>

      {/* Mojang Status Section */}
      {mojangUrls && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: 20, fontWeight: 600, color: 'var(--color-heading)', margin: 0 }}>
              Mojang 服务状态
            </h2>
            <button
              onClick={checkMojangStatus}
              disabled={isCheckingStatus}
              className="btn-ghost"
              style={{ padding: '6px 12px', fontSize: 13 }}
            >
              {isCheckingStatus ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw style={{ width: 14, height: 14 }} />}
              刷新
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            {Object.entries(mojangUrls).map(([key, _]) => {
              const status = mojangHealth[key] || 'checking';
              return (
                <div key={key} className="surface-card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>{key.toUpperCase()} API</span>
                  <span
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 500,
                      color: status === 'online' ? '#22c55e' : status === 'checking' ? '#eab308' : '#ef4444',
                    }}
                  >
                    {status === 'online' ? <Check style={{ width: 14, height: 14 }} /> :
                     status === 'checking' ? <Loader2 className="w-4 h-4 animate-spin" /> :
                     <AlertTriangle style={{ width: 14, height: 14 }} />}
                    {status === 'online' ? '在线' : status === 'checking' ? '检查中...' : '连接超时'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function StatsCard({
  label,
  value,
  icon,
  gradientClass,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  gradientClass: string;
}) {
  return (
    <div className="surface-card">
      <div className="stats-card-content">
        <div className={`stats-card-icon ${gradientClass}`}>
          {icon}
        </div>
        <div className="stats-card-info">
          <span className="stats-card-label">{label}</span>
          <span className="stats-card-value">{value}</span>
        </div>
      </div>
    </div>
  );
}
