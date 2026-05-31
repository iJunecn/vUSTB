'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useUserStore } from '@/stores/user';
import {
  LayoutDashboard, Users, KeySquare, Settings, Mail,
  Shield, Image as ImageIcon, Monitor, LogOut, Loader2, Menu, X,
} from 'lucide-react';
import { SkinAvatar } from '@/components/skin/SkinAvatar';

const NAV = [
  { href: '/admin', label: '概览', icon: LayoutDashboard, exact: true },
  { href: '/admin/users', label: '用户管理', icon: Users },
  { href: '/admin/invites', label: '邀请码', icon: KeySquare },
  { href: '/admin/settings', label: '站点设置', icon: Settings },
  { href: '/admin/email', label: '邮件服务', icon: Mail },
  { href: '/admin/oauth-apps', label: 'OAuth 应用', icon: Shield },
  { href: '/admin/carousel', label: '轮播图', icon: ImageIcon },
  { href: '/admin/mojang', label: 'Mojang Fallback', icon: Monitor },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loaded, hydrate, logout } = useUserStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (loaded) {
      if (!user) router.replace('/login');
      else if (user.user_group !== 'admin' && user.user_group !== 'super_admin') {
        router.replace('/');
      }
    }
  }, [loaded, user, router]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  if (!loaded || !user || (user.user_group !== 'admin' && user.user_group !== 'super_admin')) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--color-text-light)' }} />
      </div>
    );
  }

  const displayName = user.username || user.display_name || user.email || '';
  const avatarUrl = user.avatar_hash
    ? `/static/textures/${user.avatar_hash}.png`
    : '/img/steve.png';

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 40,
            background: 'rgba(0,0,0,0.4)',
          }}
        />
      )}

      {/* Sidebar */}
      <aside
        style={{
          width: 240,
          flexShrink: 0,
          borderRight: '1px solid var(--color-border)',
          background: 'var(--color-card-background)',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative' as const,
          zIndex: 50,
        }}
        className="admin-sidebar-desktop"
      >
        <style>{`
          @media (max-width: 767px) {
            .admin-sidebar-desktop {
              position: fixed;
              top: 0; left: 0; bottom: 0;
              transform: translateX(-100%);
              transition: transform 0.25s ease;
              z-index: 50;
            }
            .admin-sidebar-desktop.open {
              transform: translateX(0);
            }
            .admin-main-content {
              width: 100% !important;
            }
            .admin-mobile-toggle {
              display: flex !important;
            }
          }
        `}</style>

        {/* Admin info card */}
        <div style={{ padding: 20 }}>
          <div
            style={{
              padding: 16, borderRadius: 12,
              border: '1px solid var(--color-border)',
              background: 'var(--color-background-soft)',
            }}
          >
            <p style={{ fontSize: 11, color: 'var(--color-text-light)', marginBottom: 6, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' as const }}>
              管理后台
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
              {user.avatar_hash ? (
                <SkinAvatar
                  skinUrl={avatarUrl}
                  size={32}
                  style={{ borderRadius: 6, flexShrink: 0 }}
                />
              ) : (
                <SkinAvatar
                  skinUrl="/img/steve.png"
                  size={32}
                  style={{ borderRadius: 6, flexShrink: 0 }}
                />
              )}
              <div style={{ minWidth: 0 }}>
                <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-heading)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {displayName}
                </p>
                <span
                  style={{
                    display: 'inline-block', marginTop: 2,
                    padding: '1px 6px', borderRadius: 999, fontSize: 10,
                    background: 'color-mix(in srgb, var(--color-primary) 10%, transparent)',
                    color: 'var(--color-primary)', fontWeight: 600,
                  }}
                >
                  {user.user_group}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Nav items */}
        <nav style={{ flex: 1, padding: '0 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV.map((item) => {
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px', borderRadius: 10,
                  fontSize: 14, fontWeight: 500,
                  background: active
                    ? 'color-mix(in srgb, var(--color-primary) 10%, transparent)'
                    : 'transparent',
                  color: active ? 'var(--color-primary)' : 'var(--color-text-light)',
                  textDecoration: 'none',
                  transition: 'background 0.15s, color 0.15s',
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.background = 'var(--color-background-mute)';
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.background = 'transparent';
                }}
              >
                <Icon style={{ width: 18, height: 18 }} /> {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Logout */}
        <div style={{ padding: '0 12px 20px' }}>
          <button
            onClick={() => {
              logout();
              router.push('/');
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 12px', borderRadius: 10, width: '100%',
              fontSize: 14, fontWeight: 500,
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--color-text-light)',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-background-mute)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <LogOut style={{ width: 18, height: 18 }} /> 退出登录
          </button>
        </div>
      </aside>

      {/* Mobile toggle */}
      <button
        className="admin-mobile-toggle"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        style={{
          display: 'none', position: 'fixed', top: 16, left: 16, zIndex: 60,
          width: 40, height: 40, borderRadius: 10, border: '1px solid var(--color-border)',
          background: 'var(--color-card-background)', alignItems: 'center',
          justifyContent: 'center', cursor: 'pointer',
        }}
      >
        {sidebarOpen ? <X style={{ width: 20, height: 20 }} /> : <Menu style={{ width: 20, height: 20 }} />}
      </button>

      {/* Main content */}
      <main
        className="admin-main-content"
        style={{
          flex: 1, minWidth: 0,
          padding: '32px 40px',
          background: 'var(--color-background)',
        }}
      >
        {children}
      </main>
    </div>
  );
}
