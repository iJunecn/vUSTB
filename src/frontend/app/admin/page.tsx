'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function AdminHomePage() {
  const [stats, setStats] = useState<{ users: number; invites: number; oauth_apps: number } | null>(null);
  useEffect(() => {
    api.get('/admin/stats').then((r) => setStats(r.data));
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">概览</h1>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="注册用户" value={stats?.users} />
        <StatCard label="邀请码" value={stats?.invites} />
        <StatCard label="OAuth 应用" value={stats?.oauth_apps} />
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="glass-card p-5 space-y-1">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-3xl font-bold">{value ?? '—'}</p>
    </div>
  );
}
