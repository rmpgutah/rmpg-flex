// Pure helpers for the Daily Activity Report (DAR) subsystem. Dependency-free so
// they unit-test under vitest; the route (src/routes/dar.ts) wires them to D1.
//
// The "surpass TrackTik" idea: a DAR auto-compiles from activity RMPG already
// captures (incidents, citations, patrol scans, CAD calls) instead of making the
// guard manually log every line.

export interface AutoPopulate {
  calls: unknown[];
  incidents: unknown[];
  citations: unknown[];
  patrols: unknown[];
  total_miles?: number | null;
}

/** DAR number — YY-DAR-NNNNN. */
export function darNumber(year: string, seq: number): string {
  return `${year}-DAR-${String(seq).padStart(5, '0')}`;
}

/** Next sequence from the current MAX(dar_number). */
export function nextDarSeq(maxDarNumber: string | null | undefined): number {
  if (!maxDarNumber) return 1;
  const n = parseInt(String(maxDarNumber).split('-DAR-')[1] || '0', 10);
  return Number.isFinite(n) ? n + 1 : 1;
}

/** Tolerantly coerce a value (JSON string or array) to an array. */
export function parseArr(s: unknown): unknown[] {
  if (Array.isArray(s)) return s;
  if (typeof s === 'string') {
    try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
  }
  return [];
}

/** One-line, correctly-pluralized activity summary for a DAR. */
export function summarizeDar(a: AutoPopulate): string {
  const parts: string[] = [];
  const add = (arr: unknown[], one: string, many: string) => {
    if (arr && Array.isArray(arr) && arr.length) parts.push(`${arr.length} ${arr.length === 1 ? one : many}`);
  };
  add(a.calls, 'call', 'calls');
  add(a.incidents, 'incident', 'incidents');
  add(a.citations, 'citation', 'citations');
  add(a.patrols, 'patrol scan', 'patrol scans');
  if (a.total_miles != null && a.total_miles > 0) {
    parts.push(`${a.total_miles.toFixed(1)} shift miles`);
  }
  return parts.length ? parts.join(' · ') : 'No logged activity';
}
