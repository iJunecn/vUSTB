'use client';

import { AlertCircle, Info } from 'lucide-react';

export type ConfirmOptions = {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
};

type ConfirmDialogProps = ConfirmOptions & {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  title,
  message,
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
  open,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: 'var(--color-card-background)', borderRadius: 16,
          maxWidth: 400, width: '100%', boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
          padding: 24,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <div style={{
            flexShrink: 0, width: 36, height: 36, borderRadius: 10,
            background: danger
              ? 'color-mix(in srgb, #ef4444 12%, transparent)'
              : 'color-mix(in srgb, var(--color-primary) 12%, transparent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {danger
              ? <AlertCircle style={{ width: 20, height: 20, color: '#ef4444' }} />
              : <Info style={{ width: 20, height: 20, color: 'var(--color-primary)' }} />}
          </div>
          <div>
            {title && (
              <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-heading)', margin: '0 0 6px' }}>
                {title}
              </h3>
            )}
            <p style={{ fontSize: 14, color: 'var(--color-text)', margin: 0, lineHeight: 1.6 }}>
              {message}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            className="btn-ghost"
            style={{ fontSize: 13, padding: '8px 20px' }}
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={danger ? 'btn-destructive' : 'btn-primary'}
            style={{ fontSize: 13, padding: '8px 20px' }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
