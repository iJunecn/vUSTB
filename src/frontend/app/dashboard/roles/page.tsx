'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { rawApi } from '@/lib/api';
import { Loader2, Plus, Trash2, Shirt, X, Link2, Check, Globe, Coins } from 'lucide-react';
import { SkinViewer } from '@/components/skin/SkinViewer';
import { SkinAvatar } from '@/components/skin/SkinAvatar';

type Texture = {
  id: number;
  type: 'skin' | 'cape';
  model: string;
  name: string;
  url: string;
  hash: string;
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

export default function RolesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [players, setPlayers] = useState<Player[]>([]);
  const [wardrobe, setWardrobe] = useState<Texture[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createProgress, setCreateProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pixelPoints, setPixelPoints] = useState(0);

  // Microsoft auth state
  const [msProfile, setMsProfile] = useState<any>(null);
  const [msHasGame, setMsHasGame] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showMsDialog, setShowMsDialog] = useState(false);

  // Remote Yggdrasil import state
  const [showRemoteYggDialog, setShowRemoteYggDialog] = useState(false);
  const [remoteYggUrl, setRemoteYggUrl] = useState('');
  const [remoteYggUsername, setRemoteYggUsername] = useState('');
  const [remoteYggPassword, setRemoteYggPassword] = useState('');
  const [remoteProfiles, setRemoteProfiles] = useState<Array<{id: string; name: string}>>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteImporting, setRemoteImporting] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const [p, w, pts] = await Promise.all([
        rawApi.get<Player[]>('/api/players'),
        rawApi.get<Texture[]>('/api/me/textures'),
        rawApi.get<{ pixel_points: number; shell_points: number }>('/api/points/account'),
      ]);
      setPlayers(p.data);
      setWardrobe(w.data);
      setPixelPoints(pts.data.pixel_points);
    } catch {
      // points fetch may fail for unauthenticated users, that's ok
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();

    // Handle Microsoft auth callback
    const msToken = searchParams.get('ms_token');
    const msError = searchParams.get('error');
    if (msError) {
      setError(decodeURIComponent(msError));
      router.replace('/dashboard/roles');
    } else if (msToken) {
      rawApi.post('/api/microsoft/get-profile', { ms_token: msToken })
        .then((res) => {
          setMsProfile(res.data.profile);
          setMsHasGame(res.data.has_game);
          setShowMsDialog(true);
        })
        .catch((err) => {
          setError(err?.response?.data?.detail || '获取角色信息失败');
        });
      router.replace('/dashboard/roles');
    }
  }, []);

  async function createPlayer(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (pixelPoints < 5) {
      setError('像素积分不足，创建角色需要 5 像素积分。请前往个人中心签到获取积分。');
      return;
    }
    setCreating(true);
    setCreateProgress(0);

    // Simulate progress bar for UX feedback
    const progressInterval = setInterval(() => {
      setCreateProgress((prev) => {
        if (prev >= 90) return prev;
        return prev + Math.random() * 15;
      });
    }, 200);

    try {
      await rawApi.post('/api/me/profiles', { name: newName });
      setCreateProgress(100);
      clearInterval(progressInterval);
      setNewName('');
      await refresh();
    } catch (err: any) {
      setError(err?.response?.data?.detail || '创建失败');
    } finally {
      clearInterval(progressInterval);
      setTimeout(() => {
        setCreating(false);
        setCreateProgress(0);
      }, 500);
    }
  }

  async function bind(playerId: number, type: 'skin' | 'cape', textureId: number | null) {
    const body: Record<string, any> = {};
    if (type === 'skin') {
      if (textureId === null) body.clear_skin = true;
      else body.skin_texture_id = textureId;
    } else {
      if (textureId === null) body.clear_cape = true;
      else body.cape_texture_id = textureId;
    }
    await rawApi.post(`/api/players/${playerId}/bind`, body);
    await refresh();
  }

  async function removePlayer(id: number) {
    if (!confirm('删除该角色？皮肤绑定将被清除。')) return;
    await rawApi.delete(`/api/players/${id}`);
    await refresh();
  }

  async function clearSkin(playerId: number) {
    if (!confirm('确定要清除该角色的皮肤吗？')) return;
    await rawApi.post(`/api/players/${playerId}/bind`, { clear_skin: true });
    await refresh();
  }

  async function clearCape(playerId: number) {
    if (!confirm('确定要清除该角色的披风吗？')) return;
    await rawApi.post(`/api/players/${playerId}/bind`, { clear_cape: true });
    await refresh();
  }

  async function startMicrosoftAuth() {
    try {
      const res = await rawApi.get('/api/microsoft/auth-url');
      window.location.href = res.data.auth_url;
    } catch (err: any) {
      setError(err?.response?.data?.detail || '启动微软登录失败');
    }
  }

  async function fetchRemoteProfiles() {
    if (!remoteYggUrl || !remoteYggUsername || !remoteYggPassword) {
      setError('请填写远程皮肤站地址、用户名和密码');
      return;
    }
    setRemoteLoading(true);
    setError(null);
    try {
      const res = await rawApi.post('/api/remote-ygg/get-profiles', {
        api_url: remoteYggUrl,
        username: remoteYggUsername,
        password: remoteYggPassword,
      });
      setRemoteProfiles(res.data.profiles || []);
      if (!res.data.profiles?.length) {
        setError('该账号没有可用角色');
      }
    } catch (err: any) {
      setError(err?.response?.data?.detail || '获取远程角色失败');
    } finally {
      setRemoteLoading(false);
    }
  }

  async function importRemoteProfile(profileId: string, profileName: string) {
    setRemoteImporting(true);
    setError(null);
    try {
      await rawApi.post('/api/remote-ygg/import-profile', {
        api_url: remoteYggUrl,
        profile_id: profileId,
        profile_name: profileName,
      });
      setShowRemoteYggDialog(false);
      setRemoteProfiles([]);
      setRemoteYggUrl('');
      setRemoteYggUsername('');
      setRemoteYggPassword('');
      await refresh();
    } catch (err: any) {
      setError(err?.response?.data?.detail || '导入远程角色失败');
    } finally {
      setRemoteImporting(false);
    }
  }

  async function importMicrosoftProfile() {
    if (!msProfile) return;
    setImporting(true);
    try {
      const skinData = msProfile.skins?.[0];
      const capeData = msProfile.capes?.[0];
      await rawApi.post('/api/microsoft/import-profile', {
        profile_id: msProfile.id,
        profile_name: msProfile.name,
        skin_url: skinData?.url || null,
        skin_variant: skinData?.variant || 'classic',
        cape_url: capeData?.url || null,
      });
      setShowMsDialog(false);
      setMsProfile(null);
      await refresh();
    } catch (err: any) {
      setError(err?.response?.data?.detail || '导入失败');
    } finally {
      setImporting(false);
    }
  }

  function formatUUID(uuid: string) {
    if (uuid.length === 32) {
      return `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20)}`;
    }
    return uuid;
  }

  function texturesUrl(url: string | null) {
    if (!url) return '';
    // If url is already absolute, use it
    if (url.startsWith('http')) return url;
    return url;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <p className="section-kicker" style={{ marginBottom: 8 }}>CHARACTERS</p>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-heading)', margin: 0 }}>
          游戏角色
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-light)', marginTop: 4 }}>
          创建你的 Minecraft 角色，绑定皮肤后即可在 MC 客户端通过 authlib-injector 登录。
        </p>
      </div>

      {/* Create player form */}
      <form onSubmit={createPlayer} className="surface-card" style={{ padding: 20, display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <label style={{ flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>新角色名（MC 用户名）</span>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="input"
            placeholder="2-24 字符，不含空格"
            required
            disabled={creating}
          />
        </label>
        <button type="submit" disabled={creating || pixelPoints < 5} className="btn-primary">
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus style={{ width: 16, height: 16 }} />}
          新建角色
        </button>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12,
          padding: '4px 10px', borderRadius: 8,
          background: pixelPoints >= 5
            ? 'color-mix(in srgb, #8b5cf6 10%, transparent)'
            : 'color-mix(in srgb, #ef4444 10%, transparent)',
          color: pixelPoints >= 5 ? '#8b5cf6' : '#ef4444',
          fontWeight: 500,
        }}>
          <Coins style={{ width: 14, height: 14 }} />
          {pixelPoints >= 5 ? `消耗 5 积分（当前 ${pixelPoints}）` : `积分不足（${pixelPoints}/5）`}
        </div>
        <button type="button" onClick={startMicrosoftAuth} className="btn-ghost" style={{ padding: '8px 16px', fontSize: 13, borderColor: '#22c55e', color: '#22c55e' }}>
          <Link2 style={{ width: 14, height: 14 }} />
          绑定正版角色
        </button>
        <button type="button" onClick={() => setShowRemoteYggDialog(true)} className="btn-ghost" style={{ padding: '8px 16px', fontSize: 13, borderColor: '#6366f1', color: '#6366f1' }}>
          <Globe style={{ width: 14, height: 14 }} />
          从其他皮肤站导入
        </button>
        {error && <p style={{ fontSize: 13, color: '#dc2626', width: '100%' }}>{error}</p>}
        {/* Progress bar during creation */}
        {creating && (
          <div style={{ width: '100%' }}>
            <div
              style={{
                height: 4,
                borderRadius: 2,
                background: 'var(--color-background-mute)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  borderRadius: 2,
                  background: 'var(--color-primary)',
                  width: `${Math.min(createProgress, 100)}%`,
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
            <p style={{ fontSize: 12, color: 'var(--color-text-light)', marginTop: 4 }}>
              正在创建角色…
            </p>
          </div>
        )}
      </form>

      {/* Player list */}
      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--color-text-light)' }} />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 16,
          }}
        >
          {players.map((p) => (
            <div key={p.id} className="surface-card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* 3D Player preview */}
              <div
                style={{
                  height: 260,
                  background: 'var(--color-background-mute)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                }}
              >
                {p.skin_url ? (
                  <SkinViewer
                    skinUrl={texturesUrl(p.skin_url)}
                    capeUrl={p.cape_url ? texturesUrl(p.cape_url) : undefined}
                    width={180}
                    height={250}
                    autoRotate
                    animate
                    zoom={0.8}
                  />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, color: 'var(--color-text-light)' }}>
                    <Shirt style={{ width: 40, height: 40 }} />
                    <span style={{ fontSize: 13 }}>未设置皮肤</span>
                  </div>
                )}
              </div>

              {/* Player info */}
              <div style={{ padding: 16, textAlign: 'center', background: 'var(--color-background-soft)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 4 }}>
                  {p.skin_url && (
                    <SkinAvatar skinUrl={texturesUrl(p.skin_url)} size={24} style={{ borderRadius: 4 }} />
                  )}
                  <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-heading)' }}>{p.name}</span>
                </div>
                <p style={{ fontSize: 12, color: 'var(--color-text-light)', fontFamily: 'monospace' }}>{p.uuid}</p>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--color-border)' }}>
                {p.skin_url && (
                  <button
                    onClick={() => clearSkin(p.id)}
                    className="btn-ghost"
                    style={{ flex: 1, padding: '6px 8px', fontSize: 12 }}
                    title="清除皮肤"
                  >
                    <X style={{ width: 12, height: 12 }} /> 皮肤
                  </button>
                )}
                {p.cape_url && (
                  <button
                    onClick={() => clearCape(p.id)}
                    className="btn-ghost"
                    style={{ flex: 1, padding: '6px 8px', fontSize: 12 }}
                    title="清除披风"
                  >
                    <X style={{ width: 12, height: 12 }} /> 披风
                  </button>
                )}
                <button
                  onClick={() => removePlayer(p.id)}
                  className="btn-ghost"
                  style={{ flex: 1, padding: '6px 8px', fontSize: 12, color: '#dc2626' }}
                >
                  <Trash2 style={{ width: 12, height: 12 }} /> 删除
                </button>
              </div>

              {/* Bind slots */}
              <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <BindSlot
                  label="皮肤"
                  type="skin"
                  currentId={p.skin_texture_id}
                  currentUrl={p.skin_url}
                  wardrobe={wardrobe}
                  onBind={(id) => bind(p.id, 'skin', id)}
                />
                <BindSlot
                  label="披风"
                  type="cape"
                  currentId={p.cape_texture_id}
                  currentUrl={p.cape_url}
                  wardrobe={wardrobe}
                  onBind={(id) => bind(p.id, 'cape', id)}
                />
              </div>
            </div>
          ))}
          {players.length === 0 && (
            <p style={{ color: 'var(--color-text-light)', gridColumn: '1 / -1' }}>
              还没有角色，创建一个开始游戏。
            </p>
          )}
        </div>
      )}

      {/* Microsoft auth dialog */}
      {showMsDialog && msProfile && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
          }}
          onClick={() => { setShowMsDialog(false); setMsProfile(null); }}
        >
          <div
            className="surface-card"
            style={{ width: '90%', maxWidth: 420, padding: 24 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-heading)', marginBottom: 16 }}>绑定正版角色</h3>
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: 20, padding: 20,
                background: 'var(--color-background-soft)', borderRadius: 8,
              }}
            >
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 20, fontWeight: 600, color: 'var(--color-heading)', margin: 0 }}>{msProfile.name}</p>
                <p style={{ fontSize: 13, fontFamily: 'monospace', color: 'var(--color-text-light)', marginTop: 4 }}>
                  {formatUUID(msProfile.id || '')}
                </p>
              </div>
              <span
                style={{
                  padding: '4px 12px', borderRadius: 6, fontSize: 13, fontWeight: 600,
                  background: msHasGame ? 'color-mix(in srgb, #22c55e 15%, transparent)' : 'color-mix(in srgb, #ef4444 15%, transparent)',
                  color: msHasGame ? '#22c55e' : '#ef4444',
                }}
              >
                {msHasGame ? '拥有游戏' : '无游戏权限'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={() => { setShowMsDialog(false); setMsProfile(null); }} className="btn-ghost" style={{ padding: '8px 16px', fontSize: 13 }} disabled={importing}>
                取消
              </button>
              <button
                onClick={importMicrosoftProfile}
                disabled={importing || !msHasGame}
                className="btn-primary"
                style={{ padding: '8px 16px', fontSize: 13 }}
              >
                {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check style={{ width: 14, height: 14 }} />}
                确认导入
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remote Yggdrasil import dialog */}
      {showRemoteYggDialog && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
          }}
          onClick={() => { setShowRemoteYggDialog(false); setRemoteProfiles([]); }}
        >
          <div
            className="surface-card"
            style={{ width: '90%', maxWidth: 520, padding: 24, maxHeight: '85vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-heading)', marginBottom: 4 }}>
              <Globe style={{ width: 18, height: 18, display: 'inline', marginRight: 8, verticalAlign: '-3px' }} />
              从其他皮肤站导入角色
            </h3>
            <p style={{ fontSize: 13, color: 'var(--color-text-light)', marginBottom: 16 }}>
              输入其他 Yggdrasil 皮肤站的 API 地址和账号，导入角色及其皮肤/披风。
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>API 根地址</span>
                <input
                  value={remoteYggUrl}
                  onChange={(e) => setRemoteYggUrl(e.target.value)}
                  className="input"
                  placeholder="https://skin.example.com/api/yggdrasil/"
                />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>用户名</span>
                  <input
                    value={remoteYggUsername}
                    onChange={(e) => setRemoteYggUsername(e.target.value)}
                    className="input"
                    placeholder="邮箱或用户名"
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>密码</span>
                  <input
                    type="password"
                    value={remoteYggPassword}
                    onChange={(e) => setRemoteYggPassword(e.target.value)}
                    className="input"
                    placeholder="远程站密码"
                    onKeyDown={(e) => { if (e.key === 'Enter') fetchRemoteProfiles(); }}
                  />
                </label>
              </div>
              <button
                onClick={fetchRemoteProfiles}
                disabled={remoteLoading || !remoteYggUrl || !remoteYggUsername}
                className="btn-primary"
                style={{ padding: '8px 16px', fontSize: 13 }}
              >
                {remoteLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : '获取角色列表'}
              </button>
            </div>

            {remoteProfiles.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-heading)', marginBottom: 4 }}>
                  可导入的角色 ({remoteProfiles.length})
                </p>
                {remoteProfiles.map((p) => (
                  <div
                    key={p.id}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '12px 16px', borderRadius: 8,
                      background: 'var(--color-background-soft)',
                    }}
                  >
                    <div>
                      <p style={{ fontWeight: 600, color: 'var(--color-heading)', margin: 0 }}>{p.name}</p>
                      <p style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--color-text-light)', marginTop: 2 }}>{formatUUID(p.id)}</p>
                    </div>
                    <button
                      onClick={() => importRemoteProfile(p.id, p.name)}
                      disabled={remoteImporting}
                      className="btn-primary"
                      style={{ padding: '6px 16px', fontSize: 13 }}
                    >
                      {remoteImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check style={{ width: 14, height: 14 }} />}
                      导入
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button
                onClick={() => { setShowRemoteYggDialog(false); setRemoteProfiles([]); }}
                className="btn-ghost"
                style={{ padding: '8px 16px', fontSize: 13 }}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BindSlot({
  label,
  type,
  currentId,
  currentUrl,
  wardrobe,
  onBind,
}: {
  label: string;
  type: 'skin' | 'cape';
  currentId: number | null;
  currentUrl: string | null;
  wardrobe: Texture[];
  onBind: (id: number | null) => void;
}) {
  const options = wardrobe.filter((t) => t.type === type);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-light)' }}>{label}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div
          style={{
            width: 32, height: 32, borderRadius: 6,
            background: 'var(--color-background-mute)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden', flexShrink: 0,
          }}
        >
          {currentUrl ? (
            type === 'skin' ? (
              <SkinAvatar skinUrl={currentUrl} size={32} style={{ borderRadius: 6 }} />
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={currentUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', imageRendering: 'pixelated' }} />
            )
          ) : (
            <Shirt style={{ width: 16, height: 16, color: 'var(--color-text-light)' }} />
          )}
        </div>
        <select
          value={currentId ?? ''}
          onChange={(e) => onBind(e.target.value ? Number(e.target.value) : null)}
          className="input"
          style={{ flex: 1, fontSize: 12, padding: '6px 8px' }}
        >
          <option value="">未绑定</option>
          {options.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name || t.hash.slice(0, 8)} {type === 'skin' ? `(${t.model})` : ''}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
