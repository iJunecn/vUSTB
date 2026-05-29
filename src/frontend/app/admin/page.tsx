'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Users, KeySquare, Shield } from 'lucide-react';

type Stats = {
  users: number;
  invites: number;
  oauth_apps: number;
};

export default function AdminHomePage() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    api.get<Stats>('/admin/stats').then((r) => setStats(r.data));
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      <div>
        <p className="section-kicker" style={{ marginBottom: 8 }}>ADMIN</p>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-heading)', margin: 0 }}>
          概览
        </h1>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        <StatsCard
          label="总用户数"
          value={stats?.users}
          icon={<Users style={{ width: 28, height: 28 }} />}
          gradientClass="bg-gradient-blue"
        />
        <StatsCard
          label="邀请码"
          value={stats?.invites}
          icon={<KeySquare style={{ width: 28, height: 28 }} />}
          gradientClass="bg-gradient-purple"
        />
        <StatsCard
          label="OAuth 应用"
          value={stats?.oauth_apps}
          icon={<Shield style={{ width: 28, height: 28 }} />}
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
