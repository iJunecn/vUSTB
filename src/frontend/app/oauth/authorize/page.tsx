'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { rawApi } from '@/lib/api';
import { useUserStore } from '@/stores/user';
import { Loader2, Shield } from 'lucide-react';

type AuthorizePreview = {
  app_id: number;
  client_name: string;
  requester_name: string;
  site_name: string;
  redirect_uri: string;
  state: string;
  scope: string;
  scope_items: { key: string; label: string; description: string }[];
};

function AuthorizeInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loaded, hydrate } = useUserStore();
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<AuthorizePreview | null>(null);

  const client_id = params.get('client_id') || '';
  const redirect_uri = params.get('redirect_uri') || '';
  const state = params.get('state') || '';
  const scope = params.get('scope') || 'userinfo';

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (loaded && !user) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      router.replace(`/login?next=${next}`);
    }
  }, [loaded, user, router]);

  // Fetch authorize preview to show app name and scope details
  useEffect(() => {
    if (!client_id || !redirect_uri) return;
    rawApi.get<AuthorizePreview>('/oauth/authorize/check', {
      params: { client_id, redirect_uri, state, scope },
    }).then((r) => setPreview(r.data)).catch(() => {});
  }, [client_id, redirect_uri, state, scope]);

  async function approve() {
    setApproving(true);
    setError(null);
    try {
      const r = await rawApi.post<{ redirect: string }>('/oauth/api/approve', {
        client_id, redirect_uri, state, scope,
      });
      window.location.href = r.data.redirect;
    } catch (err: any) {
      setError(err?.response?.data?.detail || '授权失败');
      setApproving(false);
    }
  }

  if (!loaded || !user) {
    return (
      <div className="auth-shell">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--color-text-light)' }} />
      </div>
    );
  }

  const displayName = preview?.requester_name || preview?.client_name || `应用 #${client_id}`;
  const scopeItems = preview?.scope_items || scope.split(/\s+/).filter(Boolean).map((s) => ({ key: s, label: s, description: '' }));

  return (
    <div className="auth-shell">
      <div className="auth-panel">
        <header style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '14px',
            background: 'var(--color-background-mute)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
          }}>
            <Shield style={{ width: '24px', height: '24px', color: 'var(--color-primary)' }} />
          </div>
          <h1 style={{ fontSize: '22px', fontWeight: 700, margin: '0 0 8px', color: 'var(--color-heading)' }}>
            第三方应用申请授权
          </h1>
          <p style={{ fontSize: '14px', color: 'var(--color-text-light)', margin: 0 }}>
            <strong style={{ color: 'var(--color-text)' }}>{displayName}</strong> 想要访问你的 {preview?.site_name || '像素北科'} 账户
          </p>
        </header>

        {/* Scopes */}
        <div style={{
          padding: '14px',
          border: '1px solid var(--color-border)',
          borderRadius: '12px',
          background: 'var(--color-background-soft)',
          marginBottom: '16px',
        }}>
          <p style={{ fontSize: '12px', color: 'var(--color-text-light)', margin: '0 0 8px' }}>
            将授权以下权限
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {scopeItems.map((s) => (
              <li key={s.key} style={{ fontSize: '14px', display: 'flex', alignItems: 'flex-start', gap: '8px', color: 'var(--color-text)' }}>
                <span style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: 'var(--color-primary)',
                  flexShrink: 0,
                  marginTop: '7px',
                }} />
                <div>
                  <span style={{ fontWeight: 500 }}>{s.label}</span>
                  {s.description && (
                    <span style={{ marginLeft: 6, fontSize: '12px', color: 'var(--color-text-light)' }}>{s.description}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Details */}
        <div style={{
          fontSize: '13px',
          color: 'var(--color-text-light)',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          marginBottom: '16px',
        }}>
          <p style={{ margin: 0 }}>
            回调地址: <code style={{ color: 'var(--color-text)', wordBreak: 'break-all' }}>{redirect_uri || '(missing)'}</code>
          </p>
          <p style={{ margin: 0 }}>
            当前用户: <strong style={{ color: 'var(--color-heading)' }}>{user.username}</strong>
          </p>
        </div>

        {error && (
          <p style={{ fontSize: '14px', color: '#dc2626', margin: '0 0 12px' }}>{error}</p>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '12px' }}>
          <button onClick={() => router.back()} className="btn-ghost" style={{ flex: 1 }}>
            取消
          </button>
          <button
            onClick={approve}
            disabled={approving || !client_id || !redirect_uri}
            className="btn-primary"
            style={{ flex: 1 }}
          >
            {approving && <Loader2 className="w-4 h-4 animate-spin" />} 同意授权
          </button>
        </div>
      </div>
    </div>
  );
}

export default function OAuthAuthorizePage() {
  return (
    <Suspense fallback={
      <div className="auth-shell">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--color-text-light)' }} />
      </div>
    }>
      <AuthorizeInner />
    </Suspense>
  );
}
