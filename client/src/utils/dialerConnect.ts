// Client-side Dial Connect helpers. Keep in sync with src/utils/dialerConnect.ts
// (Worker and SPA do not share a package). Tests pin the 10-function minimum.

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

export const DISPOSITIONS = [
  'completed', 'left_voicemail', 'no_answer', 'busy', 'wrong_number',
  'transferred', 'callback_scheduled', 'info_only', 'emergency_escalated',
] as const;

export const PRESENCE_STATUSES = ['available', 'busy', 'dnd', 'wrapup', 'offline'] as const;

export function last10Digits(raw: string | null | undefined): string {
  return String(raw ?? '').replace(/\D/g, '').slice(-10);
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

export function displayPhone(raw: string | null | undefined): string {
  const d = last10Digits(raw);
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return raw || '—';
}

export function pdfFilename(kind: 'call' | 'voicemail', id: number | string): string {
  return `RMPG-DC-${kind === 'voicemail' ? 'VM' : 'CALL'}-${id}.pdf`;
}

export function audioFilename(kind: 'call' | 'voicemail', id: number | string): string {
  return `RMPG-DC-${kind === 'voicemail' ? 'VM' : 'CALL'}-${id}.mp3`;
}

export function minFunctionCounts(): { dialer: number; voicemail: number; history: number } {
  return {
    dialer: DIALER_FUNCTIONS.length,
    voicemail: VOICEMAIL_FUNCTIONS.length,
    history: CALL_HISTORY_FUNCTIONS.length,
  };
}

export interface CounterpartyRow {
  direction?: string | null;
  from_number?: string | null;
  to_number?: string | null;
}

/**
 * The "other party" on a call. Prefers the direction-appropriate side but falls
 * back to whichever number was archived, so a row that only carries one number
 * (e.g. enriched by a late recording event) never renders as "—".
 */
export function counterpartyNumber(row: CounterpartyRow): string {
  const primary = row.direction === 'outbound' ? row.to_number : row.from_number;
  const secondary = row.direction === 'outbound' ? row.from_number : row.to_number;
  return (primary && primary.trim()) || (secondary && secondary.trim()) || '';
}

/** Top-5 counterparties (by last-10 digits) seen 2+ times. Rows without a number are ignored. */
export function clusterCounterparties(rows: CounterpartyRow[], limit = 5): Array<[string, number]> {
  const map = new Map<string, number>();
  for (const r of rows) {
    const key = last10Digits(counterpartyNumber(r));
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, limit);
}
