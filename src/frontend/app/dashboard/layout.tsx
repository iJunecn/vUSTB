'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useUserStore } from '@/stores/user';
import {
  LayoutDashboard, Coins, Shirt, Users, Shield, LogOut, Loader2,
} from 'lucide-react';
import { SkinAvatar } from '@/components/skin/SkinAvatar';

const NAV = [
  { href: '/dashboard', label: '概览', icon: LayoutDashboard, exact: true },
  { href: '/dashboard/points', label: '积分', icon: Coins },
  { href: '/dashboard/wardrobe', label: '衣柜', icon: Shirt },
  { href: '/dashboard/roles', label: '角色', icon: Users },
  { href: '/dashboard/security', label: '安全', icon: Shield },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loaded, hydrate, logout } = useUserStore();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (loaded && !user) router.replace('/login');
  }, [loaded, user, router]);

  if (!loaded || !user) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--color-text-light)' }} />
      </div>
    );
  }

  const displayName = user.username || user.display_name || user.email || '';

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
        className="dashboard-sidebar-desktop"
      >
        {/* User info card */}
        <div style={{ padding: 20 }}>
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: 16, borderRadius: 12,
              border: '1px solid var(--color-border)',
              background: 'var(--color-background-soft)',
            }}
          >
            {user.avatar_hash ? (
              <img
                src={`/static/textures/${user.avatar_hash}.png`}
                alt=""
                style={{
                  width: 40, height: 40, borderRadius: 6,
                  objectFit: 'cover', flexShrink: 0,
                  imageRendering: 'pixelated',
                  background: 'var(--color-background-mute)',
                }}
              />
            ) : (
              <SkinAvatar
                skinUrl="/img/steve.png"
                size={40}
                style={{ borderRadius: 6, flexShrink: 0 }}
              />
            )}
            <div style={{ minWidth: 0 }}>
              <p style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-heading)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {displayName}
              </p>
              <p style={{ fontSize: 12, color: 'var(--color-text-light)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.email}
              </p>
              <span
                style={{
                  display: 'inline-block', marginTop: 4,
                  padding: '2px 8px', borderRadius: 999, fontSize: 11,
                  background: 'color-mix(in srgb, var(--color-primary) 10%, transparent)',
                  color: 'var(--color-primary)', fontWeight: 600,
                }}
              >
                {user.user_group}
              </span>
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

        {/* Logout button */}
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
        className="dashboard-main-content"
        style={{
          flex: 1, minWidth: 0,
          padding: '32px 40px',
          background: 'var(--color-background)',
        }}
      >
        {children}
      </main>

      {/* Mobile bottom tab bar */}
      <nav
        className="dashboard-bottom-tabs"
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          zIndex: 40,
          background: 'var(--color-card-background)',
          borderTop: '1px solid var(--color-border)',
          display: 'none',
          justifyContent: 'space-around',
          alignItems: 'center',
          height: 56,
          padding: '0 4px',
          boxShadow: '0 -2px 8px rgba(0,0,0,0.06)',
        }}
      >
        {NAV.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                flex: 1, minWidth: 0,
                padding: '6px 0',
                textDecoration: 'none',
                color: active ? 'var(--color-primary)' : 'var(--color-text-light)',
                transition: 'color 0.15s',
              }}
            >
              <Icon style={{ width: 20, height: 20 }} />
              <span style={{ fontSize: 11, fontWeight: active ? 600 : 400, marginTop: 2 }}>
                {item.label}
              </span>
            </Link>
          );
        })}
        {/* Logout as last tab */}
        <button
          onClick={() => {
            logout();
            router.push('/');
          }}
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            flex: 1, minWidth: 0,
            padding: '6px 0',
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
          .dashboard-sidebar-desktop {
            display: none !important;
          }
          .dashboard-main-content {
            padding: 16px !important;
            padding-bottom: 72px !important;
          }
          .dashboard-bottom-tabs {
            display: flex !important;
          }
        }
      `}</style>
    </div>
  );
}