/**
 * Minecraft server status via motd.minebbs.com public API.
 * API docs: https://motd.minebbs.com/docs
 *
 * GET https://motd.minebbs.com/api/status?ip=<host>&port=<port>&stype=auto
 * Returns: { status, type, host, version, protocol, motd, online, max, delay, icon }
 */

export type MotdSegment = {
  text: string;
  color?: string | null;
  bold?: boolean;
  italic?: boolean;
  underlined?: boolean;
  strikethrough?: boolean;
};

export type McStatus = {
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
  expose_ip?: boolean;
};

const MC_COLOR_MAP: Record<string, string> = {
  '0': '#000000', '1': '#0000AA', '2': '#00AA00', '3': '#00AAAA',
  '4': '#AA0000', '5': '#AA00AA', '6': '#FFAA00', '7': '#AAAAAA',
  '8': '#555555', '9': '#5555FF', a: '#55FF55', b: '#55FFFF',
  c: '#FF5555', d: '#FF55FF', e: '#FFFF55', f: '#FFFFFF',
};

type MotdStyleState = {
  color: string | null;
  bold: boolean;
  italic: boolean;
  underlined: boolean;
  strikethrough: boolean;
};

function createDefaultStyleState(): MotdStyleState {
  return { color: null, bold: false, italic: false, underlined: false, strikethrough: false };
}

function pushSegment(segments: MotdSegment[], text: string, style: MotdStyleState) {
  if (!text) return;
  segments.push({
    text,
    color: style.color,
    bold: style.bold,
    italic: style.italic,
    underlined: style.underlined,
    strikethrough: style.strikethrough,
  });
}

export function parseMotdSegments(raw: string | null | undefined): MotdSegment[] {
  if (!raw) return [];
  const segments: MotdSegment[] = [];
  const state = createDefaultStyleState();
  let buf = '';

  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '§' && i + 1 < raw.length) {
      pushSegment(segments, buf, state);
      buf = '';
      const code = raw[i + 1].toLowerCase();
      if (code in MC_COLOR_MAP) {
        state.color = MC_COLOR_MAP[code] ?? null;
        state.bold = false;
        state.italic = false;
        state.underlined = false;
        state.strikethrough = false;
      } else if (code === 'l') {
        state.bold = true;
      } else if (code === 'm') {
        state.strikethrough = true;
      } else if (code === 'n') {
        state.underlined = true;
      } else if (code === 'o') {
        state.italic = true;
      } else if (code === 'r') {
        Object.assign(state, createDefaultStyleState());
      }
      i++;
    } else {
      buf += raw[i];
    }
  }
  pushSegment(segments, buf, state);
  return segments;
}

// ---------- motd.minebbs.com API response type ----------
type MotdApiResponse = {
  status: 'online' | 'error' | string;
  type?: string;           // "je" or "be"
  host?: string;
  version?: string;
  protocol?: number;
  motd?: string;
  online?: number;
  max?: number;
  delay?: number;
  icon?: string;           // base64 data URI
};

/**
 * Query a single MC server status from motd.minebbs.com.
 */
export async function queryMotdApi(
  ip: string,
  port?: number,
  stype: string = 'auto',
): Promise<McStatus> {
  const params = new URLSearchParams({ ip, stype });
  if (port != null) params.set('port', String(port));

  try {
    const res = await fetch(`https://motd.minebbs.com/api/status?${params}`, {
      signal: AbortSignal.timeout(8000),
    });
    const data: MotdApiResponse = await res.json();

    if (data.status !== 'online') {
      return {
        name: ip,
        address: ip,
        server_status: 'offline',
        connect_ms: null,
      };
    }

    const motdRaw = data.motd ?? '';
    const motdSegments = parseMotdSegments(motdRaw);

    return {
      name: ip,
      address: ip,
      icon: data.icon ?? null,
      connect_ms: data.delay ?? null,
      type: data.type === 'je' ? 'java' : data.type === 'be' ? 'bedrock' : data.type,
      server_status: 'online',
      motd: motdSegments.map((s) => s.text).join('') || motdRaw,
      motdSegments,
      version: data.version ?? null,
      protocol: data.protocol ?? null,
      players_online: data.online ?? null,
      players_max: data.max ?? null,
      last_update: new Date().toISOString(),
    };
  } catch {
    return {
      name: ip,
      address: ip,
      server_status: 'offline',
      connect_ms: null,
    };
  }
}

export function formatRelativeTime(value: string | null | undefined) {
  if (!value) return '未记录';
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return '未记录';
  const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSeconds < 60) return `${diffSeconds} 秒前`;
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)} 分钟前`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)} 小时前`;
  return `${Math.floor(diffSeconds / 86400)} 天前`;
}

export function normalizeIconSrc(v: string | null | undefined): string | null {
  if (!v) return null;
  let s = String(v).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/\\r|\\n/g, '');
  const noSpace = s.replace(/\s+/g, '');
  if (noSpace.startsWith('data:')) return noSpace;
  if (/^[A-Za-z0-9+/=]+$/.test(noSpace)) return `data:image/png;base64,${noSpace}`;
  if (noSpace.includes('base64,')) return noSpace;
  return s || null;
}

export function getMotdSegmentStyle(seg: MotdSegment): React.CSSProperties {
  const textDecoration = [
    seg.underlined ? 'underline' : '',
    seg.strikethrough ? 'line-through' : '',
  ].filter(Boolean).join(' ');

  return {
    color: seg.color ?? undefined,
    fontWeight: seg.bold ? '700' : undefined,
    fontStyle: seg.italic ? 'italic' : undefined,
    textDecoration: textDecoration || undefined,
  };
}
