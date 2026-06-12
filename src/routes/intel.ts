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
import { mergeTimeline, rankAssociates, type TimelineEvent, type CoOccurrence } from '../utils/intelDossier';

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

// ─── Watchlist ───────────────────────────────────────────────
// Watch a person/vehicle; the per-minute cron sweep (intelWatchlist.ts)
// drops a HIGH-priority notification in the watcher's inbox when new
// activity (calls, FIs, citations) links to the watched entity.

const WATCHABLE = ['person', 'vehicle'];

intel.get('/watchlist', operational, async (c) => {
  const db = getDb(c.env);
  const userId = c.get('userId') as number;
  try {
    return c.json(await query<any>(db,
      `SELECT * FROM intel_watchlist WHERE active = 1 AND added_by = ? ORDER BY created_at DESC LIMIT 200`, userId));
  } catch (err: any) {
    return c.json({ error: err?.message, hint: 'migration 0099 may not have reached live D1' }, 500);
  }
});

intel.post('/watchlist', operational, async (c) => {
  const db = getDb(c.env);
  const userId = c.get('userId') as number;
  const body = await c.req.json().catch(() => ({} as any));
  const entityType = String(body?.entity_type || '');
  const entityId = Number(body?.entity_id);
  if (!WATCHABLE.includes(entityType) || !Number.isFinite(entityId)) {
    return c.json({ error: 'entity_type (person|vehicle) and entity_id required' }, 400);
  }
  // Reactivate an existing watch instead of violating the UNIQUE key.
  await execute(db,
    `INSERT INTO intel_watchlist (entity_type, entity_id, reason, added_by, active, last_alert_at)
     VALUES (?, ?, ?, ?, 1, datetime('now'))
     ON CONFLICT(entity_type, entity_id, added_by) DO UPDATE SET
       active = 1, reason = excluded.reason, last_alert_at = datetime('now')`,
    entityType, entityId, body?.reason || null, userId);
  return c.json({ success: true });
});

intel.delete('/watchlist/:entityType/:entityId', operational, async (c) => {
  const db = getDb(c.env);
  const userId = c.get('userId') as number;
  const role = String((c.get('user') as { role?: string } | undefined)?.role || '');
  const entityType = c.req.param('entityType');
  const entityId = Number(c.req.param('entityId'));
  // Owner removes their own watch; supervisor+ can clear anyone's.
  const supervisor = ['admin', 'manager', 'supervisor'].includes(role);
  await execute(db,
    supervisor
      ? 'UPDATE intel_watchlist SET active = 0 WHERE entity_type = ? AND entity_id = ?'
      : 'UPDATE intel_watchlist SET active = 0 WHERE entity_type = ? AND entity_id = ? AND added_by = ?',
    ...(supervisor ? [entityType, entityId] : [entityType, entityId, userId]));
  return c.json({ success: true });
});

// ─── Person Dossier ──────────────────────────────────────────
// GET /dossier/person/:id — 360° investigative profile. Every section
// is try/catch-isolated: a bad/missing table degrades that section to
// [] but never blanks the dossier (lesson from the records.ts warrant
// Promise.all incident that blanked all person system-history).

intel.get('/dossier/person/:id', operational, async (c) => {
  const db = getDb(c.env);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid person id' }, 400);

  const person = await queryFirst<any>(db, 'SELECT * FROM persons WHERE id = ?', id);
  if (!person) return c.json({ error: 'Person not found' }, 404);

  // Confirmed cluster: aliases pointing at me, me pointing at a canonical,
  // and siblings of that canonical. Events from all members merge into
  // one identity view.
  const clusterIds = new Set<number>([id]);
  const cluster: Array<{ person_id: number; name: string }> = [];
  try {
    const rows = await query<any>(db,
      `SELECT pc.person_id, pc.canonical_person_id FROM person_canonical pc
       WHERE pc.person_id = ? OR pc.canonical_person_id = ?
          OR pc.canonical_person_id = (SELECT canonical_person_id FROM person_canonical WHERE person_id = ?)`,
      id, id, id);
    for (const r of rows) { clusterIds.add(r.person_id); clusterIds.add(r.canonical_person_id); }
    if (clusterIds.size > 1) {
      const others = [...clusterIds].filter((p) => p !== id);
      const ph = others.map(() => '?').join(',');
      for (const p of await query<any>(db, `SELECT id, first_name, last_name FROM persons WHERE id IN (${ph})`, ...others))
        cluster.push({ person_id: p.id, name: `${p.first_name} ${p.last_name}` });
    }
  } catch (err: any) { console.error('[dossier] cluster failed:', err?.message); }
  const ids = [...clusterIds];
  const ph = ids.map(() => '?').join(',');

  // Flags: Phase-1 enrichment + persons columns.
  const flags: string[] = [];
  try {
    const fm = await personFlags(db, ids);
    for (const fs of fm.values()) for (const f of fs) if (!flags.includes(f)) flags.push(f);
  } catch (err: any) { console.error('[dossier] flags failed:', err?.message); }
  if (isRealValue(person.gang_affiliation) && !flags.includes('GANG')) flags.push('GANG');
  if (isRealValue(person.probation_parole)) flags.push('PROBATION/PAROLE');
  if (isRealValue(person.caution_flags)) flags.push('CAUTION');
  try {
    const t = await queryFirst<any>(db,
      `SELECT COUNT(*) AS n FROM trespass_orders WHERE person_id IN (${ph}) AND status = 'active'`, ...ids);
    if (t?.n) flags.push('ACTIVE TRESPASS');
  } catch (err: any) { console.error('[dossier] trespass flag failed:', err?.message); }

  // Timeline sections — each guarded.
  const sources: TimelineEvent[][] = [];
  const section = async (label: string, fn: () => Promise<TimelineEvent[]>) => {
    try { sources.push(await fn()); }
    catch (err: any) { console.error(`[dossier] ${label} failed:`, err?.message); }
  };
  await section('calls', async () =>
    (await query<any>(db,
      `SELECT c.id, c.call_number, c.incident_type, c.status, c.created_at, c.location_address, cp.person_id AS spid
       FROM calls_for_service c JOIN call_persons cp ON c.id = cp.call_id
       WHERE cp.person_id IN (${ph}) ORDER BY c.created_at DESC LIMIT 100`, ...ids))
      .map((r) => ({ kind: 'call', id: r.id, date: r.created_at, title: r.call_number || `CFS-${r.id}`,
        subtitle: [r.incident_type, r.location_address].filter(isRealValue).join(' — '), status: r.status || '', source_person_id: r.spid })));
  await section('incidents', async () =>
    (await query<any>(db,
      `SELECT i.id, i.incident_number, i.incident_type, i.status, i.created_at, i.location_address, ip.person_id AS spid
       FROM incidents i JOIN incident_persons ip ON i.id = ip.incident_id
       WHERE ip.person_id IN (${ph}) ORDER BY i.created_at DESC LIMIT 100`, ...ids))
      .map((r) => ({ kind: 'incident', id: r.id, date: r.created_at, title: r.incident_number || `INC-${r.id}`,
        subtitle: [r.incident_type, r.location_address].filter(isRealValue).join(' — '), status: r.status || '', source_person_id: r.spid })));
  await section('citations', async () =>
    (await query<any>(db,
      `SELECT id, citation_number, violation_description, status, violation_date, person_id AS spid
       FROM citations WHERE person_id IN (${ph}) ORDER BY violation_date DESC LIMIT 100`, ...ids))
      .map((r) => ({ kind: 'citation', id: r.id, date: r.violation_date, title: r.citation_number || `CIT-${r.id}`,
        subtitle: isRealValue(r.violation_description) ? String(r.violation_description) : '', status: r.status || '', source_person_id: r.spid })));
  await section('field_interviews', async () =>
    (await query<any>(db,
      `SELECT id, fi_number, location, contact_reason, status, created_at, person_id AS spid
       FROM field_interviews WHERE person_id IN (${ph}) ORDER BY created_at DESC LIMIT 100`, ...ids))
      .map((r) => ({ kind: 'field_interview', id: r.id, date: r.created_at, title: r.fi_number || `FI-${r.id}`,
        subtitle: [r.contact_reason, r.location].filter(isRealValue).join(' — '), status: r.status || '', source_person_id: r.spid })));
  await section('trespass_orders', async () =>
    (await query<any>(db,
      `SELECT id, order_number, location, status, effective_date, person_id AS spid
       FROM trespass_orders WHERE person_id IN (${ph}) ORDER BY effective_date DESC LIMIT 100`, ...ids))
      .map((r) => ({ kind: 'trespass_order', id: r.id, date: r.effective_date, title: r.order_number || `TO-${r.id}`,
        subtitle: isRealValue(r.location) ? String(r.location) : '', status: r.status || '', source_person_id: r.spid })));
  await section('warrants', async () =>
    (await query<any>(db,
      `SELECT id, warrant_number, charge_description, status, issued_date,
              COALESCE(subject_person_id, person_id) AS spid
       FROM warrants WHERE subject_person_id IN (${ph}) OR person_id IN (${ph})
       ORDER BY issued_date DESC LIMIT 100`, ...ids, ...ids))
      .map((r) => ({ kind: 'warrant', id: r.id, date: r.issued_date, title: r.warrant_number || `W-${r.id}`,
        subtitle: isRealValue(r.charge_description) ? String(r.charge_description) : '', status: r.status || '', source_person_id: r.spid })));
  // arrest_records has NO person FK — best-effort name+DOB match.
  await section('arrests', async () => {
    if (!isRealValue(person.last_name)) return [];
    const rows = await query<any>(db,
      `SELECT id, booking_date, charges, county, status FROM arrest_records
       WHERE (last_name = ? AND first_name = ?) ${isRealValue(person.dob) ? 'AND (date_of_birth = ? OR date_of_birth IS NULL)' : ''}
       ORDER BY booking_date DESC LIMIT 50`,
      ...(isRealValue(person.dob)
        ? [person.last_name, person.first_name, person.dob]
        : [person.last_name, person.first_name]));
    return rows.map((r: any) => ({ kind: 'arrest', id: r.id, date: r.booking_date,
      title: `Booking ${r.county ? `(${r.county})` : ''}`.trim(),
      subtitle: isRealValue(r.charges) ? String(r.charges) : '', status: r.status || '' }));
  });
  const timeline = mergeTimeline(sources);

  // Associates — co-occurrence on the same calls/incidents.
  let associates: ReturnType<typeof rankAssociates> = [];
  try {
    const co: CoOccurrence[] = [];
    for (const r of await query<any>(db,
      `SELECT p.id AS person_id, p.first_name || ' ' || p.last_name AS name
       FROM call_persons cp1 JOIN call_persons cp2 ON cp1.call_id = cp2.call_id AND cp1.person_id != cp2.person_id
       JOIN persons p ON p.id = cp2.person_id WHERE cp1.person_id IN (${ph}) LIMIT 500`, ...ids))
      co.push({ person_id: r.person_id, name: r.name, kind: 'call' });
    for (const r of await query<any>(db,
      `SELECT p.id AS person_id, p.first_name || ' ' || p.last_name AS name
       FROM incident_persons ip1 JOIN incident_persons ip2 ON ip1.incident_id = ip2.incident_id AND ip1.person_id != ip2.person_id
       JOIN persons p ON p.id = ip2.person_id WHERE ip1.person_id IN (${ph}) LIMIT 500`, ...ids))
      co.push({ person_id: r.person_id, name: r.name, kind: 'incident' });
    associates = rankAssociates(co, clusterIds, 15);
  } catch (err: any) { console.error('[dossier] associates failed:', err?.message); }

  // Vehicles owned by any cluster member.
  let vehicles: any[] = [];
  try {
    vehicles = await query<any>(db,
      `SELECT id, plate_number, vin, make, model, year, color FROM vehicles_records
       WHERE owner_person_id IN (${ph}) LIMIT 25`, ...ids);
  } catch (err: any) { console.error('[dossier] vehicles failed:', err?.message); }

  // Addresses: person rows + recent event locations, deduped.
  const addresses: Array<{ address: string; source: string }> = [];
  const seenAddr = new Set<string>();
  const pushAddr = (addr: unknown, source: string) => {
    if (!isRealValue(addr)) return;
    const key = String(addr).toLowerCase().trim();
    if (seenAddr.has(key)) return;
    seenAddr.add(key);
    addresses.push({ address: String(addr), source });
  };
  pushAddr([person.address, person.city].filter(isRealValue).join(', '), 'record');
  try {
    for (const p of await query<any>(db, `SELECT address, city FROM persons WHERE id IN (${ph})`, ...ids))
      pushAddr([p.address, p.city].filter(isRealValue).join(', '), 'linked identity');
  } catch (err: any) { console.error('[dossier] cluster addresses failed:', err?.message); }
  for (const e of timeline) {
    if (addresses.length >= 10) break;
    if ((e.kind === 'call' || e.kind === 'incident') && e.subtitle.includes(' — '))
      pushAddr(e.subtitle.split(' — ').pop(), `${e.kind} ${e.title}`);
  }

  // Watch state for the requesting user (Phase 4).
  let watched = false;
  try {
    const w = await queryFirst<any>(db,
      `SELECT 1 AS x FROM intel_watchlist WHERE entity_type = 'person' AND entity_id = ? AND added_by = ? AND active = 1`,
      id, c.get('userId') as number);
    watched = !!w;
  } catch (err: any) { console.error('[dossier] watch state failed:', err?.message); }

  return c.json({
    person, cluster, flags, timeline, associates, vehicles,
    addresses: addresses.slice(0, 10),
    watched,
  });
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
