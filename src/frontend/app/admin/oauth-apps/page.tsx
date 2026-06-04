'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { ConfirmDialog, ConfirmOptions } from '@/components/ui/confirm-dialog';
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
    const ok = await showConfirm({
      title: '删除 OAuth 应用',
      message: '删除该 OAuth 应用？此操作不可撤销。',
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/admin/oauth-apps/${id}`);
      toast.success('OAuth 应用已删除');
      await refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || '删除失败');
    }
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <p className="section-kicker" style={{ marginBottom: 8 }}>OAUTH</p>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-heading)', margin: 0 }}>
          OAuth 应用
        </h1>
      </div>

      {/* Create form */}
      <form onSubmit={create} className="surface-card" style={{ padding: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-heading)', margin: '0 0 16px 0' }}>
          新建应用
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginBottom: 12 }}>
          <FieldInput label="应用名称" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} required />
          <FieldInput label="redirect_uri" value={draft.redirect_uri} onChange={(v) => setDraft({ ...draft, redirect_uri: v })} required />
        </div>
        <div style={{ marginBottom: 12 }}>
          <FieldInput label="描述" value={draft.description} onChange={(v) => setDraft({ ...draft, description: v })} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Scopes</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {ALL_SCOPES.map((s) => {
              const active = draft.scopes.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleScope(s)}
                  style={{
                    padding: '4px 10px', borderRadius: 8, fontSize: 12, fontWeight: 500,
                    border: '1px solid',
                    borderColor: active ? 'var(--color-primary)' : 'var(--color-border)',
                    background: active
                      ? 'color-mix(in srgb, var(--color-primary) 10%, transparent)'
                      : 'var(--color-background-soft)',
                    color: active ? 'var(--color-primary)' : 'var(--color-text-light)',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </div>
        <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={draft.is_device_shared}
            onChange={(e) => setDraft({ ...draft, is_device_shared: e.target.checked })}
            style={{ accentColor: 'var(--color-primary)' }}
          />
          作为 Device Flow 共享 client_id（用于 USTBL 启动器等）
        </label>
        <button type="submit" disabled={creating} className="btn-primary">
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus style={{ width: 16, height: 16 }} />}
          创建应用
        </button>
      </form>

      {/* App list */}
      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--color-text-light)' }} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map((a) => (
            <div key={a.id} className="surface-card" style={{ padding: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
                <div>
                  <p style={{ fontWeight: 600, fontSize: 16, color: 'var(--color-heading)', margin: 0 }}>
                    {a.name}
                    {a.is_device_shared && (
                      <span style={{ marginLeft: 8, fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'color-mix(in srgb, var(--color-primary) 10%, transparent)', color: 'var(--color-primary)', fontWeight: 600 }}>
                        device shared
                      </span>
                    )}
                  </p>
                  {a.description && <p style={{ fontSize: 12, color: 'var(--color-text-light)', marginTop: 4 }}>{a.description}</p>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => regenerate(a.id)} className="btn-ghost" style={{ padding: '4px 12px', fontSize: 12 }}>
                    <RefreshCw style={{ width: 12, height: 12 }} /> 重新生成 secret
                  </button>
                  <button onClick={() => remove(a.id)} className="btn-destructive" style={{ padding: '4px 12px', fontSize: 12 }}>
                    <Trash2 style={{ width: 12, height: 12 }} /> 删除
                  </button>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                <CredRow label="client_id" value={String(a.id)} onCopy={() => copy(`id-${a.id}`, String(a.id))} copied={copied === `id-${a.id}`} />
                <CredRow label="client_secret" value={a.client_secret} onCopy={() => copy(`sec-${a.id}`, a.client_secret)} copied={copied === `sec-${a.id}`} />
                <CredRow label="redirect_uri" value={a.redirect_uri} onCopy={() => copy(`ru-${a.id}`, a.redirect_uri)} copied={copied === `ru-${a.id}`} />
                <CredRow label="scopes" value={a.scopes.join(' ')} onCopy={() => copy(`sc-${a.id}`, a.scopes.join(' '))} copied={copied === `sc-${a.id}`} />
              </div>
            </div>
          ))}
          {items.length === 0 && <p style={{ color: 'var(--color-text-light)' }}>还没有任何 OAuth 应用。</p>}
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

function FieldInput({ label, value, onChange, required }: { label: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 13, fontWeight: 500 }}>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} required={required} className="input" />
    </label>
  );
}

function CredRow({ label, value, onCopy, copied }: { label: string; value: string; onCopy: () => void; copied: boolean }) {
  return (
    <div>
      <p style={{ fontSize: 12, color: 'var(--color-text-light)', marginBottom: 4 }}>{label}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <code style={{
          flex: 1, padding: '4px 8px', borderRadius: 6, fontSize: 12,
          background: 'var(--color-background-mute)', border: '1px solid var(--color-border)',
          wordBreak: 'break-all', color: 'var(--color-heading)',
        }}>
          {value}
        </code>
        <button onClick={onCopy} className="btn-ghost" style={{ padding: '4px 8px' }}>
          {copied ? <Check style={{ width: 14, height: 14, color: 'var(--color-primary)' }} /> : <Copy style={{ width: 14, height: 14 }} />}
        </button>
      </div>
    </div>
  );
}
