export type MotdSegment = {
  text: string;
  color?: string | null;
  bold?: boolean;
  italic?: boolean;
  underlined?: boolean;
  strikethrough?: boolean;
};

export type McStatus = {
  id?: number;
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

export function mapMcStatusRow(item: Record<string, unknown>): McStatus {
  const status = item.status as Record<string, unknown> | undefined;
  const motdRaw = (status?.motd ?? item.motd ?? '') as string;
  const motdSegments = parseMotdSegments(motdRaw);
  const players = (status?.players ?? {}) as Record<string, unknown>;

  return {
    id: item.id as number | undefined,
    name: (item.name as string) || '',
    address: (item.address as string) ?? null,
    icon: (status?.icon as string) ?? (item.icon as string) ?? null,
    connect_ms: (status?.connect_ms as number) ?? (item.connect_ms as number) ?? null,
    type: (status?.type as string) ?? (item.type as string) ?? null,
    server_status: (status?.status as string) ?? (item.server_status as string) ?? (item.status ? 'online' : 'offline'),
    motd: motdSegments.map((s) => s.text).join('') || '',
    motdSegments,
    version: (status?.version as string) ?? (item.version as string) ?? null,
    protocol: (status?.protocol as number) ?? (item.protocol as number) ?? null,
    players_online: (players.online as number) ?? (item.players_online as number) ?? null,
    players_max: (players.max as number) ?? (item.players_max as number) ?? null,
    last_update: (item.last_update as string) ?? null,
    expose_ip: item.expose_ip === true,
  };
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
