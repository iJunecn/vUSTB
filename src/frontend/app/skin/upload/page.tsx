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
  const [msg, setMsg] = useState<string | null>(null);
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
      setMsg('上传成功,已加入衣柜。');
      if (fileRef.current) fileRef.current.value = '';
    } catch (err: any) {
      setMsg(err?.response?.data?.detail || '上传失败');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="container py-12 max-w-xl">
      <div className="glass-card p-8 space-y-6">
        <h1 className="text-3xl font-bold">上传材质</h1>
        <p className="text-sm text-muted-foreground">
          支持标准 64×64 / 64×32 像素 PNG 文件。皮肤上传后会自动加入你的衣柜,
          可在 <b>个人中心 → 游戏角色</b> 绑定到具体角色。
        </p>
        <div className="grid grid-cols-2 gap-4">
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
        </div>
        <label className="block space-y-1">
          <span className="text-sm font-medium block">名称（可选）</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
          公开到皮肤库
        </label>
        <button onClick={() => fileRef.current?.click()} disabled={uploading} className="btn-primary w-full">
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          选择 PNG 文件
        </button>
        <input ref={fileRef} type="file" accept="image/png" hidden onChange={onUpload} />
        {msg && <p className="text-sm text-primary">{msg}</p>}
      </div>
    </div>
  );
}
