'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Loader2, Plus, Trash2 } from 'lucide-react';

type Carousel = {
  id: number;
  title: string;
  image_url: string;
  link_url: string | null;
  sort_order: number;
};

export default function AdminCarouselPage() {
  const [items, setItems] = useState<Carousel[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({ title: '', image_url: '', link_url: '', sort_order: 0 });
  const [creating, setCreating] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const r = await api.get<Carousel[]>('/admin/carousels');
      setItems(r.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      await api.post('/admin/carousels', {
        ...draft,
        link_url: draft.link_url || null,
        sort_order: Number(draft.sort_order),
      });
      setDraft({ title: '', image_url: '', link_url: '', sort_order: 0 });
      await refresh();
    } finally {
      setCreating(false);
    }
  }

  async function remove(id: number) {
    if (!confirm('删除该轮播图?')) return;
    await api.delete(`/admin/carousels/${id}`);
    await refresh();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">轮播图</h1>

      <form onSubmit={create} className="glass-card p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input label="标题" value={draft.title} onChange={(v) => setDraft({ ...draft, title: v })} required />
        <Input label="图片 URL" value={draft.image_url} onChange={(v) => setDraft({ ...draft, image_url: v })} required />
        <Input label="跳转链接（可选）" value={draft.link_url} onChange={(v) => setDraft({ ...draft, link_url: v })} />
        <Input label="排序（数字越小越靠前）" value={String(draft.sort_order)} onChange={(v) => setDraft({ ...draft, sort_order: Number(v) || 0 })} />
        <button type="submit" disabled={creating} className="btn-primary md:col-span-2">
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          新增
        </button>
      </form>

      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {items.map((c) => (
            <div key={c.id} className="glass-card p-4 space-y-2">
              <div className="aspect-video bg-muted/40 rounded-xl overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.image_url} alt={c.title} className="w-full h-full object-cover" />
              </div>
              <p className="font-medium">{c.title}</p>
              {c.link_url && <p className="text-xs text-muted-foreground truncate">{c.link_url}</p>}
              <button onClick={() => remove(c.id)} className="text-xs text-destructive hover:underline inline-flex items-center gap-1">
                <Trash2 className="w-3 h-3" /> 删除
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Input({ label, value, onChange, required }: { label: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  return (
    <label className="space-y-1">
      <span className="text-sm font-medium block">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} required={required} className="input" />
    </label>
  );
}
