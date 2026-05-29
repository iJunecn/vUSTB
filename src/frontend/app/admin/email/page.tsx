'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Loader2, Save, Mail, Shield } from 'lucide-react';

type Setting = { key: string; value: any };

export default function AdminEmailPage() {
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [savingSection, setSavingSection] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const r = await api.get<Setting[]>('/admin/settings');
      const map: Record<string, any> = {};
      for (const s of r.data) map[s.key] = s.value;
      setSettings(map);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function saveSection(sectionId: string, keys: string[]) {
    setSavingSection(sectionId);
    try {
      await Promise.all(
        keys.map((key) =>
          api.put(`/admin/settings/${key}`, { key, value: settings[key] })
        )
      );
    } finally {
      setSavingSection(null);
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--color-text-light)' }} />
      </div>
    );
  }

  const smtpKeys = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_password', 'smtp_ssl', 'smtp_from'];
  const verifyKeys = ['require_email_verify'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <p className="section-kicker" style={{ marginBottom: 8 }}>EMAIL</p>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-heading)', margin: 0 }}>
          邮件服务
        </h1>
      </div>

      {/* SMTP Config */}
      <div className="surface-card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <Mail style={{ width: 20, height: 20, color: 'var(--color-primary)' }} />
          <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-heading)', margin: 0 }}>
            SMTP 配置
          </h2>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>SMTP 主机</span>
              <input
                value={settings.smtp_host ?? ''}
                onChange={(e) => setSettings((s) => ({ ...s, smtp_host: e.target.value }))}
                className="input"
                placeholder="smtp.example.com"
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>端口</span>
              <input
                type="number"
                value={settings.smtp_port ?? ''}
                onChange={(e) => setSettings((s) => ({ ...s, smtp_port: Number(e.target.value) || '' }))}
                className="input"
                placeholder="465"
              />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>用户名</span>
              <input
                value={settings.smtp_user ?? ''}
                onChange={(e) => setSettings((s) => ({ ...s, smtp_user: e.target.value }))}
                className="input"
                placeholder="noreply@example.com"
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>密码</span>
              <input
                type="password"
                value={settings.smtp_password ?? ''}
                onChange={(e) => setSettings((s) => ({ ...s, smtp_password: e.target.value }))}
                className="input"
                placeholder="SMTP 授权码"
              />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>发件人名称</span>
              <input
                value={settings.smtp_from ?? ''}
                onChange={(e) => setSettings((s) => ({ ...s, smtp_from: e.target.value }))}
                className="input"
                placeholder="像素北科"
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>使用 SSL</span>
              <select
                value={String(!!settings.smtp_ssl)}
                onChange={(e) => setSettings((s) => ({ ...s, smtp_ssl: e.target.value === 'true' }))}
                className="input"
              >
                <option value="false">关闭</option>
                <option value="true">开启</option>
              </select>
            </label>
          </div>
        </div>
        <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={() => saveSection('smtp', smtpKeys)}
            disabled={savingSection === 'smtp'}
            className="btn-primary"
          >
            {savingSection === 'smtp' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save style={{ width: 16, height: 16 }} />}
            保存 SMTP 配置
          </button>
        </div>
      </div>

      {/* Email Verification */}
      <div className="surface-card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <Shield style={{ width: 20, height: 20, color: 'var(--color-primary)' }} />
          <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-heading)', margin: 0 }}>
            邮箱验证
          </h2>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 320 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>注册时需要邮箱验证</span>
          <select
            value={String(!!settings.require_email_verify)}
            onChange={(e) => setSettings((s) => ({ ...s, require_email_verify: e.target.value === 'true' }))}
            className="input"
          >
            <option value="false">关闭</option>
            <option value="true">开启</option>
          </select>
        </label>
        <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={() => saveSection('verify', verifyKeys)}
            disabled={savingSection === 'verify'}
            className="btn-primary"
          >
            {savingSection === 'verify' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save style={{ width: 16, height: 16 }} />}
            保存邮箱验证设置
          </button>
        </div>
      </div>
    </div>
  );
}
