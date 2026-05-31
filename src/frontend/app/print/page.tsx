'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useUserStore } from '@/stores/user';
import { rawApi } from '@/lib/api';
import { Printer, CalendarCheck, ClipboardList } from 'lucide-react';

type PrinterInfo = {
  id: number;
  name: string;
  location: string | null;
  model: string | null;
  is_paused: boolean;
};

type PrinterStatus = {
  id: number;
  name: string;
  status: string;
  status_class: string;
  is_paused: boolean;
};

export default function PrintHomePage() {
  const { user, loaded, hydrate } = useUserStore();
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [statuses, setStatuses] = useState<Map<number, PrinterStatus>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => { hydrate(); }, [hydrate]);

  useEffect(() => {
    rawApi.get('/api/print/printers').then((r) => {
      setPrinters(r.data);
      setLoading(false);
      r.data.forEach((p: PrinterInfo) => {
        rawApi.get(`/api/print/printers/${p.id}/status`).then((sr) => {
          setStatuses((prev) => new Map(prev).set(p.id, sr.data));
        });
      });
    }).catch(() => setLoading(false));
  }, []);

  const statusLabel: Record<string, { text: string; color: string }> = {
    idle: { text: '空闲', color: '#22c55e' },
    paused: { text: '暂停使用', color: '#ef4444' },
    reserved: { text: '已预约', color: '#f59e0b' },
    running: { text: '正在运行', color: '#3b82f6' },
  };

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '64px 24px', display: 'flex', flexDirection: 'column', gap: 48 }}>
      {/* Header */}
      <div>
        <span
          style={{
            display: 'inline-block', padding: '4px 12px', borderRadius: 999,
            background: 'color-mix(in srgb, var(--color-primary) 10%, transparent)',
            color: 'var(--color-primary)', fontSize: 13, fontWeight: 600, marginBottom: 16,
          }}
        >
          3D 打印预约系统
        </span>
        <h1 style={{ fontSize: 40, fontWeight: 800, color: 'var(--color-heading)', margin: '0 0 12px 0', letterSpacing: '-0.5px' }}>
          打印预约
        </h1>
        <p style={{ fontSize: 16, color: 'var(--color-text-light)', maxWidth: 600, lineHeight: 1.6 }}>
          预约 3D 打印机，提交打印任务，管理员审批后即可使用。支持上午/下午两个时段。
        </p>
      </div>

      {/* Printer status */}
      <div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-heading)', margin: '0 0 16px 0' }}>
          打印机状态
        </h2>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
            <div style={{ width: 20, height: 20, border: '2px solid var(--color-border)', borderTopColor: 'var(--color-primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          </div>
        ) : printers.length === 0 ? (
          <div className="surface-card" style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-light)' }}>
            暂无打印机
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
            {printers.map((p) => {
              const st = statuses.get(p.id);
              const info = statusLabel[st?.status_class || 'idle'] || statusLabel.idle;
              return (
                <div key={p.id} className="surface-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Printer style={{ width: 22, height: 22, color: 'var(--color-primary)' }} />
                      <span style={{ fontWeight: 600, color: 'var(--color-heading)' }}>{p.name}</span>
                    </div>
                    <span
                      style={{
                        padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                        background: `color-mix(in srgb, ${info.color} 15%, transparent)`,
                        color: info.color,
                      }}
                    >
                      {info.text}
                    </span>
                  </div>
                  {p.location && <p style={{ fontSize: 13, color: 'var(--color-text-light)', margin: 0 }}>位置：{p.location}</p>}
                  {p.model && <p style={{ fontSize: 13, color: 'var(--color-text-light)', margin: 0 }}>型号：{p.model}</p>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Entry cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20 }}>
        <EntryCard
          href="/print/dashboard"
          icon={<ClipboardList style={{ width: 24, height: 24 }} />}
          title="预约面板"
          desc="查看时间表、管理你的预约记录。"
          requireAuth
          loaded={loaded}
          user={user}
        />
        <EntryCard
          href="/print/dashboard"
          icon={<CalendarCheck style={{ width: 24, height: 24 }} />}
          title="创建预约"
          desc="选择日期和时段，提交打印任务。"
          requireAuth
          loaded={loaded}
          user={user}
        />
        <EntryCard
          href="/print/dashboard"
          icon={<Printer style={{ width: 24, height: 24 }} />}
          title="我的预约"
          desc="查看历史预约，签到或取消。"
          requireAuth
          loaded={loaded}
          user={user}
        />
      </div>
    </div>
  );
}

function EntryCard({
  href,
  icon,
  title,
  desc,
  requireAuth,
  loaded,
  user,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
  requireAuth?: boolean;
  loaded?: boolean;
  user?: any;
}) {
  const target = requireAuth && loaded && !user ? '/login' : href;
  return (
    <Link
      href={target}
      className="surface-card hoverable"
      style={{ padding: 28, textDecoration: 'none', display: 'flex', flexDirection: 'column', gap: 16 }}
    >
      <div
        style={{
          width: 48, height: 48, borderRadius: 12,
          background: 'color-mix(in srgb, var(--color-primary) 10%, transparent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--color-primary)',
        }}
      >
        {icon}
      </div>
      <div>
        <h3 style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-heading)', margin: '0 0 4px 0' }}>{title}</h3>
        <p style={{ fontSize: 14, color: 'var(--color-text-light)', margin: 0, lineHeight: 1.5 }}>{desc}</p>
      </div>
    </Link>
  );
}
