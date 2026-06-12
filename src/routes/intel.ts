// ============================================================
// RMPG Flex — Intel Search + Entity Resolution API
// ============================================================
// Federated ranked search over intel_index (FTS5) with identifier
// sniffing and a LIKE fallback that keeps search alive if the index
// table never reached live D1. Supervisor-gated person-resolution
// confirm/reject writes a reversible person_canonical pointer — rows
// are never physically merged.
// Spec: docs/superpowers/specs/2026-06-11-intel-search-entity-resolution-design.md
// ============================================================

import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { sniffIdentifiers, toFtsQuery, isRealValue } from '../utils/intelMatch';
import { rebuildIntelIndex, computeResolutionSuggestions, INTEL_TYPES } from '../utils/intelIndexer';

const intel = new Hono<Env>();

// Mirrors the connections.ts gate: everyone operational; client_viewer /
// contract_manager / human_resources intentionally excluded.
const operational = requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher');
const supervisorPlus = requireRole('admin', 'manager', 'supervisor');

interface IntelHit {
  type: string; id: number; label: string; snippet: string;
  flags: string[]; score: number;
  cluster?: { canonical_person_id: number | null; pending_suggestions: number };
}

async function personFlags(db: D1Database, ids: number[]): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  if (!ids.length) return out;
  const ph = ids.map(() => '?').join(',');
  try {
    for (const w of await query<any>(db,
      `SELECT COALESCE(subject_person_id, person_id) AS pid FROM warrants
       WHERE status IN ('active','outstanding') AND COALESCE(subject_person_id, person_id) IN (${ph})`, ...ids))
      out.set(w.pid, [...(out.get(w.pid) || []), 'ACTIVE WARRANT']);
  } catch (err: any) { console.error('[intel] warrant flags failed:', err?.message); }
  try {
    for (const p of await query<any>(db, `SELECT id, flags FROM persons WHERE id IN (${ph})`, ...ids)) {
      const f = isRealValue(p.flags) ? String(p.flags).toLowerCase() : '';
      if (f.includes('officer safety') || f.includes('violent')) out.set(p.id, [...(out.get(p.id) || []), 'OFFICER SAFETY']);
      if (f.includes('gang')) out.set(p.id, [...(out.get(p.id) || []), 'GANG']);
    }
  } catch (err: any) { console.error('[intel] person flags failed:', err?.message); }
  return out;
}

// GET /search?q=&types=person,vehicle&limit=40
intel.get('/search', operational, async (c) => {
  const q = (c.req.query('q') || '').trim();
  if (q.length < 2) return c.json({ query: q, results: [] });
  const db = getDb(c.env);
  const typeFilter = (c.req.query('types') || '').split(',').filter((t) => (INTEL_TYPES as readonly string[]).includes(t));
  const limit = Math.min(parseInt(c.req.query('limit') || '40', 10) || 40, 100);
  const hits = new Map<string, IntelHit>(); // "type:id" → best hit

  // 1) Identifier exact hits (highest rank)
  for (const ident of sniffIdentifiers(q)) {
    try {
      for (const r of await query<any>(db,
        `SELECT entity_type, entity_id, label, identifiers FROM intel_index
         WHERE identifiers LIKE ? LIMIT 20`, `%${ident.value}%`)) {
        hits.set(`${r.entity_type}:${r.entity_id}`, {
          type: r.entity_type, id: Number(r.entity_id), label: r.label,
          snippet: r.identifiers, flags: [], score: 100,
        });
      }
    } catch (err: any) { console.error('[intel] identifier search failed:', err?.message); }
  }

  // 2) FTS bm25 ranking
  const fts = toFtsQuery(q);
  if (fts) {
    try {
      for (const r of await query<any>(db,
        `SELECT entity_type, entity_id, label,
                snippet(intel_index, 3, '[', ']', '…', 12) AS snip,
                bm25(intel_index) AS rank
         FROM intel_index WHERE intel_index MATCH ? ORDER BY rank LIMIT ?`, fts, limit)) {
        const key = `${r.entity_type}:${r.entity_id}`;
        if (!hits.has(key)) hits.set(key, {
          type: r.entity_type, id: Number(r.entity_id), label: r.label,
          snippet: r.snip || '', flags: [], score: 50 - Number(r.rank),
        });
      }
    } catch (err: any) {
      console.error('[intel] FTS failed, falling back to LIKE:', err?.message);
      // 3) LIKE fallback — degraded but alive if intel_index is missing on live.
      const term = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
      try {
        for (const p of await query<any>(db,
          `SELECT id, first_name, last_name FROM persons
           WHERE (first_name || ' ' || last_name) LIKE ? ESCAPE '\\' LIMIT 10`, term))
          hits.set(`person:${p.id}`, { type: 'person', id: p.id, label: `${p.first_name} ${p.last_name}`, snippet: '', flags: [], score: 10 });
      } catch (e: any) { console.error('[intel] LIKE fallback failed:', e?.message); }
    }
  }

  let results = [...hits.values()];
  if (typeFilter.length) results = results.filter((r) => typeFilter.includes(r.type));
  results.sort((a, b) => b.score - a.score);
  results = results.slice(0, limit);

  // Person enrichment: hot flags + resolution cluster info
  const personIds = results.filter((r) => r.type === 'person').map((r) => r.id);
  if (personIds.length) {
    const flags = await personFlags(db, personIds);
    const ph = personIds.map(() => '?').join(',');
    const canon = new Map<number, number>();
    const pending = new Map<number, number>();
    try {
      for (const r of await query<any>(db,
        `SELECT person_id, canonical_person_id FROM person_canonical WHERE person_id IN (${ph})`, ...personIds))
        canon.set(r.person_id, r.canonical_person_id);
      for (const r of await query<any>(db,
        `SELECT person_a AS pid, COUNT(*) AS n FROM entity_resolution_suggestions
         WHERE status = 'pending' AND person_a IN (${ph}) GROUP BY person_a`, ...personIds))
        pending.set(r.pid, r.n);
      for (const r of await query<any>(db,
        `SELECT person_b AS pid, COUNT(*) AS n FROM entity_resolution_suggestions
         WHERE status = 'pending' AND person_b IN (${ph}) GROUP BY person_b`, ...personIds))
        pending.set(r.pid, (pending.get(r.pid) || 0) + r.n);
    } catch (err: any) { console.error('[intel] cluster enrich failed:', err?.message); }
    for (const r of results) {
      if (r.type !== 'person') continue;
      r.flags = flags.get(r.id) || [];
      r.cluster = { canonical_person_id: canon.get(r.id) ?? null, pending_suggestions: pending.get(r.id) || 0 };
    }
  }

  return c.json({ query: q, results });
});

// GET /health — index freshness for diagnosis (migration-drift detector)
intel.get('/health', operational, async (c) => {
  const db = getDb(c.env);
  try {
    return c.json({ index: await query<any>(db, 'SELECT * FROM intel_index_state ORDER BY entity_type') });
  } catch (err: any) {
    return c.json({ index: [], error: err?.message, hint: 'migration 0098 may not have reached live D1' });
  }
});

// POST /reindex — full rebuild (admin only)
intel.post('/reindex', requireRole('admin'), async (c) => {
  const db = getDb(c.env);
  const counts = await rebuildIntelIndex(db);
  const suggestions = await computeResolutionSuggestions(db);
  return c.json({ success: true, counts, suggestions });
});

// ─── Resolution ──────────────────────────────────────────────

intel.get('/resolution/suggestions', supervisorPlus, async (c) => {
  const db = getDb(c.env);
  const status = c.req.query('status') || 'pending';
  const rows = await query<any>(db,
    `SELECT s.*, pa.first_name AS a_first, pa.last_name AS a_last, pa.dob AS a_dob,
            pb.first_name AS b_first, pb.last_name AS b_last, pb.dob AS b_dob
     FROM entity_resolution_suggestions s
     JOIN persons pa ON pa.id = s.person_a
     JOIN persons pb ON pb.id = s.person_b
     WHERE s.status = ? ORDER BY s.score DESC LIMIT 100`, status);
  return c.json(rows);
});

intel.post('/resolution/suggestions/:id/confirm', supervisorPlus, async (c) => {
  const db = getDb(c.env);
  const id = Number(c.req.param('id'));
  const userId = c.get('userId') as number;
  const body = await c.req.json().catch(() => ({} as any));
  const s = await queryFirst<any>(db, 'SELECT * FROM entity_resolution_suggestions WHERE id = ?', id);
  if (!s) return c.json({ error: 'Suggestion not found' }, 404);
  const canonical = Number(body?.canonical_person_id) === s.person_b ? s.person_b : s.person_a;
  const alias = canonical === s.person_a ? s.person_b : s.person_a;
  await execute(db,
    'INSERT OR REPLACE INTO person_canonical (person_id, canonical_person_id, confirmed_by) VALUES (?, ?, ?)',
    alias, canonical, userId);
  await execute(db,
    `UPDATE entity_resolution_suggestions SET status = 'confirmed', decided_by = ?, decided_at = datetime('now') WHERE id = ?`,
    userId, id);
  return c.json({ success: true, canonical_person_id: canonical, alias_person_id: alias });
});

intel.post('/resolution/suggestions/:id/reject', supervisorPlus, async (c) => {
  const db = getDb(c.env);
  const id = Number(c.req.param('id'));
  const userId = c.get('userId') as number;
  const r = await execute(db,
    `UPDATE entity_resolution_suggestions SET status = 'rejected', decided_by = ?, decided_at = datetime('now') WHERE id = ?`,
    userId, id);
  return r.meta?.changes ? c.json({ success: true }) : c.json({ error: 'Suggestion not found' }, 404);
});

intel.delete('/resolution/canonical/:personId', supervisorPlus, async (c) => {
  const db = getDb(c.env);
  await execute(db, 'DELETE FROM person_canonical WHERE person_id = ?', Number(c.req.param('personId')));
  return c.json({ success: true });
});

export default intel;
