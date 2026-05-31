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
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
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
      setNotice('验证码已发送，请查收邮件。');
    } catch (err: any) {
      setError(err?.response?.data?.detail || '发送失败');
    } finally {
      setSending(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[A-Za-z0-9]+$/.test(username)) {
      setError('用户名仅支持英文字母和数字');
      return;
    }
    if (!/^[0-9+\-\s]{5,32}$/.test(phone)) {
      setError('请输入有效的手机号');
      return;
    }
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const r = await api.post<{ access_token: string }>('/auth/register', {
        email,
        username,
        phone,
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
    <div className="auth-shell">
      <div className="auth-panel">
        <header style={{ textAlign: 'center', marginBottom: '28px' }}>
          <h1 style={{ fontSize: '28px', fontWeight: 700, margin: '0 0 8px', color: 'var(--color-heading)' }}>
            创建账户
          </h1>
          <p style={{ fontSize: '14px', color: 'var(--color-text-light)', margin: 0 }}>
            注册像素北科账户
          </p>
        </header>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '14px', fontWeight: 500 }}>邮箱</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
              autoComplete="email"
              placeholder="your@email.com"
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '14px', fontWeight: 500 }}>用户名</span>
            <input
              type="text"
              required
              minLength={3}
              maxLength={32}
              pattern="[A-Za-z0-9]+"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="input"
              autoComplete="username"
              placeholder="3-32 位，仅限英文字母和数字"
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '14px', fontWeight: 500 }}>手机号</span>
            <input
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="input"
              autoComplete="tel"
              placeholder="11 位手机号"
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '14px', fontWeight: 500 }}>密码</span>
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

          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '14px', fontWeight: 500 }}>确认密码</span>
            <input
              type="password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="input"
              autoComplete="new-password"
              placeholder="再次输入密码"
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '14px', fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              邮箱验证码（可选）
              <button
                type="button"
                onClick={sendCode}
                disabled={sending}
                style={{ fontSize: '12px', color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, opacity: sending ? 0.5 : 1 }}
              >
                {sending ? '发送中...' : sentCode ? '重新发送' : '获取验证码'}
              </button>
            </span>
            <input
              type="text"
              value={verificationCode}
              onChange={(e) => setVerificationCode(e.target.value)}
              className="input"
              placeholder="输入邮箱验证码"
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '14px', fontWeight: 500 }}>邀请码（可选）</span>
            <input
              type="text"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              className="input"
              placeholder="如有邀请码请填写"
            />
          </label>

          {notice && (
            <p style={{ fontSize: '14px', color: 'var(--color-primary)', margin: 0 }}>{notice}</p>
          )}
          {error && (
            <p style={{ fontSize: '14px', color: '#dc2626', margin: 0 }}>{error}</p>
          )}

          <button type="submit" disabled={loading} className="btn-primary" style={{ width: '100%' }}>
            {loading && <Loader2 className="w-4 h-4 animate-spin" />} 注册
          </button>
        </form>

        <p style={{ fontSize: '14px', textAlign: 'center', marginTop: '20px', color: 'var(--color-text-light)' }}>
          已有账户？{' '}
          <Link href="/login" style={{ color: 'var(--color-primary)', textDecoration: 'none', fontWeight: 500 }}>
            前往登录
          </Link>
        </p>
      </div>
    </div>
  );
}
