'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { Loader2, Lock } from 'lucide-react';

export default function SecurityPage() {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);
    try {
      await api.post('/auth/change-password', {
        old_password: oldPassword,
        new_password: newPassword,
      });
      setMsg({ ok: true, text: '密码已更新' });
      setOldPassword('');
      setNewPassword('');
    } catch (err: any) {
      setMsg({ ok: false, text: err?.response?.data?.detail || '修改失败' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 480 }}>
      <div>
        <p className="section-kicker" style={{ marginBottom: 8 }}>SECURITY</p>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-heading)', margin: 0 }}>
          账号安全
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-light)', marginTop: 4 }}>
          修改密码，管理登录设备。
        </p>
      </div>

      <form onSubmit={submit} className="surface-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Lock style={{ width: 20, height: 20, color: 'var(--color-primary)' }} />
          <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-heading)', margin: 0 }}>修改密码</h2>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>当前密码</span>
          <input
            type="password"
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            required
            className="input"
            autoComplete="current-password"
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>新密码（至少 8 位）</span>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={8}
            className="input"
            autoComplete="new-password"
          />
        </label>

        {msg && (
          <p style={{ fontSize: 13, color: msg.ok ? 'var(--color-primary)' : '#dc2626' }}>
            {msg.text}
          </p>
        )}

        <button type="submit" disabled={loading} className="btn-primary">
          {loading && <Loader2 className="w-4 h-4 animate-spin" />} 更新密码
        </button>
      </form>
    </div>
  );
}
