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
import { getDb, query, queryFirst, execute, queryInChunks } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { sniffIdentifiers, toFtsQuery, isRealValue } from '../utils/intelMatch';
import { containsClause, containsAnyClause, cappedLikePattern } from '../utils/searchText';
import { rebuildIntelIndex, computeResolutionSuggestions, INTEL_TYPES } from '../utils/intelIndexer';
import { mergeTimeline, rankAssociates, screeningHitsToTimeline, type TimelineEvent, type CoOccurrence } from '../utils/intelDossier';
import { screenPerson, screenVehicle } from '../utils/intelScreen';
import { runExtraction } from '../utils/intelExtract';
import { computeEscalation, personActivityEvents } from '../utils/intelPatterns';
import { runIntelQuery } from '../utils/intelQuery';
import { parseRosterText, ingestBookings } from '../utils/jailIngest';
import { runJailScan } from '../utils/jailSources/runScan';
import { chunkKey, parseSeq } from '../utils/intelRecording';
import { putEncrypted, getDecrypted } from '../utils/encryptedR2';
import { intelReports, intelSources } from './intel/development';
import { buildOverview } from '../utils/intelOverview';
import { daysCutoffISO, finiteCoord, geoFeature, type GeoFeature } from '../utils/intelGeo';
import { geocodeAddress } from './geocode';

import { log } from '../utils/logger';
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

// ⚠️ Both blocks below MUST use queryInChunks. This is the officer-safety
// variant of the D1 100-bound-parameter cap, and it is the SILENT one:
// D1 rejects a >100-parameter query at bind time, the per-block try/catch here
// swallows that into a console line, and the function returns an EMPTY flag map.
// The caller cannot tell "no flags" from "could not read flags", so
// ACTIVE WARRANT / OFFICER SAFETY / GANG badges simply disappear from any
// result set holding more than 100 persons — no error on screen, nothing in
// error_log. CLAUDE.md documents the identical defect in intelQueryFlags.ts;
// this was its unfixed twin. Do not reintroduce a hand-rolled IN-list here.
async function personFlags(db: D1Database, ids: number[]): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  if (!ids.length) return out;
  try {
    for (const w of await queryInChunks<any>(db, ids,
      (ph) => `SELECT subject_person_id AS pid FROM warrants
       WHERE status IN ('active','outstanding') AND subject_person_id IN (${ph})`))
      out.set(w.pid, [...(out.get(w.pid) || []), 'ACTIVE WARRANT']);
  } catch (err) { log.warn('intel warrant flags failed', { error: err instanceof Error ? err.message : String(err) }); }
  try {
    for (const p of await queryInChunks<any>(db, ids, (ph) => `SELECT id, flags FROM persons WHERE id IN (${ph})`)) {
      const f = isRealValue(p.flags) ? String(p.flags).toLowerCase() : '';
      if (f.includes('officer safety') || f.includes('violent')) out.set(p.id, [...(out.get(p.id) || []), 'OFFICER SAFETY']);
      if (f.includes('gang')) out.set(p.id, [...(out.get(p.id) || []), 'GANG']);
    }
  } catch (err) { log.warn('intel person flags failed', { error: err instanceof Error ? err.message : String(err) }); }
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
    } catch (err) { log.warn('intel identifier search failed', { error: err instanceof Error ? err.message : String(err) }); }
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
    } catch (err) {
      log.warn('intel FTS failed, falling back to LIKE', { error: err instanceof Error ? err.message : String(err) });
      // 3) LIKE fallback — degraded but alive if intel_index is missing on live.
      // D1 LIKE cap: pattern >50 chars fails — cappedLikePattern escapes and
      // truncates so '%' + escaped + '%' stays <=50.
      const term = cappedLikePattern(q);
      try {
        for (const p of await query<any>(db,
          `SELECT id, first_name, last_name FROM persons
           WHERE (first_name || ' ' || last_name) LIKE ? ESCAPE '\' LIMIT 10`, term))
          hits.set(`person:${p.id}`, { type: 'person', id: p.id, label: `${p.first_name} ${p.last_name}`, snippet: '', flags: [], score: 10 });
      } catch (e) { log.warn('intel LIKE fallback failed', { error: e instanceof Error ? e.message : String(e) }); }
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
    const canon = new Map<number, number>();
    const pending = new Map<number, number>();
    try {
      for (const r of await queryInChunks<any>(db, personIds,
        (ph) => `SELECT person_id, canonical_person_id FROM person_canonical WHERE person_id IN (${ph})`))
        canon.set(r.person_id, r.canonical_person_id);
      for (const r of await queryInChunks<any>(db, personIds,
        (ph) => `SELECT person_a AS pid, COUNT(*) AS n FROM entity_resolution_suggestions
                 WHERE status = 'pending' AND person_a IN (${ph}) GROUP BY person_a`))
        pending.set(r.pid, (pending.get(r.pid) || 0) + r.n);
      for (const r of await queryInChunks<any>(db, personIds,
        (ph) => `SELECT person_b AS pid, COUNT(*) AS n FROM entity_resolution_suggestions
                 WHERE status = 'pending' AND person_b IN (${ph}) GROUP BY person_b`))
        pending.set(r.pid, (pending.get(r.pid) || 0) + r.n);
    } catch (err) { log.warn('intel cluster enrich failed', { error: err instanceof Error ? err.message : String(err) }); }
    for (const r of results) {
      if (r.type !== 'person') continue;
      r.flags = flags.get(r.id) || [];
      r.cluster = { canonical_person_id: canon.get(r.id) ?? null, pending_suggestions: pending.get(r.id) || 0 };
    }
  }

  return c.json({ query: q, results });
});

// GET /query — parser-driven advanced search (rich hits + facets). Sibling to
// /search, which stays as-is for GlobalSearch.
intel.get('/query', operational, async (c) => {
  const p = {
    q: c.req.query('q'), type: c.req.query('type'), name: c.req.query('name'), addr: c.req.query('addr'),
    flag: c.req.query('flag'), plate: c.req.query('plate'), vin: c.req.query('vin'), dob: c.req.query('dob'),
    phone: c.req.query('phone'), dl: c.req.query('dl'), case: c.req.query('case'),
    since: c.req.query('since'), until: c.req.query('until'),
    limit: parseInt(c.req.query('limit') || '50', 10) || 50,
  };
  // Best-effort history record (never blocks the response).
  try {
    const userId = (c.get('userId') as number | undefined) ?? null;
    const raw = c.req.query('raw') || '';
    if (userId && raw.trim()) await c.env.DB.prepare(
      'INSERT INTO intel_search_history (user_id, query_text) VALUES (?, ?)').bind(userId, raw.slice(0, 500)).run();
  } catch { /* history table may be briefly absent; ignore */ }
  return c.json(await runIntelQuery(getDb(c.env), p));
});

// Saved searches (per user).
intel.get('/saved-searches', operational, async (c) => {
  const uid = (c.get('userId') as number | undefined) ?? null;
  try {
    return c.json(await query(getDb(c.env),
      'SELECT id, name, query_text, created_at FROM intel_saved_searches WHERE user_id = ? ORDER BY created_at DESC', uid));
  } catch (err) {
    log.error('intel GET /saved-searches failed', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json([]);
  }
});
intel.post('/saved-searches', operational, async (c) => {
  const uid = (c.get('userId') as number | undefined) ?? null;
  const body = await c.req.json<{ name?: string; query_text?: string }>().catch(() => ({} as { name?: string; query_text?: string }));
  if (!body.name || !body.query_text) return c.json({ error: 'name and query_text required' }, 400);
  await execute(getDb(c.env),
    `INSERT INTO intel_saved_searches (user_id, name, query_text) VALUES (?, ?, ?)
       ON CONFLICT(user_id, name) DO UPDATE SET query_text = excluded.query_text`,
    uid, body.name.slice(0, 80), body.query_text.slice(0, 500));
  return c.json({ success: true });
});
intel.delete('/saved-searches/:id', operational, async (c) => {
  const uid = (c.get('userId') as number | undefined) ?? null;
  await execute(getDb(c.env), 'DELETE FROM intel_saved_searches WHERE id = ? AND user_id = ?', c.req.param('id'), uid);
  return c.json({ success: true });
});
// Recent history (distinct, latest 10).
intel.get('/search-history', operational, async (c) => {
  const uid = (c.get('userId') as number | undefined) ?? null;
  try {
    return c.json(await query(getDb(c.env),
      `SELECT query_text, MAX(executed_at) AS executed_at FROM intel_search_history
        WHERE user_id = ? GROUP BY query_text ORDER BY executed_at DESC LIMIT 10`, uid));
  } catch (err) {
    log.error('intel GET /search-history failed', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json([]);
  }
});

// GET /health — index freshness for diagnosis (migration-drift detector)
intel.get('/health', operational, async (c) => {
  const db = getDb(c.env);
  try {
    return c.json({ index: await query<any>(db, 'SELECT * FROM intel_index_state ORDER BY entity_type') });
  } catch (err) {
    return c.json({ index: [], error: err instanceof Error ? err.message : String(err), hint: 'migration 0098 may not have reached live D1' });
  }
});

// GET /overview — single-call dashboard aggregate (command-center landing).
intel.get('/overview', operational, async (c) => {
  return c.json(await buildOverview(getDb(c.env)));
});

// GET /geo?days=30 — map-able intel as typed feature arrays for the Geospatial
// Intel Map. Coordinate-bearing sources return directly; address-only sources
// (warrants via subject person, trespass via property address) geocode
// cache-first with a small inline cap (Nominatim is 1 req/s) and report how many
// remain pending so the KV cache warms over visits. Every block is try/catch-
// isolated — a wrong column yields [] for that layer, never a 500.
intel.get('/geo', operational, async (c) => {
  const db = getDb(c.env);
  const days = Math.min(Math.max(parseInt(c.req.query('days') || '30', 10) || 30, 1), 90);
  const cutoff = daysCutoffISO(days, new Date());
  const cap = 250;
  const layers: Record<string, GeoFeature[]> = {
    sightings: [], calls: [], incidents: [], field_interviews: [], warrants: [], trespass: [],
  };

  const coordQuery = async (key: string, sql: string, args: unknown[], map: (r: any) => GeoFeature | null) => {
    try {
      for (const r of await query<any>(db, sql, ...args)) {
        const f = map(r);
        if (f && finiteCoord(f.lat, f.lng)) layers[key].push(f);
      }
    } catch (e) { log.warn(`geo ${key}`, { error: e instanceof Error ? e.message : String(e) }); }
  };

  await coordQuery('sightings',
    `SELECT id, plate, vehicle_id, lat, lng, location_text, created_at FROM vehicle_sightings
      WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?`, [cutoff, cap],
    (r) => geoFeature('vehicle', r.vehicle_id || r.id, r.lat, r.lng, r.plate || r.location_text || `Sighting #${r.id}`, { when: r.created_at }));

  await coordQuery('calls',
    `SELECT id, call_number, incident_type, latitude, longitude, created_at FROM calls_for_service
      WHERE created_at >= ? AND latitude IS NOT NULL ORDER BY created_at DESC LIMIT ?`, [cutoff, cap],
    (r) => geoFeature('call', r.id, r.latitude, r.longitude, [r.call_number, r.incident_type].filter(Boolean).join(' · ') || `CFS-${r.id}`, { when: r.created_at }));

  await coordQuery('incidents',
    `SELECT id, incident_number, incident_type, latitude, longitude, created_at FROM incidents
      WHERE created_at >= ? AND latitude IS NOT NULL ORDER BY created_at DESC LIMIT ?`, [cutoff, cap],
    (r) => geoFeature('incident', r.id, r.latitude, r.longitude, [r.incident_number, r.incident_type].filter(Boolean).join(' · ') || `INC-${r.id}`, { when: r.created_at }));

  await coordQuery('field_interviews',
    `SELECT id, fi_number, latitude, longitude, created_at FROM field_interviews
      WHERE created_at >= ? AND latitude IS NOT NULL ORDER BY created_at DESC LIMIT ?`, [cutoff, cap],
    (r) => geoFeature('field_interview', r.id, r.latitude, r.longitude, r.fi_number || `FI-${r.id}`, { when: r.created_at }));

  // --- Address-only sources: geocode cache-first, capped inline ---
  let geocodeBudget = 12; // uncached geocodes allowed THIS request
  let pending = 0;
  const geo = async (addr: string | null | undefined): Promise<{ lat: number; lng: number } | null> => {
    const a = (addr || '').trim();
    if (a.length < 4) return null;
    const cacheKey = `geocode:fwd:${a.toLowerCase()}`;
    const cached = (await c.env.KV.get(cacheKey, 'json').catch(() => null)) as { lat: number; lng: number } | null;
    if (cached && finiteCoord(cached.lat, cached.lng)) return cached;
    if (geocodeBudget <= 0) { pending++; return null; }
    geocodeBudget--;
    const res = await geocodeAddress(c.env, a); // best-effort; writes KV on success
    if (!res) { pending++; return null; }
    return res;
  };

  const addrLayer = async (key: string, sql: string, addrOf: (r: any) => string | null, mk: (r: any, lat: number, lng: number) => GeoFeature) => {
    try {
      for (const r of await query<any>(db, sql, cap)) {
        const coords = await geo(addrOf(r));
        if (coords && finiteCoord(coords.lat, coords.lng)) layers[key].push(mk(r, coords.lat, coords.lng));
      }
    } catch (e) { log.warn(`geo ${key}`, { error: e instanceof Error ? e.message : String(e) }); }
  };

  await addrLayer('warrants',
    `SELECT w.id, w.warrant_number, p.address, p.city FROM warrants w
       LEFT JOIN persons p ON p.id = w.subject_person_id
      WHERE w.status = 'active' LIMIT ?`,
    (r) => [r.address, r.city].filter(Boolean).join(', '),
    (r, lat, lng) => geoFeature('warrant', r.id, lat, lng, r.warrant_number || `WAR-${r.id}`, { geocoded: true }));

  await addrLayer('trespass',
    `SELECT id, order_number, location, property_address FROM trespass_orders
      WHERE status = 'active' OR status IS NULL LIMIT ?`,
    (r) => r.property_address || r.location,
    (r, lat, lng) => geoFeature('trespass_order', r.id, lat, lng, r.order_number || `TRES-${r.id}`, { geocoded: true }));

  return c.json({ layers, geocoding: { pending } });
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

const WATCHABLE = ['person', 'vehicle', 'warrant'];

intel.get('/watchlist', operational, async (c) => {
  const db = getDb(c.env);
  const userId = (c.get('userId') as number | undefined) ?? null;
  try {
    return c.json(await query<any>(db,
      `SELECT * FROM intel_watchlist WHERE active = 1 AND added_by = ? ORDER BY created_at DESC LIMIT 200`, userId));
  } catch (err) {
    log.error('GET /watchlist failed', { src: 'src/routes/intel.ts' }, err);
    return c.json({ error: err instanceof Error ? err.message : String(err), hint: 'migration 0099 may not have reached live D1' }, 500);
  }
});

intel.post('/watchlist', operational, async (c) => {
  const db = getDb(c.env);
  const userId = (c.get('userId') as number | undefined) ?? null;
  const body = await c.req.json().catch(() => ({} as any));
  const entityType = String(body?.entity_type || '');
  const entityId = Number(body?.entity_id);
  if (!WATCHABLE.includes(entityType) || !Number.isFinite(entityId)) {
    return c.json({ error: 'entity_type (person|vehicle|warrant) and entity_id required' }, 400);
  }
  // Warrants are watched by row id, unlike person/vehicle — confirm the
  // referenced warrant is real and seed last_known_status so the sweep's
  // first pass doesn't spuriously fire a "status changed" alert.
  let lastKnownStatus: string | null = null;
  if (entityType === 'warrant') {
    const warrant = await queryFirst<{ status: string }>(db, 'SELECT status FROM warrants WHERE id = ?', entityId);
    if (!warrant) return c.json({ error: 'Warrant not found' }, 404);
    lastKnownStatus = warrant.status;
  }
  // Reactivate an existing watch instead of violating the UNIQUE key.
  await execute(db,
    `INSERT INTO intel_watchlist (entity_type, entity_id, reason, added_by, active, last_alert_at, last_known_status)
     VALUES (?, ?, ?, ?, 1, datetime('now'), ?)
     ON CONFLICT(entity_type, entity_id, added_by) DO UPDATE SET
       active = 1, reason = excluded.reason, last_alert_at = datetime('now')`,
    entityType, entityId, body?.reason || null, userId, lastKnownStatus);
  return c.json({ success: true });
});

intel.delete('/watchlist/:entityType/:entityId', operational, async (c) => {
  const db = getDb(c.env);
  const userId = (c.get('userId') as number | undefined) ?? null;
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

// ─── Cross-hit screening (Wave 1) ────────────────────────────
// Instant records check for any person/vehicle — called by client
// flows right after a save/link for immediate feedback. Critical hits
// also notify the calling user.

intel.post('/screen', operational, async (c) => {
  const db = getDb(c.env);
  const userId = (c.get('userId') as number | undefined) ?? null;
  const body = await c.req.json().catch(() => ({} as any));
  const entityType = String(body?.entity_type || '');
  let hits;
  let resolvedId: number | null = null;
  if (entityType === 'person' && Number.isFinite(Number(body?.entity_id))) {
    resolvedId = Number(body.entity_id);
    hits = await screenPerson(db, resolvedId);
  } else if (entityType === 'vehicle' && (Number.isFinite(Number(body?.entity_id)) || body?.plate)) {
    const r = await screenVehicle(db, { vehicleId: Number(body?.entity_id) || undefined, plate: body?.plate });
    resolvedId = r.vehicleId; hits = r.hits;
  } else {
    return c.json({ error: 'entity_type person|vehicle with entity_id (or plate) required' }, 400);
  }
  const critical = hits.filter((h) => h.severity === 'critical');
  if (critical.length && userId) {
    try {
      await execute(db,
        `INSERT INTO notifications (type, priority, title, message, entity_type, entity_id, user_id, is_read, created_at)
         VALUES ('intel_screen', 'high', ?, ?, ?, ?, ?, 0, datetime('now'))`,
        `RECORDS HIT (${entityType})`, critical.map((h) => h.detail).join('; '),
        entityType, resolvedId, userId);
    } catch (err) { log.warn('screen notify failed', { error: err instanceof Error ? err.message : String(err) }); }
  }
  return c.json({ entity_type: entityType, entity_id: resolvedId, hits });
});

// Lightweight READ-ONLY plate screen for the forensic player's live hotlist
// check — no notification side-effects (the POST /screen path spams on every
// read). Returns stolen/watchlist/BOLO/owner-warrant hits for a plate.
intel.get('/screen-plate', operational, async (c) => {
  const db = getDb(c.env);
  const plate = (c.req.query('plate') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z0-9]{2,8}$/.test(plate)) return c.json({ plate, hits: [] });
  try {
    const { vehicleId, hits } = await screenVehicle(db, { plate });
    return c.json({ plate, vehicle_id: vehicleId, hits });
  } catch (err) {
    return c.json({ plate, hits: [], error: err instanceof Error ? err.message : String(err) }, 200);
  }
});

// ─── Narrative link suggestions (Wave 1) ─────────────────────

intel.get('/suggestions', operational, async (c) => {
  const db = getDb(c.env);
  const status = c.req.query('status') || 'pending';
  try {
    const rows = await query<any>(db,
      `SELECT s.*,
        CASE s.entity_type
          WHEN 'person' THEN (SELECT first_name || ' ' || last_name FROM persons WHERE id = s.entity_id)
          ELSE (SELECT COALESCE(plate_number, make || ' ' || model) FROM vehicles_records WHERE id = s.entity_id)
        END AS entity_label,
        CASE s.source_type
          WHEN 'call' THEN (SELECT COALESCE(call_number, 'CFS-' || id) FROM calls_for_service WHERE id = s.source_id)
          ELSE (SELECT COALESCE(incident_number, 'INC-' || id) FROM incidents WHERE id = s.source_id)
        END AS source_label
       FROM intel_link_suggestions s WHERE s.status = ? ORDER BY s.created_at DESC LIMIT 100`, status);
    return c.json(rows);
  } catch (err) {
    log.error('GET /suggestions failed', { src: 'src/routes/intel.ts' }, err);
    return c.json({ error: err instanceof Error ? err.message : String(err), hint: 'migration 0100 may not have reached live D1' }, 500);
  }
});

intel.post('/suggestions/:id/confirm', operational, async (c) => {
  const db = getDb(c.env);
  const userId = (c.get('userId') as number | undefined) ?? null;
  const id = Number(c.req.param('id'));
  const s = await queryFirst<any>(db, 'SELECT * FROM intel_link_suggestions WHERE id = ?', id);
  if (!s) return c.json({ error: 'Suggestion not found' }, 404);
  const table = s.source_type === 'call'
    ? (s.entity_type === 'person' ? 'call_persons' : 'call_vehicles')
    : (s.entity_type === 'person' ? 'incident_persons' : 'incident_vehicles');
  const fk = s.source_type === 'call' ? 'call_id' : 'incident_id';
  const col = s.entity_type === 'person' ? 'person_id' : 'vehicle_id';
  try {
    await execute(db,
      `INSERT OR IGNORE INTO ${table} (${fk}, ${col}, role) VALUES (?, ?, 'mentioned')`,
      s.source_id, s.entity_id);
  } catch (err) {
    log.error('POST /suggestions/:id/confirm failed', { src: 'src/routes/intel.ts' }, err);
    // Some junction tables lack a role column — retry without it.
    try {
      await execute(db, `INSERT OR IGNORE INTO ${table} (${fk}, ${col}) VALUES (?, ?)`, s.source_id, s.entity_id);
    } catch (e2: any) {
      log.error('POST /suggestions/:id/confirm failed', { src: 'src/routes/intel.ts' }, e2);
      return c.json({ error: `Failed to create link: ${e2?.message}` }, 500);
    }
  }
  await execute(db,
    `UPDATE intel_link_suggestions SET status = 'confirmed', decided_by = ?, decided_at = datetime(\'now\') WHERE id = ?`,
    userId, id);
  return c.json({ success: true });
});

intel.post('/suggestions/:id/reject', operational, async (c) => {
  const db = getDb(c.env);
  const userId = (c.get('userId') as number | undefined) ?? null;
  const r = await execute(db,
    `UPDATE intel_link_suggestions SET status = 'rejected', decided_by = ?, decided_at = datetime(\'now\') WHERE id = ?`,
    userId, Number(c.req.param('id')));
  return r.meta?.changes ? c.json({ success: true }) : c.json({ error: 'Suggestion not found' }, 404);
});

intel.post('/extract/run', requireRole('admin'), async (c) => {
  const created = await runExtraction(getDb(c.env), Number(c.req.query('hours')) || 720);
  return c.json({ success: true, suggestions_created: created });
});

// ─── Plate / sighting log (Wave 1) ───────────────────────────

intel.post('/sightings', operational, async (c) => {
  const db = getDb(c.env);
  const userId = (c.get('userId') as number | undefined) ?? null;
  const body = await c.req.json().catch(() => ({} as any));
  const plate = String(body?.plate || '').toUpperCase().replace(/[\s-]/g, '');
  if (plate.length < 2) return c.json({ error: 'plate required' }, 400);
  const { vehicleId, hits } = await screenVehicle(db, { plate });
  const r = await execute(db,
    `INSERT INTO vehicle_sightings (plate, state, vehicle_id, location_text, lat, lng, notes, sighted_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    plate, body?.state || null, vehicleId,
    body?.location_text || null,
    Number.isFinite(Number(body?.lat)) ? Number(body.lat) : null,
    Number.isFinite(Number(body?.lng)) ? Number(body.lng) : null,
    body?.notes || null, userId);
  let vehicle: any = null;
  if (vehicleId) {
    vehicle = await queryFirst<any>(db,
      'SELECT id, plate_number, make, model, color, year, owner_person_id FROM vehicles_records WHERE id = ?', vehicleId);
  }
  const critical = hits.filter((h) => h.severity === 'critical');
  if (critical.length && userId) {
    try {
      await execute(db,
        `INSERT INTO notifications (type, priority, title, message, entity_type, entity_id, user_id, is_read, created_at)
         VALUES ('intel_screen', 'high', ?, ?, 'vehicle', ?, ?, 0, datetime('now'))`,
        `PLATE HIT: ${plate}`, critical.map((h) => h.detail).join('; '), vehicleId, userId);
    } catch (err) { log.warn('sightings notify failed', { error: err instanceof Error ? err.message : String(err) }); }
  }
  return c.json({ success: true, id: r.meta.last_row_id, plate, vehicle, hits });
});

intel.get('/sightings', operational, async (c) => {
  const db = getDb(c.env);
  const plate = (c.req.query('plate') || '').toUpperCase().replace(/[\s-]/g, '');
  const limit = Math.min(Number(c.req.query('limit')) || 25, 100);
  try {
    const rows = plate
      ? await query<any>(db, `SELECT * FROM vehicle_sightings WHERE ${containsClause('plate').sql} ORDER BY created_at DESC LIMIT ?`, containsClause('plate').bind(plate), limit)
      : await query<any>(db, `SELECT * FROM vehicle_sightings ORDER BY created_at DESC LIMIT ?`, limit);
    return c.json(rows);
  } catch (err) {
    log.error('GET /sightings failed', { src: 'src/routes/intel.ts' }, err);
    return c.json({ error: err instanceof Error ? err.message : String(err), hint: 'migration 0100 may not have reached live D1' }, 500);
  }
});

// ─── Field quick-capture (Wave 2) ────────────────────────────
// One POST: dedupe-or-create person + vehicle, write the FI, screen
// both, return hits. 30-second field workflow.

intel.post('/quick-capture', operational, async (c) => {
  const db = getDb(c.env);
  const userId = (c.get('userId') as number | undefined) ?? null;
  const b = await c.req.json().catch(() => ({} as any));
  const first = String(b?.first_name || '').trim();
  const last = String(b?.last_name || '').trim();
  const plate = String(b?.plate || '').toUpperCase().replace(/[\s-]/g, '');
  if (!last && !plate) return c.json({ error: 'last_name or plate required' }, 400);

  let personId: number | null = null;
  let personReused = false;
  if (last) {
    try {
      const existing = b?.dob
        ? await queryFirst<any>(db, 'SELECT id FROM persons WHERE LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?) AND dob = ?', first, last, b.dob)
        : await queryFirst<any>(db, 'SELECT id FROM persons WHERE LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?)', first, last);
      if (existing) { personId = existing.id; personReused = true; }
      else {
        const r = await execute(db,
          'INSERT INTO persons (first_name, last_name, dob, notes, created_at) VALUES (?, ?, ?, ?, datetime(\'now\'))',
          first || null, last, b?.dob || null, 'Created via intel quick-capture');
        personId = r.meta.last_row_id as number;
      }
    } catch (err) { log.warn('quick-capture person failed', { error: err instanceof Error ? err.message : String(err) }); }
  }

  let vehicleId: number | null = null;
  if (plate.length >= 2) {
    try {
      const existing = await queryFirst<any>(db, 'SELECT id FROM vehicles_records WHERE UPPER(plate_number) = ?', plate);
      if (existing) vehicleId = existing.id;
      else {
        const r = await execute(db,
          'INSERT INTO vehicles_records (plate_number, owner_person_id, notes, created_at) VALUES (?, ?, ?, datetime(\'now\'))',
          plate, null, 'Created via intel quick-capture');
        vehicleId = r.meta.last_row_id as number;
      }
    } catch (err) { log.warn('quick-capture vehicle failed', { error: err instanceof Error ? err.message : String(err) }); }
  }

  // Linked dispatch call / incident — when the client launches the page
  // with ?call_id=… / ?incident_id=… (page 56 audit), stamp the FI so
  // the call's / incident's timeline picks it up. Schema columns
  // (associated_call_id / associated_incident_id) already exist on
  // field_interviews (see migrations/baseline/schema.sql). Coerce
  // through Number() so a stray string doesn't trip D1's strict types.
  const linkedCallId = Number.isFinite(Number(b?.call_id)) ? Number(b.call_id) : null;
  const linkedIncidentId = Number.isFinite(Number(b?.incident_id)) ? Number(b.incident_id) : null;

  let fiId: number | null = null;
  try {
    const r = await execute(db,
      `INSERT INTO field_interviews
         (person_id, vehicle_id, officer_id, location, latitude, longitude,
          contact_reason, narrative, subject_first_name, subject_last_name,
          subject_dob, subject_description, vehicle_plate,
          associated_call_id, associated_incident_id,
          status, created_at, interview_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', datetime('now'), datetime('now'))`,
      personId, vehicleId, userId, b?.location || null,
      Number.isFinite(Number(b?.lat)) ? Number(b.lat) : null,
      Number.isFinite(Number(b?.lng)) ? Number(b.lng) : null,
      b?.contact_reason || 'field contact', b?.narrative || null,
      first || null, last || null, b?.dob || null, b?.subject_description || null,
      plate || null,
      linkedCallId, linkedIncidentId);
    fiId = r.meta.last_row_id as number;
    await execute(db,
      `UPDATE field_interviews SET fi_number = 'FI-' || strftime('%Y%m%d', 'now') || '-' || id WHERE id = ? AND (fi_number IS NULL OR fi_number = '')`,
      fiId);
  } catch (err) {
    log.error('POST /quick-capture failed', { src: 'src/routes/intel.ts' }, err);
    return c.json({ error: `FI insert failed: ${err instanceof Error ? err.message : String(err)}` }, 500);
  }

  const hits: any[] = [];
  if (personId) hits.push(...await screenPerson(db, personId));
  if (vehicleId) hits.push(...(await screenVehicle(db, { vehicleId })).hits);
  const critical = hits.filter((h) => h.severity === 'critical');
  if (critical.length && userId) {
    try {
      await execute(db,
        `INSERT INTO notifications (type, priority, title, message, entity_type, entity_id, user_id, is_read, created_at)
         VALUES ('intel_screen', 'high', ?, ?, 'person', ?, ?, 0, datetime('now'))`,
        'RECORDS HIT: field contact', critical.map((h) => h.detail).join('; '), personId, userId);
    } catch (err) { log.warn('quick-capture notify failed', { error: err instanceof Error ? err.message : String(err) }); }
  }

  return c.json({
    success: true,
    person_id: personId,
    person_reused: personReused,
    vehicle_id: vehicleId,
    fi_id: fiId,
    associated_call_id: linkedCallId,
    associated_incident_id: linkedIncidentId,
    hits,
  });
});

// ─── Interaction audio recording (Wave 3b) ───────────────────
// Chunked, crash-resilient recording. Audio chunks stream to R2
// (UPLOADS bucket); D1 holds metadata only.

intel.post('/recordings/start', operational, async (c) => {
  const db = getDb(c.env);
  const userId = (c.get('userId') as number | undefined) ?? null;
  const b = await c.req.json().catch(() => ({} as any));
  // Client declares its container format (web MediaRecorder: audio/webm,
  // iOS AVAudioRecorder: audio/mp4) — stored so chunks serve back playable.
  const mime = typeof b?.mime === 'string' && /^audio\/[\w.+-]+$/.test(b.mime) ? b.mime : 'audio/webm';
  try {
    const r = await execute(db,
      `INSERT INTO interaction_recordings (officer_id, location_text, lat, lng, linked_fi_id, linked_call_id, notes, mime, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'recording')`,
      userId, b?.location || null,
      Number.isFinite(Number(b?.lat)) ? Number(b.lat) : null,
      Number.isFinite(Number(b?.lng)) ? Number(b.lng) : null,
      Number(b?.linked_fi_id) || null, Number(b?.linked_call_id) || null, b?.notes || null, mime);
    return c.json({ id: r.meta.last_row_id, mime });
  } catch (err) {
    log.error('POST /recordings/start failed', { src: 'src/routes/intel.ts' }, err);
    return c.json({ error: err instanceof Error ? err.message : String(err), hint: 'migration 0102 may not have reached live D1' }, 500);
  }
});

intel.put('/recordings/:id/chunk', operational, async (c) => {
  const db = getDb(c.env);
  const userId = (c.get('userId') as number | undefined) ?? null;
  const id = Number(c.req.param('id'));
  const seq = parseSeq(c.req.query('seq'));
  if (seq === null) return c.json({ error: 'valid seq query param required' }, 400);
  const rec = await queryFirst<any>(db, 'SELECT officer_id, status, mime FROM interaction_recordings WHERE id = ?', id);
  if (!rec || rec.officer_id !== userId) return c.json({ error: 'recording not found' }, 404);
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: 'empty chunk' }, 400);
  if (body.byteLength > 8 * 1024 * 1024) return c.json({ error: 'chunk too large' }, 413);
  try {
    await putEncrypted(c.env.UPLOADS, db, c.env, chunkKey(id, seq), body, { httpMetadata: { contentType: rec.mime || 'audio/webm' } });
    await execute(db,
      'UPDATE interaction_recordings SET chunk_count = MAX(chunk_count, ?) WHERE id = ?', seq + 1, id);
    return c.json({ success: true, seq });
  } catch (err) {
    log.error('PUT /recordings/:id/chunk failed', { src: 'src/routes/intel.ts' }, err);
    return c.json({ error: `chunk store failed: ${err instanceof Error ? err.message : String(err)}` }, 500);
  }
});

intel.post('/recordings/:id/stop', operational, async (c) => {
  const db = getDb(c.env);
  const userId = (c.get('userId') as number | undefined) ?? null;
  const id = Number(c.req.param('id'));
  const b = await c.req.json().catch(() => ({} as any));
  const rec = await queryFirst<any>(db, 'SELECT officer_id FROM interaction_recordings WHERE id = ?', id);
  if (!rec || rec.officer_id !== userId) return c.json({ error: 'recording not found' }, 404);
  await execute(db,
    `UPDATE interaction_recordings SET status = 'complete', ended_at = datetime(\'now\'), duration_sec = ? WHERE id = ?`,
    Number(b?.duration_sec) || 0, id);
  return c.json({ success: true });
});

intel.get('/recordings', operational, async (c) => {
  const db = getDb(c.env);
  const userId = (c.get('userId') as number | undefined) ?? null;
  const role = String((c.get('user') as { role?: string } | undefined)?.role || '');
  const limit = Math.min(Number(c.req.query('limit')) || 25, 100);
  try {
    const rows = ['admin', 'manager', 'supervisor'].includes(role)
      ? await query<any>(db, 'SELECT * FROM interaction_recordings ORDER BY created_at DESC LIMIT ?', limit)
      : await query<any>(db, 'SELECT * FROM interaction_recordings WHERE officer_id = ? ORDER BY created_at DESC LIMIT ?', userId, limit);
    return c.json(rows);
  } catch (err) {
    log.error('GET /recordings failed', { src: 'src/routes/intel.ts' }, err);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

intel.get('/recordings/:id/chunk/:seq', operational, async (c) => {
  const db = getDb(c.env);
  const id = Number(c.req.param('id'));
  const seq = parseSeq(c.req.param('seq'));
  if (seq === null) return c.json({ error: 'invalid seq' }, 400);
  try {
    const key = chunkKey(id, seq);
    // getDecrypted() returns null both for "object never existed" and for
    // "object exists, no file_encryption_keys row" -- the latter is exactly
    // what every interactions/ chunk looks like for recordings made before
    // this task started calling putEncrypted() (this feature has been live
    // in production). Fall back to a raw R2 read so those chunks stay
    // servable instead of permanently 404ing -- mirrors fieldPhotos.ts's
    // `GET /file/*` route. A genuine decrypt failure (bad/rotated KEK,
    // tampered ciphertext) throws instead of returning null, so it is never
    // confused with the legacy case and is not caught here -- it propagates
    // to the outer catch below as a loud 500, never a fake 200 of raw
    // ciphertext.
    const decrypted = await getDecrypted(c.env.UPLOADS, db, c.env, key);
    const rec = await queryFirst<{ mime: string | null }>(db, 'SELECT mime FROM interaction_recordings WHERE id = ?', id).catch(() => null);
    if (decrypted) {
      const mime = decrypted.httpMetadata?.contentType || rec?.mime || 'audio/webm';
      return new Response(decrypted.bytes, { headers: { 'content-type': mime, 'cache-control': 'private, max-age=3600' } });
    }
    const legacy = await (c.env as any).UPLOADS.get(key);
    if (!legacy) return c.json({ error: 'chunk not found' }, 404);
    const mime = legacy.httpMetadata?.contentType || rec?.mime || 'audio/webm';
    return new Response(legacy.body, { headers: { 'content-type': mime, 'cache-control': 'private, max-age=3600' } });
  } catch (err) {
    log.error('GET /recordings/:id/chunk/:seq failed', { src: 'src/routes/intel.ts' }, err);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// ─── Jail / booking records (Wave 3a) ────────────────────────

intel.get('/jail/sources', operational, async (c) => {
  const db = getDb(c.env);
  try {
    return c.json(await query<any>(db, 'SELECT * FROM jail_roster_sources ORDER BY status DESC, display_name'));
  } catch (err) {
    log.error('GET /jail/sources failed', { src: 'src/routes/intel.ts' }, err);
    return c.json({ error: err instanceof Error ? err.message : String(err), hint: 'migration 0101 may not have reached live D1' }, 500);
  }
});

intel.post('/jail/scan', requireRole('admin'), async (c) => {
  const summaries = await runJailScan(c.env as any);
  return c.json({ success: true, summaries });
});

intel.post('/jail/ingest', supervisorPlus, async (c) => {
  const db = getDb(c.env);
  const userId = (c.get('userId') as number | undefined) ?? null;
  const b = await c.req.json().catch(() => ({} as any));
  const county = String(b?.county || '').trim();
  const sourceKey = b?.source_key || (county ? `ut-${county.toLowerCase().replace(/\s+/g, '-')}` : 'manual');
  const format = b?.format === 'csv' ? 'csv' : 'lines';
  const text = String(b?.text || '');
  if (!text.trim()) return c.json({ error: 'text required' }, 400);
  const parsed = parseRosterText(text, format).map((r, i) => ({
    ...r, source_key: sourceKey, booking_id: '', county: county || r.county || null,
  }));
  if (!parsed.length) return c.json({ error: 'no rows parsed', ingested: 0, matched: 0, alerts: 0 });
  const result = await ingestBookings(db, parsed as any, 'roster_manual', userId);
  return c.json({ success: true, ...result, parsed: parsed.length });
});

intel.post('/jail/ingest-bookings', supervisorPlus, async (c) => {
  const db = getDb(c.env);
  const b = await c.req.json().catch(() => ({} as any));
  const sourceKey = String(b?.source_key || '').trim();
  const bookings = Array.isArray(b?.bookings) ? b.bookings : null;
  if (!sourceKey) return c.json({ error: 'source_key required' }, 400);
  if (!bookings) return c.json({ error: 'bookings array required' }, 400);
  if (bookings.length > 500) return c.json({ error: 'max 500 bookings per call' }, 400);
  const normalized = bookings.map((r: any) => ({
    source_key: sourceKey,
    booking_id: String(r?.booking_id || ''),
    full_name: r?.full_name ?? null,
    first_name: r?.first_name ?? null,
    last_name: r?.last_name ?? null,
    dob: r?.dob ?? null,
    booking_date: r?.booking_date ?? null,
    charges: r?.charges ?? null,
    county: r?.county ?? null,
    mugshot_url: r?.mugshot_url ?? null,
    detail_url: r?.detail_url ?? null,
  }));
  const result = await ingestBookings(db, normalized as any, 'roster_scrape');
  // Best-effort source health stamp so the registry reflects runner activity.
  try {
    await execute(db,
      `UPDATE jail_roster_sources SET last_run_at = datetime(\'now\'), last_status = ?, row_count = row_count + ?, updated_at = datetime(\'now\') WHERE source_key = ?`,
      `runner ok (${result.ingested})`, result.ingested, sourceKey);
  } catch (err) { log.warn('jail/ingest-bookings status update failed', { error: err instanceof Error ? err.message : String(err) }); }
  return c.json({ success: true, ...result, received: bookings.length });
});

intel.get('/jail/bookings', operational, async (c) => {
  const db = getDb(c.env);
  const q = (c.req.query('q') || '').trim();
  const county = (c.req.query('county') || '').trim();
  const limit = Math.min(Number(c.req.query('limit')) || 40, 100);
  try {
    const where: string[] = [`entry_source LIKE 'roster%'`];
    const binds: any[] = [];
    if (q) { const m = containsAnyClause(['full_name', 'charges']); where.push(m.sql); binds.push(...m.binds(q)); }
    if (county) { where.push('county = ?'); binds.push(county); }
    const rows = await query<any>(db,
      `SELECT ar.id, ar.full_name, ar.booking_date, ar.charges, ar.county, ar.entry_source, ar.mugshot_url,
              (SELECT linked_id FROM arrest_cross_links WHERE arrest_record_id = ar.id AND linked_type = 'person' LIMIT 1) AS person_id
       FROM arrest_records ar WHERE ${where.join(' AND ')} ORDER BY ar.fetched_at DESC LIMIT ?`,
      ...binds, limit);
    return c.json(rows);
  } catch (err) {
    log.error('GET /jail/bookings failed', { src: 'src/routes/intel.ts' }, err);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
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
      for (const p of await queryInChunks<any>(db, others,
        (ph) => `SELECT id, first_name, last_name FROM persons WHERE id IN (${ph})`))
        cluster.push({ person_id: p.id, name: `${p.first_name} ${p.last_name}` });
    }
  } catch (err) { log.warn('dossier cluster failed', { error: err instanceof Error ? err.message : String(err) }); }
  const ids = [...clusterIds];

  // Flags: Phase-1 enrichment + persons columns.
  const flags: string[] = [];
  try {
    const fm = await personFlags(db, ids);
    for (const fs of fm.values()) for (const f of fs) if (!flags.includes(f)) flags.push(f);
  } catch (err) { log.warn('dossier flags failed', { error: err instanceof Error ? err.message : String(err) }); }
  if (isRealValue(person.gang_affiliation) && !flags.includes('GANG')) flags.push('GANG');
  if (isRealValue(person.probation_parole)) flags.push('PROBATION/PAROLE');
  if (isRealValue(person.caution_flags)) flags.push('CAUTION');
  try {
    const trespassCounts = await queryInChunks<{ n: number }>(db, ids,
      (ph) => `SELECT COUNT(*) AS n FROM trespass_orders WHERE person_id IN (${ph}) AND status = 'active'`);
    if (trespassCounts.some((r) => r.n > 0)) flags.push('ACTIVE TRESPASS');
  } catch (err) { log.warn('dossier trespass flag failed', { error: err instanceof Error ? err.message : String(err) }); }

  // Timeline sections — each guarded.
  const sources: TimelineEvent[][] = [];
  const section = async (label: string, fn: () => Promise<TimelineEvent[]>) => {
    try { sources.push(await fn()); }
    catch (err) { log.warn(`dossier ${label} failed`, { error: err instanceof Error ? err.message : String(err) }); }
  };
  await section('calls', async () =>
    (await queryInChunks<any>(db, ids,
      (ph) => `SELECT c.id, c.call_number, c.incident_type, c.status, c.created_at, c.location_address, cp.person_id AS spid
               FROM calls_for_service c JOIN call_persons cp ON c.id = cp.call_id
               WHERE cp.person_id IN (${ph}) ORDER BY c.created_at DESC`))
      .slice(0, 100)
      .map((r) => ({ kind: 'call', id: r.id, date: r.created_at, title: r.call_number || `CFS-${r.id}`,
        subtitle: [r.incident_type, r.location_address].filter(isRealValue).join(' — '), status: r.status || '', source_person_id: r.spid })));
  await section('incidents', async () =>
    (await queryInChunks<any>(db, ids,
      (ph) => `SELECT i.id, i.incident_number, i.incident_type, i.status, i.created_at, i.location_address, ip.person_id AS spid
               FROM incidents i JOIN incident_persons ip ON i.id = ip.incident_id
               WHERE ip.person_id IN (${ph}) ORDER BY i.created_at DESC`))
      .slice(0, 100)
      .map((r) => ({ kind: 'incident', id: r.id, date: r.created_at, title: r.incident_number || `INC-${r.id}`,
        subtitle: [r.incident_type, r.location_address].filter(isRealValue).join(' — '), status: r.status || '', source_person_id: r.spid })));
  await section('citations', async () =>
    (await queryInChunks<any>(db, ids,
      (ph) => `SELECT id, citation_number, violation_description, status, violation_date, person_id AS spid
               FROM citations WHERE person_id IN (${ph}) ORDER BY violation_date DESC`))
      .slice(0, 100)
      .map((r) => ({ kind: 'citation', id: r.id, date: r.violation_date, title: r.citation_number || `CIT-${r.id}`,
        subtitle: isRealValue(r.violation_description) ? String(r.violation_description) : '', status: r.status || '', source_person_id: r.spid })));
  await section('field_interviews', async () =>
    (await queryInChunks<any>(db, ids,
      (ph) => `SELECT id, fi_number, location, contact_reason, status, created_at, person_id AS spid
               FROM field_interviews WHERE person_id IN (${ph}) ORDER BY created_at DESC`))
      .slice(0, 100)
      .map((r) => ({ kind: 'field_interview', id: r.id, date: r.created_at, title: r.fi_number || `FI-${r.id}`,
        subtitle: [r.contact_reason, r.location].filter(isRealValue).join(' — '), status: r.status || '', source_person_id: r.spid })));
  await section('trespass_orders', async () =>
    (await queryInChunks<any>(db, ids,
      (ph) => `SELECT id, order_number, location, status, effective_date, person_id AS spid
               FROM trespass_orders WHERE person_id IN (${ph}) ORDER BY effective_date DESC`))
      .slice(0, 100)
      .map((r) => ({ kind: 'trespass_order', id: r.id, date: r.effective_date, title: r.order_number || `TO-${r.id}`,
        subtitle: isRealValue(r.location) ? String(r.location) : '', status: r.status || '', source_person_id: r.spid })));
  await section('warrants', async () =>
    (await queryInChunks<any>(db, ids,
      (ph) => `SELECT id, warrant_number, charge_description, status, issued_date, subject_person_id AS spid
               FROM warrants WHERE subject_person_id IN (${ph}) ORDER BY issued_date DESC`))
      .slice(0, 100)
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
  await section('screening_hits', async () =>
    screeningHitsToTimeline(
      await query<any>(db,
        `SELECT id, source_key, display_name, summary, reviewed_at
         FROM screening_hits
         WHERE person_id = ? AND status = 'confirmed' AND is_active = 1
         ORDER BY reviewed_at DESC`, id)
        .catch(() => [])));
  const timeline = mergeTimeline(sources);

  // Associates — co-occurrence on the same calls/incidents.
  let associates: ReturnType<typeof rankAssociates> = [];
  try {
    const co: CoOccurrence[] = [];
    for (const r of (await queryInChunks<any>(db, ids,
      (ph) => `SELECT p.id AS person_id, p.first_name || ' ' || p.last_name AS name
               FROM call_persons cp1 JOIN call_persons cp2 ON cp1.call_id = cp2.call_id AND cp1.person_id != cp2.person_id
               JOIN persons p ON p.id = cp2.person_id WHERE cp1.person_id IN (${ph})`)).slice(0, 500))
      co.push({ person_id: r.person_id, name: r.name, kind: 'call' });
    for (const r of (await queryInChunks<any>(db, ids,
      (ph) => `SELECT p.id AS person_id, p.first_name || ' ' || p.last_name AS name
               FROM incident_persons ip1 JOIN incident_persons ip2 ON ip1.incident_id = ip2.incident_id AND ip1.person_id != ip2.person_id
               JOIN persons p ON p.id = ip2.person_id WHERE ip1.person_id IN (${ph})`)).slice(0, 500))
      co.push({ person_id: r.person_id, name: r.name, kind: 'incident' });
    associates = rankAssociates(co, clusterIds, 15);
  } catch (err) { log.warn('dossier associates failed', { error: err instanceof Error ? err.message : String(err) }); }

  // Vehicles owned by any cluster member.
  let vehicles: any[] = [];
  try {
    vehicles = (await queryInChunks<any>(db, ids,
      (ph) => `SELECT id, plate_number, vin, make, model, year, color FROM vehicles_records
               WHERE owner_person_id IN (${ph})`)).slice(0, 25);
  } catch (err) { log.warn('dossier vehicles failed', { error: err instanceof Error ? err.message : String(err) }); }

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
    for (const p of await queryInChunks<any>(db, ids,
      (ph) => `SELECT address, city FROM persons WHERE id IN (${ph})`))
      pushAddr([p.address, p.city].filter(isRealValue).join(', '), 'linked identity');
  } catch (err) { log.warn('dossier cluster addresses failed', { error: err instanceof Error ? err.message : String(err) }); }
  for (const e of timeline) {
    if (addresses.length >= 10) break;
    if ((e.kind === 'call' || e.kind === 'incident') && e.subtitle.includes(' — '))
      pushAddr(e.subtitle.split(' — ').pop(), `${e.kind} ${e.title}`);
  }

  // Escalation scoring (Wave 2) — weighted 30d tempo vs 90d baseline.
  let escalation = null as ReturnType<typeof computeEscalation> | null;
  try {
    escalation = computeEscalation(await personActivityEvents(db, id));
  } catch (err) { log.warn('dossier escalation failed', { error: err instanceof Error ? err.message : String(err) }); }

  // Watch state for the requesting user (Phase 4).
  let watched = false;
  try {
    const w = await queryFirst<any>(db,
      `SELECT 1 AS x FROM intel_watchlist WHERE entity_type = 'person' AND entity_id = ? AND added_by = ? AND active = 1`,
      id, (c.get('userId') as number | undefined) ?? null);
    watched = !!w;
  } catch (err) { log.warn('dossier watch state failed', { error: err instanceof Error ? err.message : String(err) }); }

  // Linked Intelligence — disseminated products that name this person.
  let linkedIntel: any[] = [];
  try {
    linkedIntel = await query<any>(db,
      `SELECT r.id, r.report_number, r.title, r.threat_level, r.source_reliability,
              r.info_credibility, r.handling_code, r.disseminated_at, l.role
       FROM intel_report_links l JOIN intel_reports r ON r.id = l.report_id
       WHERE l.entity_type = 'person' AND l.entity_id = ? AND r.status = 'disseminated'
       ORDER BY r.disseminated_at DESC`, id);
  } catch (err) { log.warn('intel linked intel failed', { error: err instanceof Error ? err.message : String(err) }); }

  return c.json({
    person, cluster, flags, timeline, associates, vehicles,
    addresses: addresses.slice(0, 10),
    watched,
    escalation,
    linked_intel: linkedIntel,
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
  const userId = (c.get('userId') as number | undefined) ?? null;
  const body = await c.req.json().catch(() => ({} as any));
  const s = await queryFirst<any>(db, 'SELECT * FROM entity_resolution_suggestions WHERE id = ?', id);
  if (!s) return c.json({ error: 'Suggestion not found' }, 404);
  const canonical = Number(body?.canonical_person_id) === s.person_b ? s.person_b : s.person_a;
  const alias = canonical === s.person_a ? s.person_b : s.person_a;
  await execute(db,
    'INSERT OR REPLACE INTO person_canonical (person_id, canonical_person_id, confirmed_by) VALUES (?, ?, ?)',
    alias, canonical, userId);
  await execute(db,
    `UPDATE entity_resolution_suggestions SET status = 'confirmed', decided_by = ?, decided_at = datetime(\'now\') WHERE id = ?`,
    userId, id);
  return c.json({ success: true, canonical_person_id: canonical, alias_person_id: alias });
});

intel.post('/resolution/suggestions/:id/reject', supervisorPlus, async (c) => {
  const db = getDb(c.env);
  const id = Number(c.req.param('id'));
  const userId = (c.get('userId') as number | undefined) ?? null;
  const r = await execute(db,
    `UPDATE entity_resolution_suggestions SET status = 'rejected', decided_by = ?, decided_at = datetime(\'now\') WHERE id = ?`,
    userId, id);
  return r.meta?.changes ? c.json({ success: true }) : c.json({ error: 'Suggestion not found' }, 404);
});

intel.delete('/resolution/canonical/:personId', supervisorPlus, async (c) => {
  const db = getDb(c.env);
  await execute(db, 'DELETE FROM person_canonical WHERE person_id = ?', Number(c.req.param('personId')));
  return c.json({ success: true });
});

intel.route('/reports', intelReports);
intel.route('/sources', intelSources);

export default intel;
