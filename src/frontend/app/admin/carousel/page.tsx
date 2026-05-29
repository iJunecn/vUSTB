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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <p className="section-kicker" style={{ marginBottom: 8 }}>CAROUSEL</p>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-heading)', margin: 0 }}>
          轮播图
        </h1>
      </div>

      {/* Create form */}
      <form onSubmit={create} className="surface-card" style={{ padding: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-heading)', margin: '0 0 16px 0' }}>
          新增轮播图
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          <FieldInput label="标题" value={draft.title} onChange={(v) => setDraft({ ...draft, title: v })} required />
          <FieldInput label="图片 URL" value={draft.image_url} onChange={(v) => setDraft({ ...draft, image_url: v })} required />
          <FieldInput label="跳转链接（可选）" value={draft.link_url} onChange={(v) => setDraft({ ...draft, link_url: v })} />
          <FieldInput label="排序（数字越小越靠前）" value={String(draft.sort_order)} onChange={(v) => setDraft({ ...draft, sort_order: Number(v) || 0 })} />
        </div>
        <div style={{ marginTop: 16 }}>
          <button type="submit" disabled={creating} className="btn-primary">
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus style={{ width: 16, height: 16 }} />}
            新增
          </button>
        </div>
      </form>

      {/* Item list */}
      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--color-text-light)' }} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {items.map((c) => (
            <div key={c.id} className="surface-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ aspectRatio: '16/9', borderRadius: 8, overflow: 'hidden', background: 'var(--color-background-mute)' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.image_url} alt={c.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
              <p style={{ fontWeight: 600, color: 'var(--color-heading)', margin: 0 }}>{c.title}</p>
              {c.link_url && (
                <p style={{ fontSize: 12, color: 'var(--color-text-light)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>
                  {c.link_url}
                </p>
              )}
              <button onClick={() => remove(c.id)} className="btn-destructive" style={{ padding: '4px 12px', fontSize: 12, alignSelf: 'flex-start' }}>
                <Trash2 style={{ width: 12, height: 12 }} /> 删除
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FieldInput({ label, value, onChange, required }: { label: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 13, fontWeight: 500 }}>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} required={required} className="input" />
    </label>
  );
}
