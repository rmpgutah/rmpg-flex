import type { D1Database } from '@cloudflare/workers-types';
import { query } from './db';

const isReal = (v: unknown) => v != null && String(v).trim() !== '';

export async function personFlagsForIds(db: D1Database, ids: number[]): Promise<{
  flags: Map<number, string[]>; canon: Map<number, number>; pending: Map<number, number>;
}> {
  const flags = new Map<number, string[]>(), canon = new Map<number, number>(), pending = new Map<number, number>();
  if (!ids.length) return { flags, canon, pending };
  const ph = ids.map(() => '?').join(',');
  try {
    for (const w of await query<any>(db,
      `SELECT COALESCE(subject_person_id, person_id) AS pid FROM warrants
        WHERE LOWER(COALESCE(status,'')) IN ('active','outstanding') AND COALESCE(subject_person_id, person_id) IN (${ph})`, ...ids))
      flags.set(w.pid, [...(flags.get(w.pid) || []), 'ACTIVE WARRANT']);
  } catch (e: any) { console.error('[queryflags] warrants:', e?.message); }
  try {
    for (const p of await query<any>(db, `SELECT id, flags FROM persons WHERE id IN (${ph})`, ...ids)) {
      const f = isReal(p.flags) ? String(p.flags).toLowerCase() : '';
      if (f.includes('officer safety') || f.includes('violent')) flags.set(p.id, [...(flags.get(p.id) || []), 'OFFICER SAFETY']);
      if (f.includes('gang')) flags.set(p.id, [...(flags.get(p.id) || []), 'GANG']);
    }
  } catch (e: any) { console.error('[queryflags] persons:', e?.message); }
  try {
    for (const r of await query<any>(db, `SELECT person_id, canonical_person_id FROM person_canonical WHERE person_id IN (${ph})`, ...ids))
      canon.set(r.person_id, r.canonical_person_id);
    for (const r of await query<any>(db,
      `SELECT person_a AS pid, COUNT(*) AS n FROM entity_resolution_suggestions WHERE status='pending' AND person_a IN (${ph}) GROUP BY person_a`, ...ids))
      pending.set(r.pid, r.n);
    for (const r of await query<any>(db,
      `SELECT person_b AS pid, COUNT(*) AS n FROM entity_resolution_suggestions WHERE status='pending' AND person_b IN (${ph}) GROUP BY person_b`, ...ids))
      pending.set(r.pid, (pending.get(r.pid) || 0) + r.n);
  } catch (e: any) { console.error('[queryflags] cluster:', e?.message); }
  return { flags, canon, pending };
}
