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
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">用户管理</h1>
      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      ) : (
        <div className="glass-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border/40 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">用户名</th>
                <th className="px-4 py-3">邮箱</th>
                <th className="px-4 py-3">用户组</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-border/20 last:border-0">
                  <td className="px-4 py-3 text-muted-foreground">{u.id}</td>
                  <td className="px-4 py-3 font-medium">{u.username}</td>
                  <td className="px-4 py-3">{u.email}</td>
                  <td className="px-4 py-3">
                    <select
                      value={u.user_group}
                      onChange={(e) => update(u.id, { user_group: e.target.value })}
                      className="input py-1"
                    >
                      {GROUPS.map((g) => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    {u.is_banned ? (
                      <span className="text-destructive">已封禁</span>
                    ) : (
                      <span className="text-primary">正常</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                    <button
                      onClick={() => update(u.id, { is_banned: !u.is_banned })}
                      className="text-xs hover:underline inline-flex items-center gap-1"
                    >
                      {u.is_banned ? <ShieldCheck className="w-3 h-3" /> : <Ban className="w-3 h-3" />}
                      {u.is_banned ? '解除' : '封禁'}
                    </button>
                    <button
                      onClick={() => remove(u.id)}
                      className="text-xs text-destructive hover:underline inline-flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" /> 删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
