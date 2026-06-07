'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { ConfirmDialog, ConfirmOptions } from '@/components/ui/confirm-dialog';
import { Loader2, Plus, Trash2, RefreshCw, Pencil, X } from 'lucide-react';

type Server = {
  id: number;
  name: string;
  address: string | null;
  description: string | null;
  version_hint: string | null;
  theme: string | null;
  icon_url: string | null;
  is_public: boolean;
  sort_order: number;
};

const EMPTY: Omit<Server, 'id'> = {
  name: '', address: '', description: '', version_hint: '', theme: '',
  icon_url: '', is_public: true, sort_order: 0,
};

export default function AdminServersPage() {
  const [items, setItems] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Omit<Server, 'id'>>({ ...EMPTY });
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<Omit<Server, 'id'>>({ ...EMPTY });
  const [saving, setSaving] = useState(false);

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

  async function refresh() {
    setLoading(true);
    try {
      const r = await api.get<Server[]>('/mc-servers');
      setItems(r.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      await api.post('/mc-servers', draft);
      setDraft({ ...EMPTY });
      await refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || '创建失败');
    } finally {
      setCreating(false);
    }
  }

  async function update(id: number, body: Partial<Server>) {
    await api.put(`/mc-servers/${id}`, body);
    await refresh();
  }

  async function remove(id: number) {
    const ok = await showConfirm({
      title: '删除服务器',
      message: '删除该服务器？',
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/mc-servers/${id}`);
      toast.success('服务器已删除');
      await refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || '删除失败');
    }
  }

  async function refreshStatus(id: number) {
    try {
      await api.post(`/mc-servers/${id}/refresh`);
      toast.success('已刷新');
      await refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || '刷新失败');
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">MC 服务器管理</h1>

      <form onSubmit={create} className="glass-card p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input label="名称" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} required />
        <Input label="地址 host:port" value={draft.address || ''} onChange={(v) => setDraft({ ...draft, address: v })} required />
        <Input label="版本提示" value={draft.version_hint || ''} onChange={(v) => setDraft({ ...draft, version_hint: v })} />
        <Input label="主题" value={draft.theme || ''} onChange={(v) => setDraft({ ...draft, theme: v })} />
        <Input label="图标 URL" value={draft.icon_url || ''} onChange={(v) => setDraft({ ...draft, icon_url: v })} />
        <Input label="描述" value={draft.description || ''} onChange={(v) => setDraft({ ...draft, description: v })} />
        <div className="flex items-center gap-4">
          <label className="text-sm flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.is_public}
              onChange={(e) => setDraft({ ...draft, is_public: e.target.checked })}
            />
            公开
          </label>
          <button type="submit" disabled={creating} className="btn-primary">
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            新增
          </button>
        </div>
      </form>

      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      ) : (
        <div className="space-y-3">
          {items.map((s) => (
            editingId === s.id ? (
              <div key={s.id} className="glass-card p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input label="名称" value={editDraft.name} onChange={(v) => setEditDraft({ ...editDraft, name: v })} required />
                <Input label="地址 host:port" value={editDraft.address || ''} onChange={(v) => setEditDraft({ ...editDraft, address: v })} required />
                <Input label="版本提示" value={editDraft.version_hint || ''} onChange={(v) => setEditDraft({ ...editDraft, version_hint: v })} />
                <Input label="主题" value={editDraft.theme || ''} onChange={(v) => setEditDraft({ ...editDraft, theme: v })} />
                <Input label="图标 URL" value={editDraft.icon_url || ''} onChange={(v) => setEditDraft({ ...editDraft, icon_url: v })} />
                <Input label="描述" value={editDraft.description || ''} onChange={(v) => setEditDraft({ ...editDraft, description: v })} />
                <div className="flex items-center gap-4">
                  <label className="text-sm flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={editDraft.is_public}
                      onChange={(e) => setEditDraft({ ...editDraft, is_public: e.target.checked })}
                    />
                    公开
                  </label>
                  <button onClick={async () => {
                    setSaving(true);
                    try {
                      await update(s.id, editDraft);
                      setEditingId(null);
                      toast.success('服务器已更新');
                    } catch (err: any) {
                      toast.error(err?.response?.data?.detail || '更新失败');
                    } finally {
                      setSaving(false);
                    }
                  }} disabled={saving} className="btn-primary">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : '保存'}
                  </button>
                  <button onClick={() => setEditingId(null)} className="text-xs px-3 py-1.5 hover:underline inline-flex items-center gap-1">
                    <X className="w-3 h-3" /> 取消
                  </button>
                </div>
              </div>
            ) : (
              <div key={s.id} className="glass-card p-4 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
                <div className="space-y-1">
                  <p className="font-semibold">{s.name} <span className="text-xs text-muted-foreground">#{s.id}</span></p>
                  <p className="text-xs text-muted-foreground"><code>{s.address}</code></p>
                  {s.theme && <p className="text-xs text-muted-foreground">主题：{s.theme}</p>}
                  {s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}
                </div>
                <div className="flex flex-wrap gap-2 items-start">
                  <button onClick={() => { setEditingId(s.id); setEditDraft({ name: s.name, address: s.address, description: s.description, version_hint: s.version_hint, theme: s.theme, icon_url: s.icon_url, is_public: s.is_public, sort_order: s.sort_order }); }} className="text-xs glass-card px-3 py-1.5 hover:bg-card inline-flex items-center gap-1">
                    <Pencil className="w-3 h-3" /> 编辑
                  </button>
                  <button onClick={() => update(s.id, { is_public: !s.is_public })} className="text-xs glass-card px-3 py-1.5 hover:bg-card">
                    {s.is_public ? '设为私有' : '设为公开'}
                  </button>
                  <button onClick={() => refreshStatus(s.id)} className="text-xs glass-card px-3 py-1.5 hover:bg-card inline-flex items-center gap-1">
                    <RefreshCw className="w-3 h-3" /> 刷新状态
                  </button>
                  <button onClick={() => remove(s.id)} className="text-xs text-destructive px-3 py-1.5 hover:underline inline-flex items-center gap-1">
                    <Trash2 className="w-3 h-3" /> 删除
                  </button>
                </div>
              </div>
            )
          ))}
          {items.length === 0 && <p className="text-muted-foreground">还没有添加任何服务器。</p>}
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

function Input({ label, value, onChange, required }: { label: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  return (
    <label className="space-y-1">
      <span className="text-sm font-medium block">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} required={required} className="input" />
    </label>
  );
}
