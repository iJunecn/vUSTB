'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useUserStore } from '@/stores/user';
import { Loader2, Lock, User as UserIcon, Mail, Phone, Shield, QrCode, Unlink, Check, X, Github } from 'lucide-react';

type Msg = { ok: boolean; text: string };

function SecurityPageInner() {
  const { user, hydrate } = useUserStore();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Account info form
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoMsg, setInfoMsg] = useState<Msg | null>(null);

  // Password form
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPwd, setSavingPwd] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<Msg | null>(null);

  // USTB SSO binding
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrUrl, setQrUrl] = useState('');
  const [ssoSessionId, setSsoSessionId] = useState('');
  const [ssoLoading, setSsoLoading] = useState(false);
  const [ssoPolling, setSsoPolling] = useState(false);
  const [ssoStatus, setSsoStatus] = useState<'waiting' | 'success' | 'expired' | 'error'>('waiting');
  const [ssoError, setSsoError] = useState('');
  const [unbinding, setUnbinding] = useState(false);

  // GitHub binding
  const [githubBinding, setGithubBinding] = useState(false);
  const [githubUnbinding, setGithubUnbinding] = useState(false);

  // URL param messages (from OAuth redirect)
  const [githubBindMsg, setGithubBindMsg] = useState<Msg | null>(null);

  useEffect(() => {
    if (user) {
      setUsername(user.username || '');
      setEmail(user.email || '');
      setPhone(user.phone || '');
    }
  }, [user]);

  // Check URL params for GitHub bind result
  useEffect(() => {
    const githubBind = searchParams.get('github_bind');
    if (githubBind === 'success') {
      // 刷新用户数据，确保拿到最新的 github_id / github_name
      hydrate().then(() => {
        setGithubBindMsg({ ok: true, text: 'GitHub 账号绑定成功' });
        // 清理 URL 参数
        router.replace('/dashboard/security', { scroll: false });
        // 5 秒后自动清除消息
        setTimeout(() => setGithubBindMsg(null), 5000);
      });
    } else if (githubBind === 'error') {
      const msg = searchParams.get('msg') === 'already_bound'
        ? '该 GitHub 账号已被其他用户绑定'
        : 'GitHub 账号绑定失败';
      setGithubBindMsg({ ok: false, text: msg });
      router.replace('/dashboard/security', { scroll: false });
      setTimeout(() => setGithubBindMsg(null), 5000);
    }
  }, [searchParams, hydrate, router]);

  async function saveInfo(e: React.FormEvent) {
    e.preventDefault();
    setInfoMsg(null);
    if (username && !/^[A-Za-z0-9]+$/.test(username)) {
      setInfoMsg({ ok: false, text: '用户名仅支持英文字母和数字' });
      return;
    }
    if (phone && !/^[0-9+\-\s]{5,32}$/.test(phone)) {
      setInfoMsg({ ok: false, text: '手机号格式不正确' });
      return;
    }
    setSavingInfo(true);
    try {
      await api.patch('/me', {
        username: username.trim(),
        email: email.trim(),
        phone: phone.trim(),
      });
      setInfoMsg({ ok: true, text: '账号信息已更新' });
      await hydrate();
    } catch (err: any) {
      setInfoMsg({ ok: false, text: err?.response?.data?.detail || '保存失败' });
    } finally {
      setSavingInfo(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwdMsg(null);
    if (newPassword !== confirmPassword) {
      setPwdMsg({ ok: false, text: '两次输入的新密码不一致' });
      return;
    }
    setSavingPwd(true);
    try {
      await api.post('/auth/change-password', {
        old_password: oldPassword,
        new_password: newPassword,
      });
      setPwdMsg({ ok: true, text: '密码已更新' });
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setPwdMsg({ ok: false, text: err?.response?.data?.detail || '修改失败' });
    } finally {
      setSavingPwd(false);
    }
  }

  // --- USTB SSO binding ---

  async function startSsoBind() {
    setSsoLoading(true);
    setSsoError('');
    setSsoStatus('waiting');
    try {
      // SSO 初始化可能需要 30 秒（多个 HTTP 请求到 USTB 服务器）
      const res = await api.post('/ustb-sso/init', {}, { timeout: 30000 });
      setQrUrl(res.data.qr_url);
      setSsoSessionId(res.data.session_id);
      setShowQrModal(true);
      setSsoPolling(true);
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.message || '初始化认证失败';
      setSsoError(msg);
      // 即使初始化失败也显示 modal，让用户看到错误
      setShowQrModal(true);
      setSsoStatus('error');
    } finally {
      setSsoLoading(false);
    }
  }

  // Polling effect
  useEffect(() => {
    if (!ssoPolling || !ssoSessionId) return;
    const interval = setInterval(async () => {
      try {
        const res = await api.get('/ustb-sso/poll', {
          params: { session_id: ssoSessionId },
          timeout: 20000, // 单次轮询最多等 20 秒
        });
        const status = res.data.status;
        if (status === 'success') {
          setSsoStatus('success');
          setSsoPolling(false);
          await hydrate();
          setTimeout(() => {
            setShowQrModal(false);
            setSsoSessionId('');
          }, 1500);
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
        } else if (err?.code === 'ECONNABORTED' || err?.message?.includes('timeout')) {
          // 轮询超时不报错，继续下一次
        } else {
          setSsoStatus('error');
          setSsoError(err?.response?.data?.detail || '网络请求失败');
          setSsoPolling(false);
        }
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [ssoPolling, ssoSessionId, hydrate]);

  const closeQrModal = useCallback(() => {
    setShowQrModal(false);
    setSsoPolling(false);
    setSsoSessionId('');
    setQrUrl('');
    setSsoStatus('waiting');
    setSsoError('');
  }, []);

  async function unbindSso() {
    setUnbinding(true);
    try {
      await api.post('/ustb-sso/unbind');
      await hydrate();
    } catch {
    } finally {
      setUnbinding(false);
    }
  }

  const isSsoBound = !!(user?.real_name && user?.student_id);
  const isGithubBound = !!(user?.github_id);  // github_id 是字符串，如 "12345678"

  // --- GitHub binding ---

  async function startGithubBind() {
    setGithubBinding(true);
    try {
      const res = await api.get('/github/auth-url');
      const authUrl = res.data.auth_url;
      // Redirect to GitHub authorization page
      window.location.href = authUrl;
    } catch (err: any) {
      setGithubBindMsg({ ok: false, text: err?.response?.data?.detail || '获取授权链接失败' });
    } finally {
      setGithubBinding(false);
    }
  }

  async function unbindGithub() {
    setGithubUnbinding(true);
    try {
      await api.post('/github/unbind');
      await hydrate();
      setGithubBindMsg({ ok: true, text: '已解绑 GitHub 账号' });
      // 引导用户去 GitHub 撤销应用授权
      window.open('https://github.com/settings/applications', '_blank');
    } catch (err: any) {
      setGithubBindMsg({ ok: false, text: err?.response?.data?.detail || '解绑失败' });
    } finally {
      setGithubUnbinding(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 640 }}>
      <div>
        <p className="section-kicker" style={{ marginBottom: 8 }}>SECURITY</p>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-heading)', margin: 0 }}>
          账号安全
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-light)', marginTop: 4 }}>
          修改账号信息和密码。用户名、邮箱、手机号在站内全局唯一。
        </p>
      </div>

      {/* Account info form */}
      <form onSubmit={saveInfo} className="surface-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <UserIcon style={{ width: 20, height: 20, color: 'var(--color-primary)' }} />
          <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-heading)', margin: 0 }}>账号信息</h2>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          <Field icon={<UserIcon className="w-4 h-4" />} label="用户名" hint="仅限英文字母和数字">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="input"
              autoComplete="username"
              minLength={3}
              maxLength={32}
              pattern="[A-Za-z0-9]+"
              required
            />
          </Field>
          <Field icon={<Mail className="w-4 h-4" />} label="邮箱">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
              autoComplete="email"
              required
            />
          </Field>
          <Field icon={<Phone className="w-4 h-4" />} label="手机号">
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="input"
              autoComplete="tel"
              required
            />
          </Field>
        </div>

        {infoMsg && (
          <p style={{ fontSize: 13, color: infoMsg.ok ? 'var(--color-primary)' : '#dc2626', margin: 0 }}>
            {infoMsg.text}
          </p>
        )}

        <div>
          <button type="submit" disabled={savingInfo} className="btn-primary">
            {savingInfo && <Loader2 className="w-4 h-4 animate-spin" />} 保存修改
          </button>
        </div>
      </form>

      {/* Account binding */}
      <div className="surface-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Shield style={{ width: 20, height: 20, color: 'var(--color-primary)' }} />
          <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-heading)', margin: 0 }}>账号绑定</h2>
        </div>

        {githubBindMsg && (
          <p style={{ fontSize: 13, color: githubBindMsg.ok ? 'var(--color-primary)' : '#dc2626', margin: 0 }}>
            {githubBindMsg.text}
          </p>
        )}

        {/* USTB SSO binding item */}
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 20px', borderRadius: 10,
            border: '1px solid var(--color-border)',
            background: 'var(--color-background-soft)',
            gap: 16, flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <div
              style={{
                width: 40, height: 40, borderRadius: 8, flexShrink: 0,
                background: 'color-mix(in srgb, var(--color-primary) 10%, transparent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 18, fontWeight: 700, color: 'var(--color-primary)',
              }}
            >
              U
            </div>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-heading)', margin: 0 }}>
                北京科技大学统一验证登录
              </p>
              {isSsoBound ? (
                <p style={{ fontSize: 13, color: 'var(--color-text-light)', margin: '4px 0 0' }}>
                  <Check style={{ width: 13, height: 13, display: 'inline', verticalAlign: '-2px', color: '#22c55e' }} />
                  {' '}{user.real_name}（{user.student_id}）
                </p>
              ) : (
                <p style={{ fontSize: 13, color: 'var(--color-text-light)', margin: '4px 0 0' }}>
                  微信扫码绑定，可自动获取姓名和学号
                </p>
              )}
            </div>
          </div>

          {isSsoBound ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  padding: '6px 14px', fontSize: 13, borderRadius: 6,
                  background: 'color-mix(in srgb, var(--color-text-light) 10%, transparent)',
                  color: 'var(--color-text-light)', fontWeight: 500,
                }}
              >
                <Check style={{ width: 13, height: 13, display: 'inline', verticalAlign: '-2px', color: '#22c55e' }} />
                {' '}已绑定
              </span>
              <button
                onClick={unbindSso}
                disabled={unbinding}
                className="btn-ghost"
                style={{ padding: '6px 14px', fontSize: 13, color: '#dc2626', borderColor: 'color-mix(in srgb, #dc2626 30%, transparent)' }}
              >
                {unbinding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlink style={{ width: 14, height: 14 }} />}
                解绑
              </button>
            </div>
          ) : (
            <button
              onClick={startSsoBind}
              disabled={ssoLoading}
              className="btn-primary"
              style={{ padding: '6px 14px', fontSize: 13 }}
            >
              {ssoLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode style={{ width: 14, height: 14 }} />}
              绑定
            </button>
          )}
        </div>

        {/* GitHub binding item */}
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 20px', borderRadius: 10,
            border: '1px solid var(--color-border)',
            background: 'var(--color-background-soft)',
            gap: 16, flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <div
              style={{
                width: 40, height: 40, borderRadius: 8, flexShrink: 0,
                background: 'color-mix(in srgb, #333 10%, transparent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Github style={{ width: 22, height: 22, color: 'var(--color-heading)' }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-heading)', margin: 0 }}>
                GitHub
              </p>
              {isGithubBound ? (
                <p style={{ fontSize: 13, color: 'var(--color-text-light)', margin: '4px 0 0' }}>
                  <Check style={{ width: 13, height: 13, display: 'inline', verticalAlign: '-2px', color: '#22c55e' }} />
                  {' '}{user!.github_name}
                </p>
              ) : (
                <p style={{ fontSize: 13, color: 'var(--color-text-light)', margin: '4px 0 0' }}>
                  绑定你的 GitHub 账号
                </p>
              )}
            </div>
          </div>

          {isGithubBound ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  padding: '6px 14px', fontSize: 13, borderRadius: 6,
                  background: 'color-mix(in srgb, var(--color-text-light) 10%, transparent)',
                  color: 'var(--color-text-light)', fontWeight: 500,
                }}
              >
                <Check style={{ width: 13, height: 13, display: 'inline', verticalAlign: '-2px', color: '#22c55e' }} />
                {' '}已绑定
              </span>
              <button
                onClick={unbindGithub}
                disabled={githubUnbinding}
                className="btn-ghost"
                style={{ padding: '6px 14px', fontSize: 13, color: '#dc2626', borderColor: 'color-mix(in srgb, #dc2626 30%, transparent)' }}
              >
                {githubUnbinding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlink style={{ width: 14, height: 14 }} />}
                解绑
              </button>
            </div>
          ) : (
            <button
              onClick={startGithubBind}
              disabled={githubBinding}
              className="btn-primary"
              style={{ padding: '6px 14px', fontSize: 13 }}
            >
              {githubBinding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Github style={{ width: 14, height: 14 }} />}
              绑定
            </button>
          )}
        </div>
      </div>

      {/* Password form */}
      <form onSubmit={changePassword} className="surface-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Lock style={{ width: 20, height: 20, color: 'var(--color-primary)' }} />
          <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-heading)', margin: 0 }}>修改密码</h2>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>当前密码</span>
          <input
            type="password"
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            required
            className="input"
            autoComplete="current-password"
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>新密码（至少 8 位）</span>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={8}
            className="input"
            autoComplete="new-password"
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>确认新密码</span>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={8}
            className="input"
            autoComplete="new-password"
          />
        </label>

        {pwdMsg && (
          <p style={{ fontSize: 13, color: pwdMsg.ok ? 'var(--color-primary)' : '#dc2626', margin: 0 }}>
            {pwdMsg.text}
          </p>
        )}

        <div>
          <button type="submit" disabled={savingPwd} className="btn-primary">
            {savingPwd && <Loader2 className="w-4 h-4 animate-spin" />} 更新密码
          </button>
        </div>
      </form>

      {/* QR Code Modal */}
      {showQrModal && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
          }}
          onClick={closeQrModal}
        >
          <div
            className="surface-card"
            style={{ width: '90%', maxWidth: 400, padding: 24, textAlign: 'center' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-heading)', margin: 0 }}>
                绑定北科大统一验证
              </h3>
              <button
                onClick={closeQrModal}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--color-text-light)', padding: 4,
                }}
              >
                <X style={{ width: 18, height: 18 }} />
              </button>
            </div>

            <p style={{ fontSize: 14, color: 'var(--color-text-light)', marginBottom: 20 }}>
              请使用微信扫描下方二维码完成认证
            </p>

            {ssoStatus === 'waiting' && qrUrl && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrUrl}
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
                  绑定成功
                </p>
                <p style={{ fontSize: 13, color: 'var(--color-text-light)', margin: 0 }}>
                  已获取您的姓名和学号
                </p>
              </div>
            )}

            {ssoStatus === 'expired' && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                <p style={{ fontSize: 14, color: '#ef4444', margin: 0 }}>
                  二维码已过期，请重新获取
                </p>
                <button
                  onClick={() => {
                    closeQrModal();
                    startSsoBind();
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
                    closeQrModal();
                    startSsoBind();
                  }}
                  className="btn-primary"
                  style={{ padding: '8px 16px', fontSize: 13 }}
                >
                  重新获取
                </button>
              </div>
            )}

            {ssoError && ssoStatus === 'waiting' && (
              <p style={{ fontSize: 13, color: '#ef4444', marginTop: 12 }}>
                {ssoError}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  icon,
  label,
  hint,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 13, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--color-text)' }}>
        <span style={{ color: 'var(--color-text-light)' }}>{icon}</span>
        {label}
        {hint && <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-text-light)' }}>· {hint}</span>}
      </span>
      {children}
    </label>
  );
}

export default function SecurityPage() {
  return (
    <Suspense fallback={
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--color-text-light)' }} />
      </div>
    }>
      <SecurityPageInner />
    </Suspense>
  );
}
