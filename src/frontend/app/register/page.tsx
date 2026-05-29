'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useUserStore } from '@/stores/user';
import { Loader2 } from 'lucide-react';

export default function RegisterPage() {
  const router = useRouter();
  const setToken = useUserStore((s) => s.setToken);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [sentCode, setSentCode] = useState(false);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function sendCode() {
    if (!email) return setError('请先填写邮箱');
    setError(null);
    setSending(true);
    try {
      await api.post('/auth/send-verification-code', { email, purpose: 'register' });
      setSentCode(true);
      setNotice('验证码已发送,请查收邮件。');
    } catch (err: any) {
      setError(err?.response?.data?.detail || '发送失败');
    } finally {
      setSending(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r = await api.post<{ access_token: string }>('/auth/register', {
        email,
        username,
        password,
        verification_code: verificationCode || undefined,
        invite_code: inviteCode || undefined,
      });
      setToken(r.data.access_token);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err?.response?.data?.detail || '注册失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container py-20 max-w-md">
      <div className="glass-card p-8 space-y-6">
        <header className="space-y-2 text-center">
          <h1 className="text-3xl font-bold">注册</h1>
          <p className="text-sm text-muted-foreground">创建像素北科账户</p>
        </header>
        <form onSubmit={submit} className="space-y-4">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">邮箱</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
              autoComplete="email"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">用户名</span>
            <input
              type="text"
              required
              minLength={3}
              maxLength={32}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="input"
              autoComplete="username"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">密码</span>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              autoComplete="new-password"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium flex items-center justify-between">
              邮箱验证码（可选）
              <button
                type="button"
                onClick={sendCode}
                disabled={sending}
                className="text-xs text-primary hover:underline disabled:opacity-50"
              >
                {sending ? '发送中…' : sentCode ? '重新发送' : '获取验证码'}
              </button>
            </span>
            <input
              type="text"
              value={verificationCode}
              onChange={(e) => setVerificationCode(e.target.value)}
              className="input"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium">邀请码（如需要）</span>
            <input
              type="text"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              className="input"
            />
          </label>

          {notice && <p className="text-sm text-primary">{notice}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />} 注册
          </button>
        </form>
        <div className="text-sm text-center">
          已有账户？{' '}
          <Link href="/login" className="text-primary hover:underline">
            前往登录
          </Link>
        </div>
      </div>
    </div>
  );
}
