'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Loader2, Plus, Trash2, Save, Monitor } from 'lucide-react';

type MojangEndpoint = {
  id?: number;
  session_url: string;
  account_url: string;
  services_url: string;
  cache_ttl: number;
  enabled: boolean;
};

type MojangConfig = {
  strategy: 'serial' | 'parallel';
  endpoints: MojangEndpoint[];
};

export default function AdminMojangPage() {
  const [config, setConfig] = useState<MojangConfig>({ strategy: 'serial', endpoints: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const r = await api.get<MojangConfig>('/admin/mojang-fallback');
      setConfig(r.data);
    } catch {
      // Endpoint may not exist yet; use defaults
      setConfig({ strategy: 'serial', endpoints: [] });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function save() {
    setSaving(true);
    try {
      await api.put('/admin/mojang-fallback', config);
    } finally {
      setSaving(false);
    }
  }

  function updateEndpoint(index: number, field: keyof MojangEndpoint, value: any) {
    setConfig((prev) => {
      const endpoints = [...prev.endpoints];
      endpoints[index] = { ...endpoints[index], [field]: value };
      return { ...prev, endpoints };
    });
  }

  function addEndpoint() {
    setConfig((prev) => ({
      ...prev,
      endpoints: [
        ...prev.endpoints,
        { session_url: '', account_url: '', services_url: '', cache_ttl: 300, enabled: true },
      ],
    }));
  }

  function removeEndpoint(index: number) {
    setConfig((prev) => ({
      ...prev,
      endpoints: prev.endpoints.filter((_, i) => i !== index),
    }));
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
        <p className="section-kicker" style={{ marginBottom: 8 }}>MOJANG</p>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-heading)', margin: 0 }}>
          Mojang Fallback
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-light)', marginTop: 4 }}>
          配置 Mojang 皮肤回退策略，当本地无材质时回退到 Mojang 服务器获取。
        </p>
      </div>

      {/* Strategy */}
      <div className="surface-card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <Monitor style={{ width: 20, height: 20, color: 'var(--color-primary)' }} />
          <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-heading)', margin: 0 }}>
            回退策略
          </h2>
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {(['serial', 'parallel'] as const).map((s) => (
            <label
              key={s}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '12px 20px', borderRadius: 10, cursor: 'pointer',
                border: '1px solid',
                borderColor: config.strategy === s ? 'var(--color-primary)' : 'var(--color-border)',
                background: config.strategy === s
                  ? 'color-mix(in srgb, var(--color-primary) 10%, transparent)'
                  : 'var(--color-background-soft)',
                transition: 'all 0.15s',
              }}
            >
              <input
                type="radio"
                name="strategy"
                value={s}
                checked={config.strategy === s}
                onChange={() => setConfig((prev) => ({ ...prev, strategy: s }))}
                style={{ accentColor: 'var(--color-primary)' }}
              />
              <span style={{ fontSize: 14, fontWeight: 500, color: config.strategy === s ? 'var(--color-primary)' : 'var(--color-text-light)' }}>
                {s === 'serial' ? '串行 (Serial)' : '并行 (Parallel)'}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Endpoints */}
      <div className="surface-card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-heading)', margin: 0 }}>
            端点列表
          </h2>
          <button onClick={addEndpoint} className="btn-ghost" style={{ padding: '6px 14px', fontSize: 13 }}>
            <Plus style={{ width: 14, height: 14 }} /> 添加端点
          </button>
        </div>

        {config.endpoints.length === 0 ? (
          <p style={{ color: 'var(--color-text-light)', fontSize: 14 }}>
            暂无端点，点击上方按钮添加。
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {config.endpoints.map((ep, index) => (
              <div
                key={index}
                style={{
                  padding: 16, borderRadius: 10,
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-background-soft)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-heading)' }}>
                    端点 #{index + 1}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={ep.enabled}
                        onChange={(e) => updateEndpoint(index, 'enabled', e.target.checked)}
                        style={{ accentColor: 'var(--color-primary)' }}
                      />
                      启用
                    </label>
                    <button
                      onClick={() => removeEndpoint(index)}
                      className="btn-ghost"
                      style={{ padding: '4px 8px', fontSize: 12, color: '#dc2626', borderColor: 'transparent' }}
                    >
                      <Trash2 style={{ width: 14, height: 14 }} />
                    </button>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 12, color: 'var(--color-text-light)' }}>Session URL</span>
                    <input
                      value={ep.session_url}
                      onChange={(e) => updateEndpoint(index, 'session_url', e.target.value)}
                      className="input"
                      placeholder="https://sessionserver.mojang.com"
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 12, color: 'var(--color-text-light)' }}>Account URL</span>
                    <input
                      value={ep.account_url}
                      onChange={(e) => updateEndpoint(index, 'account_url', e.target.value)}
                      className="input"
                      placeholder="https://api.mojang.com"
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 12, color: 'var(--color-text-light)' }}>Services URL</span>
                    <input
                      value={ep.services_url}
                      onChange={(e) => updateEndpoint(index, 'services_url', e.target.value)}
                      className="input"
                      placeholder="https://api.minecraftservices.com"
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 12, color: 'var(--color-text-light)' }}>Cache TTL (秒)</span>
                    <input
                      type="number"
                      value={ep.cache_ttl}
                      onChange={(e) => updateEndpoint(index, 'cache_ttl', Number(e.target.value) || 300)}
                      className="input"
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Save */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save style={{ width: 16, height: 16 }} />}
          保存 Mojang 配置
        </button>
      </div>
    </div>
  );
}
