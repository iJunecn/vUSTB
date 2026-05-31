'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useUserStore } from '@/stores/user';
import { ThemeToggle } from './theme-toggle';
import { Menu, X, User, Settings, LogOut, Shield, ArrowRight } from 'lucide-react';

const navItems = [
  { href: '/', label: '首页' },
  { href: '/servers', label: '服务器' },
  { href: '/campus', label: '在线地图' },
  { href: '/skin', label: '皮肤站' },
  { href: '/print', label: '打印预约' },
  { href: '/about', label: '关于' },
];

export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loaded, hydrate, logout } = useUserStore();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  const isHome = pathname === '/';
  const isAuthPage = ['/login', '/register', '/reset-password'].includes(pathname);

  useEffect(() => { hydrate(); }, [hydrate]);

  useEffect(() => {
    if (!isHome) return;
    function onScroll() { setScrolled(window.scrollY > 40); }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [isHome]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setAccountOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  if (isAuthPage) return null;

  const isAdmin = user && ['super_admin', 'admin', 'teacher'].includes(user.user_group);
  const groupLabel: Record<string, string> = {
    super_admin: '超级管理员',
    admin: '管理员',
    teacher: '老师',
    user: '用户',
  };

  const headerBarClass = isHome && !scrolled
    ? 'header-bar header-bar--transparent'
    : 'header-bar header-bar--solid';

  const navTextColor = isHome && !scrolled ? 'rgba(255,255,255,0.9)' : undefined;
  const navTextHoverBg = isHome && !scrolled
    ? 'rgba(255,255,255,0.15)'
    : 'var(--color-background-soft)';
  const logoColor = isHome && !scrolled ? '#ffffff' : 'var(--color-heading)';

  return (
    <header
      className={`relative z-50 ${isHome ? 'fixed inset-x-0 top-0' : ''}`}
      style={{ height: 56 }}
    >
      <div className={headerBarClass}>
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-2 font-black text-lg tracking-tight rounded-lg px-3 py-1 transition-colors"
          style={{ color: logoColor }}
        >
          <img
            src="/img/logo.webp"
            alt="像素北科"
            style={{ width: 28, height: 28, borderRadius: 4, objectFit: 'cover' }}
          />
          像素北科
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-1 flex-1 justify-center">
          {navItems.map((it) => {
            const isActive = it.href === '/' ? pathname === '/' : pathname.startsWith(it.href);
            return (
              <Link
                key={it.href}
                href={it.href}
                className="px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
                style={{
                  color: isActive
                    ? (isHome && !scrolled ? '#ffffff' : 'var(--color-primary)')
                    : navTextColor,
                  background: isActive
                    ? (isHome && !scrolled ? 'rgba(255,255,255,0.2)' : 'color-mix(in srgb, var(--color-primary) 10%, transparent)')
                    : undefined,
                  fontWeight: isActive ? 600 : 500,
                }}
                onMouseEnter={(e) => {
                  if (!isActive) (e.currentTarget as HTMLElement).style.background = navTextHoverBg;
                }}
                onMouseLeave={(e) => {
                  if (!isActive) (e.currentTarget as HTMLElement).style.background = '';
                }}
              >
                {it.label}
              </Link>
            );
          })}
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <ThemeToggle />

          {/* Mobile menu toggle */}
          <button
            className="md:hidden rounded-lg p-2 transition-colors"
            style={{ color: navTextColor || 'var(--color-text)' }}
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          {/* Account */}
          {loaded && user ? (
            <div ref={accountRef} className="relative hidden md:block">
              <button
                onClick={() => setAccountOpen(!accountOpen)}
                className="flex items-center gap-2 px-2 py-1 rounded-lg transition-colors"
                style={{ color: navTextColor || 'var(--color-text)' }}
              >
                <img
                  src={`/api/users/${user.id}/avatar`}
                  alt=""
                  className="w-7 h-7 rounded-md object-cover bg-gray-300 dark:bg-gray-600"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = '/img/steve.png';
                  }}
                />
                <span className="text-sm font-medium">{user.username}</span>
              </button>

              {accountOpen && (
                <div className="absolute right-0 top-full mt-2 w-60 surface-card p-4 z-50">
                  <div className="flex items-center gap-3 pb-3 mb-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
                    <img
                      src={`/api/users/${user.id}/avatar`}
                      alt=""
                      className="w-12 h-12 rounded-md object-cover bg-gray-300 dark:bg-gray-600"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = '/img/steve.png';
                      }}
                    />
                    <div>
                      <p className="font-semibold text-sm" style={{ color: 'var(--color-heading)' }}>{user.username}</p>
                      <p className="text-xs" style={{ color: 'var(--color-text-light)' }}>{groupLabel[user.user_group] || '用户'}</p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Link
                      href="/dashboard"
                      onClick={() => setAccountOpen(false)}
                      className="btn-ghost text-sm w-full"
                    >
                      <User className="w-4 h-4" /> 个人中心
                    </Link>
                    {isAdmin && (
                      <Link
                        href="/admin"
                        onClick={() => setAccountOpen(false)}
                        className="btn-ghost text-sm w-full"
                      >
                        <Shield className="w-4 h-4" /> 管理面板
                      </Link>
                    )}
                    <button
                      onClick={() => { logout(); setAccountOpen(false); router.push('/'); }}
                      className="btn-ghost text-sm w-full text-red-600 dark:text-red-400"
                    >
                      <LogOut className="w-4 h-4" /> 退出登录
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : loaded ? (
            <Link
              href="/login"
              className="hidden md:inline-flex items-center gap-1 text-sm font-medium px-3 py-1.5 rounded-md transition-colors"
              style={{ color: navTextColor || 'var(--color-text)' }}
            >
              个人中心 <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          ) : null}
        </div>
      </div>

      {/* Mobile Nav */}
      {mobileOpen && (
        <div className="md:hidden surface-card mt-2 p-4 z-50 relative mx-3">
          <nav className="flex flex-col gap-1">
            {navItems.map((it) => {
              const isActive = it.href === '/' ? pathname === '/' : pathname.startsWith(it.href);
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  onClick={() => setMobileOpen(false)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-[color-mix(in_srgb,var(--color-primary)_10%,transparent)] text-[var(--color-primary)] font-semibold'
                      : 'hover:bg-[var(--color-background-soft)]'
                  }`}
                  style={!isActive ? { color: 'var(--color-text)' } : undefined}
                >
                  {it.label}
                </Link>
              );
            })}
            <div className="border-t my-2" style={{ borderColor: 'var(--color-border)' }} />
            {user ? (
              <>
                <Link href="/dashboard" onClick={() => setMobileOpen(false)} className="px-3 py-2 rounded-lg text-sm hover:bg-[var(--color-background-soft)]">个人中心</Link>
                {isAdmin && (
                  <Link href="/admin" onClick={() => setMobileOpen(false)} className="px-3 py-2 rounded-lg text-sm hover:bg-[var(--color-background-soft)]">管理面板</Link>
                )}
                <button
                  onClick={() => { logout(); setMobileOpen(false); router.push('/'); }}
                  className="px-3 py-2 rounded-lg text-sm text-left text-red-600 dark:text-red-400 hover:bg-[var(--color-background-soft)]"
                >
                  退出登录
                </button>
              </>
            ) : (
              <div className="flex gap-2 px-3 py-2">
                <Link href="/login" onClick={() => setMobileOpen(false)} className="btn-primary text-sm flex-1">登录</Link>
                <Link href="/register" onClick={() => setMobileOpen(false)} className="btn-ghost text-sm flex-1">注册</Link>
              </div>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
