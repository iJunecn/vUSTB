'use client';

import { useUserStore } from '@/stores/user';
import Link from 'next/link';

export default function DashboardHome() {
  const user = useUserStore((s) => s.user);
  if (!user) return null;
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold">欢迎回来, {user.username}</h1>
        <p className="text-muted-foreground">在这里管理你的账户、皮肤与 Minecraft 角色。</p>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link href="/dashboard/wardrobe" className="glass-card p-5 hover:border-primary/50 transition">
          <h3 className="font-semibold mb-1">皮肤衣柜</h3>
          <p className="text-sm text-muted-foreground">上传与管理你收藏的皮肤、披风。</p>
        </Link>
        <Link href="/dashboard/roles" className="glass-card p-5 hover:border-primary/50 transition">
          <h3 className="font-semibold mb-1">游戏角色</h3>
          <p className="text-sm text-muted-foreground">创建 Minecraft 角色并绑定皮肤。</p>
        </Link>
        <Link href="/skin/settings" className="glass-card p-5 hover:border-primary/50 transition">
          <h3 className="font-semibold mb-1">authlib-injector 接入</h3>
          <p className="text-sm text-muted-foreground">查看在 MC 客户端中接入像素北科皮肤站的方法。</p>
        </Link>
        <Link href="/dashboard/security" className="glass-card p-5 hover:border-primary/50 transition">
          <h3 className="font-semibold mb-1">账号安全</h3>
          <p className="text-sm text-muted-foreground">修改密码、查看登录会话。</p>
        </Link>
      </div>
    </div>
  );
}
