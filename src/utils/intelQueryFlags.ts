import { log } from './logger';
import type { D1Database } from '@cloudflare/workers-types';
import { queryInChunks } from './db';

const isReal = (v: unknown) => v != null && String(v).trim() !== '';

/**
 * Per-person intel flags for a batch of person ids.
 *
 * ⚠️ Every query here is chunked via `queryInChunks` because D1 rejects any
 * statement carrying more than 100 bound parameters. This module had the worst
 * failure mode of the bound-parameter bugs in the codebase: each block catches
 * and logs its own error, so a batch of 100+ persons did NOT 500 — it returned
 * EMPTY FLAGS. ACTIVE WARRANT and OFFICER SAFETY badges silently vanished from
 * large result sets, with nothing on screen to say so. A visible 500 would have
 * been the safer failure.
 */
export async function personFlagsForIds(db: D1Database, ids: number[]): Promise<{
  flags: Map<number, string[]>; canon: Map<number, number>; pending: Map<number, number>;
}> {
  const flags = new Map<number, string[]>(), canon = new Map<number, number>(), pending = new Map<number, number>();
  if (!ids.length) return { flags, canon, pending };
  // Dedupe before chunking. A duplicated id would otherwise be able to land in
  // two different chunks and double-count the `pending` totals below — the
  // single-query version was immune to that, so chunking must not introduce it.
  const uniqueIds = Array.from(new Set(ids));
  const addFlag = (pid: number, label: string) => flags.set(pid, [...(flags.get(pid) || []), label]);
  const addPending = (pid: number, n: number) => pending.set(pid, (pending.get(pid) || 0) + n);

  try {
    for (const w of await queryInChunks<any>(db, uniqueIds, (ph) =>
      `SELECT subject_person_id AS pid FROM warrants
        WHERE LOWER(COALESCE(status,'')) IN ('active','outstanding') AND subject_person_id IN (${ph})`))
      addFlag(w.pid, 'ACTIVE WARRANT');
  } catch (e: any) { log.error('[intel-query-flags] warrants', { error: e?.message }); }

  try {
    for (const p of await queryInChunks<any>(db, uniqueIds, (ph) =>
      `SELECT id, flags FROM persons WHERE id IN (${ph})`)) {
      const f = isReal(p.flags) ? String(p.flags).toLowerCase() : '';
      if (f.includes('officer safety') || f.includes('violent')) addFlag(p.id, 'OFFICER SAFETY');
      if (f.includes('gang')) addFlag(p.id, 'GANG');
    }
  } catch (e: any) { log.error('[intel-query-flags] persons', { error: e?.message }); }

  try {
    for (const r of await queryInChunks<any>(db, uniqueIds, (ph) =>
      `SELECT person_id, canonical_person_id FROM person_canonical WHERE person_id IN (${ph})`))
      canon.set(r.person_id, r.canonical_person_id);
    // person_a and person_b stay two separate queries and are SUMMED per person.
    // A chunked GROUP BY still aggregates correctly within each chunk, and
    // because ids are deduped no pid can appear in more than one chunk, so the
    // accumulate below merges across chunks without double-counting.
    for (const r of await queryInChunks<any>(db, uniqueIds, (ph) =>
      `SELECT person_a AS pid, COUNT(*) AS n FROM entity_resolution_suggestions WHERE status='pending' AND person_a IN (${ph}) GROUP BY person_a`))
      addPending(r.pid, r.n);
    for (const r of await queryInChunks<any>(db, uniqueIds, (ph) =>
      `SELECT person_b AS pid, COUNT(*) AS n FROM entity_resolution_suggestions WHERE status='pending' AND person_b IN (${ph}) GROUP BY person_b`))
      addPending(r.pid, r.n);
  } catch (e: any) { log.error('[intel-query-flags] cluster', { error: e?.message }); }

  return { flags, canon, pending };
}
