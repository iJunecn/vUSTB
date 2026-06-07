'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useUserStore } from '@/stores/user';
import {
  LayoutDashboard, Users, KeySquare, Settings,
  Shield, Monitor, LogOut, Loader2, Printer, Newspaper, ImageIcon,
  Palette, UserCircle, Server,
} from 'lucide-react';
import { SkinAvatar } from '@/components/skin/SkinAvatar';

const NAV = [
  { href: '/admin', label: '概览', shortLabel: '概览', icon: LayoutDashboard, exact: true },
  { href: '/admin/users', label: '用户管理', shortLabel: '用户', icon: Users },
  { href: '/admin/servers', label: '服务器管理', shortLabel: '服务器', icon: Server },
  { href: '/admin/textures', label: '材质管理', shortLabel: '材质', icon: Palette },
  { href: '/admin/profiles', label: '角色管理', shortLabel: '角色', icon: UserCircle },
  { href: '/admin/dynamics', label: '动态管理', shortLabel: '动态', icon: Newspaper },
  { href: '/admin/media', label: '图片管理', shortLabel: '图片', icon: ImageIcon },
  { href: '/admin/print', label: '打印预约管理', shortLabel: '打印', icon: Printer },
  { href: '/admin/invites', label: '邀请码', shortLabel: '邀请', icon: KeySquare },
  { href: '/admin/settings', label: '站点设置', shortLabel: '设置', icon: Settings },
  { href: '/admin/oauth-apps', label: 'OAuth 应用', shortLabel: 'OAuth', icon: Shield },
  { href: '/admin/mojang', label: 'Mojang Fallback', shortLabel: 'Mojang', icon: Monitor },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loaded, hydrate, logout } = useUserStore();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (loaded) {
      if (!user) router.replace('/login');
      else if (user.user_group === 'teacher') {
        // teacher can only access /admin/print and /admin/invites
        if (!pathname.startsWith('/admin/print') && !pathname.startsWith('/admin/invites')) {
          router.replace('/admin/print');
        }
      } else if (user.user_group === 'server_manager') {
        // server_manager can only access servers, dynamics, textures, profiles
        const allowed = ['/admin/servers', '/admin/dynamics', '/admin/textures', '/admin/profiles'];
        if (!allowed.some((p) => pathname.startsWith(p))) {
          router.replace('/admin/servers');
        }
      } else if (user.user_group !== 'admin' && user.user_group !== 'super_admin') {
        router.replace('/');
      }
    }
  }, [loaded, user, router, pathname]);

  const canAccessAdmin = user && (user.user_group === 'admin' || user.user_group === 'super_admin');
  const isTeacher = user?.user_group === 'teacher';
  const isServerManager = user?.user_group === 'server_manager';

  if (!loaded || !user || (!canAccessAdmin && !isTeacher && !isServerManager)) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--color-text-light)' }} />
      </div>
    );
  }

  const displayName = user.username || user.display_name || user.email || '';
  const visibleNav = NAV.filter((item) => {
    if (isTeacher) return item.href === '/admin/print' || item.href === '/admin/invites';
    if (isServerManager) return ['/admin/servers', '/admin/dynamics', '/admin/textures', '/admin/profiles'].some((p) => item.href.startsWith(p));
    return true;
  });

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Desktop sidebar */}
      <aside
        style={{
          width: 240,
          flexShrink: 0,
          borderRight: '1px solid var(--color-border)',
          background: 'var(--color-card-background)',
          display: 'flex',
          flexDirection: 'column',
        }}
        className="admin-sidebar-desktop"
      >
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
                <img
                  src={`/static/textures/${user.avatar_hash}.png`}
                  alt=""
                  style={{
                    width: 32, height: 32, borderRadius: 6,
                    objectFit: 'cover', flexShrink: 0,
                    imageRendering: 'pixelated',
                    background: 'var(--color-background-mute)',
                  }}
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
          {visibleNav.map((item) => {
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

      {/* Mobile bottom tab bar — scrollable for many items */}
      <nav
        className="admin-bottom-tabs"
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          zIndex: 40,
          background: 'var(--color-card-background)',
          borderTop: '1px solid var(--color-border)',
          display: 'none',
          alignItems: 'center',
          height: 56,
          boxShadow: '0 -2px 8px rgba(0,0,0,0.06)',
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
        }}
      >
        {visibleNav.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                flex: '0 0 auto',
                minWidth: 64,
                padding: '6px 8px',
                textDecoration: 'none',
                color: active ? 'var(--color-primary)' : 'var(--color-text-light)',
                transition: 'color 0.15s',
              }}
            >
              <Icon style={{ width: 20, height: 20 }} />
              <span style={{ fontSize: 11, fontWeight: active ? 600 : 400, marginTop: 2, whiteSpace: 'nowrap' }}>
                {item.shortLabel}
              </span>
            </Link>
          );
        })}
        {/* Logout tab */}
        <button
          onClick={() => {
            logout();
            router.push('/');
          }}
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            flex: '0 0 auto',
            minWidth: 64,
            padding: '6px 8px',
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--color-text-light)',
            fontSize: 11, fontWeight: 400,
            transition: 'color 0.15s',
          }}
        >
          <LogOut style={{ width: 20, height: 20 }} />
          <span style={{ marginTop: 2 }}>退出</span>
        </button>
      </nav>

      <style>{`
        @media (max-width: 767px) {
          .admin-sidebar-desktop {
            display: none !important;
          }
          .admin-main-content {
            padding: 16px !important;
            padding-bottom: 72px !important;
          }
          .admin-bottom-tabs {
            display: flex !important;
          }
          .admin-bottom-tabs::-webkit-scrollbar {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}