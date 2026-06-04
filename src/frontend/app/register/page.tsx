'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useUserStore } from '@/stores/user';
import { Loader2, Github, Check, AlertCircle } from 'lucide-react';

function RegisterInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
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
  const [countdown, setCountdown] = useState(0);

  // Countdown timer for resend
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  // OAuth token info
  const oauthToken = searchParams.get('oauth_token') || '';
  const isSso = searchParams.get('sso') === '1';
  const githubLogin = searchParams.get('github_login') || '';
  const [oauthInfo, setOauthInfo] = useState<{ provider: string; github_name?: string; real_name?: string; student_id?: string } | null>(null);
  const [oauthInfoLoaded, setOauthInfoLoaded] = useState(false);

  // Fetch pending OAuth info if token exists
  useEffect(() => {
    if (!oauthToken) {
      setOauthInfoLoaded(true);
      return;
    }
    api.get('/auth/oauth/pending-info', { params: { oauth_token: oauthToken } })
      .then((res) => {
        setOauthInfo(res.data);
      })
      .catch(() => {
        // Token invalid/expired — ignore silently
      })
      .finally(() => {
        setOauthInfoLoaded(true);
      });
  }, [oauthToken]);

  async function sendCode() {
    if (!email) return setError('请先填写邮箱');
    setError(null);
    setSending(true);
    try {
      await api.post('/auth/send-verification-code', { email, purpose: 'register' });
      setSentCode(true);
      setCountdown(60);
      setNotice('验证码已发送，请查收邮件。');
    } catch (err: any) {
      setError(err?.response?.data?.detail || '发送失败');
    } finally {
      setSending(false);
    }
  }

  const ALLOWED_SUFFIXES = ['xs.ustb.edu.cn', 'ustb.edu.cn', 'ustb.world', 'qq.com'];

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
    if (!verificationCode || verificationCode.length !== 6) {
      setError('请输入 6 位邮箱验证码');
      return;
    }
    // 校验邮箱后缀
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain || !ALLOWED_SUFFIXES.some(s => domain === s || domain.endsWith('.' + s))) {
      setError('仅支持 @xs.ustb.edu.cn、@ustb.edu.cn、@ustb.world、@qq.com 邮箱注册');
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
        verification_code: verificationCode,
        invite_code: inviteCode || undefined,
        oauth_token: oauthToken || undefined,
      });

      await setToken(r.data.access_token);

      // If we had an OAuth token, try to bind it (in case the register endpoint didn't auto-bind)
      if (oauthToken) {
        try {
          await api.post('/auth/oauth/bind-pending', { oauth_token: oauthToken });
        } catch {
          // Ignore — the register endpoint should have already handled binding
        }
      }

      router.replace('/dashboard');
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

        {/* OAuth binding notice */}
        {oauthToken && oauthInfoLoaded && oauthInfo && (
          <div
            style={{
              padding: '12px 16px', borderRadius: 10, marginBottom: 16,
              border: '1px solid color-mix(in srgb, var(--color-primary) 30%, transparent)',
              background: 'color-mix(in srgb, var(--color-primary) 8%, transparent)',
              display: 'flex', alignItems: 'center', gap: 10,
            }}
          >
            <Check style={{ width: 18, height: 18, color: 'var(--color-primary)', flexShrink: 0 }} />
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-heading)', margin: 0 }}>
                检测到第三方登录，注册后将自动绑定
              </p>
              <p style={{ fontSize: 12, color: 'var(--color-text-light)', margin: '4px 0 0' }}>
                {oauthInfo.provider === 'github' && (
                  <>
                    <Github style={{ width: 12, height: 12, display: 'inline', verticalAlign: '-1px' }} />
                    {' '}GitHub{oauthInfo.github_name ? `（${oauthInfo.github_name}）` : ''}
                  </>
                )}
                {oauthInfo.provider === 'ustb_sso' && (
                  <>
                    北科大统一验证
                    {oauthInfo.real_name ? `（${oauthInfo.real_name}` : ''}
                    {oauthInfo.student_id ? `，${oauthInfo.student_id}）` : oauthInfo.real_name ? '）' : ''}
                  </>
                )}
              </p>
            </div>
          </div>
        )}

        {/* OAuth token expired/invalid notice */}
        {oauthToken && oauthInfoLoaded && !oauthInfo && (
          <div
            style={{
              padding: '12px 16px', borderRadius: 10, marginBottom: 16,
              border: '1px solid color-mix(in srgb, #f59e0b 30%, transparent)',
              background: 'color-mix(in srgb, #f59e0b 8%, transparent)',
              display: 'flex', alignItems: 'center', gap: 10,
            }}
          >
            <AlertCircle style={{ width: 18, height: 18, color: '#f59e0b', flexShrink: 0 }} />
            <p style={{ fontSize: 13, color: 'var(--color-text-light)', margin: 0 }}>
              第三方登录信息已过期，注册后将需要重新绑定
            </p>
          </div>
        )}

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
              placeholder="@xs.ustb.edu.cn / @ustb.edu.cn / @ustb.world / @qq.com"
            />
            <p style={{ fontSize: 11, color: 'var(--color-text-light)', margin: '2px 0 0' }}>仅支持 @xs.ustb.edu.cn、@ustb.edu.cn、@ustb.world、@qq.com 邮箱注册</p>
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
              邮箱验证码（必填）
              <button
                type="button"
                onClick={sendCode}
                disabled={sending || countdown > 0}
                style={{ fontSize: '12px', color: 'var(--color-primary)', background: 'none', border: 'none', cursor: (sending || countdown > 0) ? 'not-allowed' : 'pointer', padding: 0, opacity: (sending || countdown > 0) ? 0.5 : 1 }}
              >
                {sending ? '发送中...' : countdown > 0 ? `${countdown}s 后重发` : sentCode ? '重新发送' : '获取验证码'}
              </button>
            </span>
            <input
              type="text"
              required
              minLength={6}
              maxLength={6}
              value={verificationCode}
              onChange={(e) => setVerificationCode(e.target.value)}
              className="input"
              placeholder="6 位数字验证码"
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

export default function RegisterPage() {
  return (
    <Suspense fallback={
      <div className="auth-shell">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--color-text-light)' }} />
      </div>
    }>
      <RegisterInner />
    </Suspense>
  );
}
