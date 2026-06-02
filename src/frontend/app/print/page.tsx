'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useUserStore } from '@/stores/user';
import { rawApi } from '@/lib/api';
import { Printer, CalendarCheck, ClipboardList, ShieldCheck, Clock, AlertTriangle, X, Info } from 'lucide-react';

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
  const [showNotice, setShowNotice] = useState(false);

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

  // Show notice modal on first visit
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const seen = localStorage.getItem('vustb_print_notice_seen');
      if (!seen) setShowNotice(true);
    }
  }, []);

  const dismissNotice = () => {
    setShowNotice(false);
    localStorage.setItem('vustb_print_notice_seen', '1');
  };

  const statusLabel: Record<string, { text: string; color: string }> = {
    idle: { text: '空闲', color: '#22c55e' },
    paused: { text: '暂停使用', color: '#ef4444' },
    reserved: { text: '已预约', color: '#f59e0b' },
    running: { text: '正在运行', color: '#3b82f6' },
  };

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '64px 24px', display: 'flex', flexDirection: 'column', gap: 48 }}>
      {/* Hero Section */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ marginBottom: 24, borderRadius: 16, overflow: 'hidden', boxShadow: '0 8px 24px rgba(66,82,105,0.12)' }}>
          <Image
            src="/images/pc5.jpg"
            alt="Bambu H2D 3D 打印机"
            width={960}
            height={480}
            style={{ width: '100%', height: 'auto', display: 'block' }}
            priority
          />
        </div>
        <h1 style={{ fontSize: 36, fontWeight: 800, color: 'var(--color-heading)', margin: '0 0 8px', letterSpacing: '-0.5px' }}>
          智能学院天码智能社<br />3D打印预约系统
        </h1>
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
                  <p style={{ fontSize: 12, color: 'var(--color-text-light)', margin: 0 }}>
                    {st?.status_class === 'idle' ? '当前设备空闲，欢迎预约' : '请根据预约时间表合理安排'}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Feature cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        <div className="surface-card" style={{ padding: 24, textAlign: 'center' }}>
          <CalendarCheck style={{ width: 32, height: 32, color: 'var(--color-primary)', marginBottom: 8 }} />
          <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-heading)', margin: '0 0 4px' }}>在线预约</h3>
          <p style={{ fontSize: 13, color: 'var(--color-text-light)', margin: 0 }}>实时查看预约时间表，快速预定打印时段</p>
        </div>
        <div className="surface-card" style={{ padding: 24, textAlign: 'center' }}>
          <Clock style={{ width: 32, height: 32, color: '#22c55e', marginBottom: 8 }} />
          <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-heading)', margin: '0 0 4px' }}>灵活管理</h3>
          <p style={{ fontSize: 13, color: 'var(--color-text-light)', margin: 0 }}>随时查看和取消您的预约，合理安排时间</p>
        </div>
        <div className="surface-card" style={{ padding: 24, textAlign: 'center' }}>
          <ShieldCheck style={{ width: 32, height: 32, color: '#ef4444', marginBottom: 8 }} />
          <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-heading)', margin: '0 0 4px' }}>安全可靠</h3>
          <p style={{ fontSize: 13, color: 'var(--color-text-light)', margin: 0 }}>团队设备，及时维护，安全有保障</p>
        </div>
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
          href="/print/booking"
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

      {/* Notice button */}
      <div style={{ textAlign: 'center', paddingTop: 8 }}>
        <button
          onClick={() => setShowNotice(true)}
          className="btn-ghost"
          style={{ fontSize: 13, padding: '6px 16px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <AlertTriangle style={{ width: 14, height: 14 }} /> 查看使用须知
        </button>
      </div>

      {/* Notice Modal */}
      {showNotice && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) dismissNotice(); }}
        >
          <div
            style={{
              background: 'var(--color-card-background)', borderRadius: 16, maxWidth: 520, width: '100%',
              boxShadow: '0 16px 48px rgba(0,0,0,0.2)', overflow: 'hidden',
              animation: 'slideUp 0.3s ease-out',
            }}
          >
            {/* Header */}
            <div style={{
              background: '#dc2626', color: '#fff', padding: '16px 20px',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle style={{ width: 18, height: 18 }} /> 重要公告
              </h3>
              <button onClick={dismissNotice} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 4 }}>
                <X style={{ width: 18, height: 18 }} />
              </button>
            </div>
            {/* Body */}
            <div style={{ padding: '20px 24px', fontSize: 14, color: 'var(--color-text)', lineHeight: 1.7 }}>
              <div style={{
                padding: '10px 14px', borderRadius: 8, marginBottom: 16,
                background: 'color-mix(in srgb, #f59e0b 10%, transparent)', border: '1px solid color-mix(in srgb, #f59e0b 20%, transparent)',
                display: 'flex', gap: 8, alignItems: 'flex-start',
              }}>
                <Info style={{ width: 16, height: 16, color: '#f59e0b', flexShrink: 0, marginTop: 2 }} />
                <strong>设备信息</strong>
              </div>
              <p><strong>本3D打印机型号为 Bambu H2D，附有AMS2 Pro多色自动供料系统。</strong></p>
              <p><strong>为智能学院团委创新创业中心部门及天码智能社社团资产。</strong></p>
              <p>设备仅支持使用USB移动储存设备输入Bambu Lab的切片文件进行打印，打印前请确保自己熟练使用Bambu Lab，所输出的切片文件及各类参数设置正确。</p>
              <p>请确保自己能够独立操作本Bambu H2D打印机并完成完整打印操作。</p>
              <p>以上要求若有问题，请优先前往拓竹官网查看Wiki或前往各平台在线专卖店询问拓竹官方客服，仍有问题请联系本台打印机管理人员！</p>
              <div style={{
                padding: '12px 14px', borderRadius: 8, marginTop: 12,
                background: 'color-mix(in srgb, #ef4444 10%, transparent)', border: '1px solid color-mix(in srgb, #ef4444 20%, transparent)',
                color: '#ef4444', fontWeight: 600, fontSize: 13,
              }}>
                <AlertTriangle style={{ width: 14, height: 14, display: 'inline', marginRight: 6 }} />
                设备为精密贵重机器，所有人必须经过此系统预约使用后方可使用，未经登记允许请勿使用，谨防碰撞！
              </div>
            </div>
            {/* Footer */}
            <div style={{ padding: '0 24px 20px', textAlign: 'center' }}>
              <button onClick={dismissNotice} className="btn-primary" style={{ padding: '10px 24px' }}>
                我已知晓
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Spinner animation */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
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
