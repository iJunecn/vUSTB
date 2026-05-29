'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Loader2, Server, Users, Wifi, WifiOff } from 'lucide-react';

type ServerStatus = {
  id: number;
  name: string;
  address: string | null;
  icon_url: string | null;
  version_hint: string | null;
  status: {
    status: 'online' | 'offline' | 'unknown';
    type?: string;
    motd?: string;
    version?: string;
    players?: { online: number | null; max: number | null; sample?: string[] };
    delay_ms?: number;
  };
};

export default function ServersPage() {
  const [data, setData] = useState<ServerStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let aborted = false;
    api
      .get<ServerStatus[]>('/mc-servers/statuses')
      .then((r) => {
        if (!aborted) setData(r.data);
      })
      .catch((e) => {
        if (!aborted) setError(e?.message || '加载失败');
      })
      .finally(() => {
        if (!aborted) setLoading(false);
      });
    return () => {
      aborted = true;
    };
  }, []);

  return (
    <div className="container py-16 space-y-8">
      <header className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight">MC 服务器</h1>
        <p className="text-muted-foreground">像素北科旗下的 Minecraft 服务器列表与实时状态。</p>
      </header>

      {loading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> 正在加载服务器状态…
        </div>
      )}
      {error && <p className="text-destructive">{error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {data.map((s) => (
          <ServerCard key={s.id} s={s} />
        ))}
        {!loading && !error && data.length === 0 && (
          <p className="text-muted-foreground">暂无公开服务器。</p>
        )}
      </div>
    </div>
  );
}

function ServerCard({ s }: { s: ServerStatus }) {
  const online = s.status?.status === 'online';
  return (
    <div className="glass-card p-6 space-y-4">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center overflow-hidden">
          {s.icon_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={s.icon_url} alt="" className="w-full h-full object-cover" />
          ) : s.status.type === 'java' && (s.status as any).favicon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={(s.status as any).favicon} alt="" className="w-full h-full object-cover" />
          ) : (
            <Server className="w-6 h-6 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-xl font-semibold truncate">{s.name}</h3>
          {s.address && (
            <code className="text-xs text-muted-foreground break-all">{s.address}</code>
          )}
        </div>
        <span
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
            online ? 'bg-green-500/15 text-green-500' : 'bg-red-500/15 text-red-500'
          }`}
        >
          {online ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          {online ? '在线' : '离线'}
        </span>
      </div>

      {online && (
        <>
          {s.status.motd && (
            <p className="text-sm text-muted-foreground whitespace-pre-line line-clamp-2">{s.status.motd}</p>
          )}
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground pt-1">
            {s.status.version && (
              <span className="px-2 py-1 rounded-md bg-muted">版本 {s.status.version}</span>
            )}
            {s.status.players && (
              <span className="px-2 py-1 rounded-md bg-muted inline-flex items-center gap-1">
                <Users className="w-3 h-3" />
                {s.status.players.online ?? '?'} / {s.status.players.max ?? '?'}
              </span>
            )}
            {typeof s.status.delay_ms === 'number' && (
              <span className="px-2 py-1 rounded-md bg-muted">{s.status.delay_ms}ms</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
