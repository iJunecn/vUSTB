'use client';

import { useUserStore } from '@/stores/user';

export default function ProfilePage() {
  const user = useUserStore((s) => s.user);
  if (!user) return null;
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">个人资料</h1>
      <div className="glass-card p-6 space-y-4">
        <Row label="用户名" value={user.username} />
        <Row label="邮箱" value={user.email} />
        <Row label="邮箱验证" value={user.email_verified ? '已验证' : '未验证'} />
        <Row label="用户组" value={user.user_group} />
      </div>
      <p className="text-sm text-muted-foreground">
        修改用户名功能即将开放,如需变更请联系管理员。
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/40 pb-3 last:border-0 last:pb-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
