'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { MCCard } from '@/components/servers/mc-card';
import { mapMcStatusRow, formatRelativeTime, McStatus } from '@/lib/mc-status';
import { Wifi, WifiOff } from 'lucide-react';

const POLL_INTERVAL_MS = 125_000;

type ServerGroupConfig = {
  label: string;
  address: string;
  subs?: { name: string; address: string }[];
};

const SERVER_GROUPS: ServerGroupConfig[] = [
  {
    label: '主服',
    address: 'mc.ustb.world',
    subs: [
      { name: '主服', address: '47.94.48.113:12002' },
      { name: '建筑服', address: '47.94.48.113:12003' },
      { name: '像素北科服务器', address: '47.94.48.113:12006' },
    ],
  },
  {
    label: '模组服',
    address: 'mod.ustb.world',
  },
];

export default function ServersPage() {
  const [statuses, setStatuses] = useState<McStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const loadStatuses = useCallback(async () => {
    try {
      const r = await api.get<Record<string, unknown>[]>('/mc-servers/statuses');
      setStatuses(r.data.map(mapMcStatusRow));
    } catch {
      setStatuses([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatuses();
    const timer = setInterval(loadStatuses, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [loadStatuses]);

  const statusMap = new Map<string, McStatus>();
  for (const s of statuses) {
    if (s.address) statusMap.set(s.address, s);
  }

  const onlineCount = statuses.filter((s) => s.server_status === 'online').length;
  const lastUpdated = statuses
    .map((s) => s.last_update)
    .filter((v): v is string => Boolean(v))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];

  return (
    <div className="container py-8">
      <div className="max-w-6xl mx-auto">
        {/* Hero */}
        <section className="glass-card p-6 md:p-8 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-[1.6fr_0.9fr] gap-6">
            <div>
              <p className="section-kicker">Server Status</p>
              <h1 className="text-4xl md:text-5xl font-bold mt-1" style={{ color: 'var(--theme-text-strong, var(--color-heading))' }}>
                服务器列表
              </h1>
              <p className="mt-2" style={{ color: 'var(--color-text-light)' }}>
                像素北科 Minecraft 服务器在线状态
              </p>
              <p className="mt-4">
                <a
                  href="https://github.com/LYOfficial/USTBL/releases"
                  target="_blank"
                  rel="noreferrer"
                  className="mc-download-link"
                >
                  下载 USTBL 启动器
                </a>
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 self-start">
              <div className="surface-card p-4 text-center">
                <span className="section-kicker">节点总数</span>
                <strong className="text-2xl block mt-1" style={{ color: 'var(--color-heading)' }}>{statuses.length}</strong>
                <p className="text-xs mt-1" style={{ color: 'var(--color-text-light)' }}>当前服务器记录</p>
              </div>
              <div className="surface-card p-4 text-center" style={{ borderColor: 'var(--color-primary)', borderWidth: 2 }}>
                <span className="section-kicker">在线节点</span>
                <strong className="text-2xl block mt-1" style={{ color: 'var(--color-primary)' }}>{onlineCount}</strong>
                <p className="text-xs mt-1" style={{ color: 'var(--color-text-light)' }}>最近刷新 {formatRelativeTime(lastUpdated)}</p>
              </div>
            </div>
          </div>
        </section>

        {/* Server Groups */}
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="servers-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 540px))' }}>
            {SERVER_GROUPS.map((group) => {
              const mainStatus = statusMap.get(group.address);
              const isOnline = mainStatus?.server_status === 'online';

              return (
                <div key={group.address} className="mc-group-card">
                  {/* Main server info */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <h3 className="mc-group-title">{group.label}</h3>
                    <span className={`mc-status-pill ${isOnline ? 'online' : 'offline'}`}>
                      {isOnline ? <><Wifi className="w-3 h-3" /> 在线</> : <><WifiOff className="w-3 h-3" /> 离线</>}
                    </span>
                  </div>
                  <p className="mc-group-ip">{group.address}</p>

                  {mainStatus && (
                    <>
                      {/* MOTD */}
                      {mainStatus.motdSegments && mainStatus.motdSegments.length > 0 && (
                        <div className="mc-card-motd">
                          <p className="mc-motd-text">
                            {mainStatus.motdSegments.map((seg, i) => (
                              <span key={i} style={getMotdSegmentStyle(seg)}>{seg.text}</span>
                            ))}
                          </p>
                        </div>
                      )}

                      {/* Metrics */}
                      <div className="mc-card-metrics">
                        <div className="mc-metric">
                          <span className="mc-metric-label">在线玩家</span>
                          <strong>{mainStatus.players_online ?? '—'} / {mainStatus.players_max ?? '—'}</strong>
                        </div>
                        <div className="mc-metric">
                          <span className="mc-metric-label">延迟</span>
                          <strong>{mainStatus.connect_ms ?? '—'} ms</strong>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Sub-servers */}
                  {group.subs && group.subs.length > 0 && (
                    <div className="mc-group-subs">
                      <p className="mc-group-subs-title">下设服务器</p>
                      {group.subs.map((sub) => {
                        const subStatus = statusMap.get(sub.address);
                        const subOnline = subStatus?.server_status === 'online';
                        return (
                          <div key={sub.address} className="mc-sub-card">
                            <span className="mc-sub-card-name">{sub.name}</span>
                            <span className={`mc-status-pill ${subOnline ? 'online' : 'offline'}`}>
                              {subOnline ? <><Wifi className="w-3 h-3" /> 在线</> : <><WifiOff className="w-3 h-3" /> 离线</>}
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
  );
}

function getMotdSegmentStyle(seg: { text: string; color?: string | null; bold?: boolean; italic?: boolean; underlined?: boolean; strikethrough?: boolean }): React.CSSProperties {
  const textDecoration = [
    seg.underlined ? 'underline' : '',
    seg.strikethrough ? 'line-through' : '',
  ].filter(Boolean).join(' ');

  return {
    color: seg.color ?? undefined,
    fontWeight: seg.bold ? '700' : undefined,
    fontStyle: seg.italic ? 'italic' : undefined,
    textDecoration: textDecoration || undefined,
  };
}
