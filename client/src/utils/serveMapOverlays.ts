import { parseTimestamp } from './dateUtils';

export type UrgencyTier = 'critical' | 'warning' | 'none';

const HOUR_MS = 3_600_000;

export function urgencyTierForDeadline(deadline: string | null, now: number): UrgencyTier {
  if (!deadline) return 'none';
  const deadlineDate = parseTimestamp(deadline);
  const deadlineMs = deadlineDate.getTime();
  if (Number.isNaN(deadlineMs)) return 'none';
  const hoursLeft = (deadlineMs - now) / HOUR_MS;
  if (hoursLeft <= 24) return 'critical';
  if (hoursLeft <= 72) return 'warning';
  return 'none';
}

const SAFETY_KEYWORDS = ['officer safety', 'weapon', 'aggressive dog', 'hostile', 'restraining order', 'armed'];

export function isRiskFlagged(item: { priority: string; location_note_text: string | null }): boolean {
  if (item.priority === 'urgent') return true;
  const note = (item.location_note_text || '').toLowerCase();
  return SAFETY_KEYWORDS.some((kw) => note.includes(kw));
}

export interface SuccessRateRow {
  zip: string;
  served: number;
  failed: number;
}

export function successRateColor(row: SuccessRateRow): string {
  const total = row.served + row.failed;
  if (total === 0) return '#6b7280';
  const rate = row.served / total;
  if (rate >= 0.7) return '#22c55e';
  if (rate >= 0.4) return '#f59e0b';
  return '#ef4444';
}

// QueueMapItem (the client's mapped-item shape) has no zip field, only
// recipient_city/recipient_address/recipient_state. `/process-server/success-rates`
// aggregates by zip, so there is no exact geometric match available on the client
// without a second geocoding round-trip. As the best available substitute, group
// mapped items by `recipient_city` and treat a SuccessRateRow's `zip` field as a
// grouping key matched (case-insensitively) against `recipient_city`. Returns null
// when no mapped item matches the group key, so callers can skip plotting that row
// rather than falling back to [0,0] (Gulf of Guinea).
export interface GroupableMapItem {
  recipient_city: string | null;
  recipient_lat: number | null;
  recipient_lng: number | null;
}

export function centroidForGroup(groupKey: string, items: GroupableMapItem[]): { lat: number; lng: number } | null {
  const key = groupKey.trim().toLowerCase();
  if (!key) return null;
  const matches = items.filter(
    (it) =>
      it.recipient_lat != null &&
      it.recipient_lng != null &&
      (it.recipient_city || '').trim().toLowerCase() === key,
  );
  if (matches.length === 0) return null;
  const sum = matches.reduce(
    (acc, it) => ({ lat: acc.lat + it.recipient_lat!, lng: acc.lng + it.recipient_lng! }),
    { lat: 0, lng: 0 },
  );
  return { lat: sum.lat / matches.length, lng: sum.lng / matches.length };
}

export type DeadlineFilter = 'all' | 'today' | 'three_days' | 'week' | 'overdue';

export function matchesDeadlineFilter(deadline: string | null, filter: DeadlineFilter, now: number): boolean {
  if (filter === 'all') return true;
  if (!deadline) return false;
  const deadlineMs = parseTimestamp(deadline).getTime();
  if (Number.isNaN(deadlineMs)) return false;
  const hoursLeft = (deadlineMs - now) / HOUR_MS;
  switch (filter) {
    case 'overdue': return hoursLeft < 0;
    case 'today': return hoursLeft >= 0 && hoursLeft <= 24;
    case 'three_days': return hoursLeft >= 0 && hoursLeft <= 72;
    case 'week': return hoursLeft >= 0 && hoursLeft <= 168;
    default: return true;
  }
}
