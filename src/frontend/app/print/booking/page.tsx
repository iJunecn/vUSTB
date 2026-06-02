'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { useUserStore } from '@/stores/user';
import { rawApi } from '@/lib/api';
import { Loader2, CalendarCheck, X, AlertCircle } from 'lucide-react';

export default function PrintBookingPageWrapper() {
  return (
    <Suspense fallback={
      <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--color-text-light)' }} />
      </div>
    }>
      <PrintBookingPage />
    </Suspense>
  );
}

type PrinterInfo = {
  id: number;
  name: string;
  is_paused: boolean;
};

function PrintBookingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loaded, hydrate } = useUserStore();

  const preDate = searchParams.get('date') || '';
  const preSlot = searchParams.get('slot') || '';

  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [shellPoints, setShellPoints] = useState(0);
  const [form, setForm] = useState({
    printer_id: '' as string,
    date: preDate,
    slot_type: preSlot as 'AM' | 'PM' | '',
    weight: 0,
    file_name: '',
    purpose: '',
  });
  const [shellCost, setShellCost] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showInsufficientModal, setShowInsufficientModal] = useState(false);

  useEffect(() => { hydrate(); }, [hydrate]);

  useEffect(() => {
    if (loaded && !user) router.replace('/login');
  }, [loaded, user, router]);

  useEffect(() => {
    rawApi.get('/api/print/printers').then((r) => {
      setPrinters(r.data);
      if (r.data.length === 1 && !form.printer_id) {
        setForm((f) => ({ ...f, printer_id: String(r.data[0].id) }));
      }
    });
  }, []);

  useEffect(() => {
    if (user) {
      rawApi.get<{ pixel_points: number; shell_points: number }>('/api/points/account').then((r) => {
        setShellPoints(r.data.shell_points);
      }).catch(() => {});
    }
  }, [user]);

  useEffect(() => {
    const cost = form.weight > 0 ? Math.ceil(form.weight / 10) : 0;
    setShellCost(cost);
  }, [form.weight]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (shellCost > shellPoints) {
      setShowInsufficientModal(true);
      return;
    }

    setSubmitting(true);
    try {
      await rawApi.post('/api/print/bookings', {
        printer_id: form.printer_id ? Number(form.printer_id) : null,
        date: form.date,
        slot_type: form.slot_type,
        weight: form.weight,
        file_name: form.file_name || null,
        purpose: form.purpose || null,
      });
      router.push('/print/dashboard');
    } catch (err: any) {
      const detail = err?.response?.data?.detail || '预约失败';
      if (detail.includes('贝壳积分不足')) {
        setShowInsufficientModal(true);
      } else {
        setError(detail);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!loaded || !user) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--color-text-light)' }} />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '32px 24px', display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <p className="section-kicker" style={{ marginBottom: 4 }}>3D PRINT</p>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--color-heading)', margin: 0 }}>创建预约</h1>
      </div>

      {/* Shell points balance */}
      <div style={{ padding: '12px 16px', borderRadius: 10, background: 'color-mix(in srgb, #3b82f6 8%, transparent)', border: '1px solid color-mix(in srgb, #3b82f6 20%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-heading)' }}>当前贝壳积分</span>
        <span style={{ fontSize: 20, fontWeight: 700, color: '#3b82f6' }}>{shellPoints}</span>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: 'color-mix(in srgb, #ef4444 10%, transparent)', color: '#ef4444', fontSize: 13 }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* Printer */}
        {printers.length > 0 && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-heading)' }}>打印机</span>
            <select
              value={form.printer_id}
              onChange={(e) => setForm({ ...form, printer_id: e.target.value })}
              required
              className="input"
            >
              <option value="">请选择打印机</option>
              {printers.map((p) => (
                <option key={p.id} value={p.id} disabled={p.is_paused}>
                  {p.name}{p.is_paused ? ' (暂停中)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}

        {/* Date */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-heading)' }}>预约日期</span>
          <input
            type="date"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
            required
            min={new Date().toISOString().slice(0, 10)}
            className="input"
          />
        </label>

        {/* Slot */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-heading)' }}>时段</span>
          <select
            value={form.slot_type}
            onChange={(e) => setForm({ ...form, slot_type: e.target.value as 'AM' | 'PM' })}
            required
            className="input"
          >
            <option value="">请选择时段</option>
            <option value="AM">上午 (08:00-11:30)</option>
            <option value="PM">下午 (13:30-17:00)</option>
          </select>
        </label>

        {/* File name */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-heading)' }}>文件名</span>
          <input
            type="text"
            value={form.file_name}
            onChange={(e) => setForm({ ...form, file_name: e.target.value })}
            placeholder="打印的文件名称"
            className="input"
          />
        </label>

        {/* Purpose */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-heading)' }}>用途</span>
          <textarea
            value={form.purpose}
            onChange={(e) => setForm({ ...form, purpose: e.target.value })}
            placeholder="打印用途说明"
            rows={3}
            className="input"
            style={{ resize: 'vertical' }}
          />
        </label>

        {/* Weight */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-heading)' }}>预估重量 (g)</span>
          <input
            type="number"
            value={form.weight || ''}
            onChange={(e) => setForm({ ...form, weight: parseFloat(e.target.value) || 0 })}
            min={0}
            step={0.1}
            required
            className="input"
            placeholder="请在Bambu Lab切片软件查看后填写"
          />
          <p style={{ fontSize: 11, color: 'var(--color-text-light)', margin: '2px 0 0' }}>请务必如实填写，管理员将会核对。</p>
        </label>

        {/* Cost preview */}
        <div style={{ padding: '16px 20px', borderRadius: 12, background: 'var(--color-background-soft)', border: '2px solid var(--color-primary)', textAlign: 'center' }}>
          <div style={{ color: 'var(--color-text-light)', fontSize: 13, marginBottom: 4 }}>消耗贝壳积分</div>
          <div>
            <span style={{ fontSize: 36, fontWeight: 700, color: 'var(--color-primary)' }}>
              {shellCost}
            </span>
            <span style={{ fontSize: 18, color: 'var(--color-primary)', fontWeight: 600 }}> 积分</span>
          </div>
          {form.weight > 0 && (
            <p style={{ fontSize: 11, color: 'var(--color-text-light)', margin: '4px 0 0' }}>
              {form.weight}g ÷ 10 = {form.weight / 10} → 向上取整 = {shellCost} 积分
            </p>
          )}
          {shellCost > shellPoints && form.weight > 0 && (
            <p style={{ fontSize: 12, color: '#ef4444', margin: '8px 0 0', fontWeight: 500 }}>
              积分不足！还需 {shellCost - shellPoints} 积分
            </p>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            type="submit"
            disabled={submitting || !form.date || !form.slot_type || form.weight <= 0}
            className="btn-primary"
            style={{ padding: '12px 20px', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarCheck style={{ width: 16, height: 16 }} />}
            确认预约
          </button>
        </div>
      </form>

      {/* Insufficient points modal */}
      {showInsufficientModal && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 110, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowInsufficientModal(false); }}
        >
          <div style={{ background: 'var(--color-card-background)', borderRadius: 16, maxWidth: 400, width: '100%', boxShadow: '0 16px 48px rgba(0,0,0,0.2)', animation: 'slideUp 0.3s ease-out', padding: 24, textAlign: 'center' }}>
            <div style={{
              width: 56, height: 56, borderRadius: 14,
              background: 'color-mix(in srgb, #ef4444 10%, transparent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 16px',
            }}>
              <AlertCircle style={{ width: 28, height: 28, color: '#ef4444' }} />
            </div>
            <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: 'var(--color-heading)' }}>贝壳积分不足</h3>
            <p style={{ fontSize: 14, color: 'var(--color-text-light)', margin: '0 0 20px', lineHeight: 1.6 }}>
              当前贝壳积分余额 {shellPoints}，需要 {shellCost} 积分。请前往个人中心充值。
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button
                onClick={() => setShowInsufficientModal(false)}
                className="btn-ghost"
                style={{ padding: '8px 20px', fontSize: 13 }}
              >
                取消
              </button>
              <button
                onClick={() => { setShowInsufficientModal(false); router.push('/dashboard/points'); }}
                className="btn-primary"
                style={{ padding: '8px 20px', fontSize: 13 }}
              >
                前往充值
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
