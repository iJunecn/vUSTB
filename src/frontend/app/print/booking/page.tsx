'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useUserStore } from '@/stores/user';
import { rawApi } from '@/lib/api';
import { Loader2, CalendarCheck } from 'lucide-react';

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
  const [form, setForm] = useState({
    printer_id: '' as string,
    date: preDate,
    slot_type: preSlot as 'AM' | 'PM' | '',
    own_filament: false,
    print_type: 'single' as 'single' | 'multi',
    weight: 0,
    file_name: '',
    purpose: '',
    is_paid: false,
  });
  const [cost, setCost] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

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
    if (form.own_filament) {
      setCost(0);
    } else {
      const unit = form.print_type === 'multi' ? 0.15 : 0.10;
      setCost(parseFloat((form.weight * unit).toFixed(2)));
    }
  }, [form.own_filament, form.print_type, form.weight]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await rawApi.post('/api/print/bookings', {
        printer_id: form.printer_id ? Number(form.printer_id) : null,
        date: form.date,
        slot_type: form.slot_type,
        own_filament: form.own_filament,
        print_type: form.print_type,
        weight: form.weight,
        file_name: form.file_name || null,
        purpose: form.purpose || null,
        is_paid: form.is_paid,
      });
      router.push('/print/dashboard');
    } catch (err: any) {
      setError(err?.response?.data?.detail || '预约失败');
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
              style={{
                padding: '8px 12px', borderRadius: 8, fontSize: 14,
                border: '1px solid var(--color-border)', background: 'var(--color-card-background)',
                color: 'var(--color-text)',
              }}
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
            style={{
              padding: '8px 12px', borderRadius: 8, fontSize: 14,
              border: '1px solid var(--color-border)', background: 'var(--color-card-background)',
              color: 'var(--color-text)',
            }}
          />
        </label>

        {/* Slot */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-heading)' }}>时段</span>
          <select
            value={form.slot_type}
            onChange={(e) => setForm({ ...form, slot_type: e.target.value as 'AM' | 'PM' })}
            required
            style={{
              padding: '8px 12px', borderRadius: 8, fontSize: 14,
              border: '1px solid var(--color-border)', background: 'var(--color-card-background)',
              color: 'var(--color-text)',
            }}
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
            style={{
              padding: '8px 12px', borderRadius: 8, fontSize: 14,
              border: '1px solid var(--color-border)', background: 'var(--color-card-background)',
              color: 'var(--color-text)',
            }}
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
            style={{
              padding: '8px 12px', borderRadius: 8, fontSize: 14, resize: 'vertical',
              border: '1px solid var(--color-border)', background: 'var(--color-card-background)',
              color: 'var(--color-text)',
            }}
          />
        </label>

        {/* Filament */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            type="checkbox"
            id="own_filament"
            checked={form.own_filament}
            onChange={(e) => setForm({ ...form, own_filament: e.target.checked })}
          />
          <label htmlFor="own_filament" style={{ fontSize: 14, color: 'var(--color-text)', cursor: 'pointer' }}>自带耗材</label>
        </div>

        {/* Print type & weight */}
        {!form.own_filament && (
          <>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-heading)' }}>打印类型</span>
              <select
                value={form.print_type}
                onChange={(e) => setForm({ ...form, print_type: e.target.value as 'single' | 'multi' })}
                style={{
                  padding: '8px 12px', borderRadius: 8, fontSize: 14,
                  border: '1px solid var(--color-border)', background: 'var(--color-card-background)',
                  color: 'var(--color-text)',
                }}
              >
                <option value="single">单色 (¥0.10/g)</option>
                <option value="multi">多色 (¥0.15/g)</option>
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-heading)' }}>预估重量 (g)</span>
              <input
                type="number"
                value={form.weight}
                onChange={(e) => setForm({ ...form, weight: parseFloat(e.target.value) || 0 })}
                min={0}
                step={0.1}
                required
                style={{
                  padding: '8px 12px', borderRadius: 8, fontSize: 14,
                  border: '1px solid var(--color-border)', background: 'var(--color-card-background)',
                  color: 'var(--color-text)',
                }}
              />
            </label>
          </>
        )}

        {/* Paid */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            type="checkbox"
            id="is_paid"
            checked={form.is_paid}
            onChange={(e) => setForm({ ...form, is_paid: e.target.checked })}
          />
          <label htmlFor="is_paid" style={{ fontSize: 14, color: 'var(--color-text)', cursor: 'pointer' }}>已支付</label>
        </div>

        {/* Cost preview */}
        <div style={{ padding: '12px 16px', borderRadius: 8, background: 'var(--color-background-soft)', border: '1px solid var(--color-border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--color-text-light)' }}>预估费用</span>
            <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-primary)' }}>
              {cost > 0 ? `¥${cost}` : '免费'}
            </span>
          </div>
          {!form.own_filament && (
            <p style={{ fontSize: 11, color: 'var(--color-text-light)', margin: '4px 0 0' }}>
              {form.print_type === 'multi' ? '多色' : '单色'} ¥{form.print_type === 'multi' ? '0.15' : '0.10'}/g × {form.weight}g
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={submitting || !form.date || !form.slot_type}
          className="btn-primary"
          style={{ padding: '10px 20px', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarCheck style={{ width: 16, height: 16 }} />}
          提交预约
        </button>
      </form>
    </div>
  );
}
