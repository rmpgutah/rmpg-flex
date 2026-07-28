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
