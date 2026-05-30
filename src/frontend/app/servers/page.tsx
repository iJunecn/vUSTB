'use client';

import { useEffect, useState, useCallback } from 'react';
import { queryMotdApi, formatRelativeTime, McStatus, getMotdSegmentStyle, normalizeIconSrc } from '@/lib/mc-status';
import { Wifi, WifiOff } from 'lucide-react';

const POLL_INTERVAL_MS = 125_000;

type ServerGroupConfig = {
  label: string;
  address: string;
  port?: number;
  versionOverride?: string;
  themeOverride?: string;
  subs?: { name: string; address: string; port?: number }[];
};

const SERVER_GROUPS: ServerGroupConfig[] = [
  {
    label: '主服',
    address: 'mc.ustb.world',
    versionOverride: 'Java Edition 1.21.11',
    subs: [
      { name: '主服', address: '47.94.48.113', port: 12002 },
      { name: '建筑服', address: '47.94.48.113', port: 12003 },
      { name: '像素北科服务器', address: '47.94.48.113', port: 12006 },
    ],
  },
  {
    label: '模组服',
    address: 'mod.ustb.world',
    themeOverride: '重度机械症',
  },
];

export default function ServersPage() {
  const [mainStatuses, setMainStatuses] = useState<Map<string, McStatus>>(new Map());
  const [subStatuses, setSubStatuses] = useState<Map<string, McStatus>>(new Map());
  const [loading, setLoading] = useState(true);

  const loadStatuses = useCallback(async () => {
    const newMain = new Map<string, McStatus>();
    const newSub = new Map<string, McStatus>();

    const mainPromises = SERVER_GROUPS.map(async (group) => {
      const status = await queryMotdApi(group.address, group.port);
      newMain.set(group.address, status);
    });

    const subPromises = SERVER_GROUPS.flatMap((group) =>
      (group.subs ?? []).map(async (sub) => {
        const key = `${sub.address}:${sub.port ?? 25565}`;
        const status = await queryMotdApi(sub.address, sub.port);
        newSub.set(key, status);
      })
    );

    await Promise.all([...mainPromises, ...subPromises]);

    setMainStatuses(newMain);
    setSubStatuses(newSub);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadStatuses();
    const timer = setInterval(loadStatuses, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [loadStatuses]);

  const allStatuses = [...mainStatuses.values(), ...subStatuses.values()];
  const onlineCount = allStatuses.filter((s) => s.server_status === 'online').length;
  const totalCount = allStatuses.length;
  const lastUpdated = allStatuses
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
              <p className="section-kicker" style={{ marginBottom: 4, color: 'rgba(255,255,255,0.7)' }}>SERVER STATUS</p>
              <h1 style={{ fontSize: 24, fontWeight: 700, color: '#fff', margin: 0 }}>
                服务器列表
              </h1>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ padding: '4px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.85)' }}>
                {onlineCount}/{totalCount} 在线
              </span>
              {lastUpdated && (
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
                  {formatRelativeTime(lastUpdated)}
                </span>
              )}
            </div>
          </div>

          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 4 }}>
            <a
              href="https://github.com/LYOfficial/USTBL/releases"
              target="_blank"
              rel="noreferrer"
              style={{ color: 'rgba(255,255,255,0.85)', textDecoration: 'underline', textUnderlineOffset: 2 }}
            >
              下载 USTBL 启动器
            </a>
          </p>

          {/* Server cards */}
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
              {SERVER_GROUPS.map((group) => {
                const mainStatus = mainStatuses.get(group.address);
                const isOnline = mainStatus?.server_status === 'online';
                const iconSrc = normalizeIconSrc(mainStatus?.icon);

                return (
                  <div key={group.address} style={{ padding: 14, borderRadius: 10, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)' }}>
                    {/* Main server row */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        {iconSrc ? (
                          <img src={iconSrc} alt="" style={{ width: 28, height: 28, borderRadius: '50%', border: '1.5px solid rgba(255,255,255,0.2)', objectFit: 'cover', flexShrink: 0 }} />
                        ) : (
                          <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'rgba(255,255,255,0.5)', flexShrink: 0 }}>MC</div>
                        )}
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{group.label}</span>
                            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>{group.address}{group.port ? `:${group.port}` : ''}</span>
                          </div>
                        </div>
                      </div>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: isOnline ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', color: isOnline ? '#4ade80' : '#f87171', flexShrink: 0 }}>
                        {isOnline ? <><Wifi style={{ width: 10, height: 10 }} /> 在线</> : <><WifiOff style={{ width: 10, height: 10 }} /> 离线</>}
                      </span>
                    </div>

                    {mainStatus && isOnline && (
                      <div style={{ marginTop: 8 }}>
                        {/* MOTD */}
                        {mainStatus.motdSegments && mainStatus.motdSegments.length > 0 && (
                          <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', margin: '0 0 4px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {mainStatus.motdSegments.map((seg, i) => (
                              <span key={i} style={getMotdSegmentStyle(seg)}>{seg.text}</span>
                            ))}
                          </p>
                        )}
                        {/* Metrics row */}
                        <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
                          <span>玩家 {mainStatus.players_online ?? '—'}/{mainStatus.players_max ?? '—'}</span>
                          <span>延迟 {mainStatus.connect_ms ?? '—'}ms</span>
                          {group.versionOverride && <span>{group.versionOverride}</span>}
                          {group.themeOverride && <span>主题：{group.themeOverride}</span>}
                          {!group.versionOverride && !group.themeOverride && mainStatus.version && (
                            <span>{mainStatus.type === 'java' ? 'Java' : 'Bedrock'} {mainStatus.version}</span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Version/theme when offline */}
                    {!(mainStatus && isOnline) && (
                      <div style={{ marginTop: 6, fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                        {group.versionOverride && <span>{group.versionOverride}</span>}
                        {group.themeOverride && <span>主题：{group.themeOverride}</span>}
                      </div>
                    )}

                    {/* Sub-servers */}
                    {group.subs && group.subs.length > 0 && (
                      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {group.subs.map((sub) => {
                          const key = `${sub.address}:${sub.port ?? 25565}`;
                          const subStatus = subStatuses.get(key);
                          const subOnline = subStatus?.server_status === 'online';
                          return (
                            <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.04)' }}>
                              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>{sub.name}</span>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 600, color: subOnline ? '#4ade80' : '#f87171' }}>
                                {subOnline ? <><Wifi style={{ width: 9, height: 9 }} /> 在线</> : <><WifiOff style={{ width: 9, height: 9 }} /> 离线</>}
                              </span>
                            </div>
                          );
                        })}
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
