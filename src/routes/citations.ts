// ============================================================
// RMPG Flex — Citations (Cloudflare Worker)
// ============================================================
// Traffic / criminal / parking / warning citations. Phase 1 RMS.
//
// Migration: 0027_citations.sql (citations + citation_violations +
// citation_payments).
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { emitAnalytics, flexEvent } from '../utils/analytics';
import { geocodeAddress } from './geocode';
import { putEncrypted, getDecrypted } from '../utils/encryptedR2';

import { dbErrorResponse } from '../utils/dbErrors';
import { log } from '../utils/logger';
import { containsAnyClause } from '../utils/searchText';
const citations = new Hono<Env>();

const VALID_TYPES = new Set(['traffic', 'criminal', 'parking', 'warning']);
const VALID_STATUSES = new Set(['issued', 'paid', 'contested', 'dismissed', 'warrant_issued', 'voided']);

// ── Helpers ─────────────────────────────────────────────────

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '""';
  const s = typeof v === 'string' ? v : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

/** Generate next citation_number: CIT-YYYY-NNNN.
 *  Scans the latest existing citation for the current year and
 *  increments. Same concurrency caveat as fieldInterviews FI gen —
 *  high-volume parallel inserts in the same millisecond could
 *  collide on the unique check + insert race; legacy had the same
 *  shape. Patrol cadence makes this a non-issue in practice. */
async function generateCitationNumber(db: ReturnType<typeof getDb>): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `CIT-${year}-`;
  const row = await queryFirst<{ citation_number: string }>(
    db,
    `SELECT citation_number FROM citations
     WHERE citation_number LIKE ?
     ORDER BY citation_number DESC LIMIT 1`,
    `${prefix}%`,
  );
  let seq = 1;
  if (row?.citation_number) {
    const parts = row.citation_number.split('-');
    const parsed = parseInt(parts[parts.length - 1], 10);
    seq = !Number.isFinite(parsed) ? 1 : parsed + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

// ── GET /stats — must come before GET /:id for static-precedence ──
citations.get('/stats', async (c) => {
  try {
    const db = getDb(c.env);
    const total = (await queryFirst<{ count: number }>(db, 'SELECT COUNT(*) as count FROM citations'))?.count ?? 0;
    const byStatusRows = await query<{ status: string; count: number }>(
      db, `SELECT status, COUNT(*) as count FROM citations GROUP BY status ORDER BY count DESC`,
    );
    const byTypeRows = await query<{ type: string; count: number }>(
      db, `SELECT type, COUNT(*) as count FROM citations GROUP BY type ORDER BY count DESC`,
    );
    // CitationsPage reads by_status as Record<string,number> — convert from row array.
    const by_status: Record<string, number> = {};
    for (const r of byStatusRows) by_status[r.status] = Number(r.count);
    const by_type: Record<string, number> = {};
    for (const r of byTypeRows) by_type[r.type] = Number(r.count);

    const today = new Date().toISOString().slice(0, 10);
    const today_count = (await queryFirst<{ count: number }>(
      db,
      `SELECT COUNT(*) as count FROM citations WHERE violation_date = ?`,
      today,
    ))?.count ?? 0;
    const fines_issued = (await queryFirst<{ total: number }>(
      db,
      `SELECT COALESCE(SUM(fine_amount), 0) as total FROM citations WHERE status NOT IN ('voided','dismissed')`,
    ))?.total ?? 0;
    const fines_collected = (await queryFirst<{ total: number }>(
      db,
      `SELECT COALESCE(SUM(amount), 0) as total FROM citation_payments`,
    ))?.total ?? 0;
    return c.json({
      data: {
        total,
        by_status,
        by_type,
        fines_issued,
        fines_collected,
        today_count,
        // legacy camelCase keys retained for any other consumer
        byStatus: byStatusRows,
        byType: byTypeRows,
      },
    });
  } catch (err) {
    log.error('GET /stats failed', { src: 'src/routes/citations.ts' }, err);
    return c.json({ error: 'Failed to get citation stats', code: 'STATS_ERROR' }, 500);
  }
});

// ── GET /search ─────────────────────────────────────────────
citations.get('/search', async (c) => {
  try {
    const q = (c.req.query('q') ?? '').trim();
    if (q.length < 2) return c.json({ data: [] });
    const db = getDb(c.env);
    const m = containsAnyClause(['citation_number', 'person_name', 'vehicle_plate']);
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT * FROM citations WHERE ${m.sql}
       ORDER BY violation_date DESC LIMIT 100`,
      ...m.binds(q),
    );
    return c.json({ data: rows });
  } catch (err) {
    log.error('GET /search failed', { src: 'src/routes/citations.ts' }, err);
    return c.json({ error: 'Failed to search citations', code: 'SEARCH_ERROR' }, 500);
  }
});

// ── GET /person/:personId — citations issued to one person ──
citations.get('/person/:personId', async (c) => {
  const actor = c.get('user') as { role?: string } | undefined;
  if (!actor?.role || actor.role === 'client_viewer') {
    return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }
  try {
    const db = getDb(c.env);
    const personId = parseInt(c.req.param('personId'), 10);
    if (!Number.isFinite(personId) || personId < 1) return c.json({ error: 'Invalid person ID', code: 'INVALID_PERSON_ID' }, 400);
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT * FROM citations WHERE person_id = ? ORDER BY violation_date DESC LIMIT 200`,
      personId,
    );
    return c.json({ data: rows });
  } catch (err) {
    log.error('GET /person/:personId failed', { src: 'src/routes/citations.ts' }, err);
    return c.json({ error: 'Failed to get citations by person', code: 'PERSON_QUERY_ERROR' }, 500);
  }
});

// ── GET /payment-summary — aggregate totals across all citations ──
// Returns { total_outstanding, total_collected, count_unpaid }.
// Computed via JOIN onto citation_payments — partial payments tracked.
citations.get('/payment-summary', async (c) => {
  try {
    const db = getDb(c.env);
    const row = await queryFirst<{
      total_assessed: number; total_collected: number; count_unpaid: number;
    }>(
      db,
      `SELECT
         COALESCE(SUM(c.fine_amount), 0) as total_assessed,
         COALESCE(SUM((SELECT COALESCE(SUM(amount), 0) FROM citation_payments WHERE citation_id = c.id)), 0) as total_collected,
         SUM(CASE WHEN c.status NOT IN ('paid','dismissed','voided') THEN 1 ELSE 0 END) as count_unpaid
       FROM citations c`,
    );
    const total_assessed = row?.total_assessed ?? 0;
    const total_collected = row?.total_collected ?? 0;
    const total_outstanding = Math.max(0, total_assessed - total_collected);
    const pc = await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) as n FROM citation_payments');
    const collection_rate = total_assessed > 0 ? Math.round((total_collected / total_assessed) * 100) : 0;
    // CitationsPage reads res.data.{payment_count,payment_total,outstanding_amount,collection_rate};
    // keep the legacy top-level keys too for any other consumer.
    return c.json({
      total_assessed,
      total_collected,
      total_outstanding,
      count_unpaid: row?.count_unpaid ?? 0,
      data: {
        payment_count: pc?.n ?? 0,
        payment_total: total_collected,
        total_collected,
        outstanding_amount: total_outstanding,
        collection_rate,
      },
    });
  } catch (err) {
    log.error('GET /payment-summary failed', { src: 'src/routes/citations.ts' }, err);
    return c.json({ error: 'Failed to get payment summary', code: 'PAYMENT_SUMMARY_ERROR' }, 500);
  }
});

// ── GET / — paginated list with filters ─────────────────────
citations.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query.bind(c.req);
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];

    if (q('status')) { conditions.push('status = ?'); params.push(q('status')); }
    if (q('type')) { conditions.push('type = ?'); params.push(q('type')); }
    if (q('officer_id')) { conditions.push('issuing_officer_id = ?'); params.push(q('officer_id')); }
    if (q('person_id')) { conditions.push('person_id = ?'); params.push(q('person_id')); }
    if (q('date_from')) { conditions.push('violation_date >= ?'); params.push(q('date_from')); }
    if (q('date_to')) { conditions.push('violation_date <= ?'); params.push(q('date_to')); }
    const search = q('search');
    if (search) {
      // instr(), not LIKE — D1 caps LIKE patterns at 50 chars (searchText.ts).
      const _m = containsAnyClause(['citation_number', 'person_name', 'vehicle_plate', 'location']);
      conditions.push(_m.sql);
      params.push(..._m.binds(search));
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const pageNum = Math.max(1, parseInt(q('page') || '1', 10) || 1);
    const perPage = Math.min(500, Math.max(1, parseInt(q('per_page') || '100', 10) || 100));
    const offset = (pageNum - 1) * perPage;

    const countRow = await queryFirst<{ total: number }>(
      db, `SELECT COUNT(*) as total FROM citations ${where}`, ...params,
    );
    const total = countRow?.total ?? 0;

    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT c.*,
              p.first_name as person_first_name, p.last_name as person_last_name,
              u.full_name as officer_full_name
       FROM citations c
       LEFT JOIN persons p ON c.person_id = p.id
       LEFT JOIN users u ON c.issuing_officer_id = u.id
       ${where}
       ORDER BY c.violation_date DESC, c.id DESC
       LIMIT ? OFFSET ?`,
      ...params, perPage, offset,
    );

    return c.json({
      data: rows,
      pagination: { page: pageNum, per_page: perPage, total, totalPages: perPage > 0 ? Math.ceil(total / perPage) : 0 },
    });
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to list citations', 'LIST_ERROR');
  }
});

// ── Fine calculation ─────────────────────────────────────────
citations.get('/calculate-fine', async (c) => {
  try {
    const db = getDb(c.env);
    const statuteId = c.req.query('statute_id');
    const offenseLevel = c.req.query('offense_level');
    const type = c.req.query('type') || 'traffic';
    let baseFine = 0;
    // `source` makes the basis of the number explicit. These are the app's own
    // schedule buckets, NOT Utah statutory maximums — a real citation amount
    // comes from the court's fine schedule, so the caller must be able to tell
    // an estimate from an authority.
    let source: 'statute_fine' | 'offense_level' | 'default' = 'default';
    let levelUsed: string | null = (offenseLevel as string) || null;

    if (statuteId) {
      const statute = await queryFirst<{ default_fine: number | null; offense_level: string | null }>(
        // utah_statutes stores the scheduled fine as `citation_fine` — which is
        // populated on ZERO of 4,315 live rows, so this branch never fires
        // today. Kept because it is the correct shape if that data ever lands.
        db, 'SELECT citation_fine AS default_fine, offense_level FROM utah_statutes WHERE id = ?', statuteId,
      ).catch(() => null);
      if (statute?.default_fine) {
        baseFine = statute.default_fine;
        source = 'statute_fine';
      }
      // The statute's own offense_level was SELECTed and then never read, so a
      // caller passing statute_id alone always fell through to the flat
      // default even though 911 live statutes carry a level.
      if (!levelUsed && statute?.offense_level) levelUsed = statute.offense_level;
    }

    if (!baseFine) {
      const fineSchedule: Record<string, number> = {
        felony: 1000, misdemeanor_a: 500, misdemeanor_b: 350,
        misdemeanor_c: 250, misdemeanor: 350, infraction: 150, violation: 100,
      };
      // Live utah_statutes.offense_level uses Utah's statutory vocabulary
      // ('class_b_misdemeanor', 'third_degree_felony'), which shares only ONE
      // key with the schedule above ('infraction'). So 738 of the 911 levelled
      // statutes matched nothing and silently returned the flat 100. Mapping is
      // onto the EXISTING buckets — no new dollar figures are introduced here.
      const LEVEL_ALIASES: Record<string, string> = {
        capital_felony: 'felony',
        first_degree_felony: 'felony',
        second_degree_felony: 'felony',
        third_degree_felony: 'felony',
        class_a_misdemeanor: 'misdemeanor_a',
        class_b_misdemeanor: 'misdemeanor_b',
        class_c_misdemeanor: 'misdemeanor_c',
      };
      const key = levelUsed ? (LEVEL_ALIASES[levelUsed] ?? levelUsed) : '';
      if (key && fineSchedule[key] !== undefined) {
        baseFine = fineSchedule[key];
        source = 'offense_level';
      } else {
        baseFine = 100;
        source = 'default';
      }
    }

    const typeMultipliers: Record<string, number> = { traffic: 1.0, criminal: 1.5, parking: 0.5, warning: 0 };
    // `|| 1.0` was a falsy-zero bug: the warning multiplier IS 0, so a warning
    // citation fell through to 1.0 and quoted the FULL fine. `??` only replaces
    // an unknown type.
    const multiplier = typeMultipliers[type] ?? 1.0;
    const calculatedFine = Math.round(baseFine * multiplier * 100) / 100;
    return c.json({ data: {
      base_fine: baseFine, multiplier, calculated_fine: calculatedFine, type,
      source, offense_level_used: levelUsed,
    } });
  } catch { return c.json({ data: { base_fine: 100, multiplier: 1.0, calculated_fine: 100, type: 'traffic', source: 'default', offense_level_used: null } }); }
});

// ── Vehicle plate lookup (for auto-filling vehicle details) ──
citations.get('/vehicle-lookup', async (c) => {
  try {
    const db = getDb(c.env);
    const plate = c.req.query('plate');
    if (!plate || plate.length < 2) return c.json({ found: false });
    const vehicle = await queryFirst<Record<string, unknown>>(db,
      `SELECT id, plate_number, make, model, year, color, vin, registered_owner
       FROM vehicles_records WHERE UPPER(REPLACE(plate_number,' ','')) = UPPER(REPLACE(?,' ',''))
       LIMIT 1`, plate);
    if (vehicle) return c.json({ found: true, ...vehicle });
    return c.json({ found: false });
  } catch { return c.json({ found: false }); }
});

// ── GET /:id ────────────────────────────────────────────────
citations.get('/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
    const row = await queryFirst<Record<string, unknown>>(
      db,
      `SELECT c.*, p.first_name as person_first_name, p.last_name as person_last_name,
              u.full_name as officer_full_name
       FROM citations c
       LEFT JOIN persons p ON c.person_id = p.id
       LEFT JOIN users u ON c.issuing_officer_id = u.id
       WHERE c.id = ?`,
      id,
    );
    if (!row) return c.json({ error: 'Citation not found', code: 'NOT_FOUND' }, 404);
    return c.json({ data: row });
  } catch (err) {
    log.error('GET /:id failed', { src: 'src/routes/citations.ts' }, err);
    return c.json({ error: 'Failed to get citation', code: 'GET_ERROR' }, 500);
  }
});

// ── POST / — create citation (officer+) ─────────────────────
citations.post('/', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, unknown>>();

    // Required-field validation
    if (typeof b.violation_description !== 'string' || !b.violation_description.trim()) {
      return c.json({ error: 'Violation description is required', code: 'MISSING_DESCRIPTION' }, 400);
    }
    if (!b.violation_date || typeof b.violation_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.violation_date)) {
      return c.json({ error: 'violation_date must be YYYY-MM-DD', code: 'INVALID_DATE' }, 400);
    }
    const type = (typeof b.type === 'string' && VALID_TYPES.has(b.type)) ? b.type : 'traffic';
    const status = (typeof b.status === 'string' && VALID_STATUSES.has(b.status)) ? b.status : 'issued';
    if (b.fine_amount !== undefined && b.fine_amount !== null) {
      const n = parseFloat(String(b.fine_amount));
      if (!Number.isFinite(n) || n < 0) return c.json({ error: 'fine_amount must be non-negative', code: 'INVALID_FINE' }, 400);
    }

    const citationNumber = await generateCitationNumber(db);

    // Allowed columns for INSERT — explicit allow-list keeps the
    // attack surface bounded (no SQL-via-body-key injection).
    const cols: string[] = ['citation_number', 'type', 'status', 'violation_date', 'violation_description'];
    const vals: unknown[] = [citationNumber, type, status, b.violation_date, b.violation_description];

    const optional: Record<string, true> = {
      person_id: true, person_name: true, person_dob: true, person_dl: true, person_address: true,
      vehicle_id: true, vehicle_description: true, vehicle_plate: true, vehicle_state: true,
      vehicle_vin: true, vehicle_year: true, vehicle_make: true, vehicle_model: true, vehicle_color: true,
      statute_id: true, statute_citation: true, offense_level: true, fine_amount: true,
      bond_amount: true, bond_type: true,
      speed_recorded: true, speed_limit: true, radar_type: true, bac_level: true,
      is_warning: true, is_equipment_violation: true, accident_related: true, dui_related: true,
      school_zone: true, construction_zone: true, commercial_vehicle: true, hazmat: true,
      weather_conditions: true, road_conditions: true,
      violation_time: true, location: true, latitude: true, longitude: true,
      section_id: true, sector_id: true, zone_id: true, beat_id: true, zone_beat: true,
      incident_id: true, call_id: true, case_id: true,
      issuing_officer_id: true, issuing_officer_name: true, badge_number: true,
      court_date: true, court_time: true, court_room: true, court_name: true, court_address: true,
      appearance_required: true, notes: true,
    };

    for (const [k, v] of Object.entries(b)) {
      if (!optional[k] || v === undefined) continue;
      cols.push(k);
      vals.push(v ?? null);
    }

    // Backfill geocoded coordinates when location is present but coords
    // are missing (e.g. user typed an address manually rather than using
    // the autocomplete). The enforcement heatmap clusters citations by
    // coords, so NULL lat/lng makes the citation invisible on the map.
    if (b.location && b.latitude === undefined && b.longitude === undefined) {
      const coords = await geocodeAddress(c.env, String(b.location)).catch(() => null);
      if (coords) {
        cols.push('latitude', 'longitude');
        vals.push(coords.lat, coords.lng);
      }
    }

    const result = await execute(
      db,
      `INSERT INTO citations (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      ...vals,
    );
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM citations WHERE id = ?', newId);

    // Analytics lakehouse: citation-issued event (best-effort, fire-and-forget).
    emitAnalytics(c, c.env.EVENTS, [flexEvent({
      event_type: 'citation_issued', occurred_at: new Date().toISOString(),
      actor_id: (c.get('userId') as number | undefined) ?? null,
      entity_type: 'citation', entity_id: newId,
      lat: b.latitude, lng: b.longitude, status, label: type,
      value: b.fine_amount, category: 'enforcement',
      payload: { citation_number: citationNumber, issuing_officer_id: b.issuing_officer_id ?? null, person_id: b.person_id ?? null },
    })]);

    return c.json({ data: created, citation_number: citationNumber }, 201);
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to create citation', 'CREATE_ERROR');
  }
});

// ── PUT /:id — partial update (officer+) ────────────────────
const UPDATABLE: Record<string, true> = {
  type: true, status: true,
  person_id: true, person_name: true, person_dob: true, person_dl: true, person_address: true,
  vehicle_id: true, vehicle_description: true, vehicle_plate: true, vehicle_state: true,
  vehicle_vin: true, vehicle_year: true, vehicle_make: true, vehicle_model: true, vehicle_color: true,
  statute_id: true, statute_citation: true, violation_description: true, offense_level: true,
  fine_amount: true, bond_amount: true, bond_type: true,
  speed_recorded: true, speed_limit: true, radar_type: true, bac_level: true,
  is_warning: true, is_equipment_violation: true, accident_related: true, dui_related: true,
  school_zone: true, construction_zone: true, commercial_vehicle: true, hazmat: true,
  weather_conditions: true, road_conditions: true,
  violation_date: true, violation_time: true, location: true, latitude: true, longitude: true,
  section_id: true, sector_id: true, zone_id: true, beat_id: true, zone_beat: true,
  incident_id: true, call_id: true, case_id: true,
  court_date: true, court_time: true, court_room: true, court_name: true, court_address: true,
  appearance_required: true,
  plea: true, verdict: true, sentence: true, disposition_date: true,
  notes: true,
};

citations.put('/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);

    const existing = await queryFirst<{ id: number; status: string }>(
      db, 'SELECT id, status FROM citations WHERE id = ?', id,
    );
    if (!existing) return c.json({ error: 'Citation not found', code: 'NOT_FOUND' }, 404);

    const b = await c.req.json<Record<string, unknown>>();
    const sets: string[] = [];
    const vals: unknown[] = [];

    for (const [k, v] of Object.entries(b)) {
      if (!UPDATABLE[k]) continue;
      if (k === 'type' && (typeof v !== 'string' || !VALID_TYPES.has(v))) continue;
      if (k === 'status' && (typeof v !== 'string' || !VALID_STATUSES.has(v))) continue;
      sets.push(`${k} = ?`);
      vals.push(v ?? null);
    }

    // Backfill geocode when location is updated but coords are not
    if ('location' in b && typeof b.location === 'string' && b.location.trim().length >= 3
        && b.latitude === undefined && b.longitude === undefined) {
      const coords = await geocodeAddress(c.env, b.location).catch(() => null);
      if (coords) {
        sets.push('latitude = ?', 'longitude = ?');
        vals.push(coords.lat, coords.lng);
      }
    }

    // Voiding bookkeeping — if status transitions to 'voided', capture
    // who/when/why so it's auditable later. Caller can also pass
    // voided_reason in the body explicitly.
    if (b.status === 'voided' && existing.status !== 'voided') {
      sets.push('voided_at = ?', 'voided_by = ?');
      vals.push(new Date().toISOString(), c.get('userId') ?? null);
      if (typeof b.voided_reason === 'string') {
        sets.push('voided_reason = ?');
        vals.push(b.voided_reason);
      }
    }

    if (sets.length === 0) return c.json({ error: 'No fields to update', code: 'NO_FIELDS' }, 400);
    sets.push(`updated_at = datetime('now')`);
    vals.push(id);

    await execute(db, `UPDATE citations SET ${sets.join(', ')} WHERE id = ?`, ...vals);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM citations WHERE id = ?', id);
    return c.json({ data: updated });
  } catch (err) {
    log.error('PUT /:id failed', { src: 'src/routes/citations.ts' }, err);
    return c.json({ error: 'Failed to update citation', code: 'UPDATE_ERROR' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// COPIES — multi-copy PDF upload to R2 (PR 1 of Utah master redesign)
// ═══════════════════════════════════════════════════════════════
//
// Officer device renders the 4 copies (court/agency/defendant/file)
// in-browser via the Utah master form schema, then POSTs them here as
// a single multipart body. We stash each in R2 under
// `citations/<id>/<copy>.pdf` and create/upsert a citation_filing row
// holding the 4 keys + lifecycle status.
//
// Architectural deviation from spec: the spec said MAP_DATA binding,
// but MAP_DATA is the system-essentials bucket (map tiles + reference
// data). User-generated content belongs in UPLOADS (mirrors ALPR,
// redactions, uploads.ts, NSOPW photos). Using UPLOADS here.
const CITATION_COPY_KINDS = ['court', 'agency', 'defendant', 'file'] as const;
type CitationCopyKind = typeof CITATION_COPY_KINDS[number];

// Ensure citation_filing exists. Migration 0150 is supposed to do this,
// but mirrors the project-wide pattern (gotcha #4 + #5): the deploy
// migration apply is continue-on-error, so a runtime reconciler keeps
// production reachable when 0150 hasn't been applied yet via
// scripts/apply-migration.sh.
async function ensureCitationFilingTables(db: ReturnType<typeof getDb>): Promise<void> {
  await execute(db, `
    CREATE TABLE IF NOT EXISTS citation_filing (
      citation_id INTEGER PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      defendant_copy_url TEXT,
      court_copy_url TEXT,
      agency_copy_url TEXT,
      file_copy_url TEXT,
      batch_id INTEGER,
      filed_at TEXT,
      filed_by INTEGER,
      generated_at TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

citations.post('/:id/copies', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);

    // Verify the citation exists before accepting uploads
    const cit = await queryFirst<{ id: number; citation_number: string }>(
      db, 'SELECT id, citation_number FROM citations WHERE id = ?', id,
    );
    if (!cit) return c.json({ error: 'Citation not found', code: 'NOT_FOUND' }, 404);

    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return c.json({ error: 'Expected multipart/form-data', code: 'BAD_MULTIPART' }, 400);
    }

    await ensureCitationFilingTables(db);

    // Upload each provided copy to R2. Officer may upload all 4 at once or
    // a subset (e.g., re-upload after signature stamp). Existing keys for
    // the missing variants are preserved.
    const uploaded: Partial<Record<CitationCopyKind, string>> = {};
    const errors: string[] = [];
    for (const kind of CITATION_COPY_KINDS) {
      const entry = form.get(kind);
      if (!entry || typeof entry !== 'object' || !('arrayBuffer' in (entry as object))) continue;
      const file = entry as File;
      const bytes = new Uint8Array(await file.arrayBuffer());
      // Sanity cap — a single citation PDF should be well under 5 MB
      if (bytes.length > 5 * 1024 * 1024) {
        errors.push(`${kind}: file too large (${bytes.length} bytes; max 5 MB)`);
        continue;
      }
      const key = `citations/${id}/${kind}.pdf`;
      try {
        await putEncrypted(c.env.UPLOADS, db, c.env, key, bytes, {
          httpMetadata: { contentType: 'application/pdf' },
        });
        uploaded[kind] = key;
      } catch (err) {
        errors.push(`${kind}: R2 put failed: ${err instanceof Error ? err.message : String(err) || 'unknown'}`);
      }
    }

    if (Object.keys(uploaded).length === 0) {
      return c.json({
        error: 'No copies were uploaded. Provide multipart fields named court / agency / defendant / file.',
        code: 'NO_COPIES',
        errors,
      }, 400);
    }

    // Upsert citation_filing row. INSERT OR IGNORE then UPDATE keeps existing
    // keys for variants not in this upload (idempotent partial uploads).
    await execute(
      db,
      `INSERT OR IGNORE INTO citation_filing (citation_id, status, generated_at)
       VALUES (?, 'pending', datetime('now'))`,
      id,
    );
    const sets: string[] = ['generated_at = COALESCE(generated_at, datetime("now"))', 'updated_at = datetime("now")'];
    const vals: unknown[] = [];
    if (uploaded.court)     { sets.push('court_copy_url = ?');     vals.push(uploaded.court); }
    if (uploaded.agency)    { sets.push('agency_copy_url = ?');    vals.push(uploaded.agency); }
    if (uploaded.defendant) { sets.push('defendant_copy_url = ?'); vals.push(uploaded.defendant); }
    if (uploaded.file)      { sets.push('file_copy_url = ?');      vals.push(uploaded.file); }
    vals.push(id);
    await execute(
      db,
      `UPDATE citation_filing SET ${sets.join(', ')} WHERE citation_id = ?`,
      ...vals,
    );

    const filingRow = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM citation_filing WHERE citation_id = ?', id,
    );

    // Analytics: citation_copies_stored event (best-effort).
    emitAnalytics(c, c.env.EVENTS, [flexEvent({
      event_type: 'citation_copies_stored', occurred_at: new Date().toISOString(),
      actor_id: (c.get('userId') as number | undefined) ?? null,
      entity_type: 'citation', entity_id: id,
      label: cit.citation_number, status: 'pending',
      category: 'enforcement',
      payload: { uploaded_kinds: Object.keys(uploaded), errors: errors.length ? errors : undefined },
    })]);

    return c.json({
      data: filingRow,
      uploaded_kinds: Object.keys(uploaded),
      ...(errors.length ? { errors } : {}),
    }, 201);
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to upload copies', 'COPIES_UPLOAD_ERROR');
  }
});

// GET /:id/filing — return the citation_filing row + presigned URLs for the
// 4 copies. Officer/admin uses this to fetch the defendant copy for re-print
// or to retrieve the court copy from the batch export workflow (PR 3).
citations.get('/:id/filing', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
    await ensureCitationFilingTables(db);
    const row = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM citation_filing WHERE citation_id = ?', id,
    );
    if (!row) return c.json({ data: null });
    return c.json({ data: row });
  } catch (err) {
    log.error('GET /:id/filing failed', { src: 'src/routes/citations.ts' }, err);
    return c.json({ error: 'Failed to get filing record', code: 'FILING_GET_ERROR' }, 500);
  }
});

// GET /:id/copies/:kind — return the R2 PDF bytes for a given copy.
// Public-ish (auth: officer+) — officer can re-fetch the defendant copy to
// reprint if the violator dropped the original.
citations.get('/:id/copies/:kind', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor', 'dispatcher');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const kind = c.req.param('kind') as CitationCopyKind;
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
    if (!CITATION_COPY_KINDS.includes(kind)) {
      return c.json({ error: 'Invalid copy kind', code: 'INVALID_KIND' }, 400);
    }
    const key = `citations/${id}/${kind}.pdf`;
    const decrypted = await getDecrypted(c.env.UPLOADS, db, c.env, key);
    let body: BodyInit;
    let contentType = 'application/pdf';
    if (decrypted) {
      body = decrypted.bytes;
      contentType = decrypted.httpMetadata?.contentType || contentType;
    } else {
      // getDecrypted() returns null both for "object never existed" and for
      // "object exists but has no file_encryption_keys row" — the latter is
      // exactly what a citation PDF copy uploaded before this feature
      // shipped looks like. Fall back to a raw R2 read so those pre-existing
      // copies stay retrievable instead of permanently 404ing. A genuine
      // decrypt failure (bad KEK, tampered ciphertext) throws out of
      // getDecrypted() rather than returning null, so it's caught by this
      // handler's own try/catch below and never reaches this fallback.
      const legacy = await c.env.UPLOADS.get(key);
      if (!legacy) return c.json({ error: 'Copy not found', code: 'NOT_FOUND' }, 404);
      body = legacy.body;
      contentType = legacy.httpMetadata?.contentType || contentType;
    }
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=60',
        'Content-Disposition': `inline; filename="citation-${id}-${kind}.pdf"`,
      },
    });
  } catch (err) {
    log.error('GET /:id/copies/:kind failed', { src: 'src/routes/citations.ts' }, err);
    return c.json({ error: 'Failed to fetch copy', code: 'COPY_FETCH_ERROR' }, 500);
  }
});

// ── DELETE /:id — admin/manager only ────────────────────────
citations.delete('/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM citations WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Citation not found', code: 'NOT_FOUND' }, 404);
    // Children (violations, payments) CASCADE via FK. Belt-and-suspenders
    // explicit deletes here in case PRAGMA foreign_keys isn't ON.
    await execute(db, 'DELETE FROM citation_payments WHERE citation_id = ?', id);
    await execute(db, 'DELETE FROM citation_violations WHERE citation_id = ?', id);
    await execute(db, 'DELETE FROM citations WHERE id = ?', id);
    return c.json({ success: true });
  } catch (err) {
    log.error('DELETE /:id failed', { src: 'src/routes/citations.ts' }, err);
    return c.json({ error: 'Failed to delete citation', code: 'DELETE_ERROR' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// PAYMENTS — citation_payments child table
// ═══════════════════════════════════════════════════════════════

citations.get('/:id/payments', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT p.*, u.full_name as recorded_by_name
       FROM citation_payments p
       LEFT JOIN users u ON p.recorded_by = u.id
       WHERE p.citation_id = ?
       ORDER BY p.payment_date DESC, p.id DESC`,
      id,
    );
    const totalRow = await queryFirst<{ total: number }>(
      db, 'SELECT COALESCE(SUM(amount), 0) as total FROM citation_payments WHERE citation_id = ?', id,
    );
    const fineRow = await queryFirst<{ fine_amount: number | null }>(
      db, 'SELECT fine_amount FROM citations WHERE id = ?', id,
    );
    const totalAmount = Number(fineRow?.fine_amount ?? 0) || 0;
    const totalPaid = totalRow?.total ?? 0;
    // CitationsPage reads res.data.payments / total_amount / total_paid / remaining;
    // returning the bare rows as `data` crashed the Payment Tracking section.
    return c.json({
      data: {
        payments: rows,
        total_amount: totalAmount,
        total_paid: totalPaid,
        remaining: Math.max(0, totalAmount - totalPaid),
      },
    });
  } catch (err) {
    log.error('GET /:id/payments failed', { src: 'src/routes/citations.ts' }, err);
    return c.json({ error: 'Failed to get payments', code: 'PAYMENTS_GET_ERROR' }, 500);
  }
});

citations.post('/:id/payments', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
    const userId = c.get('userId') as number;
    const b = await c.req.json<{
      amount?: number; payment_date?: string; payment_method?: string;
      reference_number?: string; notes?: string;
    }>();
    if (typeof b.amount !== 'number' || b.amount <= 0) {
      return c.json({ error: 'amount must be a positive number', code: 'INVALID_AMOUNT' }, 400);
    }

    const cit = await queryFirst<{ id: number; fine_amount: number | null }>(
      db, 'SELECT id, fine_amount FROM citations WHERE id = ?', id,
    );
    if (!cit) return c.json({ error: 'Citation not found', code: 'NOT_FOUND' }, 404);

    const result = await execute(
      db,
      `INSERT INTO citation_payments (citation_id, amount, payment_date, payment_method, reference_number, notes, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id, b.amount, b.payment_date ?? new Date().toISOString().slice(0, 10),
      b.payment_method ?? null, b.reference_number ?? null, b.notes ?? null, userId,
    );
    const paymentId = Number(result.meta.last_row_id);

    // Auto-mark citation paid when total payments meet/exceed fine
    if (cit.fine_amount && cit.fine_amount > 0) {
      const totalRow = await queryFirst<{ total: number }>(
        db, 'SELECT COALESCE(SUM(amount), 0) as total FROM citation_payments WHERE citation_id = ?', id,
      );
      if ((totalRow?.total ?? 0) >= cit.fine_amount) {
        await execute(db, `UPDATE citations SET status = 'paid', updated_at = datetime('now') WHERE id = ?`, id);
      }
    }

    const payment = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM citation_payments WHERE id = ?', paymentId);
    return c.json({ data: payment }, 201);
  } catch (err) {
    log.error('POST /:id/payments failed', { src: 'src/routes/citations.ts' }, err);
    return c.json({ error: 'Failed to record payment', code: 'PAYMENTS_POST_ERROR' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// VIOLATIONS — citation_violations child table
// ═══════════════════════════════════════════════════════════════

citations.get('/:id/violations', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT * FROM citation_violations WHERE citation_id = ? ORDER BY violation_number, id`,
      id,
    );
    return c.json({ data: rows });
  } catch (err) {
    log.error('GET /:id/violations failed', { src: 'src/routes/citations.ts' }, err);
    return c.json({ error: 'Failed to get violations', code: 'VIOLATIONS_GET_ERROR' }, 500);
  }
});

citations.post('/:id/violations', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'officer');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
    const b = await c.req.json<{
      violation_number?: number; statute_id?: number; statute_citation?: string;
      violation_code?: string; violation_description?: string; offense_level?: string;
      fine_amount?: number; speed_recorded?: number; speed_limit?: number; notes?: string;
    }>();
    if (!b.violation_description?.trim()) {
      return c.json({ error: 'violation_description required', code: 'MISSING_DESCRIPTION' }, 400);
    }

    // Auto-assign violation_number if not supplied
    let violationNumber = b.violation_number;
    if (!violationNumber) {
      const maxRow = await queryFirst<{ max_num: number }>(
        db, 'SELECT COALESCE(MAX(violation_number), 0) as max_num FROM citation_violations WHERE citation_id = ?', id,
      );
      violationNumber = (maxRow?.max_num ?? 0) + 1;
    }

    const result = await execute(
      db,
      `INSERT INTO citation_violations (
         citation_id, violation_number, statute_id, statute_citation,
         violation_code, violation_description, offense_level, fine_amount,
         speed_recorded, speed_limit, notes
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, violationNumber, b.statute_id ?? null, b.statute_citation ?? null,
      b.violation_code ?? b.statute_citation ?? `VIO-${violationNumber}`,
      b.violation_description, b.offense_level ?? 'infraction', b.fine_amount ?? 0,
      b.speed_recorded ?? null, b.speed_limit ?? null, b.notes ?? null,
    );
    const violation = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM citation_violations WHERE id = ?', Number(result.meta.last_row_id),
    );
    return c.json({ data: violation }, 201);
  } catch (err) {
    log.error('POST /:id/violations failed', { src: 'src/routes/citations.ts' }, err);
    return c.json({ error: 'Failed to add violation', code: 'VIOLATION_POST_ERROR' }, 500);
  }
});

const VIOLATION_UPDATABLE: Record<string, true> = {
  statute_id: true, statute_citation: true, violation_description: true,
  offense_level: true, fine_amount: true, speed_recorded: true, speed_limit: true,
  plea: true, verdict: true, disposition: true, disposition_date: true, notes: true,
};

citations.put('/:id/violations/:violationId', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'officer');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const citationId = parseInt(c.req.param('id'), 10);
    const violationId = parseInt(c.req.param('violationId'), 10);
    if (!Number.isFinite(citationId) || citationId < 1 || !Number.isFinite(violationId) || violationId < 1) return c.json({ error: 'Invalid IDs', code: 'INVALID_ID' }, 400);

    const existing = await queryFirst<{ id: number }>(
      db, 'SELECT id FROM citation_violations WHERE id = ? AND citation_id = ?', violationId, citationId,
    );
    if (!existing) return c.json({ error: 'Violation not found', code: 'NOT_FOUND' }, 404);

    const b = await c.req.json<Record<string, unknown>>();
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(b)) {
      if (!VIOLATION_UPDATABLE[k]) continue;
      sets.push(`${k} = ?`);
      vals.push(v ?? null);
    }
    if (sets.length === 0) return c.json({ error: 'No fields to update', code: 'NO_FIELDS' }, 400);
    vals.push(violationId);

    await execute(db, `UPDATE citation_violations SET ${sets.join(', ')} WHERE id = ?`, ...vals);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM citation_violations WHERE id = ?', violationId);
    return c.json({ data: updated });
  } catch (err) {
    log.error('PUT /:id/violations/:violationId failed', { src: 'src/routes/citations.ts' }, err);
    return c.json({ error: 'Failed to update violation', code: 'VIOLATION_PUT_ERROR' }, 500);
  }
});

citations.delete('/:id/violations/:violationId', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const citationId = parseInt(c.req.param('id'), 10);
    const violationId = parseInt(c.req.param('violationId'), 10);
    if (!Number.isFinite(citationId) || citationId < 1 || !Number.isFinite(violationId) || violationId < 1) return c.json({ error: 'Invalid IDs', code: 'INVALID_ID' }, 400);
    const result = await execute(
      db, 'DELETE FROM citation_violations WHERE id = ? AND citation_id = ?', violationId, citationId,
    );
    if (result.meta.changes === 0) return c.json({ error: 'Violation not found', code: 'NOT_FOUND' }, 404);
    return c.json({ success: true });
  } catch (err) {
    log.error('DELETE /:id/violations/:violationId failed', { src: 'src/routes/citations.ts' }, err);
    return c.json({ error: 'Failed to delete violation', code: 'VIOLATION_DELETE_ERROR' }, 500);
  }
});

// ── GET /export/csv — supervisor+ only ──────────────────────
citations.get('/export/csv', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const dateFrom = c.req.query('date_from');
    const dateTo = c.req.query('date_to');
    const where: string[] = ['1=1'];
    const params: unknown[] = [];
    if (dateFrom) { where.push('violation_date >= ?'); params.push(dateFrom); }
    if (dateTo) { where.push('violation_date <= ?'); params.push(dateTo); }

    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT c.citation_number, c.type, c.status, c.violation_date, c.violation_time,
              c.person_name, c.person_dob, c.person_dl,
              c.vehicle_plate, c.vehicle_state,
              c.statute_citation, c.violation_description, c.offense_level, c.fine_amount,
              c.location, u.full_name as officer_name, c.badge_number,
              c.court_date, c.court_name, c.created_at
       FROM citations c
       LEFT JOIN users u ON c.issuing_officer_id = u.id
       WHERE ${where.join(' AND ')}
       ORDER BY c.violation_date DESC LIMIT 10000`,
      ...params,
    );

    const headers = [
      { key: 'citation_number', label: 'Citation #' },
      { key: 'type', label: 'Type' },
      { key: 'status', label: 'Status' },
      { key: 'violation_date', label: 'Date' },
      { key: 'violation_time', label: 'Time' },
      { key: 'person_name', label: 'Person' },
      { key: 'person_dob', label: 'DOB' },
      { key: 'person_dl', label: 'DL' },
      { key: 'vehicle_plate', label: 'Plate' },
      { key: 'vehicle_state', label: 'State' },
      { key: 'statute_citation', label: 'Statute' },
      { key: 'violation_description', label: 'Description' },
      { key: 'offense_level', label: 'Level' },
      { key: 'fine_amount', label: 'Fine' },
      { key: 'location', label: 'Location' },
      { key: 'officer_name', label: 'Officer' },
      { key: 'badge_number', label: 'Badge' },
      { key: 'court_date', label: 'Court Date' },
      { key: 'court_name', label: 'Court' },
      { key: 'created_at', label: 'Created' },
    ];
    const head = headers.map((h) => csvEscape(h.label)).join(',');
    const body = rows.map((r) => headers.map((h) => csvEscape(r[h.key])).join(',')).join('\n');
    const csv = `${head}\n${body}\n`;
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="citations_${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (err) {
    log.error('GET /export/csv failed', { src: 'src/routes/citations.ts' }, err);
    return c.json({ error: 'Failed to export citations', code: 'EXPORT_ERROR' }, 500);
  }
});

// ── Statute lookup / autocomplete ─────────────────────────────
citations.get('/statutes/lookup', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query('q');
    const offenseLevel = c.req.query('offense_level');
    if (!q || q.length < 2) return c.json({ data: [] });
    const searchTerm = `%${q}%`;
    const params: unknown[] = [searchTerm, searchTerm, searchTerm];
    let whereExtra = '';
    if (offenseLevel) { whereExtra = ' AND s.offense_level = ?'; params.push(offenseLevel); }
    const rows = await query<Record<string, unknown>>(db,
      // Live utah_statutes: `citation` (not citation_code), `citation_fine`
      // (not default_fine). Aliased so the response shape is unchanged.
      `SELECT s.id, s.citation AS citation_code, s.title, s.offense_level,
              s.citation_fine AS default_fine, s.description
       FROM utah_statutes s WHERE (s.citation LIKE ? OR s.title LIKE ? OR s.description LIKE ?)${whereExtra}
       ORDER BY s.citation LIMIT 20`, ...params);
    return c.json({ data: rows });
  } catch { return c.json({ data: [] }); }
});

// ── Batch citation creation (traffic enforcement) ────────────
citations.post('/batch', async (c) => {
  // Bulk citation creation was the one citations mutation with no role gate —
  // every other write requires an issuing role. Match them so the external
  // contract_manager role can't bulk-insert enforcement records.
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number | undefined;
    const body = await c.req.json<{ citations: Array<Record<string, unknown>> }>();
    if (!Array.isArray(body.citations) || !body.citations.length) return c.json({ error: 'citations array required' }, 400);
    const created: number[] = [];
    for (const cit of body.citations) {
      if (!cit.type || !cit.person_name || !cit.violation_description) continue;
      const cols = ['type', 'person_name', 'violation_description', 'status', 'issuing_officer_id', 'created_at', 'updated_at'];
      const vals = ['?', '?', '?', "'issued'", '?', "datetime('now')", "datetime('now')"];
      const params: unknown[] = [cit.type, cit.person_name, cit.violation_description, userId ?? null];
      if (cit.person_dob) { cols.push('person_dob'); vals.push('?'); params.push(cit.person_dob); }
      if (cit.statute_id) { cols.push('statute_id'); vals.push('?'); params.push(cit.statute_id); }
      if (cit.fine_amount) { cols.push('fine_amount'); vals.push('?'); params.push(cit.fine_amount); }
      if (cit.location) { cols.push('location'); vals.push('?'); params.push(cit.location); }
      if (cit.court_name) { cols.push('court_name'); vals.push('?'); params.push(cit.court_name); }
      if (cit.violation_date) { cols.push('violation_date'); vals.push('?'); params.push(cit.violation_date); }
      if (cit.notes) { cols.push('notes'); vals.push('?'); params.push(cit.notes); }
      const r = await execute(db, `INSERT INTO citations (${cols.join(',')}) VALUES (${vals.join(',')})`, ...params);
      created.push(Number(r.meta.last_row_id));
    }
    return c.json({ success: true, created: created.length, ids: created });
  } catch (err) {
    log.error('POST /batch failed', { src: 'src/routes/citations.ts' }, err); return c.json({ error: 'Batch creation failed' }, 500); }
});

export default citations;
