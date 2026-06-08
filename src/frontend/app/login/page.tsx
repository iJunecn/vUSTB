'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useUserStore } from '@/stores/user';
import { Loader2, QrCode, Github, Check, X } from 'lucide-react';

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') || '/dashboard';
  const setToken = useUserStore((s) => s.setToken);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showSsoModal, setShowSsoModal] = useState(false);
  const [ssoQrUrl, setSsoQrUrl] = useState('');
  const [ssoSessionId, setSsoSessionId] = useState('');
  const [ssoLoading, setSsoLoading] = useState(false);
  const [ssoPolling, setSsoPolling] = useState(false);
  const [ssoStatus, setSsoStatus] = useState<'waiting' | 'success' | 'expired' | 'error' | 'unregistered'>('waiting');
  const [ssoError, setSsoError] = useState('');
  const [ssoOauthToken, setSsoOauthToken] = useState('');

  const [githubLoading, setGithubLoading] = useState(false);

  useEffect(() => {
    const accessToken = searchParams.get('access_token');
    const oauthError = searchParams.get('oauth_error');

    if (accessToken) {
      setToken(accessToken).then(() => {
        router.replace(next);
      });
      return;
    }

    if (oauthError) {
      const messages: Record<string, string> = {
        banned: '账号已被封禁',
        invalid_state: '授权状态无效，请重试',
        state_expired: '授权已过期，请重试',
        missing_params: '授权参数缺失',
      };
      setError(messages[oauthError] || `第三方登录失败: ${oauthError}`);

      router.replace('/login', { scroll: false });
    }
  }, [searchParams, setToken, router, next]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r = await api.post<{ access_token: string }>('/auth/login', {
        identifier,
        password,
      });
      await setToken(r.data.access_token);
      router.replace(next);
    } catch (err: any) {
      setError(err?.response?.data?.detail || '登录失败');
    } finally {
      setLoading(false);
    }
  }


  async function startSsoLogin() {
    setSsoLoading(true);
    setSsoError('');
    setSsoStatus('waiting');
    try {
      const res = await api.post('/ustb-sso/login/init');
      setSsoQrUrl(res.data.qr_url);
      setSsoSessionId(res.data.session_id);
      setShowSsoModal(true);
      setSsoPolling(true);
    } catch (err: any) {
      setError(err?.response?.data?.detail || '初始化 SSO 认证失败');
    } finally {
      setSsoLoading(false);
    }
  }

  useEffect(() => {
    if (!ssoPolling || !ssoSessionId) return;
    const interval = setInterval(async () => {
      try {
        const res = await api.get('/ustb-sso/login/poll', { params: { session_id: ssoSessionId } });
        const status = res.data.status;
        if (status === 'success') {
          const accessToken = res.data.access_token;
          setSsoStatus('success');
          setSsoPolling(false);
          if (accessToken) {
            await setToken(accessToken);
            setTimeout(() => {
              router.replace(next);
            }, 1000);
          }
        } else if (status === 'unregistered') {
          setSsoStatus('unregistered');
          setSsoPolling(false);
          setSsoOauthToken(res.data.oauth_token);
        } else if (status === 'expired') {
          setSsoStatus('expired');
          setSsoPolling(false);
        } else if (status === 'error') {
          setSsoStatus('error');
          setSsoError(res.data.message || '认证失败');
          setSsoPolling(false);
        }
      } catch (err: any) {
        if (err?.response?.status === 410) {
          setSsoStatus('expired');
          setSsoPolling(false);
        }
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [ssoPolling, ssoSessionId, setToken, router, next]);

  function closeSsoModal() {
    setShowSsoModal(false);
    setSsoPolling(false);
    setSsoSessionId('');
    setSsoQrUrl('');
    setSsoStatus('waiting');
    setSsoError('');
  }


  async function startGithubLogin() {
    setGithubLoading(true);
    try {
      // Redirect to backend OAuth endpoint which 302s to GitHub
      window.location.href = '/api/auth/oauth/github';
    } catch {
      setGithubLoading(false);
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
            <span style={{ fontSize: '14px', fontWeight: 500 }}>用户名 / 邮箱 / 手机号</span>
            <input
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
              className="input"
              autoComplete="username"
              placeholder="输入用户名、邮箱或手机号"
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

        <div style={{ marginTop: '24px' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '12px',
            marginBottom: '16px',
          }}>
            <div style={{ flex: 1, height: '1px', background: 'var(--color-border)' }} />
            <span style={{ fontSize: '12px', color: 'var(--color-text-light)', whiteSpace: 'nowrap' }}>
              其他登录方式
            </span>
            <div style={{ flex: 1, height: '1px', background: 'var(--color-border)' }} />
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={startSsoLogin}
              disabled={ssoLoading}
              className="btn-ghost"
              style={{
                flex: 1, padding: '10px 16px', fontSize: '13px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              }}
            >
              {ssoLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode style={{ width: 16, height: 16 }} />}
              北科大统一验证
            </button>
            <button
              onClick={startGithubLogin}
              disabled={githubLoading}
              className="btn-ghost"
              style={{
                flex: 1, padding: '10px 16px', fontSize: '13px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              }}
            >
              {githubLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Github style={{ width: 16, height: 16 }} />}
              GitHub
            </button>
          </div>
        </div>

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

      {showSsoModal && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
          }}
          onClick={closeSsoModal}
        >
          <div
            className="surface-card"
            style={{ width: '90%', maxWidth: 400, padding: 24, textAlign: 'center' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-heading)', margin: 0 }}>
                北科大统一验证登录
              </h3>
              <button
                onClick={closeSsoModal}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--color-text-light)', padding: 4,
                }}
              >
                <X style={{ width: 18, height: 18 }} />
              </button>
            </div>

            <p style={{ fontSize: 14, color: 'var(--color-text-light)', marginBottom: 20 }}>
              请使用微信扫描下方二维码登录
            </p>

            {ssoStatus === 'waiting' && ssoQrUrl && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={ssoQrUrl}
                  alt="USTB SSO QR Code"
                  style={{
                    width: 200, height: 200, borderRadius: 12,
                    border: '1px solid var(--color-border)',
                    background: '#fff',
                  }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--color-text-light)' }}>
                  {ssoPolling && <Loader2 className="w-4 h-4 animate-spin" />}
                  {ssoPolling ? '等待扫码中...' : '加载中...'}
                </div>
              </div>
            )}

            {ssoStatus === 'success' && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 56, height: 56, borderRadius: '50%',
                    background: 'color-mix(in srgb, #22c55e 15%, transparent)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Check style={{ width: 28, height: 28, color: '#22c55e' }} />
                </div>
                <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-heading)', margin: 0 }}>
                  登录成功
                </p>
                <p style={{ fontSize: 13, color: 'var(--color-text-light)', margin: 0 }}>
                  正在跳转...
                </p>
              </div>
            )}

            {ssoStatus === 'unregistered' && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                <p style={{ fontSize: 14, color: 'var(--color-heading)', margin: 0, fontWeight: 600 }}>
                  该学号尚未绑定账户
                </p>
                <p style={{ fontSize: 13, color: 'var(--color-text-light)', margin: 0 }}>
                  注册后可自动绑定
                </p>
                <button
                  onClick={() => {
                    closeSsoModal();
                    router.push(`/register?oauth_token=${ssoOauthToken}&sso=1`);
                  }}
                  className="btn-primary"
                  style={{ padding: '8px 16px', fontSize: 13 }}
                >
                  前往注册
                </button>
              </div>
            )}

            {ssoStatus === 'expired' && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                <p style={{ fontSize: 14, color: '#ef4444', margin: 0 }}>
                  二维码已过期，请重新获取
                </p>
                <button
                  onClick={() => {
                    closeSsoModal();
                    startSsoLogin();
                  }}
                  className="btn-primary"
                  style={{ padding: '8px 16px', fontSize: 13 }}
                >
                  重新获取
                </button>
              </div>
            )}

            {ssoStatus === 'error' && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                <p style={{ fontSize: 14, color: '#ef4444', margin: 0 }}>
                  {ssoError || '认证失败，请重试'}
                </p>
                <button
                  onClick={() => {
                    closeSsoModal();
                    startSsoLogin();
                  }}
                  className="btn-primary"
                  style={{ padding: '8px 16px', fontSize: 13 }}
                >
                  重新获取
                </button>
              </div>
            )}
          </div>
        </div>
      )}
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
