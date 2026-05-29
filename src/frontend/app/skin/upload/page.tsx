'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useUserStore } from '@/stores/user';
import { Loader2, Upload } from 'lucide-react';

export default function SkinUploadPage() {
  const router = useRouter();
  const { user, loaded, hydrate } = useUserStore();
  const [type, setType] = useState<'skin' | 'cape'>('skin');
  const [model, setModel] = useState<'classic' | 'slim'>('classic');
  const [name, setName] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (loaded && !user) router.replace('/login');
  }, [loaded, user, router]);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('type', type);
      fd.append('model', model);
      if (name) fd.append('name', name);
      fd.append('is_public', String(isPublic));
      await api.post('/textures/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setMsg({ ok: true, text: '上传成功，已加入衣柜。' });
      if (fileRef.current) fileRef.current.value = '';
    } catch (err: any) {
      setMsg({ ok: false, text: err?.response?.data?.detail || '上传失败' });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: '48px 24px' }}>
      <div className="surface-card" style={{ padding: 32 }}>
        <div style={{ marginBottom: 24 }}>
          <p className="section-kicker" style={{ marginBottom: 8 }}>UPLOAD</p>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-heading)', margin: 0 }}>
            上传材质
          </h1>
          <p style={{ fontSize: 14, color: 'var(--color-text-light)', marginTop: 4 }}>
            支持标准 64x64 / 64x32 像素 PNG 文件。皮肤上传后会自动加入你的衣柜，
            可在 <b>个人中心 → 游戏角色</b> 绑定到具体角色。
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>类型</span>
              <select value={type} onChange={(e) => setType(e.target.value as any)} className="input">
                <option value="skin">皮肤 skin</option>
                <option value="cape">披风 cape</option>
              </select>
            </label>
            {type === 'skin' && (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>模型</span>
                <select value={model} onChange={(e) => setModel(e.target.value as any)} className="input">
                  <option value="classic">classic (Steve)</option>
                  <option value="slim">slim (Alex)</option>
                </select>
              </label>
            )}
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>名称（可选）</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="input" />
          </label>

          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
              style={{ accentColor: 'var(--color-primary)' }}
            />
            公开到皮肤库
          </label>

          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="btn-primary"
            style={{ width: '100%' }}
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload style={{ width: 16, height: 16 }} />}
            选择 PNG 文件
          </button>
          <input ref={fileRef} type="file" accept="image/png" hidden onChange={onUpload} />

          {msg && (
            <p style={{ fontSize: 13, color: msg.ok ? 'var(--color-primary)' : '#dc2626' }}>
              {msg.text}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
