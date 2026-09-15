// ============================================================
// Dispatcher Command Engine — reference resolution
// ============================================================
// "42" / "0042" / "CFS26-0042" / "selected call" → calls_for_service.id
// "12" / "A12" → units.id. Exact → suffix → prefix → Levenshtein ≤ 2.
// Ambiguity is a first-class result so the route can ask, not guess.

import { query } from '../db';
import { ACTIVE_CALL_WHERE } from '../callStatus';
import type { ResolvedCall, ResolvedRefs, ResolvedUnit } from './compile';
import type { CommandContext } from './types';

export interface ResolveIssue { ref: string; kind: 'call' | 'unit'; problem: 'not_found' | 'ambiguous'; candidates?: string[] }

export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j], cur[j - 1], prev[j - 1]);
    }
    prev = cur;
  }
  return prev[n];
}

const SELECTED_WORDS = /^(this|that|selected|current)\s*(call|one)?$|^it$/i;

export function pickCall(ref: string, calls: ResolvedCall[], selected?: string | null): { hit?: ResolvedCall; candidates: ResolvedCall[] } {
  const raw = ref.trim();
  if (SELECTED_WORDS.test(raw) || /^selected call$/i.test(raw)) {
    const s = selected ? calls.find(c => c.call_number.toUpperCase() === selected.toUpperCase()) : undefined;
    return s ? { hit: s, candidates: [s] } : { candidates: [] };
  }
  const q = raw.toUpperCase().replace(/^(CALL|CFS)\s*#?\s*/, '').replace(/^#/, '');
  const exact = calls.filter(c => c.call_number.toUpperCase() === q);
  if (exact.length === 1) return { hit: exact[0], candidates: exact };
  // Numeric tail: "42" / "0042" mean the call whose LAST segment is 42
  // ("CFS26-0042", not "CFS26-0142"). Strip leading zeros on both sides.
  const qDigits = q.replace(/^0+/, '');
  if (/^\d+$/.test(qDigits)) {
    const tailHits = calls.filter(c => {
      const cn = c.call_number.toUpperCase();
      const tail = cn.split(/[-\s]/).pop() ?? cn;
      return tail.replace(/^0+/, '') === qDigits;
    });
    if (tailHits.length === 1) return { hit: tailHits[0], candidates: tailHits };
    if (tailHits.length > 1) return { candidates: tailHits };
  }
  // Raw suffix ("0042" typed against "CFS26-0042") when the tail rule found nothing.
  const suffix = calls.filter(c => c.call_number.toUpperCase().endsWith(q));
  if (suffix.length === 1) return { hit: suffix[0], candidates: suffix };
  if (suffix.length > 1) return { candidates: suffix };
  const prefix = calls.filter(c => c.call_number.toUpperCase().startsWith(q));
  if (prefix.length === 1) return { hit: prefix[0], candidates: prefix };
  if (prefix.length > 1) return { candidates: prefix };
  const fuzzy = calls
    .map(c => ({ c, d: levenshtein(q, c.call_number.toUpperCase()) }))
    .filter(x => x.d <= 2)
    .sort((a, b) => a.d - b.d);
  if (fuzzy.length && (fuzzy.length === 1 || fuzzy[0].d < fuzzy[1].d)) return { hit: fuzzy[0].c, candidates: [fuzzy[0].c] };
  return { candidates: fuzzy.map(f => f.c) };
}

export function pickUnit(ref: string, units: ResolvedUnit[]): { hit?: ResolvedUnit; candidates: ResolvedUnit[] } {
  const q = ref.trim().toUpperCase().replace(/^UNIT\s+/, '').replace(/[\s-]/g, '');
  const norm = (s: string) => s.toUpperCase().replace(/[\s-]/g, '');
  const exact = units.filter(u => norm(u.call_sign) === q);
  if (exact.length === 1) return { hit: exact[0], candidates: exact };
  // "12" should match "A12" / "UNIT-12" / "12A"? Prefer suffix, then prefix.
  const suffix = units.filter(u => norm(u.call_sign).endsWith(q));
  if (suffix.length === 1) return { hit: suffix[0], candidates: suffix };
  const prefix = units.filter(u => norm(u.call_sign).startsWith(q));
  if (prefix.length === 1) return { hit: prefix[0], candidates: prefix };
  if (suffix.length > 1) return { candidates: suffix };
  if (prefix.length > 1) return { candidates: prefix };
  const fuzzy = units
    .map(u => ({ u, d: levenshtein(q, norm(u.call_sign)) }))
    .filter(x => x.d <= 1)
    .sort((a, b) => a.d - b.d);
  if (fuzzy.length === 1) return { hit: fuzzy[0].u, candidates: [fuzzy[0].u] };
  return { candidates: fuzzy.map(f => f.u) };
}

/** Recent + active calls the dispatcher could plausibly mean. */
export async function loadCandidateCalls(db: D1Database): Promise<ResolvedCall[]> {
  return query<ResolvedCall>(
    db,
    // Active board + anything closed in the last 3 days (a dispatcher may
    // still say "reopen 42" or "redispatch 42"). Archived rows are never
    // candidates. Uses the canonical predicate — see callStatus.ts.
    `SELECT id, call_number, status FROM calls_for_service
     WHERE COALESCE(status,'') != 'archived'
       AND (${ACTIVE_CALL_WHERE} OR created_at >= datetime('now','-3 days'))
     ORDER BY created_at DESC LIMIT 400`,
  ).catch(() => []);
}

export async function loadCandidateUnits(db: D1Database): Promise<ResolvedUnit[]> {
  return query<ResolvedUnit>(db, `SELECT id, call_sign, status FROM units WHERE call_sign IS NOT NULL ORDER BY call_sign`).catch(() => []);
}

export async function resolveRefs(
  db: D1Database,
  callRefs: string[],
  unitRefs: string[],
  ctx: Pick<CommandContext, 'selectedCallNumber'>,
): Promise<{ refs: ResolvedRefs; issues: ResolveIssue[] }> {
  const refs: ResolvedRefs = { calls: {}, units: {} };
  const issues: ResolveIssue[] = [];
  if (callRefs.length) {
    const calls = await loadCandidateCalls(db);
    for (const r of callRefs) {
      const { hit, candidates } = pickCall(r, calls, ctx.selectedCallNumber);
      if (hit) refs.calls[r] = hit;
      else issues.push({ ref: r, kind: 'call', problem: candidates.length ? 'ambiguous' : 'not_found', candidates: candidates.slice(0, 5).map(c => c.call_number) });
    }
  }
  if (unitRefs.length) {
    const units = await loadCandidateUnits(db);
    for (const r of unitRefs) {
      const { hit, candidates } = pickUnit(r, units);
      if (hit) { refs.units[r] = hit; refs.units[r.toUpperCase()] = hit; }
      else issues.push({ ref: r, kind: 'unit', problem: candidates.length ? 'ambiguous' : 'not_found', candidates: candidates.slice(0, 5).map(u => u.call_sign) });
    }
  }
  return { refs, issues };
}

export function describeIssue(i: ResolveIssue): string {
  if (i.problem === 'ambiguous') return `Which ${i.kind} did you mean for "${i.ref}": ${i.candidates?.join(', ')}?`;
  return `No ${i.kind} matches "${i.ref}".`;
}
