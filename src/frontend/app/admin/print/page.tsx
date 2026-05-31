'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useUserStore } from '@/stores/user';
import { rawApi } from '@/lib/api';
import {
  Printer, CalendarCheck, CheckCircle2, XCircle, Clock, Play,
  FileDown, Trash2, PauseCircle, PlayCircle, Loader2, Plus, Settings2,
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
  location: string | null;
  model: string | null;
  is_paused: boolean;
};

type Stats = {
  total_bookings: number;
  pending_approvals: number;
  printers: number;
};

const SLOT_LABELS: Record<string, string> = { AM: '上午', PM: '下午' };
const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: '待审批', color: '#f59e0b' },
  booked: { label: '已预约', color: '#3b82f6' },
  running: { label: '运行中', color: '#8b5cf6' },
  done: { label: '已完成', color: '#22c55e' },
  cancelled: { label: '已取消', color: '#6b7280' },
  rejected: { label: '已拒绝', color: '#ef4444' },
};

export default function AdminPrintPage() {
  const router = useRouter();
  const { user, loaded, hydrate } = useUserStore();
  const [tab, setTab] = useState<'overview' | 'printers' | 'approvals' | 'all'>('overview');
  const [stats, setStats] = useState<Stats | null>(null);
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [approvals, setApprovals] = useState<Booking[]>([]);
  const [allBookings, setAllBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  // Printer form
  const [showPrinterForm, setShowPrinterForm] = useState(false);
  const [printerForm, setPrinterForm] = useState({ name: '', location: '', model: '' });

  // Report form
  const [reportFrom, setReportFrom] = useState('');
  const [reportTo, setReportTo] = useState('');

  useEffect(() => { hydrate(); }, [hydrate]);

  useEffect(() => {
    if (loaded && user && !['super_admin', 'admin', 'teacher'].includes(user.user_group)) {
      router.replace('/');
    }
  }, [loaded, user, router]);

  const loadData = useCallback(async () => {
    if (!loaded || !user) return;
    if (!['super_admin', 'admin', 'teacher'].includes(user.user_group)) return;
    setLoading(true);
    try {
      const [statsRes, printersRes, approvalsRes, bookingsRes] = await Promise.all([
        rawApi.get('/api/print/admin/stats'),
        rawApi.get('/api/print/printers'),
        rawApi.get('/api/print/admin/approvals'),
        rawApi.get('/api/print/bookings'),
      ]);
      setStats(statsRes.data);
      setPrinters(printersRes.data);
      setApprovals(approvalsRes.data);
      setAllBookings(bookingsRes.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, [loaded, user]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleAction = async (action: string, id: number, extra?: any) => {
    try {
      if (action === 'approve') await rawApi.post(`/api/print/admin/approve/${id}`);
      else if (action === 'reject') await rawApi.post(`/api/print/admin/reject/${id}`, extra);
      else if (action === 'delete') await rawApi.delete(`/api/print/admin/bookings/${id}`);
      else if (action === 'complete') await rawApi.post(`/api/print/bookings/${id}/complete`);
      loadData();
    } catch (err: any) {
      alert(err?.response?.data?.detail || '操作失败');
    }
  };

  const handleCreatePrinter = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await rawApi.post('/api/print/printers', {
        name: printerForm.name,
        location: printerForm.location || null,
        model: printerForm.model || null,
      });
      setPrinterForm({ name: '', location: '', model: '' });
      setShowPrinterForm(false);
      loadData();
    } catch (err: any) {
      alert(err?.response?.data?.detail || '创建失败');
    }
  };

  const handleTogglePause = async (p: PrinterInfo) => {
    try {
      await rawApi.put(`/api/print/printers/${p.id}`, { is_paused: !p.is_paused });
      loadData();
    } catch (err: any) {
      alert(err?.response?.data?.detail || '操作失败');
    }
  };

  const handleDeletePrinter = async (id: number) => {
    if (!confirm('确认删除此打印机？')) return;
    try {
      await rawApi.delete(`/api/print/printers/${id}`);
      loadData();
    } catch (err: any) {
      alert(err?.response?.data?.detail || '删除失败');
    }
  };

  const handleExport = async () => {
    if (!reportFrom || !reportTo) { alert('请选择日期范围'); return; }
    try {
      const r = await rawApi.get('/api/print/admin/reports/export', {
        params: { date_from: reportFrom, date_to: reportTo },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `print_report_${reportFrom}_to_${reportTo}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert('导出失败');
    }
  };

  if (!loaded || !user || !['super_admin', 'admin', 'teacher'].includes(user.user_group)) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--color-text-light)' }} />
      </div>
    );
  }

  const tabs = [
    { key: 'overview' as const, label: '概览' },
    { key: 'printers' as const, label: '打印机管理' },
    { key: 'approvals' as const, label: '审批队列' },
    { key: 'all' as const, label: '全部预约' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header */}
      <div>
        <p className="section-kicker" style={{ marginBottom: 8 }}>PRINT ADMIN</p>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-heading)', margin: 0 }}>打印预约管理</h1>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--color-border)', paddingBottom: 8 }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '6px 14px', borderRadius: '8px 8px 0 0', fontSize: 13, fontWeight: 600,
              border: 'none', cursor: 'pointer',
              background: tab === t.key ? 'color-mix(in srgb, var(--color-primary) 10%, transparent)' : 'transparent',
              color: tab === t.key ? 'var(--color-primary)' : 'var(--color-text-light)',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
          <Loader2 style={{ width: 20, height: 20, color: 'var(--color-text-light)', animation: 'spin 0.8s linear infinite' }} />
        </div>
      ) : (
        <>
          {/* Overview */}
          {tab === 'overview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                <StatCard icon={<CalendarCheck style={{ width: 24, height: 24 }} />} label="总预约数" value={stats?.total_bookings} />
                <StatCard icon={<Clock style={{ width: 24, height: 24 }} />} label="待审批" value={stats?.pending_approvals} color="#f59e0b" />
                <StatCard icon={<Printer style={{ width: 24, height: 24 }} />} label="打印机" value={stats?.printers} />
              </div>

              {/* Quick report export */}
              <div className="surface-card" style={{ padding: 20 }}>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-heading)', margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FileDown style={{ width: 16, height: 16 }} /> 导出周报
                </h3>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input type="date" value={reportFrom} onChange={(e) => setReportFrom(e.target.value)} style={inputStyle} />
                  <span style={{ color: 'var(--color-text-light)' }}>~</span>
                  <input type="date" value={reportTo} onChange={(e) => setReportTo(e.target.value)} style={inputStyle} />
                  <button onClick={handleExport} className="btn-primary" style={{ fontSize: 13, padding: '6px 14px' }}>
                    导出 Excel
                  </button>
                </div>
              </div>

              {/* Quick pending list */}
              {approvals.length > 0 && (
                <div>
                  <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-heading)', margin: '0 0 8px 0' }}>
                    待审批 ({approvals.length})
                  </h3>
                  {approvals.slice(0, 5).map((b) => (
                    <div key={b.id} className="surface-card" style={{ padding: '10px 14px', marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ fontWeight: 600, color: 'var(--color-heading)' }}>{b.real_name || b.username}</span>
                        <span style={{ fontSize: 12, color: 'var(--color-text-light)', marginLeft: 8 }}>{b.date} {SLOT_LABELS[b.slot_type]}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => handleAction('approve', b.id)} style={{ fontSize: 12, padding: '3px 8px', borderRadius: 4, border: 'none', background: '#22c55e', color: '#fff', cursor: 'pointer' }}>批准</button>
                        <button onClick={() => { const r = prompt('拒绝原因:'); if (r !== null) handleAction('reject', b.id, { reason: r }); }} style={{ fontSize: 12, padding: '3px 8px', borderRadius: 4, border: '1px solid #ef4444', background: 'transparent', color: '#ef4444', cursor: 'pointer' }}>拒绝</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Printers management */}
          {tab === 'printers' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-heading)', margin: 0 }}>打印机列表</h3>
                <button onClick={() => setShowPrinterForm(!showPrinterForm)} className="btn-primary" style={{ fontSize: 13, padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Plus style={{ width: 14, height: 14 }} /> 添加打印机
                </button>
              </div>

              {showPrinterForm && (
                <form onSubmit={handleCreatePrinter} className="surface-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <input type="text" placeholder="打印机名称 *" value={printerForm.name} onChange={(e) => setPrinterForm({ ...printerForm, name: e.target.value })} required style={inputStyle} />
                  <input type="text" placeholder="位置" value={printerForm.location} onChange={(e) => setPrinterForm({ ...printerForm, location: e.target.value })} style={inputStyle} />
                  <input type="text" placeholder="型号" value={printerForm.model} onChange={(e) => setPrinterForm({ ...printerForm, model: e.target.value })} style={inputStyle} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="submit" className="btn-primary" style={{ fontSize: 13, padding: '6px 14px' }}>创建</button>
                    <button type="button" onClick={() => setShowPrinterForm(false)} className="btn-ghost" style={{ fontSize: 13, padding: '6px 14px' }}>取消</button>
                  </div>
                </form>
              )}

              {printers.map((p) => (
                <div key={p.id} className="surface-card" style={{ padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Printer style={{ width: 20, height: 20, color: p.is_paused ? '#ef4444' : '#22c55e' }} />
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--color-heading)' }}>{p.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-light)' }}>
                        {p.location && <span>位置: {p.location} · </span>}
                        {p.model && <span>型号: {p.model} · </span>}
                        <span style={{ color: p.is_paused ? '#ef4444' : '#22c55e' }}>
                          {p.is_paused ? '已暂停' : '可用'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => handleTogglePause(p)}
                      title={p.is_paused ? '恢复使用' : '暂停使用'}
                      style={{
                        padding: '4px 8px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                        border: '1px solid var(--color-border)', background: 'transparent',
                        color: p.is_paused ? '#22c55e' : '#ef4444',
                        display: 'flex', alignItems: 'center', gap: 4,
                      }}
                    >
                      {p.is_paused ? <><PlayCircle style={{ width: 14, height: 14 }} /> 恢复</> : <><PauseCircle style={{ width: 14, height: 14 }} /> 暂停</>}
                    </button>
                    {user.user_group === 'super_admin' && (
                      <button
                        onClick={() => handleDeletePrinter(p.id)}
                        style={{ padding: '4px 8px', borderRadius: 6, fontSize: 12, cursor: 'pointer', border: '1px solid #ef4444', background: 'transparent', color: '#ef4444', display: 'flex', alignItems: 'center', gap: 4 }}
                      >
                        <Trash2 style={{ width: 14, height: 14 }} /> 删除
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {printers.length === 0 && (
                <div className="surface-card" style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-light)' }}>
                  暂无打印机，请添加
                </div>
              )}
            </div>
          )}

          {/* Approvals */}
          {tab === 'approvals' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {approvals.length === 0 ? (
                <div className="surface-card" style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-light)' }}>
                  暂无待审批预约
                </div>
              ) : approvals.map((b) => (
                <div key={b.id} className="surface-card" style={{ padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--color-heading)', marginBottom: 4 }}>
                        {b.real_name || b.username}
                        {b.student_id && <span style={{ fontSize: 12, color: 'var(--color-text-light)', marginLeft: 8 }}>学号: {b.student_id}</span>}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--color-text-light)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        <span>{b.date} {SLOT_LABELS[b.slot_type]}</span>
                        {b.file_name && <span>文件: {b.file_name}</span>}
                        {b.purpose && <span>用途: {b.purpose}</span>}
                        <span>{b.own_filament ? '自带耗材' : `${b.print_type === 'multi' ? '多色' : '单色'} ${b.weight}g ¥${b.cost}`}</span>
                        <span>{b.is_paid ? '已支付' : '未支付'}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => handleAction('approve', b.id)} className="btn-primary" style={{ fontSize: 12, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <CheckCircle2 style={{ width: 14, height: 14 }} /> 批准
                      </button>
                      <button onClick={() => { const r = prompt('拒绝原因:'); if (r !== null) handleAction('reject', b.id, { reason: r }); }} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid #ef4444', background: 'transparent', color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <XCircle style={{ width: 14, height: 14 }} /> 拒绝
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* All bookings */}
          {tab === 'all' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {allBookings.length === 0 ? (
                <div className="surface-card" style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-light)' }}>
                  暂无预约记录
                </div>
              ) : allBookings.map((b) => {
                const st = STATUS_LABELS[b.status] || STATUS_LABELS.pending;
                return (
                  <div key={b.id} className="surface-card" style={{ padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600, color: 'var(--color-heading)' }}>{b.real_name || b.username}</span>
                        {b.student_id && <span style={{ fontSize: 11, color: 'var(--color-text-light)' }}>{b.student_id}</span>}
                        <span style={{ fontSize: 12, color: 'var(--color-text-light)' }}>{b.date} {SLOT_LABELS[b.slot_type]}</span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12, color: st.color, fontWeight: 600 }}>
                          {st.label}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-light)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {b.file_name && <span>{b.file_name} · </span>}
                        {b.own_filament ? '自带耗材' : `${b.print_type === 'multi' ? '多色' : '单色'} ${b.weight}g ¥${b.cost}`}
                        {b.rejection_reason && <span style={{ color: '#ef4444' }}> · 拒绝: {b.rejection_reason}</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {b.status === 'running' && (
                        <button onClick={() => handleAction('complete', b.id)} style={smallBtnStyle('#22c55e')}>
                          <CheckCircle2 style={{ width: 12, height: 12 }} /> 完成
                        </button>
                      )}
                      {user.user_group === 'super_admin' && (
                        <button onClick={() => { if (confirm('确认删除？')) handleAction('delete', b.id); }} style={smallBtnStyle('#ef4444')}>
                          <Trash2 style={{ width: 12, height: 12 }} /> 删除
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number | undefined; color?: string }) {
  return (
    <div className="surface-card" style={{ padding: 18, display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{
        width: 44, height: 44, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: color ? `color-mix(in srgb, ${color} 10%, transparent)` : 'color-mix(in srgb, var(--color-primary) 10%, transparent)',
        color: color || 'var(--color-primary)',
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 12, color: 'var(--color-text-light)', fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-heading)' }}>{value ?? '--'}</div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 8, fontSize: 14,
  border: '1px solid var(--color-border)', background: 'var(--color-card-background)',
  color: 'var(--color-text)',
};

function smallBtnStyle(color: string): React.CSSProperties {
  return {
    fontSize: 11, padding: '3px 8px', borderRadius: 4, cursor: 'pointer',
    border: `1px solid ${color}`, background: 'transparent', color,
    display: 'inline-flex', alignItems: 'center', gap: 3,
  };
}
