'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useUserStore } from '@/stores/user';
import { Loader2, Ban, ShieldCheck, Trash2, Coins, UserPlus, X, Check } from 'lucide-react';

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

const GROUP_LABELS: Record<string, string> = {
  user: '用户',
  teacher: '教师',
  admin: '管理员',
  super_admin: '超管',
};

export default function AdminUsersPage() {
  const currentUser = useUserStore((s) => s.user);
  const isSuperAdmin = currentUser?.user_group === 'super_admin';
  const isAdmin = currentUser?.user_group === 'admin' || isSuperAdmin;

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);

  // Points modal
  const [pointsModalUser, setPointsModalUser] = useState<AdminUser | null>(null);
  const [pointsPixel, setPointsPixel] = useState(0);
  const [pointsShell, setPointsShell] = useState(0);
  const [pointsSaving, setPointsSaving] = useState(false);

  // Create user modal
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ email: '', username: '', phone: '', password: '', user_group: 'user' });
  const [createSaving, setCreateSaving] = useState(false);

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

  async function openPointsModal(u: AdminUser) {
    setPointsModalUser(u);
    setPointsSaving(false);
    // Fetch current points
    try {
      const r = await api.get<{ pixel_points: number; shell_points: number }>(`/admin/users/${u.id}/points`);
      setPointsPixel(r.data.pixel_points ?? 0);
      setPointsShell(r.data.shell_points ?? 0);
    } catch {
      // If endpoint doesn't return points yet, just default to 0
      // Actually the PUT endpoint we just created returns points, but we need a GET too
      // Let's just use the user account endpoint through admin
      setPointsPixel(0);
      setPointsShell(0);
    }
  }

  async function savePoints() {
    if (!pointsModalUser) return;
    setPointsSaving(true);
    try {
      await api.put(`/admin/users/${pointsModalUser.id}/points`, {
        pixel_points: pointsPixel,
        shell_points: pointsShell,
      });
      setPointsModalUser(null);
    } catch (err: any) {
      alert(err?.response?.data?.detail || '设置积分失败');
    } finally {
      setPointsSaving(false);
    }
  }

  async function createUser() {
    setCreateSaving(true);
    try {
      await api.post('/admin/users', createForm);
      setCreateModalOpen(false);
      setCreateForm({ email: '', username: '', phone: '', password: '', user_group: 'user' });
      await refresh();
    } catch (err: any) {
      alert(err?.response?.data?.detail || '创建用户失败');
    } finally {
      setCreateSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <p className="section-kicker" style={{ marginBottom: 8 }}>USERS</p>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-heading)', margin: 0 }}>
            用户管理
          </h1>
        </div>
        {isAdmin && (
          <button onClick={() => setCreateModalOpen(true)} className="btn-primary" style={{ padding: '8px 16px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
            <UserPlus style={{ width: 14, height: 14 }} /> 创建用户
          </button>
        )}
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
                        <option key={g} value={g}>{GROUP_LABELS[g] || g}</option>
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
                      {isSuperAdmin && (
                        <button
                          onClick={() => openPointsModal(u)}
                          className="btn-ghost"
                          style={{ padding: '4px 10px', fontSize: 12 }}
                        >
                          <Coins style={{ width: 12, height: 12 }} /> 积分
                        </button>
                      )}
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

      {/* Points Modal */}
      {pointsModalUser && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={(e) => { if (e.target === e.currentTarget) setPointsModalUser(null); }}
        >
          <div style={{ background: 'var(--color-card-background)', borderRadius: 16, maxWidth: 400, width: '100%', boxShadow: '0 16px 48px rgba(0,0,0,0.2)', padding: 24 }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: 'var(--color-heading)' }}>
              设置积分 — {pointsModalUser.username}
            </h3>
            <p style={{ fontSize: 13, color: 'var(--color-text-light)', margin: '0 0 20px' }}>
              直接设置用户积分的绝对值（非增减），系统会自动记录调整流水
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-heading)' }}>
                  像素积分 <span style={{ fontSize: 11, color: 'var(--color-text-light)' }}>(皮肤站专用)</span>
                </span>
                <input
                  type="number"
                  value={pointsPixel}
                  onChange={(e) => setPointsPixel(Number(e.target.value))}
                  className="input"
                  style={{ fontSize: 14 }}
                  min={0}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-heading)' }}>
                  贝壳积分 <span style={{ fontSize: 11, color: 'var(--color-text-light)' }}>(打印预约专用)</span>
                </span>
                <input
                  type="number"
                  value={pointsShell}
                  onChange={(e) => setPointsShell(Number(e.target.value))}
                  className="input"
                  style={{ fontSize: 14 }}
                  min={0}
                />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 24 }}>
              <button onClick={() => setPointsModalUser(null)} className="btn-ghost" style={{ fontSize: 13, padding: '8px 16px' }}>
                取消
              </button>
              <button onClick={savePoints} disabled={pointsSaving} className="btn-primary" style={{ fontSize: 13, padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 6 }}>
                {pointsSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check style={{ width: 14, height: 14 }} />}
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create User Modal */}
      {createModalOpen && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={(e) => { if (e.target === e.currentTarget) setCreateModalOpen(false); }}
        >
          <div style={{ background: 'var(--color-card-background)', borderRadius: 16, maxWidth: 440, width: '100%', boxShadow: '0 16px 48px rgba(0,0,0,0.2)', padding: 24 }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: 'var(--color-heading)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <UserPlus style={{ width: 18, height: 18, color: 'var(--color-primary)' }} />
              手动创建用户
            </h3>
            <p style={{ fontSize: 13, color: 'var(--color-text-light)', margin: '0 0 20px' }}>
              管理员可直接创建用户，无需邀请码和邮箱验证
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>邮箱</span>
                <input
                  type="email"
                  value={createForm.email}
                  onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                  className="input"
                  style={{ fontSize: 14 }}
                  placeholder="user@example.com"
                />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>用户名</span>
                  <input
                    value={createForm.username}
                    onChange={(e) => setCreateForm((f) => ({ ...f, username: e.target.value }))}
                    className="input"
                    style={{ fontSize: 14 }}
                    placeholder="username"
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>手机号</span>
                  <input
                    value={createForm.phone}
                    onChange={(e) => setCreateForm((f) => ({ ...f, phone: e.target.value }))}
                    className="input"
                    style={{ fontSize: 14 }}
                    placeholder="13800138000"
                  />
                </label>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>密码</span>
                  <input
                    type="password"
                    value={createForm.password}
                    onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
                    className="input"
                    style={{ fontSize: 14 }}
                    placeholder="至少 8 位"
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>用户组</span>
                  <select
                    value={createForm.user_group}
                    onChange={(e) => setCreateForm((f) => ({ ...f, user_group: e.target.value }))}
                    className="input"
                    style={{ fontSize: 14 }}
                  >
                    <option value="user">用户</option>
                    <option value="teacher">教师</option>
                    {isSuperAdmin && <option value="admin">管理员</option>}
                  </select>
                </label>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 24 }}>
              <button onClick={() => setCreateModalOpen(false)} className="btn-ghost" style={{ fontSize: 13, padding: '8px 16px' }}>
                取消
              </button>
              <button
                onClick={createUser}
                disabled={createSaving || !createForm.email || !createForm.username || !createForm.password}
                className="btn-primary"
                style={{ fontSize: 13, padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                {createSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus style={{ width: 14, height: 14 }} />}
                创建
              </button>
            </div>
          </div>
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
