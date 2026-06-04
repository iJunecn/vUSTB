'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { ConfirmDialog, ConfirmOptions } from '@/components/ui/confirm-dialog';
import { SkinPreview } from '@/components/skin/SkinViewer';
import { CapeViewer } from '@/components/skin/CapeViewer';
import { Loader2, Search, Image, RefreshCw, Edit3, Trash2, X, Eye, EyeOff } from 'lucide-react';

type AdminTexture = {
  hash: string;
  type: 'skin' | 'cape';
  model: string;
  name: string | null;
  is_public: boolean;
  uploader: number | null;
  uploader_name: string | null;
  uploader_display_name: string | null;
  uploader_email: string | null;
  created_at: string | null;
};

export default function AdminTexturesPage() {
  const [textures, setTextures] = useState<AdminTexture[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'' | 'skin' | 'cape'>('');
  // Preview dialog
  const [previewItem, setPreviewItem] = useState<AdminTexture | null>(null);
  const [editNote, setEditNote] = useState('');

  // Confirm dialog state
  const [confirmState, setConfirmState] = useState<{ open: boolean; options: ConfirmOptions; onConfirm: () => void }>({
    open: false, options: { message: '' }, onConfirm: () => {},
  });

  const showConfirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmState({
        open: true,
        options,
        onConfirm: () => { setConfirmState((s) => ({ ...s, open: false })); resolve(true); },
      });
    });
  }, []);

  const fetchTextures = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { limit: 200 };
      if (activeSearch) params.q = activeSearch;
      if (typeFilter) params.type = typeFilter;
      const r = await api.get<AdminTexture[]>('/admin/textures', { params });
      setTextures(r.data);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [activeSearch, typeFilter]);

  useEffect(() => { fetchTextures(); }, [fetchTextures]);

  function handleSearch() {
    setActiveSearch(searchQuery.trim());
  }

  function handleClearSearch() {
    setSearchQuery('');
    setActiveSearch('');
  }

  function openPreview(item: AdminTexture) {
    setPreviewItem(item);
    setEditNote(item.name || '');
  }

  async function updateNote() {
    if (!previewItem) return;
    const newName = editNote.trim();
    if (newName === (previewItem.name || '')) return;
    try {
      await api.patch(`/admin/textures/${previewItem.hash}`, { note: newName });
      previewItem.name = newName;
      fetchTextures();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || '更新名称失败');
    }
  }

  async function updateModel(newModel: string) {
    if (!previewItem || previewItem.type !== 'skin') return;
    try {
      await api.patch(`/admin/textures/${previewItem.hash}`, { model: newModel });
      previewItem.model = newModel;
      fetchTextures();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || '更新模型失败');
    }
  }

  async function updateIsPublic(newValue: boolean) {
    if (!previewItem) return;
    if (previewItem.is_public === newValue) return;
    if (!newValue) {
      const ok = await showConfirm({
        title: '取消公开',
        message: '取消公开后，该材质将不会出现在公共皮肤库中。确定取消公开？',
        confirmText: '确定',
        danger: true,
      });
      if (!ok) return;
    }
    try {
      await api.patch(`/admin/textures/${previewItem.hash}`, { is_public: newValue });
      previewItem.is_public = newValue;
      fetchTextures();
      toast.success(newValue ? '已设为公开' : '已取消公开');
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || '操作失败');
    }
  }

  async function forceDelete() {
    if (!previewItem) return;
    const ok = await showConfirm({
      title: '强制下架',
      message: '强制下架将从所有用户的衣柜中移除该材质，并从皮肤库中彻底删除。此操作不可撤销！',
      confirmText: '强制下架',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/admin/textures/${previewItem.hash}`, { params: { force: true, type: previewItem.type } });
      setPreviewItem(null);
      toast.success('材质已下架');
      fetchTextures();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || '删除失败');
    }
  }

  function texturesUrl(hash: string) {
    return `/static/textures/${hash}.png`;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <p className="section-kicker" style={{ marginBottom: 8 }}>TEXTURES</p>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-heading)', margin: 0 }}>
          材质管理
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-light)', marginTop: 4 }}>
          浏览和管理皮肤库中所有上传的材质
        </p>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240, position: 'relative' }}>
          <Search style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16, color: 'var(--color-text-light)' }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="搜索哈希、材质名或上传者"
            className="input"
            style={{ width: '100%', paddingLeft: 36, paddingRight: searchQuery ? 36 : 12 }}
          />
          {searchQuery && (
            <button onClick={handleClearSearch} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-light)' }}>
              <X style={{ width: 14, height: 14 }} />
            </button>
          )}
        </div>
        <button onClick={handleSearch} className="btn-primary" style={{ padding: '8px 20px', fontSize: 13 }}>
          搜索
        </button>
        <div style={{ display: 'flex', gap: 0, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--color-border)' }}>
          {(['', 'skin', 'cape'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              style={{
                padding: '6px 16px', fontSize: 13, fontWeight: 500,
                border: 'none', cursor: 'pointer',
                background: typeFilter === t ? 'var(--color-primary)' : 'var(--color-card-background)',
                color: typeFilter === t ? '#fff' : 'var(--color-text-light)',
                transition: 'all 0.15s',
              }}
            >
              {t === '' ? '全部' : t === 'skin' ? '皮肤' : '披风'}
            </button>
          ))}
        </div>
        <button onClick={fetchTextures} className="btn-ghost" style={{ padding: '6px 12px' }}>
          <RefreshCw style={{ width: 14, height: 14 }} />
        </button>
      </div>

      {/* Loading / Content */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--color-text-light)' }} />
        </div>
      ) : textures.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--color-text-light)' }}>
          <Image style={{ width: 48, height: 48, margin: '0 auto 12px', opacity: 0.4 }} />
          <p>暂无材质数据</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
          {textures.map((item) => (
            <div
              key={item.hash}
              className="surface-card"
              onClick={() => openPreview(item)}
              style={{ cursor: 'pointer', overflow: 'hidden', transition: 'transform 0.15s, box-shadow 0.15s' }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.1)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}
            >
              <div style={{ width: '100%', height: 200, display: 'flex', justifyContent: 'center', alignItems: 'center', background: 'var(--color-background-mute)' }}>
                {item.type === 'skin' ? (
                  <SkinPreview skinUrl={texturesUrl(item.hash)} model={item.model as 'classic' | 'slim'} size={160} />
                ) : (
                  <CapeViewer capeUrl={texturesUrl(item.hash)} width={140} height={190} autoRotate={false} zoom={0.8} />
                )}
              </div>
              <div style={{ padding: '10px 14px', textAlign: 'center' }}>
                <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: item.type === 'skin' ? 'color-mix(in srgb, var(--color-primary) 10%, transparent)' : 'color-mix(in srgb, #8b5cf6 10%, transparent)', color: item.type === 'skin' ? 'var(--color-primary)' : '#8b5cf6' }}>
                  {item.type === 'skin' ? '皮肤' : '披风'}
                </span>
                <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-heading)', margin: '6px 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                  {item.name || '未命名'}
                </p>
                <p style={{ fontSize: 12, color: 'var(--color-text-light)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                  {item.uploader_display_name || item.uploader_email || ''}
                </p>
              </div>
              <div style={{ display: 'flex', padding: '8px 14px', borderTop: '1px solid var(--color-border)', background: 'var(--color-background-soft)' }}>
                <button className="btn-ghost" style={{ flex: 1, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                  <Edit3 style={{ width: 12, height: 12 }} /> 编辑
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Preview Dialog */}
      {previewItem && (
        <div
          onClick={() => setPreviewItem(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(0,0,0,0.5)', display: 'flex',
            justifyContent: 'center', alignItems: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="surface-card"
            style={{
              display: 'flex', gap: 24, padding: 24, borderRadius: 16,
              maxWidth: 700, width: '90%', maxHeight: '90vh', overflowY: 'auto',
            }}
          >
            {/* 3D Preview */}
            <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', width: 280, height: 360, borderRadius: 12, background: 'var(--color-background-mute)' }}>
              {previewItem.type === 'skin' ? (
                <SkinPreview skinUrl={texturesUrl(previewItem.hash)} model={previewItem.model as 'classic' | 'slim'} size={240} />
              ) : (
                <CapeViewer capeUrl={texturesUrl(previewItem.hash)} width={220} height={300} autoRotate={false} zoom={0.9} />
              )}
            </div>

            {/* Info Panel */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
              {/* Name */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-light)', display: 'block', marginBottom: 4 }}>名称</label>
                <input
                  type="text"
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  onBlur={updateNote}
                  className="input"
                  style={{ width: '100%' }}
                  placeholder="未命名纹理"
                />
              </div>

              {/* Hash */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-light)', display: 'block', marginBottom: 4 }}>哈希</label>
                <code style={{ fontSize: 12, padding: '4px 8px', background: 'var(--color-background-mute)', borderRadius: 6, wordBreak: 'break-all', display: 'block' }}>
                  {previewItem.hash}
                </code>
              </div>

              {/* Uploader */}
              {(previewItem.uploader_display_name || previewItem.uploader_email) && (
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-light)', display: 'block', marginBottom: 4 }}>上传者</label>
                  <span style={{ fontSize: 14, color: 'var(--color-heading)', fontWeight: 500 }}>
                    {previewItem.uploader_display_name || previewItem.uploader_email}
                  </span>
                </div>
              )}

              {/* Model (skin only) */}
              {previewItem.type === 'skin' && (
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-light)', display: 'block', marginBottom: 4 }}>模型选择</label>
                  <div style={{ display: 'flex', gap: 0, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--color-border)' }}>
                    {['default', 'slim'].map((m) => (
                      <button
                        key={m}
                        onClick={() => updateModel(m)}
                        style={{
                          padding: '6px 16px', fontSize: 13, fontWeight: 500,
                          border: 'none', cursor: 'pointer',
                          background: previewItem.model === m ? 'var(--color-primary)' : 'var(--color-card-background)',
                          color: previewItem.model === m ? '#fff' : 'var(--color-text-light)',
                          transition: 'all 0.15s',
                        }}
                      >
                        {m === 'default' ? 'Default' : 'Slim'}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Public toggle */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-light)', display: 'block', marginBottom: 4 }}>公开状态</label>
                <button
                  onClick={() => updateIsPublic(!previewItem.is_public)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '6px 14px', borderRadius: 8, fontSize: 13,
                    border: '1px solid var(--color-border)', cursor: 'pointer',
                    background: previewItem.is_public ? 'color-mix(in srgb, #22c55e 10%, transparent)' : 'var(--color-card-background)',
                    color: previewItem.is_public ? '#16a34a' : 'var(--color-text-light)',
                  }}
                >
                  {previewItem.is_public ? <Eye style={{ width: 14, height: 14 }} /> : <EyeOff style={{ width: 14, height: 14 }} />}
                  {previewItem.is_public ? '公开' : '未公开'}
                </button>
              </div>

              {/* Delete */}
              <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
                <button onClick={forceDelete} className="btn-destructive" style={{ width: '100%', padding: '8px 16px' }}>
                  <Trash2 style={{ width: 14, height: 14 }} /> 强制下架
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Dialog */}
      <ConfirmDialog
        open={confirmState.open}
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState((s) => ({ ...s, open: false }))}
        {...confirmState.options}
      />
    </div>
  );
}
