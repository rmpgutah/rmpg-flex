/** Spillman CAD color mapping. Returns CSS-variable strings (or 'inherit')
 *  so callers drop the value straight into an inline `color`/`background`. */

const PRIORITIES = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]);

/** Fixed Spillman call-priority color (1 red … 9 purple). */
export function priorityColor(priority: number | string | null | undefined): string {
  const n = typeof priority === 'string' ? parseInt(priority, 10) : priority;
  return typeof n === 'number' && PRIORITIES.has(n) ? `var(--spm-pri-${n})` : 'inherit';
}

const STATUS_TO_TOKEN: Record<string, string> = {
  avail: 'avail', available: 'avail',
  enrt: 'enrt', enroute: 'enrt', 'en route': 'enrt',
  busy: 'busy', oos: 'busy',
  xbsy: 'xbsy',
};

/** Unit-status color for the CAD console (available/en-route/busy/extra-busy).
 *  Unknown or out-of-service-monitor (OMDT) falls back to the row's default. */
export function unitStatusColor(status: string | null | undefined): string {
  if (!status) return 'inherit';
  const token = STATUS_TO_TOKEN[status.trim().toLowerCase()];
  return token ? `var(--spm-stat-${token})` : 'inherit';
}
