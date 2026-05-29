'use client';

import { useState, useEffect } from 'react';
import { MotdSegment, getMotdSegmentStyle, normalizeIconSrc } from '@/lib/mc-status';
import { Wifi, WifiOff } from 'lucide-react';

type McCardProps = {
  name: string;
  address?: string | null;
  icon?: string | null;
  connect_ms?: number | null;
  type?: string | null;
  server_status?: string | null;
  motd?: string;
  motdSegments?: MotdSegment[];
  version?: string | null;
  protocol?: number | null;
  players_online?: number | null;
  players_max?: number | null;
  last_update?: string | null;
  compact?: boolean;
};

function formatRelativeTime(value: string | null | undefined) {
  if (!value) return '未记录';
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return '未记录';
  const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSeconds < 60) return `${diffSeconds} 秒前`;
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)} 分钟前`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)} 小时前`;
  return `${Math.floor(diffSeconds / 86400)} 天前`;
}

export function MCCard(props: McCardProps) {
  const isOnline = props.server_status === 'online';
  const iconSrc = normalizeIconSrc(props.icon);
  const [iconValid, setIconValid] = useState(false);
  const isCompact = props.compact ?? false;

  useEffect(() => {
    if (!iconSrc) { setIconValid(false); return; }
    const img = new Image();
    img.onload = () => setIconValid(true);
    img.onerror = () => setIconValid(false);
    img.src = iconSrc;
  }, [iconSrc]);

  // Compact mode: only name + online status
  if (isCompact) {
    return (
      <div className="mc-sub-card">
        <span className="mc-sub-card-name">{props.name}</span>
        <span className={`mc-status-pill ${isOnline ? 'online' : 'offline'}`}>
          {isOnline ? <><Wifi className="w-3 h-3" /> 在线</> : <><WifiOff className="w-3 h-3" /> 离线</>}
        </span>
      </div>
    );
  }

  const latencyClass = (() => {
    const ms = props.connect_ms;
    if (ms == null) return 'unknown';
    if (ms < 150) return 'good';
    if (ms < 400) return 'warning';
    return 'bad';
  })();

  const segments = props.motdSegments && props.motdSegments.length > 0
    ? props.motdSegments
    : [{ text: props.motd || '暂无服务器描述' }];

  return (
    <article className="mc-card">
      <div className="mc-card-header">
        <div className="mc-card-info">
          {iconValid && iconSrc ? (
            <img src={iconSrc} alt="" className="mc-card-icon" />
          ) : (
            <div className="mc-card-icon mc-card-icon-placeholder">MC</div>
          )}
          <div className="mc-card-details">
            <div className="mc-card-title-row">
              <h3 className="mc-card-name">{props.name}</h3>
              <span className={`mc-status-pill ${isOnline ? 'online' : 'offline'}`}>
                {isOnline ? <><Wifi className="w-3 h-3" /> 在线</> : <><WifiOff className="w-3 h-3" /> 离线</>}
              </span>
            </div>
            <p className="mc-card-meta">
              {props.type || '未知类型'} • {props.version || '未知版本'}
            </p>
            {props.address && <p className="mc-card-ip">{props.address}</p>}
          </div>
        </div>
        <div className={`mc-latency-badge ${latencyClass}`}>
          <span className="mc-latency-dot" />
          <span className="mc-latency-value">{props.connect_ms ?? '—'}</span>
          <span className="mc-latency-unit">ms</span>
        </div>
      </div>

      <div className="mc-card-motd">
        <p className="mc-motd-text">
          {segments.map((seg, i) => (
            <span key={i} style={getMotdSegmentStyle(seg)}>{seg.text}</span>
          ))}
        </p>
      </div>

      <div className="mc-card-metrics">
        <div className="mc-metric">
          <span className="mc-metric-label">在线玩家</span>
          <strong>{props.players_online ?? '—'} / {props.players_max ?? '—'}</strong>
        </div>
        <div className="mc-metric">
          <span className="mc-metric-label">状态更新</span>
          <strong>{formatRelativeTime(props.last_update)}</strong>
        </div>
      </div>

      <div className="mc-card-footer">
        <span>{props.connect_ms != null ? '响应正常' : '暂无延迟'}</span>
        <span className="mc-protocol">协议版本 {props.protocol ?? '—'}</span>
      </div>
    </article>
  );
}
