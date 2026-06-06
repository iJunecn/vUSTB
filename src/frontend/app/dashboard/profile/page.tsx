'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { useUserStore } from '@/stores/user';
import { rawApi } from '@/lib/api';
import { toast } from 'sonner';
import { Upload, Loader2, UserCircle, ShieldAlert, Check, Trash2 } from 'lucide-react';
import { SkinAvatar } from '@/components/skin/SkinAvatar';

type Texture = {
  hash: string;
  type: 'skin' | 'cape';
  model: string;
  name: string;
  url: string;
};

export default function ProfilePage() {
  const { user, hydrate } = useUserStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [textures, setTextures] = useState<Texture[]>([]);
  const [settingAvatar, setSettingAvatar] = useState(false);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);

  // Edit form
  const [formEmail, setFormEmail] = useState('');
  const [formDisplayName, setFormDisplayName] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Account deletion
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (user) {
      setFormEmail(user.email || '');
      setFormDisplayName(user.display_name || '');
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      rawApi.get<Texture[]>('/api/me/textures').then((r) => {
        setTextures(r.data.filter((t) => t.type === 'skin'));
      }).catch(() => {});
    }
  }, [user]);

  const isPrivileged = user && (user.user_group === 'super_admin' || user.user_group === 'admin');

  async function saveProfile() {
    setSaving(true);
    setMsg(null);
    try {
      // Change password if provided
      if (newPassword) {
        if (!oldPassword) {
          setMsg({ ok: false, text: '请输入旧密码' });
          return;
        }
        if (newPassword.length < 6) {
          setMsg({ ok: false, text: '新密码长度不能少于6个字符' });
          return;
        }
        if (newPassword !== confirmPassword) {
          setMsg({ ok: false, text: '两次输入的新密码不一致' });
          return;
        }
        await rawApi.post('/api/me/password', {
          old_password: oldPassword,
          new_password: newPassword,
        });
        setOldPassword('');
        setNewPassword('');
        setConfirmPassword('');
      }

      // Update profile info
      await rawApi.patch('/api/me', {
        email: formEmail,
        display_name: formDisplayName,
      });
      await hydrate();
      setMsg({ ok: true, text: '保存成功' });
    } catch (err: any) {
      setMsg({ ok: false, text: err?.response?.data?.detail || '保存失败' });
    } finally {
      setSaving(false);
    }
  }

  async function deleteAccount() {
    if (deleteConfirmText !== '注销账号') return;
    setDeleting(true);
    try {
      await rawApi.delete('/api/me');
      localStorage.removeItem('vustb_token');
      window.location.href = '/';
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || '注销失败');
    } finally {
      setDeleting(false);
    }
  }

  async function setAvatarFromTexture(hash: string) {
    setSettingAvatar(true);
    try {
      await rawApi.post('/api/me/avatar/from-texture', { hash });
      await hydrate();
      setShowAvatarPicker(false);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || '设置头像失败');
    } finally {
      setSettingAvatar(false);
    }
  }

  if (!user) return null;

  const avatarUrl = user.avatar_hash ? `/static/textures/${user.avatar_hash}.png` : null;
  const initial = ((user.display_name || user.username || user.email || '').charAt(0) || '?').toUpperCase();
  const isBanned = user.is_banned && user.banned_until && Date.now() < user.banned_until;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 600 }}>
      <div>
        <p className="section-kicker" style={{ marginBottom: 8 }}>ACCOUNT</p>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-heading)', margin: 0 }}>
          个人资料
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-light)', marginTop: 4 }}>
          管理您的账号安全与个性化设置
        </p>
      </div>

      {/* Ban alert */}
      {isBanned && (
        <div style={{
          padding: 16, borderRadius: 12,
          background: 'color-mix(in srgb, #e6a23c 10%, transparent)',
          border: '1px solid color-mix(in srgb, #e6a23c 30%, transparent)',
          display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <ShieldAlert style={{ width: 20, height: 20, color: '#e6a23c', flexShrink: 0, marginTop: 2 }} />
          <div>
            <p style={{ fontWeight: 600, fontSize: 15, color: '#e6a23c', margin: 0 }}>账号已被封禁</p>
            <p style={{ fontSize: 13, color: 'var(--color-text-light)', marginTop: 4 }}>
              您的账号已被管理员封禁，暂时无法通过 Minecraft 客户端登录游戏。您仍可以正常访问皮肤站。
            </p>
          </div>
        </div>
      )}

      {/* Avatar section */}
      <div className="surface-card" style={{ padding: 24, display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
        <div
          style={{
            width: 72, height: 72, borderRadius: 10,
            background: 'var(--color-primary)', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 28, flexShrink: 0,
            overflow: 'hidden',
            cursor: 'pointer',
            transition: 'transform 0.2s',
          }}
          onClick={() => setShowAvatarPicker(!showAvatarPicker)}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.05)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = ''; }}
        >
          {avatarUrl ? (
            <SkinAvatar skinUrl={avatarUrl} size={72} style={{ borderRadius: 10 }} />
          ) : (
            initial
          )}
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ fontWeight: 600, fontSize: 16, color: 'var(--color-heading)' }}>
            {user.display_name || user.username}
          </p>
          <p style={{ fontSize: 13, color: 'var(--color-text-light)', marginTop: 2 }}>{user.email}</p>
        </div>
        <button
          onClick={() => setShowAvatarPicker(!showAvatarPicker)}
          className="btn-ghost"
          style={{ padding: '8px 16px', fontSize: 13 }}
        >
          <UserCircle style={{ width: 14, height: 14 }} /> 从皮肤设为头像
        </button>
      </div>

      {/* Avatar picker from textures */}
      {showAvatarPicker && (
        <div className="surface-card" style={{ padding: 16 }}>
          <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-light)', marginBottom: 12 }}>
            选择一个皮肤来截取头像
          </p>
          {textures.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--color-text-light)' }}>还没有皮肤，先去衣柜上传一个吧。</p>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {textures.map((t) => {
                const texUrl = `/static/textures/${t.hash}.png`;
                return (
                  <button
                    key={t.hash}
                    onClick={() => setAvatarFromTexture(t.hash)}
                    disabled={settingAvatar}
                    style={{
                      padding: 4, borderRadius: 8, border: '2px solid var(--color-border)',
                      background: 'transparent', cursor: 'pointer', transition: 'border-color 0.15s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-primary)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
                    title={t.name || t.hash.slice(0, 8)}
                  >
                    <SkinAvatar skinUrl={texUrl} size={48} style={{ borderRadius: 6 }} />
                  </button>
                );
              })}
            </div>
          )}
          {settingAvatar && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span style={{ fontSize: 13, color: 'var(--color-text-light)' }}>正在设置头像…</span>
            </div>
          )}
        </div>
      )}

      {/* Edit form */}
      <div className="surface-card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>邮箱</span>
            <input
              value={formEmail}
              onChange={(e) => setFormEmail(e.target.value)}
              className="input"
              placeholder="请输入邮箱"
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>用户名</span>
            <input
              value={formDisplayName}
              onChange={(e) => setFormDisplayName(e.target.value)}
              className="input"
              placeholder="请输入用户名"
            />
          </label>

          <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 16, marginTop: 8 }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-heading)', marginBottom: 12 }}>修改密码</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>旧密码</span>
                <input
                  type="password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  className="input"
                  placeholder="请输入旧密码"
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>新密码</span>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="input"
                  placeholder="请输入新密码（留空则不修改）"
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>确认新密码</span>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="input"
                  placeholder="请再次输入新密码"
                />
              </label>
            </div>
          </div>

          {msg && (
            <p style={{ fontSize: 13, color: msg.ok ? 'var(--color-primary)' : '#dc2626' }}>{msg.text}</p>
          )}

          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            {!isPrivileged && (
              <button
                onClick={() => setShowDeleteDialog(true)}
                className="btn-ghost"
                style={{ padding: '8px 16px', fontSize: 13, color: '#dc2626', borderColor: '#dc2626', marginRight: 'auto' }}
              >
                <Trash2 style={{ width: 14, height: 14 }} /> 注销账号
              </button>
            )}
            <button
              onClick={saveProfile}
              disabled={saving}
              className="btn-primary"
              style={{ padding: '8px 24px', fontSize: 14 }}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check style={{ width: 16, height: 16 }} />}
              保存修改
            </button>
          </div>
        </div>
      </div>

      {/* Info rows */}
      <div className="surface-card" style={{ padding: 0 }}>
        <InfoRow label="邮箱验证" value={user.email_verified ? '已验证' : '未验证'} highlight={!user.email_verified} />
        <InfoRow label="用户组" value={user.user_group} last />
      </div>

      {/* Delete account dialog */}
      {showDeleteDialog && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
          }}
          onClick={() => setShowDeleteDialog(false)}
        >
          <div
            className="surface-card"
            style={{ width: '90%', maxWidth: 500, padding: 24 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{
              padding: 12, borderRadius: 8, marginBottom: 16,
              background: 'color-mix(in srgb, #ef4444 10%, transparent)',
              border: '1px solid color-mix(in srgb, #ef4444 30%, transparent)',
            }}>
              <p style={{ fontWeight: 600, fontSize: 15, color: '#ef4444', margin: 0 }}>警告：该操作不可逆！</p>
              <p style={{ fontSize: 13, color: 'var(--color-text-light)', marginTop: 4 }}>
                注销账号后，您的所有数据（包括角色、皮肤、披风等）将被永久删除，无法恢复。
              </p>
            </div>
            <p style={{ fontSize: 14, color: 'var(--color-text)' }}>
              请输入 <strong style={{ color: '#ef4444' }}>注销账号</strong> 来确认操作：
            </p>
            <input
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              className="input"
              placeholder="请输入：注销账号"
              style={{ marginTop: 10 }}
            />
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={() => setShowDeleteDialog(false)} className="btn-ghost" style={{ padding: '8px 16px', fontSize: 13 }}>
                取消
              </button>
              <button
                onClick={deleteAccount}
                disabled={deleteConfirmText !== '注销账号' || deleting}
                className="btn-primary"
                style={{ padding: '8px 16px', fontSize: 13, background: '#ef4444', borderColor: '#ef4444' }}
              >
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 style={{ width: 14, height: 14 }} />}
                确认注销
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value, highlight, last }: { label: string; value: string; highlight?: boolean; last?: boolean }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 24px',
        borderBottom: last ? 'none' : '1px solid color-mix(in srgb, var(--color-border) 40%, transparent)',
      }}
    >
      <span style={{ fontSize: 14, color: 'var(--color-text-light)' }}>{label}</span>
      <span
        style={{
          fontSize: 14, fontWeight: 500,
          color: highlight ? '#dc2626' : 'var(--color-heading)',
        }}
      >
        {value}
      </span>
    </div>
  );
}
