'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { useUserStore } from '@/stores/user';
import { toast } from 'sonner';
import { ConfirmDialog, ConfirmOptions } from '@/components/ui/confirm-dialog';
import { Loader2, Plus, Trash2, Copy, Check, Shield } from 'lucide-react';

type Invite = {
  id: number;
  code: string;
  total_uses: number | null;
  used_count: number;
  used_by: string | null;
  note: string | null;
  target_group: string | null;
  created_at: number;
};

const GROUP_LABELS: Record<string, string> = {
  admin: '管理员',
  teacher: '教师',
  server_manager: '服务器管理员',
};

const GROUP_COLORS: Record<string, string> = {
  admin: '#409EFF',
  teacher: '#9B59B6',
  server_manager: '#E6A23C',
};

export default function AdminInvitesPage() {
  const user = useUserStore((s) => s.user);
  const [items, setItems] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState(5);
  const [targetGroup, setTargetGroup] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  // Confirm dialog state
  const [confirmState, setConfirmState] = useState<{ open: boolean; options: ConfirmOptions; onConfirm: () => void }>({
    open: false, options: { message: '' }, onConfirm: () => {},
  });

  const showConfirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmState({
        open: true,
        options,
        onConfirm: () => { setConfirmState((s) => ({ ...s, open: false })); resolve(true); },
      });
    });
  }, []);

  // 根据当前用户身份决定可选的 target_group
  const targetGroupOptions = (() => {
    const group = user?.user_group;
    if (group === 'super_admin') {
      return [
        { value: '', label: '普通用户' },
        { value: 'teacher', label: '教师' },
        { value: 'server_manager', label: '服务器管理员' },
        { value: 'admin', label: '管理员' },
      ];
    }
    if (group === 'admin') {
      return [
        { value: '', label: '普通用户' },
        { value: 'teacher', label: '教师' },
        { value: 'server_manager', label: '服务器管理员' },
      ];
    }
    // teacher 和 server_manager 只能选普通用户或教师
    if (group === 'teacher' || group === 'server_manager') {
      return [
        { value: '', label: '普通用户' },
        { value: 'teacher', label: '教师' },
      ];
    }
    return [{ value: '', label: '普通用户' }];
  })();

  async function refresh() {
    setLoading(true);
    try {
      const r = await api.get<Invite[]>('/admin/invites');
      setItems(r.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function create() {
    setCreating(true);
    try {
      await api.post('/admin/invites', {
        count,
        target_group: targetGroup || null,
      });
      await refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || '创建失败');
    } finally {
      setCreating(false);
    }
  }

  async function remove(id: number) {
    const ok = await showConfirm({
      title: '删除邀请码',
      message: '删除该邀请码？',
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/admin/invites/${id}`);
      toast.success('邀请码已删除');
      await refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || '删除失败');
    }
  }

  function copy(item: Invite) {
    navigator.clipboard.writeText(item.code);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <p className="section-kicker" style={{ marginBottom: 8 }}>INVITES</p>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-heading)', margin: 0 }}>
          邀请码
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-light)', marginTop: 4 }}>
          创建邀请码时可设置身份型号，新用户使用该邀请码注册后将直接获得对应身份
        </p>
      </div>

      {/* Generate form */}
      <div className="surface-card" style={{ padding: 20, display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>数量</span>
          <input
            type="number"
            min={1}
            max={100}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="input"
            style={{ width: 96 }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>身份型号</span>
          <select
            value={targetGroup}
            onChange={(e) => setTargetGroup(e.target.value)}
            className="input"
            style={{ width: 120 }}
          >
            {targetGroupOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>
        <button onClick={create} disabled={creating} className="btn-primary">
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus style={{ width: 16, height: 16 }} />}
          生成
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--color-text-light)' }} />
      ) : (
        <div className="surface-card" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left' }}>
                <th style={{ padding: '12px 16px', color: 'var(--color-text-light)', fontWeight: 600, fontSize: 12, letterSpacing: '0.04em', textTransform: 'uppercase' as const }}>邀请码</th>
                <th style={{ padding: '12px 16px', color: 'var(--color-text-light)', fontWeight: 600, fontSize: 12, letterSpacing: '0.04em', textTransform: 'uppercase' as const }}>身份</th>
                <th style={{ padding: '12px 16px', color: 'var(--color-text-light)', fontWeight: 600, fontSize: 12, letterSpacing: '0.04em', textTransform: 'uppercase' as const }}>状态</th>
                <th style={{ padding: '12px 16px', color: 'var(--color-text-light)', fontWeight: 600, fontSize: 12, letterSpacing: '0.04em', textTransform: 'uppercase' as const }}>使用者</th>
                <th style={{ padding: '12px 16px', color: 'var(--color-text-light)', fontWeight: 600, fontSize: 12, letterSpacing: '0.04em', textTransform: 'uppercase' as const, textAlign: 'right' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-border) 40%, transparent)' }}>
                  <td style={{ padding: '12px 16px', fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', color: 'var(--color-heading)' }}>{i.code}</td>
                  <td style={{ padding: '12px 16px' }}>
                    {i.target_group ? (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600,
                        background: `color-mix(in srgb, ${GROUP_COLORS[i.target_group] || 'var(--color-primary)'} 12%, transparent)`,
                        color: GROUP_COLORS[i.target_group] || 'var(--color-primary)',
                      }}>
                        <Shield style={{ width: 12, height: 12 }} />
                        {GROUP_LABELS[i.target_group] || i.target_group}
                      </span>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--color-text-light)' }}>普通用户</span>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    {i.used_count >= (i.total_uses ?? Infinity)
                      ? <span style={{ color: 'var(--color-text-light)', fontSize: 13 }}>已使用</span>
                      : <span style={{ color: 'var(--color-primary)', fontSize: 13, fontWeight: 500 }}>未使用</span>}
                  </td>
                  <td style={{ padding: '12px 16px', color: 'var(--color-text-light)' }}>{i.used_by ?? '-'}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button onClick={() => copy(i)} className="btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }}>
                        {copiedId === i.id
                          ? <><Check style={{ width: 12, height: 12, color: 'var(--color-primary)' }} /> 已复制</>
                          : <><Copy style={{ width: 12, height: 12 }} /> 复制</>}
                      </button>
                      <button onClick={() => remove(i.id)} className="btn-destructive" style={{ padding: '4px 10px', fontSize: 12 }}>
                        <Trash2 style={{ width: 12, height: 12 }} /> 删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirm Dialog */}
      <ConfirmDialog
        open={confirmState.open}
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState((s) => ({ ...s, open: false }))}
        {...confirmState.options}
      />
    </div>
  );
}
