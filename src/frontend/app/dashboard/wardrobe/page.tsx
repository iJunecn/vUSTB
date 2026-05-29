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
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold">皮肤衣柜</h1>
        <p className="text-muted-foreground">上传 64×64 / 64×32 PNG 材质,绑定到游戏角色后即可在 MC 中使用。</p>
      </header>

      <div className="glass-card p-5 flex flex-wrap items-end gap-4">
        <label className="space-y-1">
          <span className="text-sm font-medium block">类型</span>
          <select value={type} onChange={(e) => setType(e.target.value as any)} className="input">
            <option value="skin">皮肤 skin</option>
            <option value="cape">披风 cape</option>
          </select>
        </label>
        {type === 'skin' && (
          <label className="space-y-1">
            <span className="text-sm font-medium block">模型</span>
            <select value={model} onChange={(e) => setModel(e.target.value as any)} className="input">
              <option value="classic">classic (Steve)</option>
              <option value="slim">slim (Alex)</option>
            </select>
          </label>
        )}
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="btn-primary"
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          上传
        </button>
        <input ref={fileRef} type="file" accept="image/png" hidden onChange={onUpload} />
      </div>

      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {items.map((t) => (
            <div key={t.id} className="glass-card p-3 space-y-2">
              <div className="aspect-square bg-muted/40 rounded-xl overflow-hidden flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={t.url}
                  alt={t.name}
                  className="w-full h-full object-contain"
                  style={{ imageRendering: 'pixelated' }}
                />
              </div>
              <div className="text-xs">
                <p className="font-medium truncate">{t.name}</p>
                <p className="text-muted-foreground">
                  {t.type} · {t.type === 'skin' ? t.model : ''}
                </p>
              </div>
              <button
                onClick={() => remove(t.id)}
                className="text-xs text-destructive hover:underline inline-flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" /> 移除
              </button>
            </div>
          ))}
          {items.length === 0 && (
            <p className="text-muted-foreground col-span-full">衣柜为空,先上传一个皮肤吧。</p>
          )}
        </div>
      )}
    </div>
  );
}
