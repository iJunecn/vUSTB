'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Loader2, Upload, Trash2 } from 'lucide-react';

type Texture = {
  id: number;
  hash: string;
  type: 'skin' | 'cape';
  model: 'classic' | 'slim';
  name: string;
  is_public: boolean;
  url: string;
  created_at: string;
};

export default function WardrobePage() {
  const [items, setItems] = useState<Texture[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [type, setType] = useState<'skin' | 'cape'>('skin');
  const [model, setModel] = useState<'classic' | 'slim'>('classic');
  const fileRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    setLoading(true);
    try {
      const r = await api.get<Texture[]>('/textures/wardrobe');
      setItems(r.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('type', type);
      fd.append('model', model);
      await api.post('/textures/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      await refresh();
    } catch (err: any) {
      alert(err?.response?.data?.detail || '上传失败');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function remove(id: number) {
    if (!confirm('从衣柜移除这个材质？（不会删除已绑定的角色皮肤）')) return;
    await api.delete(`/textures/wardrobe/${id}`);
    setItems((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <p className="section-kicker" style={{ marginBottom: 8 }}>WARDROBE</p>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-heading)', margin: 0 }}>
          皮肤衣柜
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-light)', marginTop: 4 }}>
          上传 64x64 / 64x32 PNG 材质，绑定到游戏角色后即可在 MC 中使用。
        </p>
      </div>

      {/* Upload form */}
      <div className="surface-card" style={{ padding: 20, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 16 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>类型</span>
          <select value={type} onChange={(e) => setType(e.target.value as any)} className="input" style={{ width: 'auto' }}>
            <option value="skin">皮肤 skin</option>
            <option value="cape">披风 cape</option>
          </select>
        </label>
        {type === 'skin' && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>模型</span>
            <select value={model} onChange={(e) => setModel(e.target.value as any)} className="input" style={{ width: 'auto' }}>
              <option value="classic">classic (Steve)</option>
              <option value="slim">slim (Alex)</option>
            </select>
          </label>
        )}
        <button onClick={() => fileRef.current?.click()} disabled={uploading} className="btn-primary">
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload style={{ width: 16, height: 16 }} />}
          上传
        </button>
        <input ref={fileRef} type="file" accept="image/png" hidden onChange={onUpload} />
      </div>

      {/* Texture grid */}
      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--color-text-light)' }} />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 16,
          }}
        >
          {items.map((t) => (
            <div key={t.id} className="surface-card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div
                style={{
                  aspectRatio: '1',
                  borderRadius: 8,
                  overflow: 'hidden',
                  background: 'var(--color-background-mute)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={t.url}
                  alt={t.name}
                  style={{ width: '100%', height: '100%', objectFit: 'contain', imageRendering: 'pixelated' }}
                />
              </div>
              <div style={{ fontSize: 12 }}>
                <p style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--color-heading)' }}>{t.name}</p>
                <p style={{ color: 'var(--color-text-light)', marginTop: 2 }}>
                  {t.type} {t.type === 'skin' ? `· ${t.model}` : ''}
                </p>
              </div>
              <button
                onClick={() => remove(t.id)}
                className="btn-ghost"
                style={{ padding: '4px 8px', fontSize: 12, color: '#dc2626', borderColor: 'transparent', background: 'transparent' }}
              >
                <Trash2 style={{ width: 12, height: 12 }} /> 移除
              </button>
            </div>
          ))}
          {items.length === 0 && (
            <p style={{ color: 'var(--color-text-light)', gridColumn: '1 / -1' }}>
              衣柜为空，先上传一个皮肤吧。
            </p>
          )}
        </div>
      )}
    </div>
  );
}
