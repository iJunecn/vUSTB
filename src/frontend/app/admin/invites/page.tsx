'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Loader2, Plus, Trash2, Copy, Check } from 'lucide-react';

type Invite = {
  id: number;
  code: string;
  used: boolean;
  used_by_id: number | null;
  created_at: string;
};

export default function AdminInvitesPage() {
  const [items, setItems] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState(5);
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);

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
      await api.post('/admin/invites', { count });
      await refresh();
    } finally {
      setCreating(false);
    }
  }

  async function remove(id: number) {
    if (!confirm('删除该邀请码?')) return;
    await api.delete(`/admin/invites/${id}`);
    await refresh();
  }

  function copy(item: Invite) {
    navigator.clipboard.writeText(item.code);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">邀请码</h1>
      <div className="glass-card p-4 flex items-end gap-3 flex-wrap">
        <label className="space-y-1">
          <span className="text-sm font-medium block">数量</span>
          <input
            type="number"
            min={1}
            max={100}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="input w-24"
          />
        </label>
        <button onClick={create} disabled={creating} className="btn-primary">
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          生成
        </button>
      </div>

      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      ) : (
        <div className="glass-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground border-b border-border/40">
              <tr>
                <th className="px-4 py-3">邀请码</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">使用者</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="border-b border-border/20 last:border-0">
                  <td className="px-4 py-3 font-mono">{i.code}</td>
                  <td className="px-4 py-3">{i.used ? <span className="text-muted-foreground">已使用</span> : <span className="text-primary">未使用</span>}</td>
                  <td className="px-4 py-3 text-muted-foreground">{i.used_by_id ?? '-'}</td>
                  <td className="px-4 py-3 text-right space-x-3 whitespace-nowrap">
                    <button onClick={() => copy(i)} className="text-xs hover:underline inline-flex items-center gap-1">
                      {copiedId === i.id ? <Check className="w-3 h-3 text-primary" /> : <Copy className="w-3 h-3" />}
                      复制
                    </button>
                    <button onClick={() => remove(i.id)} className="text-xs text-destructive hover:underline inline-flex items-center gap-1">
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
