'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Loader2, Save } from 'lucide-react';

type Setting = { key: string; value: any };

const KNOWN_KEYS: { key: string; label: string; type: 'text' | 'bool' }[] = [
  { key: 'site_name', label: '站点名称', type: 'text' },
  { key: 'announcement', label: '首页公告', type: 'text' },
  { key: 'require_invite', label: '注册需要邀请码', type: 'bool' },
  { key: 'require_email_verify', label: '注册需要邮箱验证码', type: 'bool' },
  { key: 'smtp_from', label: 'SMTP 发件人', type: 'text' },
];

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

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

  async function save(key: string) {
    setSavingKey(key);
    try {
      await api.put(`/admin/settings/${key}`, { key, value: settings[key] });
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-3xl font-bold">站点设置</h1>
      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      ) : (
        <div className="space-y-3">
          {KNOWN_KEYS.map(({ key, label, type }) => (
            <div key={key} className="glass-card p-4 flex items-end gap-3 flex-wrap">
              <label className="flex-1 min-w-[200px] space-y-1">
                <span className="text-sm font-medium block">{label}</span>
                <span className="text-xs text-muted-foreground block">{key}</span>
                {type === 'bool' ? (
                  <select
                    value={String(!!settings[key])}
                    onChange={(e) => setSettings((s) => ({ ...s, [key]: e.target.value === 'true' }))}
                    className="input"
                  >
                    <option value="false">关闭</option>
                    <option value="true">开启</option>
                  </select>
                ) : (
                  <input
                    value={settings[key] ?? ''}
                    onChange={(e) => setSettings((s) => ({ ...s, [key]: e.target.value }))}
                    className="input"
                  />
                )}
              </label>
              <button
                onClick={() => save(key)}
                disabled={savingKey === key}
                className="btn-primary"
              >
                {savingKey === key ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                保存
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
