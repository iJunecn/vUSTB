'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Loader2, Bookmark } from 'lucide-react';
import { useUserStore } from '@/stores/user';

type Texture = {
  id: number;
  type: 'skin' | 'cape';
  model: 'classic' | 'slim';
  name: string;
  url: string;
};

export default function SkinLibraryPage() {
  const [items, setItems] = useState<Texture[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'skin' | 'cape'>('all');
  const user = useUserStore((s) => s.user);
  const hydrate = useUserStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    setLoading(true);
    const params: any = {};
    if (filter !== 'all') params.type = filter;
    api
      .get<Texture[]>('/textures/library', { params })
      .then((r) => setItems(r.data))
      .finally(() => setLoading(false));
  }, [filter]);

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

  return (
    <div className="container py-12 space-y-6 max-w-5xl">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold">公共皮肤库</h1>
          <p className="text-muted-foreground">社区上传的公开材质,可一键收藏到自己的衣柜。</p>
        </div>
        <div className="flex gap-2">
          {(['all', 'skin', 'cape'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-3 py-1.5 rounded-xl text-sm transition ${
                filter === k ? 'bg-primary text-primary-foreground' : 'glass-card hover:bg-card'
              }`}
            >
              {k === 'all' ? '全部' : k === 'skin' ? '皮肤' : '披风'}
            </button>
          ))}
        </div>
      </header>

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
              <p className="text-xs font-medium truncate">{t.name}</p>
              <p className="text-xs text-muted-foreground">
                {t.type} {t.type === 'skin' && `· ${t.model}`}
              </p>
              <button
                onClick={() => collect(t.id)}
                className="text-xs text-primary hover:underline inline-flex items-center gap-1"
              >
                <Bookmark className="w-3 h-3" /> 加入衣柜
              </button>
            </div>
          ))}
          {items.length === 0 && (
            <p className="text-muted-foreground col-span-full">公共皮肤库暂时是空的。</p>
          )}
        </div>
      )}
    </div>
  );
}
