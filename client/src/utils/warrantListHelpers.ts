export type PriorityBucket = 'critical' | 'high' | 'medium' | 'low';

/**
 * Bucket a priority score for display.
 *
 * ⚠️ These boundaries are COUPLED to computePriorityScore's base values in
 * src/routes/warrants.ts (felony 60 / misdemeanor 30 / infraction 10 / civil 5,
 * plus up to 60 of modifiers). Changing either side without the other silently
 * decouples the label from the model.
 *
 * `high` is 60, NOT 70, deliberately: the scorer's documented intent is that a
 * felony reads as high priority "before anything else applies", and a felony with
 * no modifiers scores exactly 60. With a 70 boundary that intent was not honored
 * — measured live 2026-07-31, a felony warrant scoring 61 was rendering as
 * `medium`, which understates a felony on an officer's service queue. 60 makes
 * every felony `high` and keeps `critical` (90) for a felony that has genuinely
 * stacked aggravating factors.
 *
 * A maximally stale misdemeanor tops out at 45 (30 + the 15 staleness cap), so it
 * stays `medium` and cannot reach `high` on age alone — severity still sets the
 * band, which is the whole design.
 */
export function priorityBucket(score: number | null | undefined): PriorityBucket {
  if (score == null) return 'low';
  if (score >= 90) return 'critical';
  if (score >= 60) return 'high';
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

// stateFromSource() was DELETED 2026-07-30.
//
// It matched /^([a-z]{2})_/ — underscore-separated, state as a PREFIX — but every
// live source key is hyphenated with the state as a SUFFIX ('ada-county-id',
// 'natrona-county-wy', 'ohio-drc-pval'). It therefore returned '—' for every row,
// which is why the Warrants list SOURCE column was blank in production.
//
// It is NOT reimplemented here. GET /warrants/unified now stamps an authoritative
// `source_state` on every row via src/utils/warrantSourceState.ts (unit-tested
// against the real live keys in tests/warrantSourceState.test.ts). Render
// `row.source_state`; do not re-derive it client-side. A second implementation is
// exactly how this ended up with two different wrong answers.
