'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Loader2, Plus, Trash2, RefreshCw, Copy, Check } from 'lucide-react';

type OAuthApp = {
  id: number;
  name: string;
  description: string | null;
  client_secret: string;
  redirect_uri: string;
  scopes: string[];
  is_device_shared: boolean;
};

const ALL_SCOPES = [
  'openid', 'offline_access', 'userinfo', 'profile', 'avatar',
  'email', 'permission', 'skin',
  'Yggdrasil.PlayerProfiles.Select', 'Yggdrasil.Server.Join',
];

export default function AdminOAuthAppsPage() {
  const [items, setItems] = useState<OAuthApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({
    name: '', description: '', redirect_uri: '', scopes: ['userinfo'] as string[], is_device_shared: false,
  });
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const r = await api.get<OAuthApp[]>('/admin/oauth-apps');
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
      await api.post('/admin/oauth-apps', draft);
      setDraft({ name: '', description: '', redirect_uri: '', scopes: ['userinfo'], is_device_shared: false });
      await refresh();
    } finally {
      setCreating(false);
    }
  }

  async function regenerate(id: number) {
    await api.put(`/admin/oauth-apps/${id}`, { regenerate_secret: true });
    await refresh();
  }

  async function remove(id: number) {
    if (!confirm('删除该 OAuth 应用?')) return;
    await api.delete(`/admin/oauth-apps/${id}`);
    await refresh();
  }

  function copy(key: string, val: string) {
    navigator.clipboard.writeText(val);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }

  function toggleScope(scope: string) {
    setDraft((d) => ({
      ...d,
      scopes: d.scopes.includes(scope) ? d.scopes.filter((s) => s !== scope) : [...d.scopes, scope],
    }));
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">OAuth 应用</h1>

      <form onSubmit={create} className="glass-card p-5 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input label="应用名称" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} required />
          <Input label="redirect_uri" value={draft.redirect_uri} onChange={(v) => setDraft({ ...draft, redirect_uri: v })} required />
        </div>
        <Input label="描述" value={draft.description} onChange={(v) => setDraft({ ...draft, description: v })} />
        <div>
          <p className="text-sm font-medium mb-2">scopes</p>
          <div className="flex flex-wrap gap-2">
            {ALL_SCOPES.map((s) => (
              <label key={s} className={`text-xs px-2 py-1 rounded-lg cursor-pointer ${draft.scopes.includes(s) ? 'bg-primary text-primary-foreground' : 'glass-card'}`}>
                <input type="checkbox" className="sr-only" checked={draft.scopes.includes(s)} onChange={() => toggleScope(s)} />
                {s}
              </label>
            ))}
          </div>
        </div>
        <label className="text-sm flex items-center gap-2">
          <input type="checkbox" checked={draft.is_device_shared} onChange={(e) => setDraft({ ...draft, is_device_shared: e.target.checked })} />
          作为 Device Flow 共享 client_id（用于 USTBL 启动器等）
        </label>
        <button type="submit" disabled={creating} className="btn-primary">
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          创建应用
        </button>
      </form>

      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      ) : (
        <div className="space-y-3">
          {items.map((a) => (
            <div key={a.id} className="glass-card p-5 space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="space-y-1">
                  <p className="font-semibold">
                    {a.name}
                    {a.is_device_shared && (
                      <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-secondary/15 text-secondary">device shared</span>
                    )}
                  </p>
                  {a.description && <p className="text-xs text-muted-foreground">{a.description}</p>}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => regenerate(a.id)} className="text-xs glass-card px-3 py-1.5 hover:bg-card inline-flex items-center gap-1">
                    <RefreshCw className="w-3 h-3" /> 重新生成 secret
                  </button>
                  <button onClick={() => remove(a.id)} className="text-xs text-destructive px-3 py-1.5 hover:underline inline-flex items-center gap-1">
                    <Trash2 className="w-3 h-3" /> 删除
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <CredRow label="client_id" value={String(a.id)} onCopy={() => copy(`id-${a.id}`, String(a.id))} copied={copied === `id-${a.id}`} />
                <CredRow label="client_secret" value={a.client_secret} onCopy={() => copy(`sec-${a.id}`, a.client_secret)} copied={copied === `sec-${a.id}`} />
                <CredRow label="redirect_uri" value={a.redirect_uri} onCopy={() => copy(`ru-${a.id}`, a.redirect_uri)} copied={copied === `ru-${a.id}`} />
                <CredRow label="scopes" value={a.scopes.join(' ')} onCopy={() => copy(`sc-${a.id}`, a.scopes.join(' '))} copied={copied === `sc-${a.id}`} />
              </div>
            </div>
          ))}
          {items.length === 0 && <p className="text-muted-foreground">还没有任何 OAuth 应用。</p>}
        </div>
      )}
    </div>
  );
}

function Input({ label, value, onChange, required }: { label: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  return (
    <label className="space-y-1 block">
      <span className="text-sm font-medium block">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} required={required} className="input" />
    </label>
  );
}

function CredRow({ label, value, onCopy, copied }: { label: string; value: string; onCopy: () => void; copied: boolean }) {
  return (
    <div>
      <p className="text-muted-foreground mb-1">{label}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 px-2 py-1 rounded-md bg-muted/40 border border-input break-all">{value}</code>
        <button onClick={onCopy} className="glass-card px-2 py-1 hover:bg-card">
          {copied ? <Check className="w-3 h-3 text-primary" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>
    </div>
  );
}
