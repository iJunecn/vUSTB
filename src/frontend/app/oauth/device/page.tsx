'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useUserStore } from '@/stores/user';
import { Loader2, Smartphone, CheckCircle2 } from 'lucide-react';

type Player = {
  id: number;
  name: string;
  uuid: string;
};

function DeviceInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loaded, hydrate } = useUserStore();

  const [userCode, setUserCode] = useState(params.get('user_code') || '');
  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => { hydrate(); }, [hydrate]);

  useEffect(() => {
    if (loaded && !user) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      router.replace(`/login?next=${next}`);
    }
  }, [loaded, user, router]);

  useEffect(() => {
    if (!user) return;
    api.get<Player[]>('/players').then((r) => {
      setPlayers(r.data);
      if (r.data.length > 0) setSelectedPlayerId(r.data[0].id);
    }).catch(() => {});
  }, [user]);

  async function approve(e: React.FormEvent) {
    e.preventDefault();
    setApproving(true);
    setError(null);
    try {
      await api.post('/oauth/device/approve', {
        user_code: userCode.trim().toUpperCase(),
        selected_player_id: selectedPlayerId,
      });
      setDone(true);
    } catch (err: any) {
      setError(err?.response?.data?.detail || '授权失败，请检查用户码是否正确');
    } finally {
      setApproving(false);
    }
  }

  if (!loaded || !user) {
    return (
      <div className="container py-20 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (done) {
    return (
      <div className="container py-16 max-w-md">
        <div className="glass-card p-8 space-y-4 text-center">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-6 h-6 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">授权成功</h1>
          <p className="text-sm text-muted-foreground">
            你现在可以回到启动器或设备，应用会自动完成登录。
          </p>
          <button onClick={() => router.push('/dashboard')} className="btn-primary w-full">
            回到用户中心
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container py-16 max-w-md">
      <form onSubmit={approve} className="glass-card p-8 space-y-6">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
          <Smartphone className="w-6 h-6 text-primary" />
        </div>
        <header className="text-center space-y-2">
          <h1 className="text-2xl font-bold">设备授权</h1>
          <p className="text-sm text-muted-foreground">
            在启动器或第三方应用中获得用户码后，在此输入并确认。
          </p>
        </header>

        <label className="space-y-1 block">
          <span className="text-sm font-medium block">用户码 (User Code)</span>
          <input
            value={userCode}
            onChange={(e) => setUserCode(e.target.value)}
            required
            placeholder="例如 ABCD-EFGH"
            autoComplete="off"
            className="input text-center tracking-widest text-lg uppercase"
          />
        </label>

        {players.length > 0 ? (
          <label className="space-y-1 block">
            <span className="text-sm font-medium block">选择绑定角色</span>
            <span className="text-xs text-muted-foreground block">
              当前会话将以该角色登录 Minecraft 服务器
            </span>
            <select
              value={selectedPlayerId ?? ''}
              onChange={(e) => setSelectedPlayerId(Number(e.target.value))}
              className="input"
            >
              {players.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
        ) : (
          <p className="text-xs text-muted-foreground">
            你还没有创建任何 MC 角色，可以在
            <a href="/dashboard/roles" className="text-primary hover:underline mx-1">游戏角色</a>
            页面创建后再来授权。
          </p>
        )}

        <div className="text-xs text-muted-foreground">
          当前用户: <b className="text-foreground">{user.username}</b>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <button
          type="submit"
          disabled={approving || !userCode.trim() || players.length === 0}
          className="btn-primary w-full"
        >
          {approving && <Loader2 className="w-4 h-4 animate-spin" />} 确认授权
        </button>
      </form>
    </div>
  );
}

export default function OAuthDevicePage() {
  return (
    <Suspense fallback={
      <div className="container py-20 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    }>
      <DeviceInner />
    </Suspense>
  );
}
