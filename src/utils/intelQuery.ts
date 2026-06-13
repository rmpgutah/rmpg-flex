// Parser-driven advanced search. Sibling to /search (which stays untouched for
// GlobalSearch). Builds targeted identifier/name/addr/case lookups + FTS free
// text, enriches person hits with photo_url + flags + cluster, and returns
// facet counts. Each branch is try/catch-isolated. SQL verified vs live D1.
import type { D1Database } from '@cloudflare/workers-types';
import { query } from './db';
import { personFlagsForIds } from './intelQueryFlags';

export interface QueryHit {
  type: string; id: number; label: string; snippet: string;
  flags: string[]; score: number; photo_url?: string | null;
  cluster?: { canonical_person_id: number | null; pending_suggestions: number };
  date?: string | null;
}
export interface Facets { byType: Record<string, number>; byFlag: Record<string, number> }
export interface QueryParams {
  q?: string; type?: string; name?: string; addr?: string; flag?: string;
  plate?: string; vin?: string; dob?: string; phone?: string; dl?: string; case?: string;
  since?: string; until?: string; limit?: number;
}

const esc = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const like = (s: string) => `%${esc(s)}%`;

export async function runIntelQuery(db: D1Database, p: QueryParams): Promise<{ results: QueryHit[]; facets: Facets }> {
  const limit = Math.min(p.limit || 50, 100);
  const hits = new Map<string, QueryHit>();
  const put = (h: QueryHit) => { const k = `${h.type}:${h.id}`; if (!hits.has(k) || hits.get(k)!.score < h.score) hits.set(k, h); };

  if (p.name) {
    try {
      for (const r of await query<any>(db,
        `SELECT id, first_name, last_name, photo_url FROM persons
          WHERE (COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')) LIKE ? ESCAPE '\\' LIMIT ?`,
        like(p.name), limit))
        put({ type: 'person', id: r.id, label: `${r.first_name || ''} ${r.last_name || ''}`.trim(), snippet: '', flags: [], score: 95, photo_url: r.photo_url });
    } catch (e: any) { console.error('[query] name:', e?.message); }
  }
  if (p.addr) {
    try {
      for (const r of await query<any>(db,
        `SELECT id, first_name, last_name, photo_url, address FROM persons
          WHERE COALESCE(address,'') LIKE ? ESCAPE '\\' OR COALESCE(city,'') LIKE ? ESCAPE '\\' LIMIT ?`,
        like(p.addr), like(p.addr), limit))
        put({ type: 'person', id: r.id, label: `${r.first_name || ''} ${r.last_name || ''}`.trim(), snippet: r.address || '', flags: [], score: 80, photo_url: r.photo_url });
    } catch (e: any) { console.error('[query] addr:', e?.message); }
  }
  for (const [col, val, sc] of [['dl_number', p.dl, 92], ['dob', p.dob, 92], ['phone', p.phone, 92]] as const) {
    if (!val) continue;
    try {
      for (const r of await query<any>(db,
        `SELECT id, first_name, last_name, photo_url FROM persons WHERE COALESCE(${col},'') LIKE ? ESCAPE '\\' LIMIT ?`,
        like(String(val)), limit))
        put({ type: 'person', id: r.id, label: `${r.first_name || ''} ${r.last_name || ''}`.trim(), snippet: `${col}: ${val}`, flags: [], score: sc, photo_url: r.photo_url });
    } catch (e: any) { console.error(`[query] ${col}:`, e?.message); }
  }
  for (const [col, val] of [['plate_number', p.plate], ['vin', p.vin]] as const) {
    if (!val) continue;
    try {
      for (const r of await query<any>(db,
        `SELECT id, plate_number, make, model, color, vin FROM vehicles_records WHERE COALESCE(${col},'') LIKE ? ESCAPE '\\' LIMIT ?`,
        like(String(val)), limit))
        put({ type: 'vehicle', id: r.id, label: [r.color, r.make, r.model].filter(Boolean).join(' ') + (r.plate_number ? ` (${r.plate_number})` : ''), snippet: r.vin || '', flags: [], score: 92 });
    } catch (e: any) { console.error(`[query] ${col}:`, e?.message); }
  }
  if (p.case) {
    try {
      for (const r of await query<any>(db,
        `SELECT id, case_number, title, opened_date FROM cases WHERE COALESCE(case_number,'') LIKE ? ESCAPE '\\' LIMIT ?`,
        like(p.case), limit))
        put({ type: 'case', id: r.id, label: r.case_number || r.title || `Case #${r.id}`, snippet: r.title || '', flags: [], score: 92, date: r.opened_date });
    } catch (e: any) { console.error('[query] case:', e?.message); }
  }
  if (p.q && p.q.trim().length >= 2) {
    const term = p.q.trim();
    try {
      for (const r of await query<any>(db,
        `SELECT entity_type, entity_id, label, snippet(intel_index, 3, '[', ']', '…', 12) AS snip, bm25(intel_index) AS rank
           FROM intel_index WHERE intel_index MATCH ? ORDER BY rank LIMIT ?`,
        term.split(/\s+/).map((t) => `"${t.replace(/"/g, '')}"`).join(' '), limit))
        put({ type: r.entity_type, id: Number(r.entity_id), label: r.label, snippet: r.snip || '', flags: [], score: 50 - Number(r.rank) });
    } catch (e: any) {
      console.error('[query] FTS, LIKE fallback:', e?.message);
      try {
        for (const r of await query<any>(db,
          `SELECT id, first_name, last_name, photo_url FROM persons WHERE (COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')) LIKE ? ESCAPE '\\' LIMIT ?`,
          like(term), limit))
          put({ type: 'person', id: r.id, label: `${r.first_name || ''} ${r.last_name || ''}`.trim(), snippet: '', flags: [], score: 20, photo_url: r.photo_url });
      } catch (e2: any) { console.error('[query] LIKE fallback:', e2?.message); }
    }
  }

  let results = [...hits.values()];

  if (p.type) results = results.filter((r) => r.type === p.type);
  // since/until only narrow hits that CARRY a date (currently case hits via
  // opened_date). Undated hits (persons/vehicles/FTS) pass through unfiltered —
  // deliberate partial support given the schema (documented in Phase 2 spec §5;
  // broaden by enriching hits with per-type dates in a later pass).
  if (p.since) results = results.filter((r) => !r.date || r.date >= p.since!);
  if (p.until) results = results.filter((r) => !r.date || r.date <= p.until!);

  const personIds = results.filter((r) => r.type === 'person').map((r) => r.id);
  if (personIds.length) {
    const { flags, canon, pending } = await personFlagsForIds(db, personIds);
    for (const r of results) if (r.type === 'person') {
      r.flags = flags.get(r.id) || [];
      r.cluster = { canonical_person_id: canon.get(r.id) ?? null, pending_suggestions: pending.get(r.id) || 0 };
    }
  }
  if (p.flag) {
    const wanted = p.flag.split(',').map((f) => f.trim().toLowerCase()).filter(Boolean);
    results = results.filter((r) => wanted.every((w) => r.flags.some((f) => f.toLowerCase().includes(w))));
  }

  results.sort((a, b) => b.score - a.score);
  results = results.slice(0, limit);

  const facets: Facets = { byType: {}, byFlag: {} };
  for (const r of results) {
    facets.byType[r.type] = (facets.byType[r.type] || 0) + 1;
    for (const f of r.flags) facets.byFlag[f] = (facets.byFlag[f] || 0) + 1;
  }
  return { results, facets };
}
