'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useUserStore } from '@/stores/user';
import { User as UserIcon, Shirt, Users, Shield, LogOut, Loader2 } from 'lucide-react';

const NAV = [
  { href: '/dashboard', label: '概览', icon: UserIcon, exact: true },
  { href: '/dashboard/profile', label: '资料', icon: UserIcon },
  { href: '/dashboard/wardrobe', label: '皮肤衣柜', icon: Shirt },
  { href: '/dashboard/roles', label: '游戏角色', icon: Users },
  { href: '/dashboard/security', label: '账号安全', icon: Shield },
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
      <div className="container py-20 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container py-12">
      <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-8">
        <aside className="space-y-1">
          <div className="glass-card p-4 mb-3">
            <p className="font-semibold truncate">{user.username}</p>
            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
            <p className="text-xs mt-2 inline-block px-2 py-0.5 rounded-full bg-primary/10 text-primary">
              {user.user_group}
            </p>
          </div>
          {NAV.map((item) => {
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-xl transition ${
                  active ? 'bg-primary/10 text-primary' : 'hover:bg-muted text-muted-foreground'
                }`}
              >
                <Icon className="w-4 h-4" /> {item.label}
              </Link>
            );
          })}
          <button
            onClick={() => {
              logout();
              router.push('/');
            }}
            className="flex items-center gap-3 px-3 py-2 rounded-xl text-muted-foreground hover:bg-muted w-full text-left"
          >
            <LogOut className="w-4 h-4" /> 退出登录
          </button>
        </aside>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
