export type PriorityBucket = 'critical' | 'high' | 'medium' | 'low';

export function priorityBucket(score: number | null | undefined): PriorityBucket {
  if (score == null) return 'low';
  if (score >= 90) return 'critical';
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

export function priorityChipClass(bucket: PriorityBucket): string {
  return {
    critical: 'bg-red-900/40 text-red-200 border-red-700',
    high:     'bg-amber-900/40 text-amber-200 border-amber-700',
    medium:   'bg-slate-800 text-slate-200 border-slate-600',
    low:      'bg-zinc-800 text-zinc-300 border-zinc-600',
  }[bucket];
}

export function formatAge(days: number | null | undefined): string {
  if (days == null) return '—';
  const d = Math.floor(days);
  if (d < 14) return `${d}d`;
  if (d < 60) return `${Math.floor(d / 7)}w`;
  if (d < 365) return `${Math.floor(d / 30)}mo`;
  return `${Math.floor(d / 365)}y`;
}

export type FreshnessClass = 'fresh' | 'recent' | 'stale' | 'old' | 'manual';

export function freshnessClass(daysSinceScrape: number | null | undefined): FreshnessClass {
  if (daysSinceScrape == null) return 'manual';
  if (daysSinceScrape < 1) return 'fresh';
  if (daysSinceScrape < 7) return 'recent';
  if (daysSinceScrape < 30) return 'stale';
  return 'old';
}

export function freshnessIcon(cls: FreshnessClass): string {
  return { fresh: '🟢', recent: '🟡', stale: '🟠', old: '⚫', manual: '✏️' }[cls];
}

export function stateFromSource(source: string | null | undefined): string {
  if (!source) return '—';
  if (source.startsWith('fed_') || source.startsWith('federal_')) return 'FED';
  const m = source.match(/^([a-z]{2})_/);
  return m ? m[1].toUpperCase() : '—';
}
