// Case SLA computation (v2 Phase 3). Pure + injectable `now` so it's fully
// unit-testable. A case's deadline is its explicit due_date if set, else
// opened_date + sla_hours. Closed/canceled cases have no live SLA.

export interface SlaInput {
  opened_date?: string | null;
  sla_hours?: number | null;
  due_date?: string | null;
  status?: string | null;
  now?: Date;
}

export type SlaState = 'on_track' | 'due_soon' | 'overdue' | 'none';

export interface SlaStatus {
  state: SlaState;
  dueAt: string | null;        // ISO, or null when there's no deadline
  hoursRemaining: number | null;
}

const NONE: SlaStatus = { state: 'none', dueAt: null, hoursRemaining: null };

/**
 * Parse a date-only string ('YYYY-MM-DD') at a fixed local time-of-day.
 * Parsing both opened_date and due_date the same way (local) keeps window
 * math timezone-consistent — `new Date('2026-06-13')` alone is UTC-midnight,
 * which would skew against a locally-constructed `now`.
 */
function parseLocalDay(s: string, endOfDay: boolean): Date {
  return new Date(`${String(s).slice(0, 10)}T${endOfDay ? '23:59:59' : '00:00:00'}`);
}

/** Resolve the deadline instant from due_date (preferred) or opened+sla_hours. */
function resolveDueAt(input: SlaInput): Date | null {
  if (input.due_date) {
    const d = parseLocalDay(input.due_date, true);
    if (!isNaN(d.getTime())) return d;
  }
  if (input.opened_date && input.sla_hours && input.sla_hours > 0) {
    const opened = parseLocalDay(input.opened_date, false);
    if (!isNaN(opened.getTime())) return new Date(opened.getTime() + input.sla_hours * 3600000);
  }
  return null;
}

export function computeSlaStatus(input: SlaInput): SlaStatus {
  const now = input.now ?? new Date();
  const status = String(input.status || '').toLowerCase();
  // Terminal states have no live SLA.
  if (status.startsWith('closed') || status === 'canceled') return NONE;

  const dueAt = resolveDueAt(input);
  if (!dueAt) return NONE;

  const hoursRemaining = (dueAt.getTime() - now.getTime()) / 3600000;
  if (hoursRemaining < 0) {
    return { state: 'overdue', dueAt: dueAt.toISOString(), hoursRemaining };
  }

  // "Due soon" window = max(24h, 25% of the opened→due window). Falls back to
  // 24h when there's no opened_date to size the window against.
  let threshold = 24;
  if (input.opened_date) {
    const opened = parseLocalDay(input.opened_date, false);
    if (!isNaN(opened.getTime())) {
      const windowH = (dueAt.getTime() - opened.getTime()) / 3600000;
      if (windowH > 0) threshold = Math.max(24, windowH * 0.25);
    }
  }
  return {
    state: hoursRemaining <= threshold ? 'due_soon' : 'on_track',
    dueAt: dueAt.toISOString(),
    hoursRemaining,
  };
}

/** Badge presentation for an SLA state (label + theme color, no blue). */
export function slaBadge(state: SlaState): { label: string; color: string } | null {
  switch (state) {
    case 'overdue': return { label: 'OVERDUE', color: '#ef4444' };
    case 'due_soon': return { label: 'DUE SOON', color: '#f59e0b' };
    case 'on_track': return { label: 'ON TRACK', color: '#22c55e' };
    default: return null;
  }
}
