'use client';

import { useEffect, useState, useCallback } from 'react';
import { formatRelativeTime, McStatus, getMotdSegmentStyle, normalizeIconSrc } from '@/lib/mc-status';
import { Wifi, WifiOff } from 'lucide-react';

const POLL_INTERVAL_MS = 125_000;

type ServerStatus = {
  id: number;
  name: string;
  address: string | null;
  icon_url: string | null;
  version_hint: string | null;
  theme: string | null;
  motd_segments: { text: string; styles?: string[] }[] | null;
  server_status: string;
  players_online: number | null;
  players_max: number | null;
  last_update: string | null;
  type: string | null;
  version: string | null;
  icon: string | null;
};

export default function ServersPage() {
  const [servers, setServers] = useState<ServerStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const loadServers = useCallback(async () => {
    try {
      const res = await fetch('/api/mc-servers/statuses');
      if (res.ok) {
        const data = await res.json();
        setServers(data);
      }
    } catch {
      // silently ignore fetch errors
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadServers();
    const timer = setInterval(loadServers, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [loadServers]);

  const onlineCount = servers.filter((s) => s.server_status === 'online').length;
  const totalCount = servers.length;
  const lastUpdated = servers
    .map((s) => s.last_update)
    .filter((v): v is string => Boolean(v))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];

  return (
    <div className="servers-page-container">
      {/* Background */}
      <div className="home-bg">
        <picture>
          <source srcSet="/img/background.webp" type="image/webp" />
          <img src="/img/background.jpg" alt="" />
        </picture>
      </div>
      <div className="home-bg-overlay" />

      {/* Content */}
      <div className="servers-page-content">
        <div className="servers-page-card">
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
            <div>
              <p className="section-kicker" style={{ marginBottom: 4 }}>SERVER STATUS</p>
              <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--color-heading)', margin: 0, letterSpacing: '-0.3px' }}>
                服务器列表
              </h1>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span
                style={{
                  padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                  background: 'color-mix(in srgb, var(--color-primary) 10%, transparent)',
                  color: 'var(--color-primary)',
                }}
              >
                {onlineCount}/{totalCount} 在线
              </span>
              {lastUpdated && (
                <span style={{ fontSize: 11, color: 'var(--color-text-light)' }}>
                  {formatRelativeTime(lastUpdated)}
                </span>
              )}
            </div>
          </div>

          {/* Server cards */}
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
              <div
                style={{
                  width: 20, height: 20,
                  border: '2px solid var(--color-border)',
                  borderTopColor: 'var(--color-primary)',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                }}
              />
            </div>
          ) : totalCount === 0 ? (
            <p style={{ textAlign: 'center', color: 'var(--color-text-light)', padding: '32px 0' }}>
              暂无服务器
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
              {servers.map((server) => {
                const isOnline = server.server_status === 'online';
                const iconSrc = normalizeIconSrc(server.icon);

                return (
                  <div
                    key={server.id}
                    style={{
                      padding: 14, borderRadius: 10,
                      background: 'var(--color-background-soft)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    {/* Main server row */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        {iconSrc ? (
                          <img src={iconSrc} alt="" style={{ width: 28, height: 28, borderRadius: '50%', border: '1.5px solid var(--color-border)', objectFit: 'cover', flexShrink: 0 }} />
                        ) : (
                          <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--color-background-mute)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--color-text-light)', flexShrink: 0 }}>MC</div>
                        )}
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-heading)' }}>{server.name}</span>
                            {server.address && <span style={{ fontSize: 11, color: 'var(--color-text-light)', fontFamily: 'monospace' }}>{server.address}</span>}
                          </div>
                        </div>
                      </div>
                      <span
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                          background: isOnline
                            ? 'color-mix(in srgb, #22c55e 15%, transparent)'
                            : 'color-mix(in srgb, #ef4444 15%, transparent)',
                          color: isOnline ? '#16a34a' : '#dc2626',
                          flexShrink: 0,
                        }}
                      >
                        {isOnline ? <><Wifi style={{ width: 10, height: 10 }} /> 在线</> : <><WifiOff style={{ width: 10, height: 10 }} /> 离线</>}
                      </span>
                    </div>

                    {isOnline && (
                      <div style={{ marginTop: 8 }}>
                        {/* MOTD */}
                        {server.motd_segments && server.motd_segments.length > 0 && (
                          <p style={{ fontSize: 11, color: 'var(--color-text)', margin: '0 0 4px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {server.motd_segments.map((seg, i) => (
                              <span key={i} style={getMotdSegmentStyle(seg)}>{seg.text}</span>
                            ))}
                          </p>
                        )}
                        {/* Metrics row */}
                        <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--color-text-light)', flexWrap: 'wrap' }}>
                          {server.version_hint && <span>{server.version_hint}</span>}
                          {server.theme && <span>主题：{server.theme}</span>}
                          {!server.version_hint && !server.theme && server.version && (
                            <span>{server.type === 'java' ? 'Java' : 'Bedrock'} {server.version}</span>
                          )}
                          {server.players_online !== null && server.players_max !== null && (
                            <span>玩家：{server.players_online}/{server.players_max}</span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Version/theme when offline */}
                    {!isOnline && (
                      <div style={{ marginTop: 6, fontSize: 11, color: 'var(--color-text-light)' }}>
                        {server.version_hint && <span>{server.version_hint}</span>}
                        {server.theme && <span>主题：{server.theme}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
