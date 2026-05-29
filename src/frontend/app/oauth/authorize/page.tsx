'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useUserStore } from '@/stores/user';
import { Loader2, Shield } from 'lucide-react';

export default function OAuthAuthorizePage() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loaded, hydrate } = useUserStore();
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function approve() {
    setApproving(true);
    setError(null);
    try {
      const r = await api.post<{ redirect: string }>('/oauth/api/approve', {
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
      <div className="container py-20 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container py-16 max-w-md">
      <div className="glass-card p-8 space-y-6">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
          <Shield className="w-6 h-6 text-primary" />
        </div>
        <header className="text-center space-y-2">
          <h1 className="text-2xl font-bold">第三方应用申请授权</h1>
          <p className="text-sm text-muted-foreground">
            client_id <code className="text-foreground">{client_id || '?'}</code> 想要访问你的像素北科账户
          </p>
        </header>

        <div className="glass-card p-4 space-y-2">
          <p className="text-xs text-muted-foreground">将授权以下权限</p>
          <ul className="space-y-1">
            {scope.split(/\s+/).filter(Boolean).map((s) => (
              <li key={s} className="text-sm flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-primary" /> {s}
              </li>
            ))}
          </ul>
        </div>
        <div className="text-xs text-muted-foreground space-y-1">
          <p>回调地址: <code className="text-foreground break-all">{redirect_uri || '(missing)'}</code></p>
          <p>当前用户: <b className="text-foreground">{user.username}</b></p>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-3">
          <button onClick={() => router.back()} className="btn-ghost flex-1">取消</button>
          <button onClick={approve} disabled={approving || !client_id || !redirect_uri} className="btn-primary flex-1">
            {approving && <Loader2 className="w-4 h-4 animate-spin" />} 同意授权
          </button>
        </div>
      </div>
    </div>
  );
}
