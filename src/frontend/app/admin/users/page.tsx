'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Loader2, Ban, ShieldCheck, Trash2 } from 'lucide-react';

type AdminUser = {
  id: number;
  email: string;
  username: string;
  user_group: 'super_admin' | 'admin' | 'teacher' | 'user';
  email_verified: boolean;
  is_banned: boolean;
  created_at: string;
};

const GROUPS = ['user', 'teacher', 'admin', 'super_admin'] as const;

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const r = await api.get<AdminUser[]>('/admin/users');
      setUsers(r.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function update(id: number, body: Partial<{ user_group: string; is_banned: boolean }>) {
    try {
      await api.put(`/admin/users/${id}`, body);
      await refresh();
    } catch (err: any) {
      alert(err?.response?.data?.detail || '更新失败');
    }
  }

  async function remove(id: number) {
    if (!confirm('彻底删除该用户?该操作不可逆。')) return;
    try {
      await api.delete(`/admin/users/${id}`);
      await refresh();
    } catch (err: any) {
      alert(err?.response?.data?.detail || '删除失败');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <p className="section-kicker" style={{ marginBottom: 8 }}>USERS</p>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-heading)', margin: 0 }}>
          用户管理
        </h1>
      </div>

      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--color-text-light)' }} />
      ) : (
        <div className="surface-card" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left' }}>
                <ThCell>ID</ThCell>
                <ThCell>用户名</ThCell>
                <ThCell>邮箱</ThCell>
                <ThCell>用户组</ThCell>
                <ThCell>状态</ThCell>
                <ThCell style={{ textAlign: 'right' }}>操作</ThCell>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-border) 40%, transparent)' }}>
                  <TdCell style={{ color: 'var(--color-text-light)' }}>{u.id}</TdCell>
                  <TdCell style={{ fontWeight: 600, color: 'var(--color-heading)' }}>{u.username}</TdCell>
                  <TdCell>{u.email}</TdCell>
                  <TdCell>
                    <select
                      value={u.user_group}
                      onChange={(e) => update(u.id, { user_group: e.target.value })}
                      className="input"
                      style={{ padding: '4px 8px', fontSize: 13 }}
                    >
                      {GROUPS.map((g) => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                    </select>
                  </TdCell>
                  <TdCell>
                    {u.is_banned ? (
                      <span style={{ color: '#dc2626', fontSize: 13, fontWeight: 500 }}>已封禁</span>
                    ) : (
                      <span style={{ color: 'var(--color-primary)', fontSize: 13, fontWeight: 500 }}>正常</span>
                    )}
                  </TdCell>
                  <TdCell style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button
                        onClick={() => update(u.id, { is_banned: !u.is_banned })}
                        className="btn-ghost"
                        style={{ padding: '4px 10px', fontSize: 12 }}
                      >
                        {u.is_banned
                          ? <><ShieldCheck style={{ width: 12, height: 12 }} /> 解除</>
                          : <><Ban style={{ width: 12, height: 12 }} /> 封禁</>}
                      </button>
                      <button
                        onClick={() => remove(u.id)}
                        className="btn-destructive"
                        style={{ padding: '4px 10px', fontSize: 12 }}
                      >
                        <Trash2 style={{ width: 12, height: 12 }} /> 删除
                      </button>
                    </div>
                  </TdCell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ThCell({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <th style={{ padding: '12px 16px', color: 'var(--color-text-light)', fontWeight: 600, fontSize: 12, letterSpacing: '0.04em', textTransform: 'uppercase' as const, ...style }}>
      {children}
    </th>
  );
}

function TdCell({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <td style={{ padding: '12px 16px', ...style }}>{children}</td>
  );
}
