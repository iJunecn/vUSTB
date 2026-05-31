'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Loader2, Save, Globe, Lock, Key } from 'lucide-react';

type Setting = { key: string; value: any };

const SECTIONS = [
  {
    id: 'site',
    label: '站点配置',
    icon: Globe,
    fields: [
      { key: 'public_url', label: '对外访问地址（域名或 IP，含协议）', type: 'text' as const, placeholder: 'https://skin.example.com' },
      { key: 'texture_base_url', label: '材质 URL 基地址（绝对 URL，留空则用 site_url，材质走 {base}/static/textures/）', type: 'text' as const, placeholder: 'https://cdn.example.com' },
      { key: 'allow_register', label: '允许注册', type: 'bool' as const },
      { key: 'require_invite', label: '注册需要邀请码', type: 'bool' as const },
      { key: 'enable_skin_library', label: '启用皮肤库', type: 'bool' as const },
      { key: 'register_email_suffixes', label: '注册邮箱后缀（逗号分隔，留空允许全部）', type: 'text' as const },
    ],
  },
  {
    id: 'security',
    label: '安全设置',
    icon: Lock,
    fields: [
      { key: 'require_email_verify', label: '注册需要邮箱验证', type: 'bool' as const },
      { key: 'allow_password_reset', label: '允许密码重置', type: 'bool' as const },
    ],
  },
  {
    id: 'auth',
    label: '认证 / JWT',
    icon: Key,
    fields: [
      { key: 'jwt_expire_seconds', label: 'JWT 过期时间（秒）', type: 'text' as const },
      { key: 'jwt_refresh_expire_seconds', label: 'Refresh Token 过期时间（秒）', type: 'text' as const },
    ],
  },
];

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [savingSection, setSavingSection] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState('site');

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

  async function saveSection(sectionId: string) {
    setSavingSection(sectionId);
    const section = SECTIONS.find((s) => s.id === sectionId);
    if (!section) return;
    try {
      await Promise.all(
        section.fields.map((f) =>
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
            </button>
          );
        })}
      </div>

      {/* Active section */}
      {SECTIONS.filter((s) => s.id === activeSection).map((section) => (
        <div key={section.id} className="surface-card" style={{ padding: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-heading)', margin: '0 0 20px 0' }}>
            {section.label}
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {section.fields.map((field) => (
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
                      placeholder={(field as any).placeholder}
                      className="input"
                    />
                  )}
                </label>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={() => saveSection(section.id)}
              disabled={savingSection === section.id}
              className="btn-primary"
            >
              {savingSection === section.id
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Save style={{ width: 16, height: 16 }} />}
              保存 {section.label}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
