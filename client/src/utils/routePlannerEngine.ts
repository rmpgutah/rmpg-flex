import { ROUTE_PLANNER_FEATURES, ROUTE_PLANNER_FIXES } from './routePlannerCatalog';

const LUNCH_HOUR_DENVER = 12;
const DEFAULT_LUNCH_MIN = 30;
const DEFAULT_MPG = 18;
const SHIFT_MINUTES = 480;

export function denverHourFromMs(ms: number): number {
  return Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    hour: 'numeric',
    hourCycle: 'h23',
  }).format(new Date(ms))); // new-date-ok — epoch ms
}

/** Insert a single unpaid lunch once the clock crosses noon Denver. */
export function applyLunchBreak(
  elapsedMs: number,
  lunchTaken: boolean,
  lunchMinutes: number = DEFAULT_LUNCH_MIN,
): { elapsedMs: number; lunchTaken: boolean; addedMs: number } {
  if (lunchTaken || lunchMinutes <= 0) return { elapsedMs, lunchTaken, addedMs: 0 };
  if (denverHourFromMs(elapsedMs) < LUNCH_HOUR_DENVER) {
    return { elapsedMs, lunchTaken: false, addedMs: 0 };
  }
  const addedMs = lunchMinutes * 60_000;
  return { elapsedMs: elapsedMs + addedMs, lunchTaken: true, addedMs };
}

export function gallonsForMiles(miles: number, mpg: number = DEFAULT_MPG): number {
  if (!Number.isFinite(miles) || miles <= 0 || !Number.isFinite(mpg) || mpg <= 0) return 0;
  return miles / mpg;
}

export function splitIdsByShiftMinutes(
  orderedIds: number[],
  cumulativeMinutes: number[],
  shiftMinutes: number = SHIFT_MINUTES,
): { day1: number[]; day2: number[] } {
  if (orderedIds.length === 0) return { day1: [], day2: [] };
  let cut = orderedIds.length;
  for (let i = 0; i < orderedIds.length; i++) {
    if ((cumulativeMinutes[i] ?? 0) > shiftMinutes) {
      cut = Math.max(1, i);
      break;
    }
  }
  if (cut >= orderedIds.length) {
    cut = Math.max(1, Math.ceil(orderedIds.length / 2));
  }
  return { day1: orderedIds.slice(0, cut), day2: orderedIds.slice(cut) };
}

/** Keep locked jobs at their original indexes; fill the rest from the optimized list. */
export function mergeLockedVisitOrder(
  originalIds: number[],
  optimizedIds: number[],
  lockedIds: ReadonlySet<number>,
): number[] {
  const lockedAt = new Map<number, number>();
  originalIds.forEach((id, i) => {
    if (lockedIds.has(id)) lockedAt.set(i, id);
  });
  const unlocked = optimizedIds.filter((id) => !lockedIds.has(id));
  const out: number[] = [];
  let u = 0;
  for (let i = 0; i < originalIds.length; i++) {
    const pinned = lockedAt.get(i);
    if (pinned != null) out.push(pinned);
    else if (u < unlocked.length) out.push(unlocked[u++]);
  }
  while (u < unlocked.length) out.push(unlocked[u++]);
  return out;
}

export function nextUnservedJob<T extends { id: number; status: string }>(
  ordered: T[],
): T | null {
  return ordered.find((j) => j.status !== 'served' && j.status !== 'failed' && j.status !== 'skipped' && j.status !== 'archived') ?? null;
}

export function googleMapsNavUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
}

export function hoursUntilDeadline(deadlineIso: string | null | undefined, nowMs: number = Date.now()): number | null {
  if (!deadlineIso) return null;
  const t = Date.parse(deadlineIso);
  if (!Number.isFinite(t)) return null;
  return (t - nowMs) / 3_600_000;
}

export function hasEveningWindow(timeWindow: string | null | undefined, nextWindow?: string | null): boolean {
  const raw = `${timeWindow || ''} ${nextWindow || ''}`.toLowerCase();
  return raw.includes('evening') || raw.includes('17:00') || raw.includes('18:00');
}

export function dwellTypeShort(type: 'individual' | 'apartment' | 'business'): string {
  if (type === 'apartment') return 'Apt';
  if (type === 'business') return 'Biz';
  return 'House';
}

export function formatRunBreakdown(b: { drive: number; dwell: number; wait: number; lunch: number }): string {
  const parts = [`${Math.round(b.drive)}m drive`, `${Math.round(b.dwell)}m on-site`];
  if (b.wait >= 1) parts.push(`${Math.round(b.wait)}m window wait`);
  if (b.lunch >= 1) parts.push(`${Math.round(b.lunch)}m lunch`);
  return parts.join(' · ');
}

export function catalogCounts(): { fixes: number; features: number } {
  return { fixes: ROUTE_PLANNER_FIXES.length, features: ROUTE_PLANNER_FEATURES.length };
}
