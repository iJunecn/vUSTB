'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { Loader2 } from 'lucide-react';

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
    <div className="space-y-6 max-w-lg">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold">账号安全</h1>
        <p className="text-muted-foreground">修改密码,管理登录设备。</p>
      </header>
      <form onSubmit={submit} className="glass-card p-6 space-y-4">
        <h2 className="font-semibold">修改密码</h2>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">当前密码</span>
          <input
            type="password"
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            required
            className="input"
            autoComplete="current-password"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">新密码（至少 8 位）</span>
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
          <p className={msg.ok ? 'text-sm text-primary' : 'text-sm text-destructive'}>{msg.text}</p>
        )}
        <button type="submit" disabled={loading} className="btn-primary">
          {loading && <Loader2 className="w-4 h-4 animate-spin" />} 更新密码
        </button>
      </form>
    </div>
  );
}
