'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useUserStore } from '@/stores/user';
import { ThemeToggle } from './theme-toggle';
import { Menu, X, User, Settings, LogOut, Shield } from 'lucide-react';

const navItems = [
  { href: '/', label: '首页' },
  { href: '/servers', label: '服务器' },
  { href: '/skin', label: '皮肤站' },
  { href: '/campus', label: '校园游览' },
  { href: '/activities', label: '活动' },
  { href: '/about', label: '关于' },
];

export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loaded, hydrate, logout } = useUserStore();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  const isHome = pathname === '/';
  const isAuthPage = ['/login', '/register', '/reset-password'].includes(pathname);

  useEffect(() => { hydrate(); }, [hydrate]);

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

  const isAdmin = user && ['super_admin', 'admin'].includes(user.user_group);
  const groupLabel: Record<string, string> = {
    super_admin: '超级管理员',
    admin: '管理员',
    teacher: '老师',
    user: '用户',
  };

  return (
    <header
      className={`relative z-50 ${isHome ? 'absolute inset-x-0 top-0' : ''}`}
      style={{ padding: '10px 16px 0', height: 74 }}
    >
      <div className="header-bar">
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-2 font-black text-lg tracking-tight rounded-lg px-3 py-1 hover:bg-[var(--color-background-soft)] transition-colors"
          style={{ color: 'var(--color-heading)' }}
        >
          像素北科
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-1 flex-1 justify-center">
          {navItems.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                pathname === it.href
                  ? 'bg-[#c7e6fa] text-[#1f4f79] dark:bg-[#2e5a80] dark:text-[#eaf4ff] font-bold'
                  : 'hover:bg-[var(--color-background-soft)]'
              }`}
              style={pathname !== it.href ? { color: 'var(--color-text)' } : undefined}
            >
              {it.label}
            </Link>
          ))}
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <ThemeToggle />

          {/* Mobile menu toggle */}
          <button
            className="md:hidden rounded-lg p-2 hover:bg-[var(--color-background-soft)] transition-colors"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          {/* Account popover */}
          {loaded && user ? (
            <div ref={accountRef} className="relative hidden md:block">
              <button
                onClick={() => setAccountOpen(!accountOpen)}
                className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-[var(--color-background-soft)] transition-colors"
              >
                <div className="w-8 h-8 rounded bg-[var(--color-primary)] flex items-center justify-center text-white text-xs font-bold">
                  {(user.username || user.email)[0].toUpperCase()}
                </div>
                <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                  {user.username}
                </span>
              </button>

              {accountOpen && (
                <div className="absolute right-0 top-full mt-2 w-60 surface-card p-4 z-50">
                  <div className="flex items-center gap-3 pb-3 mb-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
                    <div className="w-12 h-12 rounded bg-[var(--color-primary)] flex items-center justify-center text-white text-lg font-bold">
                      {(user.username || user.email)[0].toUpperCase()}
                    </div>
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
                      <User className="w-4 h-4" /> 个人面板
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
            <div className="hidden md:flex items-center gap-2">
              <Link href="/login" className="btn-primary text-sm">登录</Link>
              <Link href="/register" className="btn-ghost text-sm">注册</Link>
            </div>
          ) : null}
        </div>
      </div>

      {/* Mobile Nav */}
      {mobileOpen && (
        <div className="md:hidden surface-card mt-2 p-4 z-50 relative">
          <nav className="flex flex-col gap-1">
            {navItems.map((it) => (
              <Link
                key={it.href}
                href={it.href}
                onClick={() => setMobileOpen(false)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  pathname === it.href
                    ? 'bg-[#c7e6fa] text-[#1f4f79] dark:bg-[#2e5a80] dark:text-[#eaf4ff]'
                    : 'hover:bg-[var(--color-background-soft)]'
                }`}
                style={pathname !== it.href ? { color: 'var(--color-text)' } : undefined}
              >
                {it.label}
              </Link>
            ))}
            <div className="border-t my-2" style={{ borderColor: 'var(--color-border)' }} />
            {user ? (
              <>
                <Link href="/dashboard" onClick={() => setMobileOpen(false)} className="px-3 py-2 rounded-lg text-sm hover:bg-[var(--color-background-soft)]">个人面板</Link>
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
