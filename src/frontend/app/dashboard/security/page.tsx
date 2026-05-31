'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useUserStore } from '@/stores/user';
import { Loader2, Lock, User as UserIcon, Mail, Phone, IdCard, BadgeCheck } from 'lucide-react';

type Msg = { ok: boolean; text: string };

export default function SecurityPage() {
  const { user, hydrate } = useUserStore();

  // Account info form
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [realName, setRealName] = useState('');
  const [studentId, setStudentId] = useState('');
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoMsg, setInfoMsg] = useState<Msg | null>(null);

  // Password form
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPwd, setSavingPwd] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<Msg | null>(null);

  useEffect(() => {
    if (user) {
      setUsername(user.username || '');
      setEmail(user.email || '');
      setPhone(user.phone || '');
      setRealName(user.real_name || '');
      setStudentId(user.student_id || '');
    }
  }, [user]);

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
        real_name: realName.trim() || null,
        student_id: studentId.trim() || null,
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

        <div style={{ height: 1, background: 'var(--color-border)', margin: '4px 0' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <BadgeCheck style={{ width: 18, height: 18, color: 'var(--color-text-light)' }} />
          <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-heading)', margin: 0 }}>备选信息（选填）</h3>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          <Field icon={<IdCard className="w-4 h-4" />} label="姓名">
            <input
              value={realName}
              onChange={(e) => setRealName(e.target.value)}
              className="input"
              maxLength={64}
              placeholder="如：张三"
            />
          </Field>
          <Field icon={<IdCard className="w-4 h-4" />} label="学工号">
            <input
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              className="input"
              maxLength={32}
              placeholder="如：U202412345"
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
