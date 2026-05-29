'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useUserStore } from '@/stores/user';
import { Loader2 } from 'lucide-react';

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') || '/dashboard';
  const setToken = useUserStore((s) => s.setToken);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r = await api.post<{ access_token: string }>('/auth/login', {
        email,
        password,
      });
      setToken(r.data.access_token);
      router.push(next);
    } catch (err: any) {
      setError(err?.response?.data?.detail || '登录失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-panel">
        <header style={{ textAlign: 'center', marginBottom: '28px' }}>
          <h1 style={{ fontSize: '28px', fontWeight: 700, margin: '0 0 8px', color: 'var(--color-heading)' }}>
            欢迎回来
          </h1>
          <p style={{ fontSize: '14px', color: 'var(--color-text-light)', margin: 0 }}>
            登录你的像素北科账户
          </p>
        </header>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '14px', fontWeight: 500 }}>邮箱</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="input"
              autoComplete="email"
              placeholder="your@email.com"
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '14px', fontWeight: 500 }}>密码</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="input"
              autoComplete="current-password"
              placeholder="输入密码"
            />
          </label>

          {error && (
            <p style={{ fontSize: '14px', color: '#dc2626', margin: 0 }}>{error}</p>
          )}

          <button type="submit" disabled={loading} className="btn-primary" style={{ width: '100%' }}>
            {loading && <Loader2 className="w-4 h-4 animate-spin" />} 登录
          </button>
        </form>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: '20px',
          fontSize: '14px',
        }}>
          <Link
            href="/reset-password"
            style={{ color: 'var(--color-text-light)', textDecoration: 'none' }}
          >
            忘记密码?
          </Link>
          <Link
            href="/register"
            style={{ color: 'var(--color-primary)', textDecoration: 'none', fontWeight: 500 }}
          >
            没有账户？立即注册
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="auth-shell">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--color-text-light)' }} />
      </div>
    }>
      <LoginInner />
    </Suspense>
  );
}
