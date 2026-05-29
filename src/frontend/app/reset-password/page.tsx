'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Loader2 } from 'lucide-react';

export default function ResetPasswordPage() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function sendCode() {
    if (!email) return setError('请先填写邮箱');
    setError(null);
    setSending(true);
    try {
      await api.post('/auth/send-verification-code', { email, purpose: 'reset' });
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
      await api.post('/auth/reset-password', {
        email,
        verification_code: code,
        new_password: password,
      });
      setNotice('密码已重置,请重新登录。');
    } catch (err: any) {
      setError(err?.response?.data?.detail || '重置失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container py-20 max-w-md">
      <div className="glass-card p-8 space-y-6">
        <header className="space-y-2 text-center">
          <h1 className="text-3xl font-bold">重置密码</h1>
        </header>
        <form onSubmit={submit} className="space-y-4">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium flex items-center justify-between">
              邮箱
              <button
                type="button"
                onClick={sendCode}
                disabled={sending}
                className="text-xs text-primary hover:underline disabled:opacity-50"
              >
                {sending ? '发送中…' : '获取验证码'}
              </button>
            </span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">邮箱验证码</span>
            <input
              type="text"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="input"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">新密码</span>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
            />
          </label>
          {notice && <p className="text-sm text-primary">{notice}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />} 重置密码
          </button>
        </form>
        <div className="text-sm text-center">
          <Link href="/login" className="text-primary hover:underline">
            返回登录
          </Link>
        </div>
      </div>
    </div>
  );
}
