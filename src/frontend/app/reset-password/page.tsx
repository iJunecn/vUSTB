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
      setNotice('验证码已发送，请查收邮件。');
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
      setNotice('密码已重置，请重新登录。');
    } catch (err: any) {
      setError(err?.response?.data?.detail || '重置失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-panel">
        <header style={{ textAlign: 'center', marginBottom: '28px' }}>
          <h1 style={{ fontSize: '28px', fontWeight: 700, margin: '0 0 8px', color: 'var(--color-heading)' }}>
            重置密码
          </h1>
          <p style={{ fontSize: '14px', color: 'var(--color-text-light)', margin: 0 }}>
            通过邮箱验证码重置你的密码
          </p>
        </header>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '14px', fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              邮箱
              <button
                type="button"
                onClick={sendCode}
                disabled={sending}
                style={{ fontSize: '12px', color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, opacity: sending ? 0.5 : 1 }}
              >
                {sending ? '发送中...' : '获取验证码'}
              </button>
            </span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
              placeholder="your@email.com"
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '14px', fontWeight: 500 }}>邮箱验证码</span>
            <input
              type="text"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="input"
              placeholder="输入验证码"
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '14px', fontWeight: 500 }}>新密码</span>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              autoComplete="new-password"
              placeholder="至少 8 个字符"
            />
          </label>

          {notice && (
            <p style={{ fontSize: '14px', color: 'var(--color-primary)', margin: 0 }}>{notice}</p>
          )}
          {error && (
            <p style={{ fontSize: '14px', color: '#dc2626', margin: 0 }}>{error}</p>
          )}

          <button type="submit" disabled={loading} className="btn-primary" style={{ width: '100%' }}>
            {loading && <Loader2 className="w-4 h-4 animate-spin" />} 重置密码
          </button>
        </form>

        <p style={{ fontSize: '14px', textAlign: 'center', marginTop: '20px' }}>
          <Link href="/login" style={{ color: 'var(--color-primary)', textDecoration: 'none', fontWeight: 500 }}>
            返回登录
          </Link>
        </p>
      </div>
    </div>
  );
}
