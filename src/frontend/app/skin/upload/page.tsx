'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useUserStore } from '@/stores/user';
import { Loader2, Upload, Save, Eye } from 'lucide-react';
import { SkinViewer } from '@/components/skin/SkinViewer';

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

  // Preview state
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [step, setStep] = useState<'select' | 'preview'>('select');

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (loaded && !user) router.replace('/login');
  }, [loaded, user, router]);

  function onFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate it's a PNG
    if (!file.type.startsWith('image/png')) {
      setMsg({ ok: false, text: '仅支持 PNG 格式文件' });
      return;
    }

    // Create preview URL
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    setPreviewFile(file);
    setStep('preview');
    setMsg(null);
  }

  async function handleSave() {
    if (!previewFile) return;
    setUploading(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', previewFile);
      fd.append('type', type);
      fd.append('model', model);
      if (name) fd.append('name', name);
      fd.append('is_public', String(isPublic));
      await api.post('/textures/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setMsg({ ok: true, text: '上传成功，已加入衣柜。' });
      // Reset to select step after successful upload
      resetForm();
    } catch (err: any) {
      setMsg({ ok: false, text: err?.response?.data?.detail || '上传失败' });
    } finally {
      setUploading(false);
    }
  }

  function resetForm() {
    setPreviewUrl(null);
    setPreviewFile(null);
    setStep('select');
    setName('');
    setIsPublic(false);
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: '48px 24px' }}>
      <div className="surface-card" style={{ padding: 32 }}>
        <div style={{ marginBottom: 24 }}>
          <p className="section-kicker" style={{ marginBottom: 8 }}>UPLOAD</p>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-heading)', margin: 0 }}>
            上传材质
          </h1>
          <p style={{ fontSize: 14, color: 'var(--color-text-light)', marginTop: 4 }}>
            支持标准 64x64 / 64x32 像素 PNG 文件。选择文件后可预览、修改信息，再保存到皮肤库。
          </p>
        </div>

        {step === 'select' ? (
          /* Step 1: Select file */
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

            <button
              onClick={() => fileRef.current?.click()}
              className="btn-primary"
              style={{ width: '100%' }}
            >
              <Upload style={{ width: 16, height: 16 }} />
              选择 PNG 文件
            </button>
            <input ref={fileRef} type="file" accept="image/png" hidden onChange={onFileSelect} />

            {msg && (
              <p style={{ fontSize: 13, color: msg.ok ? 'var(--color-primary)' : '#dc2626' }}>
                {msg.text}
              </p>
            )}
          </div>
        ) : (
          /* Step 2: Preview and edit info before saving */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* 3D Preview */}
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              padding: 16,
              borderRadius: 16,
              background: 'var(--color-background-mute)',
              border: '1px solid var(--color-border)',
            }}>
              {previewUrl && type === 'skin' ? (
                <SkinViewer
                  skinUrl={previewUrl}
                  model={model}
                  width={200}
                  height={280}
                  autoRotate
                  animate
                  zoom={0.9}
                />
              ) : previewUrl && type === 'cape' ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewUrl}
                    alt="Cape preview"
                    style={{
                      maxWidth: 200,
                      maxHeight: 280,
                      imageRendering: 'pixelated',
                      borderRadius: 8,
                    }}
                  />
                  <span style={{ fontSize: 12, color: 'var(--color-text-light)' }}>披风预览</span>
                </div>
              ) : null}
            </div>

            {/* Edit info */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
                <span style={{ fontSize: 13, fontWeight: 500 }}>名称</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="给材质起个名字（可选）"
                  className="input"
                />
              </label>

              <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={isPublic}
                  onChange={(e) => setIsPublic(e.target.checked)}
                  style={{ accentColor: 'var(--color-primary)' }}
                />
                公开到皮肤库（其他用户可见并可收藏）
              </label>
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                onClick={resetForm}
                className="btn-ghost"
                style={{ flex: 1 }}
              >
                重新选择
              </button>
              <button
                onClick={handleSave}
                disabled={uploading}
                className="btn-primary"
                style={{ flex: 2 }}
              >
                {uploading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save style={{ width: 16, height: 16 }} />
                )}
                保存到皮肤库
              </button>
            </div>

            {msg && (
              <p style={{ fontSize: 13, color: msg.ok ? 'var(--color-primary)' : '#dc2626' }}>
                {msg.text}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
