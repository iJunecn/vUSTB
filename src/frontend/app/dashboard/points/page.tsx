'use client';

import { useEffect, useState } from 'react';
import { rawApi } from '@/lib/api';
import { useUserStore } from '@/stores/user';
import {
  Coins, CalendarCheck, Loader2, Check, AlertCircle, Filter, CreditCard,
} from 'lucide-react';

type PointAccount = {
  pixel_points: number;
  shell_points: number;
  last_checkin: string | null;
};

type Transaction = {
  id: number;
  type: string;
  amount: number;
  reason: string;
  ref_id: string | null;
  balance_after: number;
  created_at: string | null;
};

const REASON_LABELS: Record<string, string> = {
  register: '注册赠送',
  checkin: '每日签到',
  upload_skin: '上传皮肤',
  create_player: '创建角色',
  print_booking: '打印预约',
  print_refund: '预约退回',
  print_cancel: '取消预约',
  recharge: '充值',
};

const AFDIAN_SHOP_URL = 'https://ifdian.net/item/7e31e1f85db611f1a9ad52540025c377';

export default function PointsPage() {
  const user = useUserStore((s) => s.user);
  const [account, setAccount] = useState<PointAccount | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>('all');
  const [checkinLoading, setCheckinLoading] = useState(false);
  const [checkinMessage, setCheckinMessage] = useState<string | null>(null);
  const [verifyModalOpen, setVerifyModalOpen] = useState(false);
  const [orderId, setOrderId] = useState('');
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyMessage, setVerifyMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function refreshAccount() {
    try {
      const r = await rawApi.get<PointAccount>('/api/points/account');
      setAccount(r.data);
    } catch { /* ignore */ }
  }

  async function refreshTransactions() {
    try {
      const params: Record<string, string> = { page: '1', page_size: '50' };
      if (filterType !== 'all') params.type = filterType;
      const r = await rawApi.get<Transaction[]>('/api/points/transactions', { params });
      setTransactions(r.data);
    } catch { /* ignore */ }
  }

  useEffect(() => {
    if (user) {
      setLoading(true);
      Promise.all([refreshAccount(), refreshTransactions()]).finally(() => setLoading(false));
    }
  }, [user, filterType]);

  async function handleCheckin() {
    setCheckinLoading(true);
    setCheckinMessage(null);
    try {
      const r = await rawApi.post('/api/points/checkin');
      setCheckinMessage(r.data.message || '签到成功！');
      refreshAccount();
    } catch (err: any) {
      setCheckinMessage(err?.response?.data?.detail || '签到失败');
    } finally {
      setCheckinLoading(false);
    }
  }

  async function handleVerify() {
    if (!orderId.trim()) return;
    setVerifyLoading(true);
    setVerifyMessage(null);
    try {
      const r = await rawApi.post('/api/points/verify-afdian', { out_trade_no: orderId.trim() });
      setVerifyMessage({ ok: true, text: `充值成功！获得 ${r.data.recharged} 贝壳积分` });
      setOrderId('');
      setVerifyModalOpen(false);
      refreshAccount();
      refreshTransactions();
    } catch (err: any) {
      setVerifyMessage({ ok: false, text: err?.response?.data?.detail || '验证失败' });
    } finally {
      setVerifyLoading(false);
    }
  }

  function formatDate(dateStr: string | null) {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--color-text-light)' }} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      {/* Header */}
      <div>
        <p className="section-kicker" style={{ marginBottom: 8 }}>POINTS</p>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-heading)', margin: 0 }}>
          积分详细
        </h1>
      </div>

      {/* Balance cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        <div className="surface-card" style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: 'color-mix(in srgb, #8b5cf6 12%, transparent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#8b5cf6',
            }}>
              <Coins style={{ width: 24, height: 24 }} />
            </div>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-light)' }}>像素积分</span>
          </div>
          <div style={{ fontSize: 36, fontWeight: 700, color: 'var(--color-heading)' }}>
            {account?.pixel_points ?? 0}
          </div>
          <p style={{ fontSize: 12, color: 'var(--color-text-light)', marginTop: 4 }}>
            皮肤站专用 · 签到获取
          </p>
        </div>

        <div className="surface-card" style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: 'color-mix(in srgb, #3b82f6 12%, transparent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#3b82f6',
            }}>
              <Coins style={{ width: 24, height: 24 }} />
            </div>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-light)' }}>贝壳积分</span>
          </div>
          <div style={{ fontSize: 36, fontWeight: 700, color: 'var(--color-heading)' }}>
            {account?.shell_points ?? 0}
          </div>
          <p style={{ fontSize: 12, color: 'var(--color-text-light)', marginTop: 4 }}>
            打印预约专用 · 充值获取
          </p>
        </div>
      </div>

      {/* Checkin */}
      <div className="surface-card" style={{ padding: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-heading)', margin: '0 0 4px 0' }}>
            每日签到
          </h2>
          <p style={{ fontSize: 14, color: 'var(--color-text-light)', margin: 0 }}>
            每天签到可获得 2 像素积分
          </p>
          {checkinMessage && (
            <p style={{ fontSize: 13, color: checkinMessage.includes('成功') ? '#22c55e' : '#ef4444', margin: '4px 0 0', fontWeight: 500 }}>
              {checkinMessage}
            </p>
          )}
        </div>
        <button
          onClick={handleCheckin}
          disabled={checkinLoading}
          className="btn-primary"
          style={{ padding: '10px 24px', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}
        >
          {checkinLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarCheck style={{ width: 18, height: 18 }} />}
          签到
        </button>
      </div>

      {/* Recharge section */}
      <div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-heading)', margin: '0 0 16px 0' }}>
          充值贝壳积分
        </h2>
        <p style={{ fontSize: 14, color: 'var(--color-text-light)', marginBottom: 16 }}>
          通过爱发电购买贝壳积分，1 元 = 1 贝壳积分。购买后点击"确认已购买"验证订单。
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <a
            href={AFDIAN_SHOP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary"
            style={{
              fontSize: 14, padding: '10px 24px',
              display: 'inline-flex', alignItems: 'center', gap: 8,
              textDecoration: 'none',
            }}
          >
            <CreditCard style={{ width: 16, height: 16 }} /> 前往爱发电充值
          </a>
          <button
            onClick={() => { setVerifyModalOpen(true); setVerifyMessage(null); }}
            className="btn-ghost"
            style={{ padding: '10px 24px', fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 8 }}
          >
            <Check style={{ width: 16, height: 16 }} /> 确认已购买
          </button>
        </div>
      </div>

      {/* Transaction history */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-heading)', margin: 0 }}>
            积分流水
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Filter style={{ width: 14, height: 14, color: 'var(--color-text-light)' }} />
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="input"
              style={{ fontSize: 13, padding: '6px 10px' }}
            >
              <option value="all">全部</option>
              <option value="pixel">像素积分</option>
              <option value="shell">贝壳积分</option>
            </select>
          </div>
        </div>

        {transactions.length === 0 ? (
          <div className="surface-card" style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-light)' }}>
            暂无积分记录
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {transactions.map((tx) => (
              <div key={tx.id} className="surface-card" style={{
                padding: '12px 16px', display: 'flex', alignItems: 'center',
                justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: tx.amount > 0
                      ? 'color-mix(in srgb, #22c55e 12%, transparent)'
                      : 'color-mix(in srgb, #ef4444 12%, transparent)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 700,
                    color: tx.amount > 0 ? '#22c55e' : '#ef4444',
                  }}>
                    {tx.amount > 0 ? '+' : ''}{tx.amount}
                  </div>
                  <div>
                    <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-heading)' }}>
                      {REASON_LABELS[tx.reason] || tx.reason}
                    </span>
                    <span style={{
                      fontSize: 11, marginLeft: 8, padding: '1px 6px', borderRadius: 4,
                      background: tx.type === 'pixel'
                        ? 'color-mix(in srgb, #8b5cf6 12%, transparent)'
                        : 'color-mix(in srgb, #3b82f6 12%, transparent)',
                      color: tx.type === 'pixel' ? '#8b5cf6' : '#3b82f6',
                      fontWeight: 600,
                    }}>
                      {tx.type === 'pixel' ? '像素' : '贝壳'}
                    </span>
                    {tx.ref_id && (
                      <span style={{ fontSize: 11, color: 'var(--color-text-light)', marginLeft: 4 }}>
                        #{tx.ref_id}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: tx.amount > 0 ? '#22c55e' : 'var(--color-heading)' }}>
                    {tx.amount > 0 ? '+' : ''}{tx.amount}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-light)' }}>
                    余额 {tx.balance_after} · {formatDate(tx.created_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Verify Afdian Modal */}
      {verifyModalOpen && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={(e) => { if (e.target === e.currentTarget) setVerifyModalOpen(false); }}
        >
          <div style={{ background: 'var(--color-card-background)', borderRadius: 16, maxWidth: 440, width: '100%', boxShadow: '0 16px 48px rgba(0,0,0,0.2)', animation: 'slideUp 0.3s ease-out' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-border)' }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--color-heading)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Check style={{ width: 18, height: 18, color: 'var(--color-primary)' }} />
                确认爱发电订单
              </h3>
            </div>
            <div style={{ padding: 24 }}>
              <p style={{ fontSize: 14, color: 'var(--color-text-light)', marginBottom: 16, lineHeight: 1.6 }}>
                在爱发电完成购买后，请输入订单号以验证并充值贝壳积分。订单号可在爱发电订单详情页找到。
              </p>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-heading)' }}>订单号</span>
                <input
                  value={orderId}
                  onChange={(e) => setOrderId(e.target.value)}
                  className="input"
                  placeholder="例如 202106232138371083454010626"
                  style={{ fontSize: 14 }}
                />
              </label>
              {verifyMessage && (
                <div style={{
                  padding: '10px 14px', borderRadius: 8, marginBottom: 16,
                  background: verifyMessage.ok
                    ? 'color-mix(in srgb, #22c55e 10%, transparent)'
                    : 'color-mix(in srgb, #ef4444 10%, transparent)',
                  color: verifyMessage.ok ? '#22c55e' : '#ef4444',
                  fontSize: 13, fontWeight: 500,
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  {verifyMessage.ok
                    ? <Check style={{ width: 16, height: 16 }} />
                    : <AlertCircle style={{ width: 16, height: 16 }} />}
                  {verifyMessage.text}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setVerifyModalOpen(false)}
                  className="btn-ghost"
                  style={{ fontSize: 13, padding: '8px 16px' }}
                >
                  取消
                </button>
                <button
                  onClick={handleVerify}
                  disabled={verifyLoading || !orderId.trim()}
                  className="btn-primary"
                  style={{ fontSize: 13, padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  {verifyLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check style={{ width: 14, height: 14 }} />}
                  验证订单
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
