'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { rawApi } from '@/lib/api';
import { toast } from 'sonner';
import { ConfirmDialog, ConfirmOptions } from '@/components/ui/confirm-dialog';
import { Loader2, Upload, Trash2, Eye, Pencil, ToggleLeft, ToggleRight, Shirt, UserCircle } from 'lucide-react';
import { SkinPreview, SkinViewer } from '@/components/skin/SkinViewer';
import { CapeViewer } from '@/components/skin/CapeViewer';
import { SkinAvatar } from '@/components/skin/SkinAvatar';

type Texture = {
  id: number;
  hash: string;
  type: 'skin' | 'cape';
  model: string;
  name: string;
  is_public: boolean;
  url: string;
};

type Player = {
  id: number;
  uuid: string;
  name: string;
  skin_texture_id: number | null;
  cape_texture_id: number | null;
  skin_url: string | null;
  cape_url: string | null;
};

export default function WardrobePage() {
  const [items, setItems] = useState<Texture[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [type, setType] = useState<'skin' | 'cape'>('skin');
  const [model, setModel] = useState<'classic' | 'slim'>('classic');
  const fileRef = useRef<HTMLInputElement>(null);

  // Detail dialog state
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTex, setDetailTex] = useState<Texture | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editNote, setEditNote] = useState('');
  const [editModel, setEditModel] = useState('');
  const [editPublic, setEditPublic] = useState(false);
  const [applyPlayerId, setApplyPlayerId] = useState('');
  const [isApplying, setIsApplying] = useState(false);
  const [settingAvatar, setSettingAvatar] = useState(false);

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

  async function refresh() {
    setLoading(true);
    try {
      const [texRes, playerRes] = await Promise.all([
        rawApi.get<Texture[]>('/api/me/textures'),
        rawApi.get<Player[]>('/api/players'),
      ]);
      setItems(texRes.data);
      setPlayers(playerRes.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('texture_type', type);
      if (type === 'skin') fd.append('model', model);
      fd.append('note', '');
      fd.append('is_public', 'false');
      await rawApi.post('/api/me/textures', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      await refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || '上传失败');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function openDetail(tex: Texture) {
    setDetailTex(tex);
    setEditNote(tex.name || '');
    setEditModel(tex.model || 'classic');
    setEditPublic(tex.is_public);
    setApplyPlayerId('');
    setDetailOpen(true);
    setDetailLoading(true);

    try {
      const res = await rawApi.get(`/api/me/textures/${tex.hash}/${tex.type}`);
      const data = res.data;
      setEditNote(data.name || '');
      setEditModel(data.model || 'classic');
      setEditPublic(!!data.is_public);
    } catch {
      // use fallback values from list
    } finally {
      setDetailLoading(false);
    }
  }

  async function saveNote() {
    if (!detailTex) return;
    try {
      await rawApi.patch(`/api/me/textures/${detailTex.hash}/${detailTex.type}`, { note: editNote.trim() });
      // Update local
      setItems((prev) => prev.map((t) =>
        t.hash === detailTex.hash && t.type === detailTex.type ? { ...t, name: editNote.trim() } : t
      ));
      setDetailTex((prev) => prev ? { ...prev, name: editNote.trim() } : prev);
    } catch {
      toast.error('更新备注失败');
    }
  }

  async function saveModel() {
    if (!detailTex) return;
    try {
      await rawApi.patch(`/api/me/textures/${detailTex.hash}/${detailTex.type}`, { model: editModel });
      setItems((prev) => prev.map((t) =>
        t.hash === detailTex.hash && t.type === detailTex.type ? { ...t, model: editModel } : t
      ));
      setDetailTex((prev) => prev ? { ...prev, model: editModel } : prev);
    } catch {
      toast.error('切换模型失败');
    }
  }

  async function savePublic() {
    if (!detailTex) return;
    try {
      await rawApi.patch(`/api/me/textures/${detailTex.hash}/${detailTex.type}`, { is_public: editPublic });
      setItems((prev) => prev.map((t) =>
        t.hash === detailTex.hash && t.type === detailTex.type ? { ...t, is_public: editPublic } : t
      ));
      setDetailTex((prev) => prev ? { ...prev, is_public: editPublic } : prev);
    } catch {
      toast.error('更新公开状态失败');
      setEditPublic(!editPublic);
    }
  }

  async function doApply() {
    if (!detailTex || !applyPlayerId) {
      toast.warning('请选择角色');
      return;
    }
    setIsApplying(true);
    try {
      await rawApi.post(`/api/me/textures/${detailTex.hash}/apply`, {
        profile_id: applyPlayerId,
        texture_type: detailTex.type,
      });
      toast.success('已应用到角色');
      await refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || '应用失败');
    } finally {
      setIsApplying(false);
    }
  }

  async function setAsAvatar() {
    if (!detailTex || detailTex.type !== 'skin') return;
    setSettingAvatar(true);
    try {
      await rawApi.post('/api/me/avatar/from-texture', { hash: detailTex.hash });
      toast.success('头像已更新');
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || '设置头像失败');
    } finally {
      setSettingAvatar(false);
    }
  }

  async function confirmDelete() {
    if (!detailTex) return;
    const ok = await showConfirm({
      title: '删除纹理',
      message: '确定要从衣柜中删除此纹理吗？此操作不可撤销。',
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    try {
      await rawApi.delete(`/api/me/textures/${detailTex.hash}/${detailTex.type}`);
      setDetailOpen(false);
      setDetailTex(null);
      toast.success('纹理已删除');
      await refresh();
    } catch {
      toast.error('删除失败');
    }
  }

  function texturesUrl(hash: string) {
    if (!hash) return '';
    return `/static/textures/${hash}.png`;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <p className="section-kicker" style={{ marginBottom: 8 }}>WARDROBE</p>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-heading)', margin: 0 }}>
          皮肤衣柜
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-light)', marginTop: 4 }}>
          管理你上传和收藏的皮肤与披风，绑定到游戏角色后即可在 MC 中使用。
        </p>
      </div>

      {/* Quick upload form */}
      <div className="surface-card" style={{ padding: 20, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 16 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>类型</span>
          <select value={type} onChange={(e) => setType(e.target.value as any)} className="input" style={{ width: 'auto' }}>
            <option value="skin">皮肤 skin</option>
            <option value="cape">披风 cape</option>
          </select>
        </label>
        {type === 'skin' && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>模型</span>
            <select value={model} onChange={(e) => setModel(e.target.value as any)} className="input" style={{ width: 'auto' }}>
              <option value="classic">classic (Steve)</option>
              <option value="slim">slim (Alex)</option>
            </select>
          </label>
        )}
        <button onClick={() => fileRef.current?.click()} disabled={uploading} className="btn-primary">
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload style={{ width: 16, height: 16 }} />}
          快速上传
        </button>
        <span style={{ fontSize: 12, color: 'var(--color-text-light)', alignSelf: 'center' }}>
          或前往 <a href="/skin/upload" style={{ color: 'var(--color-primary)' }}>上传页面</a> 预览后保存
        </span>
        <input ref={fileRef} type="file" accept="image/png" hidden onChange={onUpload} />
      </div>

      {/* Texture grid */}
      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--color-text-light)' }} />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 16,
          }}
        >
          {items.map((t) => {
            const texUrl = texturesUrl(t.hash);
            return (
              <div
                key={`${t.hash}-${t.type}`}
                className="surface-card"
                style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, cursor: 'pointer', transition: 'transform 0.15s, box-shadow 0.15s' }}
                onClick={() => openDetail(t)}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}
              >
                {/* Avatar + 3D preview row */}
                <div
                  style={{
                    aspectRatio: '1',
                    borderRadius: 8,
                    overflow: 'hidden',
                    background: 'var(--color-background-mute)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                  }}
                >
                  {t.type === 'skin' ? (
                    <SkinPreview skinUrl={texUrl} model={t.model === 'slim' ? 'slim' : 'classic'} size={150} />
                  ) : (
                    <CapeViewer capeUrl={texUrl} width={150} height={195} autoRotate={false} zoom={0.6} />
                  )}
                  {/* Public/private badge */}
                  <span
                    style={{
                      position: 'absolute', top: 6, right: 6,
                      padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600,
                      background: t.is_public ? 'color-mix(in srgb, var(--color-primary) 15%, transparent)' : 'color-mix(in srgb, #888 15%, transparent)',
                      color: t.is_public ? 'var(--color-primary)' : '#888',
                    }}
                  >
                    {t.is_public ? '公开' : '私有'}
                  </span>
                </div>
                {/* Info */}
                <div style={{ fontSize: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {t.type === 'skin' && (
                      <SkinAvatar skinUrl={texUrl} size={20} style={{ borderRadius: 4, flexShrink: 0 }} />
                    )}
                    <p style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--color-heading)', margin: 0 }}>
                      {t.name || '未命名纹理'}
                    </p>
                  </div>
                  <p style={{ color: 'var(--color-text-light)', marginTop: 2 }}>
                    {t.type === 'skin' ? '皮肤' : '披风'} {t.type === 'skin' ? `· ${t.model}` : ''}
                  </p>
                </div>
              </div>
            );
          })}
          {items.length === 0 && (
            <p style={{ color: 'var(--color-text-light)', gridColumn: '1 / -1' }}>
              衣柜为空，先上传一个皮肤吧。
            </p>
          )}
        </div>
      )}

      {/* Detail dialog */}
      {detailOpen && detailTex && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
          }}
          onClick={() => { setDetailOpen(false); setDetailTex(null); }}
        >
          <div
            className="surface-card detail-dialog-layout"
            style={{
              width: '90%', maxWidth: 800, maxHeight: '90vh',
              overflow: 'auto', borderRadius: 16,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 3D Viewer */}
            <div
              className="detail-viewer"
              style={{
                flex: '0 0 320px',
                background: 'var(--color-background-mute)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: 24,
              }}
            >
              {detailTex.type === 'skin' ? (
                <SkinViewer
                  skinUrl={texturesUrl(detailTex.hash)}
                  model={editModel === 'slim' ? 'slim' : 'classic'}
                  width={280}
                  height={380}
                  autoRotate
                  animate
                  zoom={0.9}
                />
              ) : (
                <CapeViewer
                  capeUrl={texturesUrl(detailTex.hash)}
                  width={280}
                  height={380}
                  autoRotate
                  zoom={0.9}
                />
              )}
            </div>

            {/* Info panel */}
            <div style={{ flex: 1, padding: 24, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {detailLoading && <Loader2 className="w-4 h-4 animate-spin" />}

              {/* Note / Name */}
              <section>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-light)', marginBottom: 4 }}>名称</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    value={editNote}
                    onChange={(e) => setEditNote(e.target.value)}
                    onBlur={saveNote}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveNote(); }}
                    className="input"
                    style={{ flex: 1 }}
                    placeholder="未命名纹理"
                  />
                </div>
              </section>

              {/* Hash */}
              <section>
                <div style={{ fontSize: 11, color: 'var(--color-text-light)', fontFamily: 'monospace' }}>
                  {detailTex.hash}
                </div>
              </section>

              {/* Model toggle (skin only) */}
              {detailTex.type === 'skin' && (
                <section>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-light)', marginBottom: 4 }}>模型选择</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => { setEditModel('classic'); }}
                      onBlur={saveModel}
                      className={editModel === 'classic' ? 'btn-primary' : 'btn-ghost'}
                      style={{ padding: '6px 16px', fontSize: 13 }}
                    >
                      Default
                    </button>
                    <button
                      onClick={() => { setEditModel('slim'); }}
                      onBlur={saveModel}
                      className={editModel === 'slim' ? 'btn-primary' : 'btn-ghost'}
                      style={{ padding: '6px 16px', fontSize: 13 }}
                    >
                      Slim
                    </button>
                  </div>
                </section>
              )}

              {/* Set as avatar (skin only) */}
              {detailTex.type === 'skin' && (
                <section>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-light)', marginBottom: 4 }}>头像</div>
                  <button
                    onClick={setAsAvatar}
                    disabled={settingAvatar}
                    className="btn-ghost"
                    style={{ padding: '6px 16px', fontSize: 13, width: '100%' }}
                  >
                    {settingAvatar ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCircle style={{ width: 14, height: 14 }} />}
                    将此皮肤设为头像
                  </button>
                </section>
              )}

              {/* Public toggle */}
              <section>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-light)', marginBottom: 4 }}>公开状态</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button
                    onClick={() => { setEditPublic(!editPublic); }}
                    className="btn-ghost"
                    style={{ padding: '4px 8px', fontSize: 13 }}
                  >
                    {editPublic ? <ToggleRight style={{ width: 20, height: 20, color: 'var(--color-primary)' }} /> : <ToggleLeft style={{ width: 20, height: 20 }} />}
                  </button>
                  <span style={{ fontSize: 13, color: 'var(--color-text-light)' }}>
                    {editPublic ? '公开（其他用户可在皮肤库看到）' : '私有（仅自己可见）'}
                  </span>
                </div>
              </section>

              {/* Apply to player */}
              <section>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-light)', marginBottom: 4 }}>应用到角色</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select
                    value={applyPlayerId}
                    onChange={(e) => setApplyPlayerId(e.target.value)}
                    className="input"
                    style={{ flex: 1 }}
                  >
                    <option value="">选择目标角色</option>
                    {players.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={doApply}
                    disabled={isApplying || !applyPlayerId}
                    className="btn-primary"
                    style={{ padding: '6px 16px', fontSize: 13, minWidth: 80 }}
                  >
                    {isApplying ? <Loader2 className="w-4 h-4 animate-spin" /> : '确定'}
                  </button>
                </div>
              </section>

              {/* Delete */}
              <section style={{ marginTop: 'auto' }}>
                <button
                  onClick={confirmDelete}
                  className="btn-ghost"
                  style={{ padding: '8px 16px', fontSize: 13, width: '100%', color: '#dc2626', borderColor: '#dc2626' }}
                >
                  <Trash2 style={{ width: 14, height: 14 }} /> 删除纹理
                </button>
              </section>
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
