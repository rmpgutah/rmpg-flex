// Relative time formatter

const DIVISIONS: Array<{ amount: number; name: Intl.RelativeTimeFormatUnit }> = [
  { amount: 60, name: 'seconds' },
  { amount: 60, name: 'minutes' },
  { amount: 24, name: 'hours' },
  { amount: 7, name: 'days' },
  { amount: 4.34524, name: 'weeks' },
  { amount: 12, name: 'months' },
  { amount: Number.POSITIVE_INFINITY, name: 'years' },
];

const formatter =
  typeof Intl !== 'undefined'
    ? new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
    : null;

/** Format a date as relative time ("5 minutes ago", "in 3 days") */
export function relativeTime(date: Date | string | number): string {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return 'Invalid date';

  if (!formatter) {
    // Fallback for environments without Intl.RelativeTimeFormat
    const seconds = Math.round((d.getTime() - Date.now()) / 1000);
    const abs = Math.abs(seconds);
    if (abs < 60) return seconds < 0 ? 'just now' : 'in a moment';
    if (abs < 3600)
      return `${Math.round(abs / 60)} min ${seconds < 0 ? 'ago' : 'from now'}`;
    if (abs < 86400)
      return `${Math.round(abs / 3600)} hr ${seconds < 0 ? 'ago' : 'from now'}`;
    return `${Math.round(abs / 86400)} days ${seconds < 0 ? 'ago' : 'from now'}`;
  }

  let duration = (d.getTime() - Date.now()) / 1000;

  for (const division of DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return formatter.format(Math.round(duration), division.name);
    }
    duration /= division.amount;
  }

  return d.toLocaleDateString();
}

/** Format a timestamp as "X ago" or absolute date if too old */
export function timeAgo(date: Date | string | number, maxDays = 30): string {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return 'Unknown';

  const diffMs = Date.now() - d.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffDays > maxDays) {
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  return relativeTime(d);
}
