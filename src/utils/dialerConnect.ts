// ============================================================
// Dial Connect — shared helpers (Worker)
// Phone identity, call/voicemail classification, history filters,
// and the function catalogs that pin "10 minimum" per surface.
// ============================================================

export const DIALER_FUNCTIONS = [
  { id: 'keypad', label: 'Keypad / Place Call' },
  { id: 'speed_dial', label: 'Speed Dial' },
  { id: 'presence', label: 'Agent Presence' },
  { id: 'dtmf', label: 'In-call DTMF' },
  { id: 'hold', label: 'Hold / Resume' },
  { id: 'transfer', label: 'Blind / Warm Transfer' },
  { id: 'conference', label: 'Add Conference Party' },
  { id: 'record', label: 'Start / Stop Recording' },
  { id: 'hangup', label: 'Hang Up / Mute' },
  { id: 'lookup', label: 'Caller ID Lookup' },
  { id: 'link_cfs', label: 'Link Call to CFS' },
  { id: 'disposition', label: 'Call Disposition' },
  { id: 'callback', label: 'Schedule Callback' },
] as const;

export const VOICEMAIL_FUNCTIONS = [
  { id: 'inbox', label: 'Inbox Filters' },
  { id: 'play', label: 'Play in Browser' },
  { id: 'download_audio', label: 'Download Recording' },
  { id: 'print_pdf', label: 'Print / Download Transcript PDF' },
  { id: 'mark_read', label: 'Mark Heard / Unheard' },
  { id: 'star', label: 'Star / Flag' },
  { id: 'assign', label: 'Assign Officer' },
  { id: 'callback', label: 'Return Call' },
  { id: 'archive', label: 'Archive / Restore' },
  { id: 'search', label: 'Transcript Search' },
  { id: 'urgency', label: 'Urgency Classification' },
  { id: 'bulk_heard', label: 'Bulk Mark Heard' },
  { id: 'csv', label: 'CSV Export' },
  { id: 'notes', label: 'Mailbox Notes' },
] as const;

export const CALL_HISTORY_FUNCTIONS = [
  { id: 'direction', label: 'Direction Filter' },
  { id: 'date_range', label: 'Date Range' },
  { id: 'search', label: 'Number / Name Search' },
  { id: 'play', label: 'Play Recording' },
  { id: 'download_audio', label: 'Download Recording' },
  { id: 'print_pdf', label: 'Print / Download Transcript PDF' },
  { id: 'csv', label: 'CSV Export' },
  { id: 'missed', label: 'Missed-only Filter' },
  { id: 'redial', label: 'Redial' },
  { id: 'stats', label: 'Duration Stats' },
  { id: 'duplicates', label: 'Duplicate Clusters' },
  { id: 'tags', label: 'Tags & Notes' },
  { id: 'starred', label: 'Starred Filter' },
  { id: 'link_cfs', label: 'Open Linked CFS' },
] as const;

export const PRESENCE_STATUSES = ['available', 'busy', 'dnd', 'wrapup', 'offline'] as const;
export type PresenceStatus = (typeof PRESENCE_STATUSES)[number];

export const CALL_DIRECTIONS = ['inbound', 'outbound', 'internal'] as const;
export type CallDirection = (typeof CALL_DIRECTIONS)[number];

export const CALL_STATUSES = [
  'ringing', 'in_progress', 'completed', 'missed', 'failed', 'voicemail', 'busy',
] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

export const VM_URGENCY = ['normal', 'urgent', 'emergency'] as const;
export type VmUrgency = (typeof VM_URGENCY)[number];

export const DISPOSITIONS = [
  'completed', 'left_voicemail', 'no_answer', 'busy', 'wrong_number',
  'transferred', 'callback_scheduled', 'info_only', 'emergency_escalated',
] as const;

const NANP_DIGITS = /^\d{10}$/;
const E164_DIGITS = /^\d{11}$/;

/** Best-effort E.164 for US/NANP numbers Dial Connect and Flex share. */
export function normalizeDialNumber(raw: string | null | undefined): string {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  if (trimmed.startsWith('+')) return trimmed.replace(/[^\d+]/g, '');
  const digits = trimmed.replace(/\D/g, '');
  if (E164_DIGITS.test(digits) && digits.startsWith('1')) return `+${digits}`;
  if (NANP_DIGITS.test(digits)) return `+1${digits}`;
  return digits ? `+${digits}` : '';
}

export function last10Digits(raw: string | null | undefined): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return digits.slice(-10);
}

export function isMissedCall(status: string | null | undefined): boolean {
  const s = (status ?? '').toLowerCase();
  return s === 'missed' || s === 'no-answer' || s === 'no_answer';
}

export function classifyVmUrgency(text: string | null | undefined): VmUrgency {
  const t = (text ?? '').toLowerCase();
  if (/\b(911|emergency|officer down|shots fired|help me|suicide)\b/.test(t)) return 'emergency';
  if (/\b(urgent|asap|right now|immediately|callback now)\b/.test(t)) return 'urgent';
  return 'normal';
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${String(sec).padStart(2, '0')}s`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

export interface HistoryRow {
  from_number?: string | null;
  to_number?: string | null;
  from_name?: string | null;
  to_name?: string | null;
  direction?: string | null;
  status?: string | null;
  agent_name?: string | null;
  notes?: string | null;
  tags?: string | null;
  transcript?: string | null;
  started_at?: string | null;
}

export interface HistoryFilters {
  q?: string;
  direction?: string;
  missedOnly?: boolean;
  fromIso?: string;
  toIso?: string;
}

export function matchesHistoryFilters(row: HistoryRow, f: HistoryFilters): boolean {
  if (f.direction && f.direction !== 'all' && (row.direction || '') !== f.direction) return false;
  if (f.missedOnly && !isMissedCall(row.status)) return false;
  if (f.fromIso && (row.started_at || '') < f.fromIso) return false;
  if (f.toIso && (row.started_at || '') > f.toIso) return false;
  const q = (f.q || '').trim().toLowerCase();
  if (!q) return true;
  const hay = [
    row.from_number, row.to_number, row.from_name, row.to_name,
    row.agent_name, row.notes, row.tags, row.transcript, row.status,
  ].map((v) => String(v ?? '').toLowerCase()).join(' ');
  const digits = last10Digits(q);
  if (digits.length >= 4) {
    const fromD = last10Digits(row.from_number);
    const toD = last10Digits(row.to_number);
    if (fromD.includes(digits) || toD.includes(digits)) return true;
  }
  return hay.includes(q);
}

export interface DuplicateCluster {
  key: string;
  count: number;
  lastAt: string | null;
}

/** Cluster calls that share the same counterparty number within a window. */
export function clusterDuplicates(
  rows: Array<{ from_number?: string | null; to_number?: string | null; direction?: string | null; started_at?: string | null }>,
): DuplicateCluster[] {
  const map = new Map<string, DuplicateCluster>();
  for (const r of rows) {
    const counterparty = r.direction === 'outbound' ? r.to_number : r.from_number;
    const key = last10Digits(counterparty) || 'unknown';
    const existing = map.get(key);
    const at = r.started_at || null;
    if (!existing) {
      map.set(key, { key, count: 1, lastAt: at });
    } else {
      existing.count += 1;
      if (at && (!existing.lastAt || at > existing.lastAt)) existing.lastAt = at;
    }
  }
  return [...map.values()].filter((c) => c.count >= 2).sort((a, b) => b.count - a.count);
}

export function parseTagList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((x) => String(x).trim()).filter(Boolean);
  } catch { /* CSV fallback */ }
  return String(raw).split(/[,;]/).map((s) => s.trim()).filter(Boolean);
}

export function serializeTags(tags: string[]): string {
  const uniq = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
  return JSON.stringify(uniq);
}

export function csvEscape(value: unknown): string {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function callsToCsv(rows: Array<Record<string, unknown>>): string {
  const headers = [
    'id', 'call_sid', 'direction', 'status', 'from_number', 'to_number',
    'from_name', 'to_name', 'agent_name', 'started_at', 'ended_at',
    'duration_seconds', 'disposition', 'starred', 'call_id', 'notes',
  ];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  }
  return lines.join('\r\n');
}

export function voicemailsToCsv(rows: Array<Record<string, unknown>>): string {
  const headers = [
    'id', 'call_sid', 'from_number', 'from_name', 'to_number', 'mailbox',
    'duration_seconds', 'urgency', 'is_read', 'starred', 'archived',
    'assigned_name', 'received_at', 'call_id', 'notes', 'transcript',
  ];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  }
  return lines.join('\r\n');
}

export function assertMinFunctions(): { dialer: number; voicemail: number; history: number } {
  return {
    dialer: DIALER_FUNCTIONS.length,
    voicemail: VOICEMAIL_FUNCTIONS.length,
    history: CALL_HISTORY_FUNCTIONS.length,
  };
}

export function isPresenceStatus(v: unknown): v is PresenceStatus {
  return typeof v === 'string' && (PRESENCE_STATUSES as readonly string[]).includes(v);
}

export function isCallDirection(v: unknown): v is CallDirection {
  return typeof v === 'string' && (CALL_DIRECTIONS as readonly string[]).includes(v);
}

export function isCallStatus(v: unknown): v is CallStatus {
  return typeof v === 'string' && (CALL_STATUSES as readonly string[]).includes(v);
}

export function isVmUrgency(v: unknown): v is VmUrgency {
  return typeof v === 'string' && (VM_URGENCY as readonly string[]).includes(v);
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/** SSRF gate for proxying Dial Connect / Twilio recording URLs through the Worker. */
export function isAllowedRecordingSourceUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return host === 'dialer.rmpgutah.us'
      || host === 'api.twilio.com'
      || host.endsWith('.twilio.com');
  } catch {
    return false;
  }
}
