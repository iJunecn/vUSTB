'use client';

import { useEffect, useState } from 'react';
import { rawApi } from '@/lib/api';
import { Loader2, Bookmark, ChevronLeft, ChevronRight } from 'lucide-react';
import { useUserStore } from '@/stores/user';
import { SkinPreview } from '@/components/skin/SkinViewer';

type LibraryItem = {
  hash: string;
  type: 'skin' | 'cape';
  model: string;
  name: string;
  is_public: boolean;
  uploader: number;
  uploader_name: string;
  created_at: string;
  url?: string;
};

const PAGE_SIZE = 20;

export default function SkinLibraryPage() {
  const [items, setItems] = useState<LibraryItem[]>([]);
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
    const params: Record<string, any> = { page, limit: PAGE_SIZE };
    if (filter !== 'all') params.texture_type = filter;
    rawApi
      .get<{ total: number; items: LibraryItem[] }>('/api/public/skin-library', { params })
      .then((r) => {
        setItems(r.data.items);
        setTotal(r.data.total);
      })
      .finally(() => setLoading(false));
  }, [filter, page]);

  async function collect(hash: string) {
    if (!user) {
      alert('请先登录');
      return;
    }
    try {
      await rawApi.post(`/api/me/textures/${hash}/add`);
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
            皮肤库
          </h1>
          <p style={{ fontSize: 14, color: 'var(--color-text-light)', marginTop: 4 }}>
            浏览所有公开材质和你的私有材质，可一键收藏到衣柜。
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
            {items.map((t) => {
              const texUrl = `/static/textures/${t.hash}.png`;
              return (
                <div key={t.hash} className="surface-card" style={{ display: 'flex', flexDirection: 'column' }}>
                  {/* 3D Texture preview */}
                  <div
                    style={{
                      aspectRatio: '1', background: 'var(--color-background-mute)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      overflow: 'hidden', position: 'relative',
                    }}
                  >
                    {t.type === 'skin' ? (
                      <SkinPreview skinUrl={texUrl} model={t.model === 'slim' ? 'slim' : 'classic'} size={180} />
                    ) : (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={texUrl}
                        alt={t.name}
                        style={{ width: '100%', height: '100%', objectFit: 'contain', imageRendering: 'pixelated' }}
                      />
                    )}
                    {!t.is_public && (
                      <span
                        style={{
                          position: 'absolute', top: 6, right: 6,
                          padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600,
                          background: 'color-mix(in srgb, #888 15%, transparent)',
                          color: '#888',
                        }}
                      >
                        私有
                      </span>
                    )}
                  </div>

                  {/* Info */}
                  <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-heading)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>
                      {t.name || '未命名材质'}
                    </p>
                    <p style={{ fontSize: 12, color: 'var(--color-text-light)', margin: 0 }}>
                      {t.uploader_name || '未知上传者'} · {t.type === 'skin' ? t.model : '披风'}
                    </p>
                    <button
                      onClick={() => collect(t.hash)}
                      className="btn-ghost"
                      style={{ padding: '6px 0', fontSize: 12, marginTop: 4, justifyContent: 'flex-start' }}
                    >
                      <Bookmark style={{ width: 14, height: 14 }} /> 收藏到衣柜
                    </button>
                  </div>
                </div>
              );
            })}
            {items.length === 0 && (
              <p style={{ color: 'var(--color-text-light)', gridColumn: '1 / -1' }}>
                皮肤库暂时是空的。
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
