'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useUserStore } from '@/stores/user';
import { Loader2 } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
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
      router.push('/dashboard');
    } catch (err: any) {
      setError(err?.response?.data?.detail || '登录失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container py-20 max-w-md">
      <div className="glass-card p-8 space-y-6">
        <header className="space-y-2 text-center">
          <h1 className="text-3xl font-bold">登录</h1>
          <p className="text-sm text-muted-foreground">登录像素北科账户</p>
        </header>
        <form onSubmit={submit} className="space-y-4">
          <Field label="邮箱">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="input"
              autoComplete="email"
            />
          </Field>
          <Field label="密码">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="input"
              autoComplete="current-password"
            />
          </Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />} 登录
          </button>
        </form>
        <div className="flex items-center justify-between text-sm">
          <Link href="/reset-password" className="text-muted-foreground hover:text-primary">
            忘记密码？
          </Link>
          <Link href="/register" className="text-primary hover:underline">
            注册新账户
          </Link>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
