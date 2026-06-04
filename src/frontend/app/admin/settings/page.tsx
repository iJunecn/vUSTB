'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Loader2, Save, Globe, Lock, Key, Mail, Shield } from 'lucide-react';

type Setting = { key: string; value: any };

// ──────────── 硬编码设置（不可修改） ────────────
const HARDCODED_SECURITY = {
  require_email_verify: true,
  allow_password_reset: true,
  register_email_suffixes: '@xs.ustb.edu.cn, @ustb.edu.cn, @ustb.world, @qq.com',
};

const HARDCODED_AUTH = {
  jwt_expire_seconds: '259200',
  jwt_refresh_expire_seconds: '259200',
};

const HARDCODED_EMAIL = {
  smtp_host: 'mx.jianyuelab.net',
  smtp_port: '465',
  smtp_user: 'noreply',
  smtp_password: '••••••••',
  smtp_from: '像素北科',
  smtp_ssl: true,
  email_verify_enabled: true,
};

// 可编辑的通用设置
const GENERAL_FIELDS = [
  { key: 'public_url', label: '对外访问地址（域名或 IP，含协议）', type: 'text' as const, placeholder: 'https://skin.example.com' },
  { key: 'texture_base_url', label: '材质 URL 基地址（绝对 URL，留空则用 site_url）', type: 'text' as const, placeholder: 'https://cdn.example.com' },
  { key: 'enable_skin_library', label: '启用皮肤库', type: 'bool' as const },
];

type SectionConfig = {
  id: string;
  label: string;
  icon: any;
  hardcoded?: boolean;
};

const SECTIONS: SectionConfig[] = [
  { id: 'general', label: '基本设置', icon: Globe, hardcoded: false },
  { id: 'security', label: '安全设置', icon: Lock, hardcoded: true },
  { id: 'auth', label: '认证 / JWT', icon: Key, hardcoded: true },
  { id: 'email', label: '邮件服务', icon: Mail, hardcoded: true },
];

function HardcodedBadge() {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
      background: 'color-mix(in srgb, #3b82f6 10%, transparent)',
      color: '#3b82f6',
    }}>
      <Shield style={{ width: 12, height: 12 }} /> 硬编码
    </span>
  );
}

function ReadOnlyRow({ label, value }: { label: string; value: string | boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
      <label style={{ flex: 1, minWidth: 240, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{label}</span>
        <div style={{
          padding: '8px 12px', borderRadius: 8,
          background: 'var(--color-background-mute)',
          border: '1px solid var(--color-border)',
          fontSize: 14, color: 'var(--color-text)',
        }}>
          {typeof value === 'boolean' ? (value ? '✓ 开启' : '✗ 关闭') : String(value)}
        </div>
      </label>
    </div>
  );
}

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [savingSection, setSavingSection] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState('general');

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

  async function saveGeneral() {
    setSavingSection('general');
    try {
      await Promise.all(
        GENERAL_FIELDS.map((f) =>
          api.put(`/admin/settings/${f.key}`, { key: f.key, value: settings[f.key] })
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <p className="section-kicker" style={{ marginBottom: 8 }}>CONFIGURATION</p>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-heading)', margin: 0 }}>
          站点设置
        </h1>
        <p style={{ fontSize: 13, color: 'var(--color-text-light)', marginTop: 4 }}>
          安全设置、认证过期、邮件服务已硬编码在代码中，不可在平台内修改。
        </p>
      </div>

      {/* Section tabs */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          const isActive = activeSection === s.id;
          return (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 16px', borderRadius: 10,
                fontSize: 13, fontWeight: 600,
                border: '1px solid',
                borderColor: isActive ? 'var(--color-primary)' : 'var(--color-border)',
                background: isActive
                  ? 'color-mix(in srgb, var(--color-primary) 10%, transparent)'
                  : 'var(--color-background-soft)',
                color: isActive ? 'var(--color-primary)' : 'var(--color-text-light)',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              <Icon style={{ width: 14, height: 14 }} /> {s.label}
              {s.hardcoded && <span style={{ fontSize: 10, padding: '0 4px', borderRadius: 4, background: 'color-mix(in srgb, #3b82f6 10%, transparent)', color: '#3b82f6' }}>只读</span>}
            </button>
          );
        })}
      </div>

      {/* General section — editable */}
      {activeSection === 'general' && (
        <div className="surface-card" style={{ padding: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-heading)', margin: '0 0 20px 0' }}>
            基本设置
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {GENERAL_FIELDS.map((field) => (
              <div key={field.key} style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
                <label style={{ flex: 1, minWidth: 240, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{field.label}</span>
                  <span style={{ fontSize: 11, color: 'var(--color-text-light)' }}>{field.key}</span>
                  {field.type === 'bool' ? (
                    <select
                      value={String(!!settings[field.key])}
                      onChange={(e) => setSettings((s) => ({ ...s, [field.key]: e.target.value === 'true' }))}
                      className="input"
                    >
                      <option value="false">关闭</option>
                      <option value="true">开启</option>
                    </select>
                  ) : (
                    <input
                      value={settings[field.key] ?? ''}
                      onChange={(e) => setSettings((s) => ({ ...s, [field.key]: e.target.value }))}
                      placeholder={field.placeholder}
                      className="input"
                    />
                  )}
                </label>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={saveGeneral}
              disabled={savingSection === 'general'}
              className="btn-primary"
            >
              {savingSection === 'general'
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Save style={{ width: 16, height: 16 }} />}
              保存基本设置
            </button>
          </div>
        </div>
      )}

      {/* Security section — read-only */}
      {activeSection === 'security' && (
        <div className="surface-card" style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-heading)', margin: 0 }}>安全设置</h2>
            <HardcodedBadge />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <ReadOnlyRow label="注册需要邮箱验证" value={HARDCODED_SECURITY.require_email_verify} />
            <ReadOnlyRow label="允许密码重置" value={HARDCODED_SECURITY.allow_password_reset} />
            <ReadOnlyRow label="注册邮箱后缀" value={HARDCODED_SECURITY.register_email_suffixes} />
          </div>
        </div>
      )}

      {/* Auth section — read-only */}
      {activeSection === 'auth' && (
        <div className="surface-card" style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-heading)', margin: 0 }}>认证 / JWT</h2>
            <HardcodedBadge />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <ReadOnlyRow label="JWT 过期时间" value={`${HARDCODED_AUTH.jwt_expire_seconds} 秒（72 小时）`} />
            <ReadOnlyRow label="Refresh Token 过期时间" value={`${HARDCODED_AUTH.jwt_refresh_expire_seconds} 秒（72 小时）`} />
          </div>
        </div>
      )}

      {/* Email section — read-only */}
      {activeSection === 'email' && (
        <div className="surface-card" style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-heading)', margin: 0 }}>邮件服务</h2>
            <HardcodedBadge />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <ReadOnlyRow label="SMTP 主机" value={HARDCODED_EMAIL.smtp_host} />
            <ReadOnlyRow label="SMTP 端口" value={HARDCODED_EMAIL.smtp_port} />
            <ReadOnlyRow label="SMTP 用户名" value={HARDCODED_EMAIL.smtp_user} />
            <ReadOnlyRow label="SMTP 密码" value={HARDCODED_EMAIL.smtp_password} />
            <ReadOnlyRow label="发件人名称" value={HARDCODED_EMAIL.smtp_from} />
            <ReadOnlyRow label="使用 SSL" value={HARDCODED_EMAIL.smtp_ssl} />
            <ReadOnlyRow label="启用邮箱验证" value={HARDCODED_EMAIL.email_verify_enabled} />
          </div>
        </div>
      )}
    </div>
  );
}
