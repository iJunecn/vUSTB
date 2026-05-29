'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, rawApi } from '@/lib/api';
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
      await rawApi.post('/oauth/device/approve', {
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
      <div className="auth-shell">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--color-text-light)' }} />
      </div>
    );
  }

  if (done) {
    return (
      <div className="auth-shell">
        <div className="auth-panel" style={{ textAlign: 'center' }}>
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '14px',
            background: 'var(--color-background-mute)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
          }}>
            <CheckCircle2 style={{ width: '24px', height: '24px', color: 'var(--color-primary)' }} />
          </div>
          <h1 style={{ fontSize: '22px', fontWeight: 700, margin: '0 0 8px', color: 'var(--color-heading)' }}>
            授权成功
          </h1>
          <p style={{ fontSize: '14px', color: 'var(--color-text-light)', margin: '0 0 20px' }}>
            你现在可以回到启动器或设备，应用会自动完成登录。
          </p>
          <button onClick={() => router.push('/dashboard')} className="btn-primary" style={{ width: '100%' }}>
            回到用户中心
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <form onSubmit={approve} className="auth-panel">
        <header style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '14px',
            background: 'var(--color-background-mute)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
          }}>
            <Smartphone style={{ width: '24px', height: '24px', color: 'var(--color-primary)' }} />
          </div>
          <h1 style={{ fontSize: '22px', fontWeight: 700, margin: '0 0 8px', color: 'var(--color-heading)' }}>
            设备授权
          </h1>
          <p style={{ fontSize: '14px', color: 'var(--color-text-light)', margin: 0 }}>
            在启动器或第三方应用中获得用户码后，在此输入并确认。
          </p>
        </header>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' }}>
          <span style={{ fontSize: '14px', fontWeight: 500 }}>用户码 (User Code)</span>
          <input
            value={userCode}
            onChange={(e) => setUserCode(e.target.value)}
            required
            placeholder="例如 ABCD-EFGH"
            autoComplete="off"
            className="input"
            style={{
              textAlign: 'center',
              letterSpacing: '0.2em',
              fontSize: '18px',
              textTransform: 'uppercase',
            }}
          />
        </label>

        {players.length > 0 ? (
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' }}>
            <span style={{ fontSize: '14px', fontWeight: 500 }}>选择绑定角色</span>
            <span style={{ fontSize: '12px', color: 'var(--color-text-light)', marginBottom: '2px' }}>
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
          <p style={{ fontSize: '13px', color: 'var(--color-text-light)', marginBottom: '16px' }}>
            你还没有创建任何 MC 角色，可以在
            <a href="/dashboard/roles" style={{ color: 'var(--color-primary)', marginLeft: '4px' }}>游戏角色</a>
            页面创建后再来授权。
          </p>
        )}

        <div style={{ fontSize: '13px', color: 'var(--color-text-light)', marginBottom: '16px' }}>
          当前用户: <strong style={{ color: 'var(--color-heading)' }}>{user.username}</strong>
        </div>

        {error && (
          <p style={{ fontSize: '14px', color: '#dc2626', margin: '0 0 12px' }}>{error}</p>
        )}

        <button
          type="submit"
          disabled={approving || !userCode.trim() || players.length === 0}
          className="btn-primary"
          style={{ width: '100%' }}
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
      <div className="auth-shell">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--color-text-light)' }} />
      </div>
    }>
      <DeviceInner />
    </Suspense>
  );
}
