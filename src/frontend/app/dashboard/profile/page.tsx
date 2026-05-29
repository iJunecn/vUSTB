'use client';

import { useRef } from 'react';
import { useUserStore } from '@/stores/user';
import { api } from '@/lib/api';
import { Upload, Loader2 } from 'lucide-react';

export default function ProfilePage() {
  const { user, hydrate } = useUserStore();
  const fileRef = useRef<HTMLInputElement>(null);

  if (!user) return null;

  const initial = user.username.charAt(0).toUpperCase();

  async function onAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('avatar', file);
    try {
      await api.post('/users/me/avatar', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      await hydrate();
    } catch (err: any) {
      alert(err?.response?.data?.detail || '上传失败');
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 560 }}>
      <div>
        <p className="section-kicker" style={{ marginBottom: 8 }}>ACCOUNT</p>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-heading)', margin: 0 }}>
          个人资料
        </h1>
      </div>

      {/* Avatar section */}
      <div className="surface-card" style={{ padding: 24, display: 'flex', alignItems: 'center', gap: 20 }}>
        <div
          style={{
            width: 72, height: 72, borderRadius: '50%',
            background: 'var(--color-primary)', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 28, flexShrink: 0,
          }}
        >
          {initial}
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ fontWeight: 600, fontSize: 16, color: 'var(--color-heading)' }}>{user.username}</p>
          <p style={{ fontSize: 13, color: 'var(--color-text-light)', marginTop: 2 }}>{user.email}</p>
        </div>
        <button
          onClick={() => fileRef.current?.click()}
          className="btn-ghost"
          style={{ padding: '8px 16px', fontSize: 13 }}
        >
          <Upload style={{ width: 14, height: 14 }} /> 更换头像
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onAvatarChange} />
      </div>

      {/* Info rows */}
      <div className="surface-card" style={{ padding: 0 }}>
        <InfoRow label="用户名" value={user.username} />
        <InfoRow label="邮箱" value={user.email} />
        <InfoRow label="邮箱验证" value={user.email_verified ? '已验证' : '未验证'} highlight={!user.email_verified} />
        <InfoRow label="用户组" value={user.user_group} last />
      </div>

      <p style={{ fontSize: 13, color: 'var(--color-text-light)' }}>
        修改用户名功能即将开放，如需变更请联系管理员。
      </p>
    </div>
  );
}

function InfoRow({ label, value, highlight, last }: { label: string; value: string; highlight?: boolean; last?: boolean }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 24px',
        borderBottom: last ? 'none' : '1px solid color-mix(in srgb, var(--color-border) 40%, transparent)',
      }}
    >
      <span style={{ fontSize: 14, color: 'var(--color-text-light)' }}>{label}</span>
      <span
        style={{
          fontSize: 14, fontWeight: 500,
          color: highlight ? '#dc2626' : 'var(--color-heading)',
        }}
      >
        {value}
      </span>
    </div>
  );
}
