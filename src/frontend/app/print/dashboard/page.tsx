'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useUserStore } from '@/stores/user';
import { rawApi } from '@/lib/api';
import { toast } from 'sonner';
import { ConfirmDialog, ConfirmOptions } from '@/components/ui/confirm-dialog';
import {
  ChevronLeft, ChevronRight, CalendarCheck, XCircle, Play,
  Clock, CheckCircle2, AlertCircle, Loader2, X, Save, Trash2, Shield,
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
  model: string | null;
  is_paused: boolean;
};

const SLOT_LABELS: Record<string, string> = { AM: '白天 (00:00-11:59)', PM: '下午 (12:00-23:59)' };
const STATUS_MAP: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending: { label: '待审批', color: '#f59e0b', icon: <Clock style={{ width: 14, height: 14 }} /> },
  booked: { label: '已预约', color: '#3b82f6', icon: <CalendarCheck style={{ width: 14, height: 14 }} /> },
  running: { label: '运行中', color: '#8b5cf6', icon: <Play style={{ width: 14, height: 14 }} /> },
  done: { label: '已完成', color: '#22c55e', icon: <CheckCircle2 style={{ width: 14, height: 14 }} /> },
  cancelled: { label: '已取消', color: '#6b7280', icon: <XCircle style={{ width: 14, height: 14 }} /> },
  rejected: { label: '已拒绝', color: '#ef4444', icon: <AlertCircle style={{ width: 14, height: 14 }} /> },
};


/** 获取当前北京时间 */
function getBeijingNow(): Date {
  const now = new Date();
  // UTC 时间 + 8 小时，得到北京时间对应的 UTC 时刻
  return new Date(now.getTime() + (8 + now.getTimezoneOffset() / -60) * 3600000);
}

/** 将 Date 格式化为北京时间的 YYYY-MM-DD */
function toBeijingDateStr(d: Date): string {
  // 利用 toLocaleString 的 timeZone 参数获取北京时间的各字段
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const y = parts.find(p => p.type === 'year')!.value;
  const m = parts.find(p => p.type === 'month')!.value;
  const dd = parts.find(p => p.type === 'day')!.value;
  return `${y}-${m}-${dd}`;
}

/** 获取北京时间所在周的周一 */
function getBeijingMonday(): Date {
  const bjNow = getBeijingNow();
  const day = bjNow.getDay(); // 0=Sun ... 6=Sat
  const diff = day === 0 ? -6 : 1 - day; // 周一为起始
  const monday = new Date(bjNow);
  monday.setDate(bjNow.getDate() + diff);
  return monday;
}

function renderCost(weight: number): string {
  if (weight <= 0) return '0';
  return String(Math.ceil(weight / 10));
}

/** 判断指定日期+时段是否已过去（北京时间）。 */
function isSlotPast(date: string, slot: string): boolean {
  const bjNow = getBeijingNow();
  const today = toBeijingDateStr(bjNow);
  const currentHour = bjNow.getHours();

  if (date < today) return true;
  if (date === today) {
    if (slot === 'AM' && currentHour >= 12) return true;
  }
  return false;
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

  const [detailBooking, setDetailBooking] = useState<Booking | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showSsoModal, setShowSsoModal] = useState(false);

  const [confirmState, setConfirmState] = useState<{ open: boolean; options: ConfirmOptions; onConfirm: () => void }>({
    open: false, options: { message: '' }, onConfirm: () => {},
  });

  const showConfirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmState({
        open: true,
        options,
        onConfirm: () => { setConfirmState((s) => ({ ...s, open: false })); resolve(true); },
      });
    });
  }, []);
  const [editForm, setEditForm] = useState({
    weight: 0,
    file_name: '',
    purpose: '',
  });


  useEffect(() => { hydrate(); }, [hydrate]);

  useEffect(() => {
    if (loaded && !user) router.replace('/login');
  }, [loaded, user, router]);

  const monday = getBeijingMonday();
  monday.setDate(monday.getDate() + weekOffset * 7);
  const weekDates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    weekDates.push(toBeijingDateStr(d));
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

  const grid: Record<string, Record<string, Booking | null>> = {};
  for (const d of weekDates) grid[d] = { AM: null, PM: null };
  for (const b of bookings) {
    if (grid[b.date]) grid[b.date][b.slot_type] = b;
  }

  const canManage = user && ['super_admin', 'admin', 'teacher'].includes(user.user_group);

  const handleNewBooking = (params?: string) => {
    if (!user?.real_name || !user?.student_id) {
      setShowSsoModal(true);
      return;
    }
    router.push(params ? `/print/booking?${params}` : '/print/booking');
  };

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
      toast.error(err?.response?.data?.detail || '操作失败');
    }
  };

  const openDetail = async (id: number) => {
    setDetailLoading(true);
    setDetailBooking(null);
    try {
      const r = await rawApi.get(`/api/print/bookings/${id}`);
      const b = r.data;
      setDetailBooking(b);
      setEditForm({
        weight: b.weight,
        file_name: b.file_name || '',
        purpose: b.purpose || '',
      });
    } catch {
      toast.error('加载失败');
    }
    setDetailLoading(false);
  };

  const closeDetail = () => {
    setDetailBooking(null);
  };

  const saveDetail = async () => {
    if (!detailBooking) return;
    try {
      await rawApi.put(`/api/print/bookings/${detailBooking.id}`, {
        weight: editForm.weight,
        file_name: editForm.file_name || null,
        purpose: editForm.purpose || null,
      });
      closeDetail();
      loadData();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || '保存失败');
    }
  };

  const editCost = renderCost(editForm.weight);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px', display: 'flex', flexDirection: 'column', gap: 32 }}>
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
              {printers.map((p) => <option key={p.id} value={p.id}>{p.model ? `${p.name} (${p.model})` : p.name}</option>)}
            </select>
          )}
          <button
            onClick={() => handleNewBooking()}
            className="btn-primary"
            style={{ fontSize: 13, padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <CalendarCheck style={{ width: 14, height: 14 }} /> 新建预约
          </button>
        </div>
      </div>

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
                  const slotPast = isSlotPast(d, slot);
                  const isMyBooking = b && b.user_id === user.id;
                  return (
                    <td key={d + slot} style={{ padding: 8, borderBottom: '1px solid var(--color-border)', textAlign: 'center', verticalAlign: 'top' }}>
                      {b ? (
                        <div
                          style={{
                            padding: '6px 8px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                            background: isMyBooking
                              ? 'color-mix(in srgb, var(--color-primary) 10%, transparent)'
                              : 'var(--color-background-mute)',
                            border: isMyBooking ? '1px solid color-mix(in srgb, var(--color-primary) 30%, transparent)' : '1px solid transparent',
                          }}
                          onClick={() => openDetail(b.id)}
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
                                onClick={(e) => { e.stopPropagation(); handleAction('checkin', b.id); }}
                                style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, border: 'none', background: 'var(--color-primary)', color: '#fff', cursor: 'pointer' }}
                              >
                                签到
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); showConfirm({ title: '取消预约', message: '确定取消？', confirmText: '取消预约', danger: true }).then(ok => { if (ok) handleAction('cancel', b.id); }); }}
                                style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, border: '1px solid #ef4444', background: 'transparent', color: '#ef4444', cursor: 'pointer' }}
                              >
                                取消
                              </button>
                            </div>
                          )}
                          {isMyBooking && b.status === 'pending' && (
                            <div style={{ marginTop: 4 }}>
                              <button
                                onClick={(e) => { e.stopPropagation(); showConfirm({ title: '取消预约', message: '确定取消？', confirmText: '取消预约', danger: true }).then(ok => { if (ok) handleAction('cancel', b.id); }); }}
                                style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, border: '1px solid #ef4444', background: 'transparent', color: '#ef4444', cursor: 'pointer' }}
                              >
                                取消
                              </button>
                            </div>
                          )}
                          {canManage && b.status === 'pending' && !isMyBooking && (
                            <div style={{ marginTop: 4, display: 'flex', gap: 4, justifyContent: 'center' }}>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleAction('approve', b.id); }}
                                style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, border: 'none', background: '#22c55e', color: '#fff', cursor: 'pointer' }}
                              >
                                批准
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); const r = prompt('拒绝原因:'); if (r !== null) handleAction('reject', b.id, { reason: r }); }}
                                style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, border: '1px solid #ef4444', background: 'transparent', color: '#ef4444', cursor: 'pointer' }}
                              >
                                拒绝
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        !slotPast && (
                          <button
                            onClick={() => handleNewBooking(`date=${d}&slot=${slot}`)}
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, cursor: 'pointer' }} onClick={() => openDetail(b.id)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 600, color: 'var(--color-heading)' }}>{b.date}</span>
                      <span style={{ fontSize: 12, color: 'var(--color-text-light)' }}>{SLOT_LABELS[b.slot_type]}</span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12, color: st.color, fontWeight: 600 }}>{st.icon} {st.label}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-light)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {b.file_name && <span>文件: {b.file_name} · </span>}
                      {b.purpose && <span>用途: {b.purpose} · </span>}
                      <span>{b.weight}g · {b.cost > 0 ? `${b.cost} 积分` : '免费'}</span>
                      {b.rejection_reason && <span style={{ color: '#ef4444' }}> · 拒绝原因: {b.rejection_reason}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => openDetail(b.id)} className="btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }}>
                      详情/编辑
                    </button>
                    {b.status === 'booked' && (
                      <>
                        <button onClick={() => handleAction('checkin', b.id)} className="btn-primary" style={{ fontSize: 12, padding: '4px 10px' }}>签到</button>
                        <button onClick={() => { showConfirm({ title: '取消预约', message: '确定取消？', confirmText: '取消预约', danger: true }).then(ok => { if (ok) handleAction('cancel', b.id); }); }} className="btn-ghost" style={{ fontSize: 12, padding: '4px 10px', color: '#ef4444' }}>取消</button>
                      </>
                    )}
                    {b.status === 'pending' && (
                      <button onClick={() => { showConfirm({ title: '取消预约', message: '确定取消？', confirmText: '取消预约', danger: true }).then(ok => { if (ok) handleAction('cancel', b.id); }); }} className="btn-ghost" style={{ fontSize: 12, padding: '4px 10px', color: '#ef4444' }}>取消</button>
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

      {detailLoading && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#fff' }} />
        </div>
      )}

      {detailBooking && !detailLoading && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={(e) => { if (e.target === e.currentTarget) closeDetail(); }}
        >
          <div style={{ background: 'var(--color-card-background)', borderRadius: 16, maxWidth: 520, width: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 16px 48px rgba(0,0,0,0.2)', animation: 'slideUp 0.3s ease-out' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--color-heading)' }}>预约详情</h3>
              <button onClick={closeDetail} style={{ background: 'none', border: 'none', color: 'var(--color-text-light)', cursor: 'pointer', padding: 4 }}>
                <X style={{ width: 18, height: 18 }} />
              </button>
            </div>

            <div style={{ padding: 20 }}>
              <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 16, background: detailBooking.user_id === user.id ? 'color-mix(in srgb, var(--color-primary) 8%, transparent)' : 'color-mix(in srgb, #f59e0b 8%, transparent)' }}>
                <strong style={{ color: 'var(--color-heading)', fontSize: 13 }}>
                  {detailBooking.user_id === user.id ? '✓ 这是您预定的时段' : `管理员查看 - ${detailBooking.real_name || detailBooking.username}`}
                </strong>
                {detailBooking.student_id && (
                  <span style={{ fontSize: 12, color: 'var(--color-text-light)', marginLeft: 8 }}>学号: {detailBooking.student_id}</span>
                )}
              </div>

              <div style={{ fontSize: 14, color: 'var(--color-text-light)', marginBottom: 16 }}>
                📅 <strong>{detailBooking.date}</strong> {SLOT_LABELS[detailBooking.slot_type]}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <span style={{ fontSize: 13, color: 'var(--color-text-light)' }}>状态：</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, color: STATUS_MAP[detailBooking.status]?.color || '#6b7280', fontWeight: 600 }}>
                  {STATUS_MAP[detailBooking.status]?.icon} {STATUS_MAP[detailBooking.status]?.label || detailBooking.status}
                </span>
                {detailBooking.rejection_reason && (
                  <span style={{ fontSize: 12, color: '#ef4444' }}>原因: {detailBooking.rejection_reason}</span>
                )}
              </div>

              {(detailBooking.status !== 'cancelled' && detailBooking.status !== 'done') && (
                <div style={{ border: '1px solid var(--color-border)', borderRadius: 12, padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <span style={{ fontWeight: 600, color: 'var(--color-heading)', fontSize: 14 }}>编辑预约信息</span>
                    <span style={{ fontSize: 11, color: 'var(--color-text-light)' }}>修改后立即生效</span>
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-heading)', marginBottom: 6, display: 'block' }}>预计打印克数 (g)</label>
                    <input
                      type="number" step={0.1} min={0}
                      value={editForm.weight}
                      onChange={(e) => setEditForm({ ...editForm, weight: parseFloat(e.target.value) || 0 })}
                      className="input"
                      style={{ fontSize: 14 }}
                    />
                    <p style={{ fontSize: 11, color: 'var(--color-text-light)', margin: '4px 0 0' }}>请如实填写，管理员将核对。</p>
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-heading)', marginBottom: 6, display: 'block' }}>文件名</label>
                    <input
                      type="text"
                      value={editForm.file_name}
                      onChange={(e) => setEditForm({ ...editForm, file_name: e.target.value })}
                      className="input"
                      style={{ fontSize: 14 }}
                      placeholder="打印文件名称"
                    />
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-heading)', marginBottom: 6, display: 'block' }}>用途</label>
                    <textarea
                      value={editForm.purpose}
                      onChange={(e) => setEditForm({ ...editForm, purpose: e.target.value })}
                      className="input"
                      style={{ fontSize: 14, resize: 'vertical', minHeight: 60 }}
                      placeholder="打印用途说明"
                    />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', borderRadius: 8, background: 'var(--color-background-soft)', border: '1px solid var(--color-border)' }}>
                    <span style={{ fontSize: 13, color: 'var(--color-text-light)' }}>消耗贝壳积分</span>
                    <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-primary)' }}>{editCost} 积分</span>
                  </div>
                </div>
              )}
            </div>

            <div style={{ padding: '0 20px 16px', display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              {detailBooking.status !== 'cancelled' && detailBooking.status !== 'done' && (
                <>
                  <button
                    onClick={async () => {
                      const ok = await showConfirm({ title: '取消预约', message: '确定取消该预约？', confirmText: '取消预约', danger: true });
                      if (ok) {
                        await handleAction('cancel', detailBooking.id);
                        closeDetail();
                      }
                    }}
                    className="btn-destructive"
                    style={{ fontSize: 13, padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 4 }}
                  >
                    <Trash2 style={{ width: 14, height: 14 }} /> 取消预约
                  </button>
                  <button
                    onClick={saveDetail}
                    className="btn-ghost"
                    style={{ fontSize: 13, padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 4 }}
                  >
                    <Save style={{ width: 14, height: 14 }} /> 保存修改
                  </button>
                  {detailBooking.status === 'booked' && (
                    <button
                      onClick={async () => {
                        await handleAction('checkin', detailBooking.id);
                        closeDetail();
                      }}
                      className="btn-primary"
                      style={{ fontSize: 13, padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      <Play style={{ width: 14, height: 14 }} /> 签到并开始运行
                    </button>
                  )}
                </>
              )}
              {canManage && detailBooking.status === 'pending' && (
                <>
                  <button
                    onClick={async () => { await handleAction('approve', detailBooking.id); closeDetail(); }}
                    style={{ fontSize: 13, padding: '8px 16px', borderRadius: 10, border: 'none', background: '#22c55e', color: '#fff', cursor: 'pointer', fontWeight: 600 }}
                  >
                    批准
                  </button>
                  <button
                    onClick={async () => { const r = prompt('拒绝原因:'); if (r !== null) { await handleAction('reject', detailBooking.id, { reason: r }); closeDetail(); } }}
                    className="btn-destructive"
                    style={{ fontSize: 13, padding: '8px 16px' }}
                  >
                    拒绝
                  </button>
                </>
              )}
              {canManage && detailBooking.status === 'running' && (
                <button
                  onClick={async () => { await rawApi.post(`/api/print/bookings/${detailBooking.id}/complete`); closeDetail(); loadData(); }}
                  className="btn-primary"
                  style={{ fontSize: 13, padding: '8px 16px' }}
                >
                  <CheckCircle2 style={{ width: 14, height: 14 }} /> 标记完成
                </button>
              )}
              {canManage && user.user_group === 'super_admin' && (
                <button
                  onClick={async () => {
                    const ok = await showConfirm({ title: '删除预约', message: '确认删除此预约？此操作不可撤销。', confirmText: '删除', danger: true });
                    if (ok) {
                      await rawApi.delete(`/api/print/admin/bookings/${detailBooking.id}`);
                      toast.success('预约已删除');
                      closeDetail();
                      loadData();
                    }
                  }}
                  className="btn-destructive"
                  style={{ fontSize: 13, padding: '8px 16px' }}
                >
                  <Trash2 style={{ width: 14, height: 14 }} /> 删除
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showSsoModal && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 110, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowSsoModal(false); }}
        >
          <div style={{ background: 'var(--color-card-background)', borderRadius: 16, maxWidth: 400, width: '100%', boxShadow: '0 16px 48px rgba(0,0,0,0.2)', animation: 'slideUp 0.3s ease-out', padding: 24, textAlign: 'center' }}>
            <div style={{
              width: 56, height: 56, borderRadius: 14,
              background: 'color-mix(in srgb, #3b82f6 10%, transparent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 16px',
            }}>
              <Shield style={{ width: 28, height: 28, color: '#3b82f6' }} />
            </div>
            <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: 'var(--color-heading)' }}>需要绑定北科大统一验证</h3>
            <p style={{ fontSize: 14, color: 'var(--color-text-light)', margin: '0 0 20px', lineHeight: 1.6 }}>
              创建打印预约前，请先绑定「北京科技大学统一验证登录」，以获取您的姓名和学号信息。
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button
                onClick={() => setShowSsoModal(false)}
                className="btn-ghost"
                style={{ padding: '8px 20px', fontSize: 13 }}
              >
                取消
              </button>
              <button
                onClick={() => { setShowSsoModal(false); router.push('/dashboard/security'); }}
                className="btn-primary"
                style={{ padding: '8px 20px', fontSize: 13 }}
              >
                前往绑定
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmState.open}
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState((s) => ({ ...s, open: false }))}
        {...confirmState.options}
      />

    </div>
  );
}
