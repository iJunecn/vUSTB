'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useUserStore } from '@/stores/user';
import { rawApi } from '@/lib/api';
import {
  ChevronLeft, ChevronRight, CalendarCheck, XCircle, Play,
  Clock, CheckCircle2, AlertCircle, Loader2,
} from 'lucide-react';

type Booking = {
  id: number;
  user_id: number;
  printer_id: number | null;
  date: string;
  slot_type: string;
  own_filament: boolean;
  print_type: string;
  weight: number;
  cost: number;
  file_name: string | null;
  purpose: string | null;
  is_paid: boolean;
  status: string;
  rejection_reason: string | null;
  created_at: string | null;
  username: string | null;
  real_name: string | null;
  student_id: string | null;
};

type PrinterInfo = {
  id: number;
  name: string;
  is_paused: boolean;
};

const SLOT_LABELS: Record<string, string> = { AM: '上午 (08:00-11:30)', PM: '下午 (13:30-17:00)' };
const STATUS_MAP: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending: { label: '待审批', color: '#f59e0b', icon: <Clock style={{ width: 14, height: 14 }} /> },
  booked: { label: '已预约', color: '#3b82f6', icon: <CalendarCheck style={{ width: 14, height: 14 }} /> },
  running: { label: '运行中', color: '#8b5cf6', icon: <Play style={{ width: 14, height: 14 }} /> },
  done: { label: '已完成', color: '#22c55e', icon: <CheckCircle2 style={{ width: 14, height: 14 }} /> },
  cancelled: { label: '已取消', color: '#6b7280', icon: <XCircle style={{ width: 14, height: 14 }} /> },
  rejected: { label: '已拒绝', color: '#ef4444', icon: <AlertCircle style={{ width: 14, height: 14 }} /> },
};

function getMonday(d: Date): Date {
  const dt = new Date(d);
  const day = dt.getDay();
  const diff = dt.getDate() - day + (day === 0 ? -6 : 1);
  dt.setDate(diff);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

export default function PrintDashboard() {
  const router = useRouter();
  const { user, loaded, hydrate } = useUserStore();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [myBookings, setMyBookings] = useState<Booking[]>([]);
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);

  useEffect(() => { hydrate(); }, [hydrate]);

  useEffect(() => {
    if (loaded && !user) router.replace('/login');
  }, [loaded, user, router]);

  const monday = getMonday(new Date());
  monday.setDate(monday.getDate() + weekOffset * 7);
  const weekDates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    weekDates.push(d.toISOString().slice(0, 10));
  }

  const loadData = useCallback(async () => {
    if (!loaded || !user) return;
    setLoading(true);
    try {
      const [scheduleRes, mineRes, printersRes] = await Promise.all([
        rawApi.get('/api/print/schedule', { params: { date_from: weekDates[0], date_to: weekDates[6], printer_id: selectedPrinter || undefined } }),
        rawApi.get('/api/print/bookings', { params: { mine: true } }),
        rawApi.get('/api/print/printers'),
      ]);
      setBookings(scheduleRes.data);
      setMyBookings(mineRes.data);
      setPrinters(printersRes.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, [loaded, user, weekDates, selectedPrinter]);

  useEffect(() => { loadData(); }, [loadData]);

  if (!loaded || !user) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--color-text-light)' }} />
      </div>
    );
  }

  const weekDayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

  // Build schedule grid
  const grid: Record<string, Record<string, Booking | null>> = {};
  for (const d of weekDates) grid[d] = { AM: null, PM: null };
  for (const b of bookings) {
    if (grid[b.date]) grid[b.date][b.slot_type] = b;
  }

  const canManage = user && ['super_admin', 'admin', 'teacher'].includes(user.user_group);

  const handleAction = async (action: string, bookingId: number, extra?: any) => {
    try {
      if (action === 'cancel') {
        await rawApi.post(`/api/print/bookings/${bookingId}/cancel`);
      } else if (action === 'checkin') {
        await rawApi.post(`/api/print/bookings/${bookingId}/checkin`);
      } else if (action === 'approve') {
        await rawApi.post(`/api/print/admin/approve/${bookingId}`);
      } else if (action === 'reject') {
        await rawApi.post(`/api/print/admin/reject/${bookingId}`, extra);
      }
      loadData();
    } catch (err: any) {
      alert(err?.response?.data?.detail || '操作失败');
    }
  };

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px', display: 'flex', flexDirection: 'column', gap: 32 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <p className="section-kicker" style={{ marginBottom: 4 }}>3D PRINT</p>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--color-heading)', margin: 0 }}>预约面板</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {printers.length > 1 && (
            <select
              value={selectedPrinter || ''}
              onChange={(e) => setSelectedPrinter(e.target.value ? Number(e.target.value) : null)}
              style={{
                padding: '6px 10px', borderRadius: 8, fontSize: 13,
                border: '1px solid var(--color-border)', background: 'var(--color-card-background)',
                color: 'var(--color-text)',
              }}
            >
              <option value="">全部打印机</option>
              {printers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <button
            onClick={() => router.push('/print/booking')}
            className="btn-primary"
            style={{ fontSize: 13, padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <CalendarCheck style={{ width: 14, height: 14 }} /> 新建预约
          </button>
        </div>
      </div>

      {/* Week navigation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => setWeekOffset(weekOffset - 1)} className="btn-ghost" style={{ padding: '4px 8px' }}>
          <ChevronLeft style={{ width: 18, height: 18 }} />
        </button>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-heading)', minWidth: 180, textAlign: 'center' }}>
          {weekDates[0]} ~ {weekDates[6]}
        </span>
        <button onClick={() => setWeekOffset(weekOffset + 1)} className="btn-ghost" style={{ padding: '4px 8px' }}>
          <ChevronRight style={{ width: 18, height: 18 }} />
        </button>
        {weekOffset !== 0 && (
          <button onClick={() => setWeekOffset(0)} className="btn-ghost" style={{ fontSize: 12, padding: '2px 8px' }}>
            本周
          </button>
        )}
      </div>

      {/* Schedule grid */}
      <div className="surface-card" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ padding: '10px 12px', textAlign: 'left', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-light)', fontWeight: 600, fontSize: 12 }}>时段</th>
              {weekDates.map((d, i) => (
                <th key={d} style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-light)', fontWeight: 600, fontSize: 12 }}>
                  {weekDayNames[i]}<br />{d.slice(5)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {['AM', 'PM'].map((slot) => (
              <tr key={slot}>
                <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                  {SLOT_LABELS[slot]}
                </td>
                {weekDates.map((d) => {
                  const b = grid[d]?.[slot];
                  const isPast = new Date(d + 'T23:59:59') < new Date();
                  const isMyBooking = b && b.user_id === user.id;
                  return (
                    <td key={d + slot} style={{ padding: 8, borderBottom: '1px solid var(--color-border)', textAlign: 'center', verticalAlign: 'top' }}>
                      {b ? (
                        <div
                          style={{
                            padding: '6px 8px', borderRadius: 8, fontSize: 12,
                            background: isMyBooking
                              ? 'color-mix(in srgb, var(--color-primary) 10%, transparent)'
                              : 'var(--color-background-mute)',
                            border: isMyBooking ? '1px solid color-mix(in srgb, var(--color-primary) 30%, transparent)' : '1px solid transparent',
                          }}
                        >
                          <div style={{ fontWeight: 600, color: 'var(--color-heading)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {b.real_name || b.username || '用户'}
                          </div>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: STATUS_MAP[b.status]?.color || '#6b7280' }}>
                            {STATUS_MAP[b.status]?.icon} {STATUS_MAP[b.status]?.label || b.status}
                          </div>
                          {isMyBooking && b.status === 'booked' && (
                            <div style={{ marginTop: 4, display: 'flex', gap: 4, justifyContent: 'center' }}>
                              <button
                                onClick={() => handleAction('checkin', b.id)}
                                style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, border: 'none', background: 'var(--color-primary)', color: '#fff', cursor: 'pointer' }}
                              >
                                签到
                              </button>
                              <button
                                onClick={() => handleAction('cancel', b.id)}
                                style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, border: '1px solid #ef4444', background: 'transparent', color: '#ef4444', cursor: 'pointer' }}
                              >
                                取消
                              </button>
                            </div>
                          )}
                          {isMyBooking && b.status === 'pending' && (
                            <div style={{ marginTop: 4 }}>
                              <button
                                onClick={() => handleAction('cancel', b.id)}
                                style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, border: '1px solid #ef4444', background: 'transparent', color: '#ef4444', cursor: 'pointer' }}
                              >
                                取消
                              </button>
                            </div>
                          )}
                          {canManage && b.status === 'pending' && !isMyBooking && (
                            <div style={{ marginTop: 4, display: 'flex', gap: 4, justifyContent: 'center' }}>
                              <button
                                onClick={() => handleAction('approve', b.id)}
                                style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, border: 'none', background: '#22c55e', color: '#fff', cursor: 'pointer' }}
                              >
                                批准
                              </button>
                              <button
                                onClick={() => { const r = prompt('拒绝原因:'); if (r !== null) handleAction('reject', b.id, { reason: r }); }}
                                style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, border: '1px solid #ef4444', background: 'transparent', color: '#ef4444', cursor: 'pointer' }}
                              >
                                拒绝
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        !isPast && (
                          <button
                            onClick={() => router.push(`/print/booking?date=${d}&slot=${slot}`)}
                            style={{
                              padding: '4px 10px', borderRadius: 6, fontSize: 11,
                              border: '1px dashed var(--color-border)', background: 'transparent',
                              color: 'var(--color-text-light)', cursor: 'pointer',
                            }}
                          >
                            + 预约
                          </button>
                        )
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* My bookings */}
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-heading)', margin: '0 0 12px 0' }}>我的预约记录</h2>
        {myBookings.length === 0 ? (
          <div className="surface-card" style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-light)' }}>
            暂无预约记录
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {myBookings.map((b) => {
              const st = STATUS_MAP[b.status] || STATUS_MAP.pending;
              return (
                <div key={b.id} className="surface-card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 600, color: 'var(--color-heading)' }}>{b.date}</span>
                      <span style={{ fontSize: 12, color: 'var(--color-text-light)' }}>{SLOT_LABELS[b.slot_type]}</span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12, color: st.color, fontWeight: 600 }}>{st.icon} {st.label}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-light)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {b.file_name && <span>文件: {b.file_name} · </span>}
                      {b.purpose && <span>用途: {b.purpose} · </span>}
                      <span>{b.own_filament ? '自带耗材' : `${b.print_type === 'multi' ? '多色' : '单色'} ${b.weight}g`} · {b.cost > 0 ? `¥${b.cost}` : '免费'}</span>
                      {b.rejection_reason && <span style={{ color: '#ef4444' }}> · 拒绝原因: {b.rejection_reason}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {b.status === 'booked' && (
                      <>
                        <button onClick={() => handleAction('checkin', b.id)} className="btn-primary" style={{ fontSize: 12, padding: '4px 10px' }}>签到</button>
                        <button onClick={() => handleAction('cancel', b.id)} className="btn-ghost" style={{ fontSize: 12, padding: '4px 10px', color: '#ef4444' }}>取消</button>
                      </>
                    )}
                    {b.status === 'pending' && (
                      <button onClick={() => handleAction('cancel', b.id)} className="btn-ghost" style={{ fontSize: 12, padding: '4px 10px', color: '#ef4444' }}>取消</button>
                    )}
                    {b.status === 'running' && canManage && (
                      <button onClick={async () => { await rawApi.post(`/api/print/bookings/${b.id}/complete`); loadData(); }} className="btn-primary" style={{ fontSize: 12, padding: '4px 10px' }}>完成</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
