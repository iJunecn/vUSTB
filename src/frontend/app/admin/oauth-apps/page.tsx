'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { ConfirmDialog, ConfirmOptions } from '@/components/ui/confirm-dialog';
import { Loader2, Plus, Trash2, RefreshCw, Copy, Check, Pencil, X, MonitorSmartphone } from 'lucide-react';

type OAuthApp = {
  app_id: number;
  client_name: string;
  description: string | null;
  redirect_uri: string;
  is_device_shared: boolean;
  can_use_for_device_flow: boolean;
  recommended_device_redirect_uri: string;
  created_at: number;
  updated_at: number;
};

type DeviceSettings = {
  shared_client_id: number | null;
  shared_client_ids: number[];
  expires_in: number;
  interval: number;
  default_redirect_uri: string;
};

const ALL_SCOPES = [
  'openid', 'offline_access', 'userinfo', 'profile', 'avatar',
  'email', 'permission', 'skin',
  'Yggdrasil.PlayerProfiles.Select', 'Yggdrasil.Server.Join',
];

export default function AdminOAuthAppsPage() {
  const [items, setItems] = useState<OAuthApp[]>([]);
  const [deviceSettings, setDeviceSettings] = useState<DeviceSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({
    client_name: '', description: '', redirect_uri: '', set_as_device_shared_client: false,
  });
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  // Created app secret modal
  const [secretModal, setSecretModal] = useState<{ open: boolean; app_id: number; client_name: string; client_secret: string } | null>(null);

  // Edit modal
  const [editModal, setEditModal] = useState<{ open: boolean; app: OAuthApp; client_name: string; description: string; redirect_uri: string; is_device_shared: boolean; saving: boolean } | null>(null);

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
      const [appsR, dsR] = await Promise.all([
        api.get<OAuthApp[]>('/admin/oauth/apps'),
        api.get<DeviceSettings>('/admin/oauth/device-settings'),
      ]);
      setItems(appsR.data);
      setDeviceSettings(dsR.data);
    } catch {
      // device-settings may 404 if first run, that's OK
      try {
        const appsR = await api.get<OAuthApp[]>('/admin/oauth/apps');
        setItems(appsR.data);
      } finally { /* ignore */ }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const r = await api.post('/admin/oauth/apps', draft);
      setDraft({ client_name: '', description: '', redirect_uri: '', set_as_device_shared_client: false });
      await refresh();
      // Show secret modal (only time secret is visible)
      const data = r.data;
      setSecretModal({
        open: true,
        app_id: data.app_id,
        client_name: data.client_name,
        client_secret: data.client_secret,
      });
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || '创建失败');
    } finally {
      setCreating(false);
    }
  }

  async function resetSecret(appId: number) {
    const ok = await showConfirm({
      title: '重新生成密钥',
      message: '重新生成后，旧密钥将立即失效。请确保更新所有使用该密钥的应用配置。',
      confirmText: '确认重新生成',
      danger: true,
    });
    if (!ok) return;
    try {
      const r = await api.post(`/admin/oauth/apps/${appId}/reset-secret`);
      const data = r.data;
      setSecretModal({
        open: true,
        app_id: appId,
        client_name: items.find((a) => a.app_id === appId)?.client_name || '',
        client_secret: data.client_secret,
      });
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || '重新生成失败');
    }
  }

  async function remove(appId: number) {
    const ok = await showConfirm({
      title: '删除 OAuth 应用',
      message: '删除该 OAuth 应用？此操作不可撤销。',
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/admin/oauth/apps/${appId}`);
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

  function openEditModal(app: OAuthApp) {
    setEditModal({
      open: true,
      app,
      client_name: app.client_name,
      description: app.description || '',
      redirect_uri: app.redirect_uri,
      is_device_shared: app.is_device_shared,
      saving: false,
    });
  }

  async function saveEdit() {
    if (!editModal) return;
    setEditModal({ ...editModal, saving: true });
    try {
      await api.put(`/admin/oauth/apps/${editModal.app.app_id}`, {
        client_name: editModal.client_name,
        description: editModal.description,
        redirect_uri: editModal.redirect_uri,
        set_as_device_shared_client: editModal.is_device_shared,
      });
      toast.success('应用已更新');
      setEditModal(null);
      await refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || '更新失败');
    } finally {
      if (editModal) setEditModal({ ...editModal, saving: false });
    }
  }

  // Auto-fill redirect_uri when device flow is checked
  function handleDeviceFlowToggle(checked: boolean) {
    setDraft((d) => ({
      ...d,
      set_as_device_shared_client: checked,
      redirect_uri: checked && !d.redirect_uri && deviceSettings?.default_redirect_uri
        ? deviceSettings.default_redirect_uri
        : d.redirect_uri,
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

      {/* Device Settings Info */}
      {deviceSettings && (
        <div className="surface-card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
          <MonitorSmartphone style={{ width: 20, height: 20, color: 'var(--color-primary)', flexShrink: 0 }} />
          <div style={{ flex: 1, fontSize: 13, color: 'var(--color-text-light)' }}>
            设备流默认回调 URL：<code style={{ color: 'var(--color-heading)', fontWeight: 500 }}>{deviceSettings.default_redirect_uri}</code>
            {deviceSettings.shared_client_ids.length > 0 && (
              <span style={{ marginLeft: 12 }}>共享 Client ID：{deviceSettings.shared_client_ids.join(', ')}</span>
            )}
          </div>
        </div>
      )}

      {/* Create form */}
      <form onSubmit={create} className="surface-card" style={{ padding: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-heading)', margin: '0 0 16px 0' }}>
          新建应用
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginBottom: 12 }}>
          <FieldInput label="应用名称" value={draft.client_name} onChange={(v) => setDraft({ ...draft, client_name: v })} required />
          <FieldInput label="redirect_uri" value={draft.redirect_uri} onChange={(v) => setDraft({ ...draft, redirect_uri: v })} required placeholder={deviceSettings?.default_redirect_uri || 'https://your-app.example.com/oauth/callback'} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <FieldInput label="描述" value={draft.description} onChange={(v) => setDraft({ ...draft, description: v })} />
        </div>
        <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={draft.set_as_device_shared_client}
            onChange={(e) => handleDeviceFlowToggle(e.target.checked)}
            style={{ accentColor: 'var(--color-primary)' }}
          />
          设为 Device Flow 共享应用（用于启动器等设备授权登录）
        </label>
        <button type="submit" disabled={creating} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
            <div key={a.app_id} className="surface-card" style={{ padding: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
                <div>
                  <p style={{ fontWeight: 600, fontSize: 16, color: 'var(--color-heading)', margin: 0 }}>
                    {a.client_name}
                    {a.is_device_shared && (
                      <span style={{ marginLeft: 8, fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'color-mix(in srgb, var(--color-primary) 10%, transparent)', color: 'var(--color-primary)', fontWeight: 600 }}>
                        device shared
                      </span>
                    )}
                  </p>
                  {a.description && <p style={{ fontSize: 12, color: 'var(--color-text-light)', marginTop: 4 }}>{a.description}</p>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => openEditModal(a)} className="btn-ghost" style={{ padding: '4px 12px', fontSize: 12 }}>
                    <Pencil style={{ width: 12, height: 12 }} /> 编辑
                  </button>
                  <button onClick={() => resetSecret(a.app_id)} className="btn-ghost" style={{ padding: '4px 12px', fontSize: 12 }}>
                    <RefreshCw style={{ width: 12, height: 12 }} /> 重新生成 secret
                  </button>
                  <button onClick={() => remove(a.app_id)} className="btn-destructive" style={{ padding: '4px 12px', fontSize: 12 }}>
                    <Trash2 style={{ width: 12, height: 12 }} /> 删除
                  </button>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                <CredRow label="client_id (app_id)" value={String(a.app_id)} onCopy={() => copy(`id-${a.app_id}`, String(a.app_id))} copied={copied === `id-${a.app_id}`} />
                <CredRow label="redirect_uri" value={a.redirect_uri} onCopy={() => copy(`ru-${a.app_id}`, a.redirect_uri)} copied={copied === `ru-${a.app_id}`} />
              </div>
            </div>
          ))}
          {items.length === 0 && <p style={{ color: 'var(--color-text-light)' }}>还没有任何 OAuth 应用。</p>}
        </div>
      )}

      {/* Secret Modal — shown once after create or reset */}
      {secretModal && secretModal.open && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 110, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={(e) => { if (e.target === e.currentTarget) setSecretModal(null); }}
        >
          <div style={{ background: 'var(--color-card-background)', borderRadius: 16, maxWidth: 480, width: '100%', boxShadow: '0 16px 48px rgba(0,0,0,0.2)', animation: 'slideUp 0.3s ease-out', padding: 24 }}>
            <div style={{
              padding: '10px 14px', borderRadius: 8, marginBottom: 16,
              background: 'color-mix(in srgb, #f59e0b 10%, transparent)', border: '1px solid color-mix(in srgb, #f59e0b 20%, transparent)',
              display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: '#f59e0b', fontWeight: 500,
            }}>
              ⚠️ client_secret 仅显示一次，请立即复制保存！关闭后无法再次查看。
            </div>
            <h3 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700, color: 'var(--color-heading)' }}>
              {secretModal.client_name}
            </h3>
            <CredRow label="client_id (app_id)" value={String(secretModal.app_id)} onCopy={() => copy('sm-id', String(secretModal.app_id))} copied={copied === 'sm-id'} />
            <div style={{ height: 12 }} />
            <CredRow label="client_secret" value={secretModal.client_secret} onCopy={() => copy('sm-secret', secretModal.client_secret)} copied={copied === 'sm-secret'} />
            <div style={{ marginTop: 20, textAlign: 'right' }}>
              <button onClick={() => setSecretModal(null)} className="btn-primary" style={{ padding: '8px 24px' }}>
                我已保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editModal && editModal.open && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 110, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={(e) => { if (e.target === e.currentTarget) setEditModal(null); }}
        >
          <div style={{ background: 'var(--color-card-background)', borderRadius: 16, maxWidth: 480, width: '100%', boxShadow: '0 16px 48px rgba(0,0,0,0.2)', animation: 'slideUp 0.3s ease-out', padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-heading)' }}>编辑应用</h3>
              <button onClick={() => setEditModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-light)' }}>
                <X style={{ width: 18, height: 18 }} />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <FieldInput label="应用名称" value={editModal.client_name} onChange={(v) => setEditModal({ ...editModal!, client_name: v })} required />
              <FieldInput label="描述" value={editModal.description} onChange={(v) => setEditModal({ ...editModal!, description: v })} />
              <FieldInput label="redirect_uri" value={editModal.redirect_uri} onChange={(v) => setEditModal({ ...editModal!, redirect_uri: v })} required />
              <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={editModal.is_device_shared}
                  onChange={(e) => setEditModal({ ...editModal!, is_device_shared: e.target.checked })}
                  style={{ accentColor: 'var(--color-primary)' }}
                />
                设为 Device Flow 共享应用
              </label>
            </div>
            <div style={{ marginTop: 20, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setEditModal(null)} className="btn-ghost" style={{ padding: '8px 20px' }}>取消</button>
              <button onClick={saveEdit} disabled={editModal.saving} className="btn-primary" style={{ padding: '8px 20px' }}>
                {editModal.saving ? <Loader2 className="w-4 h-4 animate-spin" /> : '保存'}
              </button>
            </div>
          </div>
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

function FieldInput({ label, value, onChange, required, placeholder }: { label: string; value: string; onChange: (v: string) => void; required?: boolean; placeholder?: string }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 13, fontWeight: 500 }}>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} required={required} placeholder={placeholder} className="input" />
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
