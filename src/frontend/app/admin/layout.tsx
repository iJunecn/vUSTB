'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useUserStore } from '@/stores/user';
import {
  LayoutDashboard, Users, KeySquare, Server, Image as ImageIcon,
  Shield, Mail, Loader2,
} from 'lucide-react';

const NAV = [
  { href: '/admin', label: '概览', icon: LayoutDashboard, exact: true },
  { href: '/admin/users', label: '用户', icon: Users },
  { href: '/admin/invites', label: '邀请码', icon: KeySquare },
  { href: '/admin/servers', label: 'MC 服务器', icon: Server },
  { href: '/admin/carousel', label: '轮播图', icon: ImageIcon },
  { href: '/admin/oauth-apps', label: 'OAuth 应用', icon: Shield },
  { href: '/admin/settings', label: '站点设置', icon: Mail },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loaded, hydrate } = useUserStore();

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

  if (!loaded || !user || (user.user_group !== 'admin' && user.user_group !== 'super_admin')) {
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
            <p className="text-xs text-muted-foreground">管理后台</p>
            <p className="font-semibold truncate">{user.username}</p>
            <p className="text-xs mt-1 inline-block px-2 py-0.5 rounded-full bg-primary/10 text-primary">
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
        </aside>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
