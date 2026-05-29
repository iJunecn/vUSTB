'use client';

import { useEffect, useState } from 'react';
import { useUserStore } from '@/stores/user';
import { api } from '@/lib/api';
import { Users, Shirt, Gamepad2 } from 'lucide-react';

type Stats = {
  users: number;
  textures: number;
  players: number;
};

export default function DashboardHome() {
  const user = useUserStore((s) => s.user);
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    api.get<Stats>('/admin/stats').then((r) => {
      setStats({
        users: r.data.users,
        textures: (r.data as any).textures ?? 0,
        players: (r.data as any).players ?? 0,
      });
    }).catch(() => {
      // Non-admin users may not have access; show zeros
      setStats({ users: 0, textures: 0, players: 0 });
    });
  }, []);

  if (!user) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      {/* Welcome header */}
      <div>
        <p className="section-kicker" style={{ marginBottom: 8 }}>DASHBOARD</p>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-heading)', margin: 0 }}>
          欢迎回来, {user.username}
        </h1>
        <p style={{ fontSize: 15, color: 'var(--color-text-light)', marginTop: 4 }}>
          在这里管理你的账户、皮肤与 Minecraft 角色。
        </p>
      </div>

      {/* Stats cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        <StatsCard
          label="用户数"
          value={stats?.users}
          icon={<Users style={{ width: 28, height: 28 }} />}
          gradientClass="bg-gradient-blue"
        />
        <StatsCard
          label="材质数"
          value={stats?.textures}
          icon={<Shirt style={{ width: 28, height: 28 }} />}
          gradientClass="bg-gradient-purple"
        />
        <StatsCard
          label="角色数"
          value={stats?.players}
          icon={<Gamepad2 style={{ width: 28, height: 28 }} />}
          gradientClass="bg-gradient-blue"
        />
      </div>
    </div>
  );
}

function StatsCard({
  label,
  value,
  icon,
  gradientClass,
}: {
  label: string;
  value: number | undefined;
  icon: React.ReactNode;
  gradientClass: string;
}) {
  return (
    <div className="surface-card">
      <div className="stats-card-content">
        <div className={`stats-card-icon ${gradientClass}`}>
          {icon}
        </div>
        <div className="stats-card-info">
          <span className="stats-card-label">{label}</span>
          <span className="stats-card-value">{value ?? '--'}</span>
        </div>
      </div>
    </div>
  );
}
