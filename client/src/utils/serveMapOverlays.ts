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

export function isRiskFlagged(item: {
  priority: string;
  location_note_text?: string | null;
  service_instructions?: string | null;
}): boolean {
  if (item.priority === 'urgent') return true;
  const note = `${item.location_note_text || ''} ${item.service_instructions || ''}`.toLowerCase();
  return SAFETY_KEYWORDS.some((kw) => note.includes(kw));
}

export type DeadlineFilter = 'all' | 'today' | 'three_days' | 'week' | 'overdue' | 'served';

export function matchesDeadlineFilter(
  deadline: string | null,
  filter: DeadlineFilter,
  now: number,
  status?: string | null,
): boolean {
  if (filter === 'served') return status === 'served';
  if (filter === 'all') return true;
  if (!deadline) return false;
  const deadlineMs = parseTimestamp(deadline).getTime();
  if (Number.isNaN(deadlineMs)) return false;
  const hoursLeft = (deadlineMs - now) / HOUR_MS;
  switch (filter) {
    case 'overdue': return hoursLeft < 0 && status !== 'served';
    case 'today': return hoursLeft <= 24;
    case 'three_days': return hoursLeft <= 72;
    case 'week': return hoursLeft <= 168;
    default: return true;
  }
}
