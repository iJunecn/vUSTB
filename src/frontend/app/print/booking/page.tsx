'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { useUserStore } from '@/stores/user';
import { rawApi } from '@/lib/api';
import { Loader2, CalendarCheck, QrCode, X } from 'lucide-react';

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
  const [showPayQR, setShowPayQR] = useState(false);

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

        {/* Filament */}
        <div style={{ padding: 16, borderRadius: 12, background: 'var(--color-background-soft)' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-heading)', display: 'block', marginBottom: 8 }}>是否使用个人耗材？</span>
          <div style={{ display: 'flex', gap: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <input
                type="radio"
                name="own_filament"
                checked={form.own_filament}
                onChange={() => setForm({ ...form, own_filament: true })}
              />
              <strong>是</strong> - 使用个人耗材 <span style={{ color: '#22c55e' }}>(免费使用机器)</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <input
                type="radio"
                name="own_filament"
                checked={!form.own_filament}
                onChange={() => setForm({ ...form, own_filament: false })}
              />
              <strong>否</strong> - 使用社团耗材 <span style={{ color: 'var(--color-text-light)' }}>(需支付材料费)</span>
            </label>
          </div>
        </div>

        {/* Print type & weight */}
        {!form.own_filament && (
          <>
            <div style={{ padding: 16, borderRadius: 12, background: 'var(--color-background-soft)' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-heading)', display: 'block', marginBottom: 8 }}>打印类型</span>
              <div style={{ display: 'flex', gap: 16 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="print_type"
                    checked={form.print_type === 'single'}
                    onChange={() => setForm({ ...form, print_type: 'single' })}
                  />
                  <strong>单色打印</strong> <span style={{ color: 'var(--color-primary)' }}>(¥0.10/g)</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="print_type"
                    checked={form.print_type === 'multi'}
                    onChange={() => setForm({ ...form, print_type: 'multi' })}
                  />
                  <strong>多色打印</strong> <span style={{ color: 'var(--color-primary)' }}>(¥0.15/g)</span>
                </label>
              </div>
            </div>

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
          </>
        )}

        {/* Cost preview */}
        <div style={{ padding: '16px 20px', borderRadius: 12, background: 'var(--color-background-soft)', border: '2px solid var(--color-primary)', textAlign: 'center' }}>
          <div style={{ color: 'var(--color-text-light)', fontSize: 13, marginBottom: 4 }}>预估费用</div>
          <div>
            <span style={{ fontSize: 36, fontWeight: 700, color: 'var(--color-primary)' }}>
              {cost > 0 ? cost.toFixed(2) : '0.00'}
            </span>
            <span style={{ fontSize: 18, color: 'var(--color-primary)', fontWeight: 600 }}> 元</span>
          </div>
          {!form.own_filament && form.weight > 0 && (
            <p style={{ fontSize: 11, color: 'var(--color-text-light)', margin: '4px 0 0' }}>
              {form.print_type === 'multi' ? '多色' : '单色'} ¥{form.print_type === 'multi' ? '0.15' : '0.10'}/g × {form.weight}g
            </p>
          )}
        </div>

        {/* Payment section - show when using club filament and cost > 0 */}
        {!form.own_filament && cost > 0 && (
          <div style={{ padding: '12px 16px', borderRadius: 10, background: 'var(--color-background-soft)', border: '1px solid var(--color-border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-heading)' }}>支付状态确认</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setShowPayQR(true)}
                  style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--color-primary)', background: 'transparent', color: 'var(--color-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  <QrCode style={{ width: 14, height: 14 }} /> 扫码支付
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, is_paid: !form.is_paid })}
                  style={{
                    padding: '4px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', border: '1px solid',
                    borderColor: form.is_paid ? '#22c55e' : '#ef4444',
                    background: form.is_paid ? 'color-mix(in srgb, #22c55e 10%, transparent)' : 'color-mix(in srgb, #ef4444 10%, transparent)',
                    color: form.is_paid ? '#22c55e' : '#ef4444', fontWeight: 600,
                  }}
                >
                  {form.is_paid ? '已支付' : '未支付'}
                </button>
              </div>
            </div>
            <p style={{ fontSize: 11, color: 'var(--color-text-light)', margin: '4px 0 0' }}>请在支付完成后切换为"已支付"</p>
            <input type="hidden" name="is_paid" value={form.is_paid ? '1' : '0'} />
          </div>
        )}

        {/* Paid checkbox (when using own filament or cost = 0) */}
        {(form.own_filament || cost === 0) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="checkbox"
              id="is_paid"
              checked={form.is_paid}
              onChange={(e) => setForm({ ...form, is_paid: e.target.checked })}
            />
            <label htmlFor="is_paid" style={{ fontSize: 14, color: 'var(--color-text)', cursor: 'pointer' }}>已支付</label>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {!form.own_filament && cost > 0 && (
            <button
              type="button"
              onClick={() => setShowPayQR(true)}
              className="btn-ghost"
              style={{ padding: '12px 20px', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, borderColor: '#f59e0b', color: '#f59e0b' }}
            >
              <QrCode style={{ width: 16, height: 16 }} /> 支付材料费用
            </button>
          )}
          <button
            type="submit"
            disabled={submitting || !form.date || !form.slot_type}
            className="btn-primary"
            style={{ padding: '12px 20px', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarCheck style={{ width: 16, height: 16 }} />}
            确认预约
          </button>
        </div>
      </form>

      {/* Payment QR Code Modal */}
      {showPayQR && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 110, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowPayQR(false); }}
        >
          <div style={{ background: 'var(--color-card-background)', borderRadius: 16, maxWidth: 320, width: '100%', boxShadow: '0 16px 48px rgba(0,0,0,0.2)', animation: 'slideUp 0.3s ease-out', textAlign: 'center', padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--color-heading)' }}>
                <QrCode style={{ width: 16, height: 16, display: 'inline', marginRight: 6 }} /> 扫码支付
              </h3>
              <button onClick={() => setShowPayQR(false)} style={{ background: 'none', border: 'none', color: 'var(--color-text-light)', cursor: 'pointer' }}>
                <X style={{ width: 18, height: 18 }} />
              </button>
            </div>
            <Image
              src="/images/pay.jpg"
              alt="支付二维码"
              width={200}
              height={200}
              style={{ width: 200, height: 'auto', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.1)', display: 'inline-block' }}
            />
            <p style={{ marginTop: 16, color: 'var(--color-text-light)', fontSize: 13, marginBottom: 0 }}>
              请使用微信扫描二维码支付材料费
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
