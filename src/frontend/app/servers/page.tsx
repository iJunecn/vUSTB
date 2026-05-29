'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { MCCard } from '@/components/servers/mc-card';
import { mapMcStatusRow, formatRelativeTime, McStatus } from '@/lib/mc-status';

const POLL_INTERVAL_MS = 125_000;

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

  const onlineCount = statuses.filter((s) => s.server_status === 'online').length;
  const lastUpdated = statuses
    .map((s) => s.last_update)
    .filter((v): v is string => Boolean(v))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];

  return (
    <div className="container py-8">
      <div className="max-w-6xl mx-auto">
        {/* Hero — USTB McServers pattern */}
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

        {/* Server Grid */}
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : statuses.length > 0 ? (
          <div className="servers-grid">
            {statuses.map((s) => (
              <MCCard key={s.id ?? s.address ?? s.name} {...s} />
            ))}
          </div>
        ) : (
          <p className="text-center py-12" style={{ color: 'var(--color-text-light)' }}>
            暂无服务器状态，等待后端缓存写入后会在这里展示。
          </p>
        )}
      </div>
    </div>
  );
}
