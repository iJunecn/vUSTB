'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { SkinPreview } from '@/components/skin/SkinViewer';
import { Loader2, Search, Users, RefreshCw, Edit3, Trash2, X, UserCircle } from 'lucide-react';

type AdminProfile = {
  id: number;
  name: string;
  model: string;
  skin_hash: string | null;
  cape_hash: string | null;
  user_id: number | null;
  owner_email: string | null;
  owner_display_name: string | null;
};

export default function AdminProfilesPage() {
  const [profiles, setProfiles] = useState<AdminProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  // Preview dialog
  const [previewItem, setPreviewItem] = useState<AdminProfile | null>(null);
  const [editName, setEditName] = useState('');

  const fetchProfiles = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { limit: 30 };
      if (activeSearch) params.q = activeSearch;
      const r = await api.get<AdminProfile[]>('/admin/profiles', { params });
      setProfiles(r.data);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [activeSearch]);

  useEffect(() => { fetchProfiles(); }, [fetchProfiles]);

  function handleSearch() {
    setActiveSearch(searchQuery.trim());
  }

  function handleClearSearch() {
    setSearchQuery('');
    setActiveSearch('');
  }

  function openPreview(item: AdminProfile) {
    setPreviewItem(item);
    setEditName(item.name || '');
  }

  async function updateProfileName() {
    if (!previewItem) return;
    const newName = editName.trim();
    if (!newName) { setEditName(previewItem.name); return; }
    if (newName === previewItem.name) return;
    try {
      await api.patch(`/admin/profiles/${previewItem.id}`, { name: newName });
      previewItem.name = newName;
      fetchProfiles();
    } catch (err: any) {
      if (err?.response?.status === 409) alert('角色名已存在，请使用其他名称');
      else alert(err?.response?.data?.detail || '更新角色名失败');
      setEditName(previewItem.name);
    }
  }

  async function clearSkin() {
    if (!previewItem) return;
    try {
      await api.patch(`/admin/profiles/${previewItem.id}/skin`, { hash: null });
      previewItem.skin_hash = null;
      fetchProfiles();
    } catch (err: any) {
      alert(err?.response?.data?.detail || '清除失败');
    }
  }

  async function clearCape() {
    if (!previewItem) return;
    try {
      await api.patch(`/admin/profiles/${previewItem.id}/cape`, { hash: null });
      previewItem.cape_hash = null;
      fetchProfiles();
    } catch (err: any) {
      alert(err?.response?.data?.detail || '清除失败');
    }
  }

  async function deleteProfile() {
    if (!previewItem) return;
    if (!confirm('确定删除此角色？此操作不可撤销。')) return;
    try {
      await api.delete(`/admin/profiles/${previewItem.id}`);
      setPreviewItem(null);
      fetchProfiles();
    } catch (err: any) {
      alert(err?.response?.data?.detail || '删除失败');
    }
  }

  function texturesUrl(hash: string | null) {
    if (!hash) return '';
    return `/static/textures/${hash}.png`;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <p className="section-kicker" style={{ marginBottom: 8 }}>PROFILES</p>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-heading)', margin: 0 }}>
          角色管理
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-light)', marginTop: 4 }}>
          浏览和管理全站所有用户的游戏角色与材质
        </p>
      </div>

      {/* Search */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240, position: 'relative' }}>
          <Search style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16, color: 'var(--color-text-light)' }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="搜索角色名、邮箱或用户名"
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
        <button onClick={fetchProfiles} className="btn-ghost" style={{ padding: '6px 12px' }}>
          <RefreshCw style={{ width: 14, height: 14 }} />
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--color-text-light)' }} />
        </div>
      ) : profiles.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--color-text-light)' }}>
          <Users style={{ width: 48, height: 48, margin: '0 auto 12px', opacity: 0.4 }} />
          <p>暂无角色数据</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
          {profiles.map((profile) => (
            <div
              key={profile.id}
              className="surface-card"
              onClick={() => openPreview(profile)}
              style={{ cursor: 'pointer', overflow: 'hidden', transition: 'transform 0.15s, box-shadow 0.15s' }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.1)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}
            >
              <div style={{ width: '100%', height: 200, display: 'flex', justifyContent: 'center', alignItems: 'center', background: 'var(--color-background-mute)' }}>
                {profile.skin_hash ? (
                  <SkinPreview
                    skinUrl={texturesUrl(profile.skin_hash)!}
                    model={profile.model as 'classic' | 'slim'}
                    size={160}
                  />
                ) : (
                  <UserCircle style={{ width: 64, height: 64, color: 'var(--color-text-light)', opacity: 0.4 }} />
                )}
              </div>
              <div style={{ padding: '10px 14px', textAlign: 'center' }}>
                <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-heading)', margin: '0 0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                  {profile.name}
                </p>
                <p style={{ fontSize: 12, color: 'var(--color-text-light)', margin: '0 0 2px' }}>
                  所属: {profile.owner_display_name || profile.owner_email || '-'}
                </p>
                <p style={{ fontSize: 12, color: 'var(--color-text-light)' }}>
                  模型: {profile.model || 'default'}
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
              {previewItem.skin_hash ? (
                <SkinPreview
                  skinUrl={texturesUrl(previewItem.skin_hash)!}
                  model={previewItem.model as 'classic' | 'slim'}
                  size={240}
                />
              ) : (
                <div style={{ textAlign: 'center', color: 'var(--color-text-light)' }}>
                  <UserCircle style={{ width: 48, height: 48, opacity: 0.4, margin: '0 auto 8px' }} />
                  <p style={{ fontSize: 14 }}>未设置皮肤</p>
                </div>
              )}
            </div>

            {/* Info Panel */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
              {/* Name */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-light)', display: 'block', marginBottom: 4 }}>角色名称</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={updateProfileName}
                  className="input"
                  style={{ width: '100%' }}
                  placeholder="角色名称"
                  maxLength={16}
                />
              </div>

              {/* Skin binding */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-light)', display: 'block', marginBottom: 4 }}>皮肤绑定</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    value={previewItem.skin_hash || '未绑定'}
                    readOnly
                    className="input"
                    style={{ flex: 1, opacity: previewItem.skin_hash ? 1 : 0.6 }}
                  />
                  <button
                    onClick={clearSkin}
                    disabled={!previewItem.skin_hash}
                    className="btn-ghost"
                    style={{ padding: '6px 12px', fontSize: 13, opacity: previewItem.skin_hash ? 1 : 0.4 }}
                  >
                    清除
                  </button>
                </div>
              </div>

              {/* Cape binding */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-light)', display: 'block', marginBottom: 4 }}>披风绑定</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    value={previewItem.cape_hash || '未绑定'}
                    readOnly
                    className="input"
                    style={{ flex: 1, opacity: previewItem.cape_hash ? 1 : 0.6 }}
                  />
                  <button
                    onClick={clearCape}
                    disabled={!previewItem.cape_hash}
                    className="btn-ghost"
                    style={{ padding: '6px 12px', fontSize: 13, opacity: previewItem.cape_hash ? 1 : 0.4 }}
                  >
                    清除
                  </button>
                </div>
              </div>

              {/* Owner info */}
              {(previewItem.owner_display_name || previewItem.owner_email) && (
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-light)', display: 'block', marginBottom: 4 }}>所属用户</label>
                  <span style={{ fontSize: 14, color: 'var(--color-heading)', fontWeight: 500 }}>
                    {previewItem.owner_display_name || previewItem.owner_email}
                  </span>
                </div>
              )}

              {/* Delete */}
              <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
                <button onClick={deleteProfile} className="btn-destructive" style={{ width: '100%', padding: '8px 16px' }}>
                  <Trash2 style={{ width: 14, height: 14 }} /> 删除角色
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
