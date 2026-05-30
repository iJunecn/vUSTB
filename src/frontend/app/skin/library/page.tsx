'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Loader2, Bookmark, ChevronLeft, ChevronRight } from 'lucide-react';
import { useUserStore } from '@/stores/user';
import { SkinPreview } from '@/components/skin/SkinViewer';

type Texture = {
  id: number;
  type: 'skin' | 'cape';
  model: 'classic' | 'slim';
  name: string;
  url: string;
  uploader?: string;
};

const PAGE_SIZE = 24;

export default function SkinLibraryPage() {
  const [items, setItems] = useState<Texture[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'skin' | 'cape'>('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const user = useUserStore((s) => s.user);
  const hydrate = useUserStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    setLoading(true);
    const params: Record<string, any> = { page, page_size: PAGE_SIZE };
    if (filter !== 'all') params.type = filter;
    api
      .get<Texture[]>('/textures/library', { params })
      .then((r) => {
        setItems(r.data);
        setTotal(r.data.length < PAGE_SIZE ? page * PAGE_SIZE : (page + 1) * PAGE_SIZE);
      })
      .finally(() => setLoading(false));
  }, [filter, page]);

  async function collect(id: number) {
    if (!user) {
      alert('请先登录');
      return;
    }
    try {
      await api.post(`/textures/library/${id}/collect`);
      alert('已加入衣柜');
    } catch (err: any) {
      alert(err?.response?.data?.detail || '操作失败');
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '48px 24px', display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p className="section-kicker" style={{ marginBottom: 8 }}>LIBRARY</p>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-heading)', margin: 0 }}>
            公共皮肤库
          </h1>
          <p style={{ fontSize: 14, color: 'var(--color-text-light)', marginTop: 4 }}>
            社区上传的公开材质，可一键收藏到自己的衣柜。
          </p>
        </div>

        {/* Filter bar */}
        <div style={{ display: 'flex', gap: 6 }}>
          {(['all', 'skin', 'cape'] as const).map((k) => (
            <button
              key={k}
              onClick={() => { setFilter(k); setPage(1); }}
              style={{
                padding: '6px 16px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                border: '1px solid',
                borderColor: filter === k ? 'var(--color-primary)' : 'var(--color-border)',
                background: filter === k
                  ? 'color-mix(in srgb, var(--color-primary) 10%, transparent)'
                  : 'var(--color-background-soft)',
                color: filter === k ? 'var(--color-primary)' : 'var(--color-text-light)',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {k === 'all' ? '全部' : k === 'skin' ? '皮肤' : '披风'}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--color-text-light)' }} />
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 16,
            }}
          >
            {items.map((t) => (
              <div key={t.id} className="surface-card" style={{ display: 'flex', flexDirection: 'column' }}>
                {/* 3D Texture preview */}
                <div
                  style={{
                    aspectRatio: '1', background: 'var(--color-background-mute)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    overflow: 'hidden',
                  }}
                >
                  {t.type === 'skin' ? (
                    <SkinPreview skinUrl={t.url} model={t.model} size={180} />
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={t.url}
                      alt={t.name}
                      style={{ width: '100%', height: '100%', objectFit: 'contain', imageRendering: 'pixelated' }}
                    />
                  )}
                </div>

                {/* Info */}
                <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-heading)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>
                    {t.name}
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--color-text-light)', margin: 0 }}>
                    {t.uploader ?? '未知上传者'} · {t.type === 'skin' ? t.model : '披风'}
                  </p>
                  <button
                    onClick={() => collect(t.id)}
                    className="btn-ghost"
                    style={{ padding: '6px 0', fontSize: 12, marginTop: 4, justifyContent: 'flex-start' }}
                  >
                    <Bookmark style={{ width: 14, height: 14 }} /> 收藏到衣柜
                  </button>
                </div>
              </div>
            ))}
            {items.length === 0 && (
              <p style={{ color: 'var(--color-text-light)', gridColumn: '1 / -1' }}>
                公共皮肤库暂时是空的。
              </p>
            )}
          </div>

          {/* Pagination */}
          {items.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 8 }}>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="btn-ghost"
                style={{ padding: '6px 12px', fontSize: 13 }}
              >
                <ChevronLeft style={{ width: 16, height: 16 }} /> 上一页
              </button>
              <span style={{ fontSize: 13, color: 'var(--color-text-light)' }}>
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={items.length < PAGE_SIZE}
                className="btn-ghost"
                style={{ padding: '6px 12px', fontSize: 13 }}
              >
                下一页 <ChevronRight style={{ width: 16, height: 16 }} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
