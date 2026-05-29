'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Loader2, Plus, Trash2, RefreshCw } from 'lucide-react';

type Server = {
  id: number;
  name: string;
  address: string | null;
  description: string | null;
  version_hint: string | null;
  icon_url: string | null;
  is_public: boolean;
  sort_order: number;
};

const EMPTY: Omit<Server, 'id'> = {
  name: '', address: '', description: '', version_hint: '',
  icon_url: '', is_public: true, sort_order: 0,
};

export default function AdminServersPage() {
  const [items, setItems] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Omit<Server, 'id'>>({ ...EMPTY });
  const [creating, setCreating] = useState(false);

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
      alert(err?.response?.data?.detail || '创建失败');
    } finally {
      setCreating(false);
    }
  }

  async function update(id: number, body: Partial<Server>) {
    await api.put(`/mc-servers/${id}`, body);
    await refresh();
  }

  async function remove(id: number) {
    if (!confirm('删除该服务器?')) return;
    await api.delete(`/mc-servers/${id}`);
    await refresh();
  }

  async function refreshStatus(id: number) {
    await api.post(`/mc-servers/${id}/refresh`);
    alert('已触发刷新');
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">MC 服务器管理</h1>

      <form onSubmit={create} className="glass-card p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input label="名称" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} required />
        <Input label="地址 host:port" value={draft.address || ''} onChange={(v) => setDraft({ ...draft, address: v })} required />
        <Input label="版本提示" value={draft.version_hint || ''} onChange={(v) => setDraft({ ...draft, version_hint: v })} />
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
            <div key={s.id} className="glass-card p-4 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
              <div className="space-y-1">
                <p className="font-semibold">{s.name} <span className="text-xs text-muted-foreground">#{s.id}</span></p>
                <p className="text-xs text-muted-foreground"><code>{s.address}</code></p>
                {s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}
              </div>
              <div className="flex flex-wrap gap-2 items-start">
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
          ))}
          {items.length === 0 && <p className="text-muted-foreground">还没有添加任何服务器。</p>}
        </div>
      )}
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
