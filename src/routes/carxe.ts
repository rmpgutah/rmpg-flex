// src/routes/carxe.ts
// ============================================================
// RMPG Flex — CarsXE vehicle-data lookup routes
// ============================================================
// Mounted at /api/carxe (auth: 'required'). Manual, officer-triggered
// lookups only — never runs automatically. Checks a D1 cache
// (carxe_lookups) before calling out to avoid re-billing CarsXE credits
// on repeat lookups. Lien & Theft results with an active theft flag are
// wired into the existing screenVehicle() critical-hit notification path
// (same one Roboflow ALPR uses) — see recordCarxeTheftHit() below.
//
// No recordAudit() calls here — matches src/routes/legalDataHunter.ts,
// which also skips it. The carxe_lookups table (requested_by_user_id +
// created_at on every row) is itself the audit trail for this route.
//
// Spec: docs/superpowers/specs/2026-07-30-carxe-api-integration-design.md
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { notConfigured } from '../utils/notConfigured';
import {
  configFromEnv,
  decodePlate,
  getSpecifications,
  getLienTheft,
  getHistory,
  type CarxeConfig,
} from '../utils/carxe/client';
import type { CarxeLienTheftResult } from '../utils/carxe/types';
import { CarxeConfigError, CarxeError, CarxeHttpError, CarxeRateLimitError, CarxeTimeoutError } from '../utils/carxe/errors';
import { checkAndReserveCarxeCall } from '../utils/carxe/rateLimit';
import { screenVehicle } from '../utils/intelScreen';
import {
  upsertVehicleFromCarxe,
  fieldsFromPlateResult,
  fieldsFromSpecsResult,
  fieldsFromHistoryResult,
  normalizeId,
  parseVehicleYear,
  type VehicleIdentity,
} from '../utils/carxe/vehicleRecords';
import type { CarxePlateResult, CarxeSpecsResult, CarxeHistoryResult } from '../utils/carxe/types';
import { parseD1TimestampMs } from '../utils/fleetio/sync';
import { log } from '../utils/logger';

const carxe = new Hono<Env>();

// Field-operational roles; client_viewer / contract_manager / human_resources
// excluded — mirrors the alpr.ts / intel.ts gate.
const operational = requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher');

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** How long a CarsXE theft notification suppresses a duplicate for the SAME
 *  (vehicle, recipient) pair. Deliberately equal to CACHE_TTL_MS: within the
 *  cache window a re-pull returns a byte-identical cached payload, so a second
 *  notification carries zero new information. Once the cache expires the next
 *  pull is a genuinely fresh CarsXE assertion that the theft is still active,
 *  and re-alerting is correct. Per-recipient, not global — a different officer
 *  pulling the same VIN must still be warned. */
const THEFT_NOTIFY_DEDUPE_MS = CACHE_TTL_MS;

type CarxeEnv = {
  CARXE_API_KEY?: string;
  CARXE_API_BASE?: string;
  DB: D1Database;
  CARXE_RATE_KV?: KVNamespace;
  KV?: KVNamespace;
};

interface CachedLookupRow {
  id: number;
  response_json: string;
  created_at: string;
}

async function findFreshCache(
  db: D1Database,
  lookupType: string,
  key: { plate?: string; state?: string; vin?: string },
): Promise<CachedLookupRow | null> {
  // Note: `state IS ?` (not `= ?`) — SQLite NULL-safe equality. A plate
  // lookup with no state (the primary UI path — PlateLogPage calls
  // CarxeLookupPanel without a state prop) binds state=null, and
  // `state = NULL` never matches under standard SQL null semantics, so
  // that lookup would never hit cache with the plain `=` form.
  const row = key.vin
    ? await queryFirst<CachedLookupRow>(
        db,
        'SELECT id, response_json, created_at FROM carxe_lookups WHERE lookup_type = ? AND vin = ? ORDER BY created_at DESC LIMIT 1',
        lookupType,
        key.vin,
      )
    : await queryFirst<CachedLookupRow>(
        db,
        'SELECT id, response_json, created_at FROM carxe_lookups WHERE lookup_type = ? AND plate = ? AND state IS ? ORDER BY created_at DESC LIMIT 1',
        lookupType,
        key.plate ?? null,
        key.state ?? null,
      );
  if (!row) return null;
  const createdMs = parseD1TimestampMs(row.created_at);
  if (createdMs === null) return null;
  const ageMs = Date.now() - createdMs;
  return ageMs <= CACHE_TTL_MS ? row : null;
}

async function persistLookup(
  db: D1Database,
  lookupType: string,
  key: { plate?: string; state?: string; vin?: string },
  response: unknown,
  userId: number | undefined,
): Promise<void> {
  await execute(
    db,
    'INSERT INTO carxe_lookups (lookup_type, plate, state, vin, response_json, requested_by_user_id) VALUES (?, ?, ?, ?, ?, ?)',
    lookupType,
    key.plate ?? null,
    key.state ?? null,
    key.vin ?? null,
    JSON.stringify(response),
    userId ?? null,
  );
}

/** Maps a CarxeError subclass to an HTTP status + client-safe body.
 *  NEVER echoes err.detail — it may carry the raw CarsXE response, which
 *  (like Fleet.io's) could theoretically echo request params back. */
function errorResponse(c: any, err: unknown) {
  if (err instanceof CarxeRateLimitError) {
    return c.json({ ok: false, code: 'rate_limited', message: err.message }, 429);
  }
  if (err instanceof CarxeTimeoutError) {
    return c.json({ ok: false, code: 'timeout', message: err.message }, 504);
  }
  if (err instanceof CarxeHttpError) {
    return c.json({ ok: false, code: 'upstream_error', message: err.message }, 502);
  }
  if (err instanceof CarxeError) {
    return c.json({ ok: false, code: 'carxe_error', message: err.message }, 500);
  }
  log.error('[carxe] unexpected error', { error: (err as any)?.message });
  return c.json({ ok: false, code: 'internal_error' }, 500);
}

/** Validates CARXE_API_KEY is set, first, before any body parsing — pinned by
 *  test-workers/carxe.test.ts ("returns invalid_input when plate is missing"),
 *  which asserts not_configured wins over invalid_input when both apply. */
async function resolveCarxeConfig(c: any): Promise<{ config: CarxeConfig } | { response: Response }> {
  const env = c.env as Record<string, unknown> as CarxeEnv;
  try {
    return { config: configFromEnv(env) };
  } catch (err) {
    if (err instanceof CarxeConfigError) return { response: notConfigured(c, 'CARXE_API_KEY is unset') };
    throw err;
  }
}

/** Shared preamble for all four POST handlers: cache probe → KV resolution +
 *  fail-closed rate-limit check → live CarsXE call → persistLookup, all
 *  inside one try/catch boundary. Centralizing this fixes two bugs that lived
 *  in the per-handler duplication: the env cast used by /plate-lookup omitted
 *  `KV?: KVNamespace` (present on the other three), and /lien-theft's
 *  persistLookup + follow-on vehicles_records query sat OUTSIDE the
 *  try/catch that wraps the live call in the other handlers, so a D1 failure
 *  there escaped errorResponse() and 500'd through the global handler
 *  untyped. */
async function runCarxeLookup(
  c: any,
  config: CarxeConfig,
  lookupType: string,
  cacheKey: { plate?: string; state?: string; vin?: string },
  callCarsXE: (config: CarxeConfig) => Promise<unknown>,
): Promise<{ response: Response } | { result: unknown; cached: boolean; db: D1Database }> {
  const env = c.env as Record<string, unknown> as CarxeEnv;
  const db = getDb(env);

  const cached = await findFreshCache(db, lookupType, cacheKey);
  if (cached) {
    return { result: JSON.parse(cached.response_json), cached: true, db };
  }

  const rateKv = (env.CARXE_RATE_KV ?? env.KV) as KVNamespace | undefined;
  if (!rateKv) {
    log.warn('[carxe] rate-limit KV binding unavailable — failing closed', { route: lookupType });
    return {
      response: c.json({ ok: false, code: 'rate_limit_unavailable', message: 'Rate limiting is not configured' }, 500),
    };
  }
  const budget = await checkAndReserveCarxeCall(rateKv, Date.now());
  if (!budget.allowed) return { response: c.json({ ok: false, code: 'rate_limited' }, 429) };

  try {
    const result = await callCarsXE(config);
    const user = c.get('user') as { id?: number } | undefined;
    await persistLookup(db, lookupType, cacheKey, result, user?.id);
    return { result, cached: false, db };
  } catch (err) {
    return { response: errorResponse(c, err) };
  }
}

/** Matches a genuinely ACTIVE theft event — requires both "active" and
 *  "theft" in the event string, so "Theft Record Cleared" / "Theft
 *  Recovered" / other historical theft events do NOT trigger an
 *  officer-safety-critical alert. A bare `.includes('theft')` previously
 *  matched all of those false positives. */
function isActiveTheftEvent(eventText: string | undefined): boolean {
  const ev = (eventText || '').toLowerCase();
  return ev.includes('active') && ev.includes('theft');
}

/** On a genuine active-theft CarsXE finding: upsert a vehicles_records row by
 *  VIN (mirrors alpr.ts's upsertVehicleRecord pattern — enrich-if-exists,
 *  create-if-not), write the theft status onto it (is_stolen + stolen_status,
 *  the exact columns/values screenVehicle() in intelScreen.ts reads — see
 *  `vehicle.is_stolen === 1 || isRealValue(vehicle.stolen_status)`), merge a
 *  flag into the JSON `flags` column (same append pattern records.ts uses
 *  for `{type:'archived'}`), then run screenVehicle() against that row so it
 *  actually observes the flag just written, and mirror alpr.ts's
 *  finalizeCapture() critical-hit notification INSERT (same column set:
 *  type/priority/title/message/entity_type/entity_id/user_id/is_read/
 *  created_at) for any critical hit. */
async function recordCarxeTheftHit(
  db: D1Database,
  identity: VehicleIdentity,
  lienTheft: CarxeLienTheftResult,
  userId: number | undefined,
): Promise<{ vehicleId: number | null; hits: unknown[] }> {
  const vin = normalizeId(identity.vin) ?? '';

  // Resolve identity by VIN **or plate** and fill descriptive fields in one
  // step. Previously this matched on `UPPER(vin) = ?` alone, which on live data
  // (38/42 rows have no VIN) meant a theft lookup for a car already known by
  // plate INSERTed a SECOND row — stamping is_stolen=1 on an orphan while the
  // plate-keyed record officers see in the dossier stayed clean.
  const { vehicleId } = await upsertVehicleFromCarxe(
    db,
    identity,
    {
      make: lienTheft.make ?? null,
      model: lienTheft.model ?? null,
      // CarsXE returns strings/ranges like "2014-2015"; a raw bind into the
      // INTEGER year column stores 0. Same parse as the plate/specs paths.
      year: parseVehicleYear(lienTheft.year),
    },
    'Created from CarsXE lien/theft lookup',
  );

  const existing = await queryFirst<{ flags: string | null }>(
    db,
    'SELECT flags FROM vehicles_records WHERE id = ?',
    vehicleId,
  );

  const stolenStatus = 'Active theft (CarsXE)';

  {
    const flags = (() => {
      try {
        const parsed = JSON.parse(existing?.flags || '[]');
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    })();
    if (!flags.some((f: any) => typeof f === 'object' && f?.type === 'carxe_theft')) {
      flags.push({ type: 'carxe_theft', source: 'carsxe_lien_theft', flagged_at: new Date().toISOString() });
    }
    // is_stolen / stolen_status OVERWRITE rather than COALESCE-fill — unlike the
    // descriptive columns above, this is an officer-safety signal and a stale
    // blank must never win over a live active-theft finding.
    await execute(
      db,
      `UPDATE vehicles_records SET
         is_stolen = 1, stolen_status = ?, flags = ?, updated_at = datetime('now')
       WHERE id = ?`,
      stolenStatus,
      JSON.stringify(flags),
      vehicleId,
    );
  }

  const screening = await screenVehicle(db, { vehicleId });

  const critical = screening.hits.filter((h) => h.severity === 'critical');
  if (critical.length) {
    try {
      // Suppress a duplicate alert for the same (vehicle, recipient) inside the
      // dedupe window. The flag/is_stolen writes above are already idempotent,
      // but this INSERT was not: because the theft path deliberately runs on
      // cache hits too (so a cached active-theft VIN still screens), every
      // re-pull of the same VIN previously appended another notification row.
      //
      // The window is evaluated entirely in SQLite via datetime('now', ...) —
      // both sides are UTC there. Doing it in JS would mean Date.parse()-ing a
      // zone-less `datetime('now')` string, which reads as LOCAL time and skews
      // the comparison on a non-UTC host (see CLAUDE.md / parseD1TimestampMs).
      const dedupeHours = Math.max(1, Math.round(THEFT_NOTIFY_DEDUPE_MS / 3_600_000));
      const recent = await queryFirst<{ id: number }>(
        db,
        `SELECT id FROM notifications
          WHERE type = 'intel_screen'
            AND entity_type = 'vehicle'
            AND entity_id = ?
            AND user_id IS ?
            AND title = ?
            AND created_at > datetime('now', ?)
          LIMIT 1`,
        vehicleId,
        userId ?? null,
        `CARSXE THEFT HIT: VIN ${vin}`,
        `-${dedupeHours} hours`,
      );

      if (recent) {
        log.info('[carxe] theft notification suppressed as duplicate', {
          vin,
          vehicleId,
          userId: userId ?? null,
          existingNotificationId: recent.id,
        });
      } else {
        await execute(
          db,
          `INSERT INTO notifications (type, priority, title, message, entity_type, entity_id, user_id, is_read, created_at)
           VALUES ('intel_screen', 'high', ?, ?, 'vehicle', ?, ?, 0, datetime('now'))`,
          `CARSXE THEFT HIT: VIN ${vin}`,
          critical.map((h) => h.detail).join('; '),
          vehicleId,
          userId ?? null,
        );
      }
    } catch (err: any) {
      log.error('[carxe] theft notification insert failed', { error: err?.message });
    }
  }

  return screening;
}

carxe.post('/plate-lookup', operational, async (c) => {
  const cfg = await resolveCarxeConfig(c);
  if ('response' in cfg) return cfg.response;

  const body = await c.req.json<{ plate?: string; state?: string }>().catch(() => ({} as { plate?: string; state?: string }));
  const plate = (body.plate || '').trim().toUpperCase();
  const state = (body.state || '').trim().toUpperCase() || undefined;
  if (!plate) return c.json({ ok: false, code: 'invalid_input', message: 'plate is required' }, 400);

  const outcome = await runCarxeLookup(c, cfg.config, 'plate', { plate, state }, (config) =>
    decodePlate(config, { plate, state }),
  );
  if ('response' in outcome) return outcome.response;

  // Bridge the plate→VIN gap. This is the ONLY CarsXE endpoint the UI can
  // reach (both call sites pass mode="plate"), and it previously wrote nothing
  // to vehicles_records — so an officer ran a plate, saw make/model/VIN on
  // screen, and the RMS learned nothing. Writing the decoded VIN onto the
  // plate-keyed record is also what makes the VIN-keyed lookups (specs,
  // lien/theft, history) resolvable at all on a fleet that is 90% VIN-less.
  //
  // Fill-only: upsertVehicleFromCarxe COALESCEs every column, so this can
  // populate blanks but never overwrite officer-entered data.
  const plateResult = outcome.result as CarxePlateResult;
  let vehicle: { vehicleId: number; created: boolean; filled: number } | undefined;
  try {
    vehicle = await upsertVehicleFromCarxe(
      outcome.db,
      { plate, state, vin: plateResult.vin },
      fieldsFromPlateResult(plateResult),
      'Created from CarsXE plate lookup',
    );
  } catch (err: any) {
    // A record-write failure must never fail the lookup the officer asked for —
    // they still need the data on screen. Log and degrade.
    log.error('[carxe] plate-lookup vehicle upsert failed', { plate, error: err?.message });
  }

  return c.json({
    ok: true,
    cached: outcome.cached,
    result: outcome.result,
    ...(vehicle ? { vehicle_record: vehicle } : {}),
  });
});

carxe.post('/vin-specs', operational, async (c) => {
  const cfg = await resolveCarxeConfig(c);
  if ('response' in cfg) return cfg.response;

  const body = await c.req.json<{ vin?: string; plate?: string; state?: string }>().catch(() => ({} as { vin?: string; plate?: string; state?: string }));
  const vin = (body.vin || '').trim().toUpperCase();
  const plate = (body.plate || '').trim().toUpperCase() || undefined;
  const state = (body.state || '').trim().toUpperCase() || undefined;
  if (!vin) return c.json({ ok: false, code: 'invalid_input', message: 'vin is required' }, 400);

  const outcome = await runCarxeLookup(c, cfg.config, 'vin_specs', { vin }, (config) => getSpecifications(config, { vin }));
  if ('response' in outcome) return outcome.response;

  // Specs carry exactly the columns vehicles_records already has and rarely has
  // filled: trim, body_style, engine_type, fuel_type, transmission, drive_type,
  // doors. `plate`/`state` are optional and let the UI resolve onto the
  // plate-keyed record it's already showing rather than a VIN-only row.
  const specsResult = outcome.result as CarxeSpecsResult;
  let vehicle: { vehicleId: number; created: boolean; filled: number } | undefined;
  try {
    vehicle = await upsertVehicleFromCarxe(
      outcome.db,
      { vin, plate, state },
      fieldsFromSpecsResult(specsResult),
      'Created from CarsXE VIN specifications lookup',
    );
  } catch (err: any) {
    log.error('[carxe] vin-specs vehicle upsert failed', { vin, error: err?.message });
  }

  return c.json({
    ok: true,
    cached: outcome.cached,
    result: outcome.result,
    ...(vehicle ? { vehicle_record: vehicle } : {}),
  });
});

carxe.post('/lien-theft', operational, async (c) => {
  const cfg = await resolveCarxeConfig(c);
  if ('response' in cfg) return cfg.response;

  const body = await c.req.json<{ vin?: string; plate?: string; state?: string }>().catch(() => ({} as { vin?: string; plate?: string; state?: string }));
  const vin = (body.vin || '').trim().toUpperCase();
  const plate = (body.plate || '').trim().toUpperCase() || undefined;
  const state = (body.state || '').trim().toUpperCase() || undefined;
  if (!vin) return c.json({ ok: false, code: 'invalid_input', message: 'vin is required' }, 400);

  const outcome = await runCarxeLookup(c, cfg.config, 'lien_theft', { vin }, (config) => getLienTheft(config, { vin }));
  if ('response' in outcome) return outcome.response;

  const { result, cached, db } = outcome;
  const lienTheft = result as CarxeLienTheftResult;
  // `plate`/`state` are optional context from the UI. They matter because the
  // theft write resolves identity by VIN *or* plate — without them, a VIN-only
  // lookup against a plate-keyed record can't find its target.
  const identity: VehicleIdentity = { vin, plate, state };

  // Wire a genuine active-theft flag into the same officer-safety screening
  // path Roboflow ALPR uses. Non-theft liens and cleared/recovered theft
  // records are informational only — no alert. This is applied on every
  // response (cache hit or fresh call) so an officer re-pulling a cached
  // active-theft VIN still gets screened.
  const hasActiveTheft = (lienTheft.events ?? []).some((e) => isActiveTheftEvent(e.event));
  let screening: { vehicleId: number | null; hits: unknown[] } | undefined;
  if (hasActiveTheft) {
    const user = c.get('user') as { id?: number } | undefined;
    // A vehicle-record write must never fail the officer's lookup — degrade
    // like every other upsert site in this file. The theft finding itself is
    // still in `result`; only the record stamp/notification is lost.
    try {
      screening = await recordCarxeTheftHit(db, identity, lienTheft, user?.id);
    } catch (err: any) {
      log.error('[carxe] theft hit record write failed', { vin, error: err?.message });
    }
  }

  // Non-theft liens: the spec says these are "stored as informational data
  // only — no alert", but nothing ever persisted them beyond the raw
  // carxe_lookups cache blob. vehicles_records.lien_holder is exactly the
  // column for it, and CarsXE hands us `lienholder` per event. Fill-only, so
  // an officer-recorded lienholder is never overwritten.
  const lienholder = (lienTheft.events ?? [])
    .map((e) => (e.lienholder || '').trim())
    .find((l) => l !== '');
  let lienRecord: { vehicleId: number; created: boolean; filled: number } | undefined;
  if (lienholder && !hasActiveTheft) {
    try {
      lienRecord = await upsertVehicleFromCarxe(
        db,
        identity,
        { lien_holder: lienholder, make: lienTheft.make ?? null, model: lienTheft.model ?? null, year: parseVehicleYear(lienTheft.year) },
        'Created from CarsXE lien/theft lookup',
      );
    } catch (err: any) {
      log.error('[carxe] lien holder record write failed', { vin, error: err?.message });
    }
  }

  return c.json({
    ok: true,
    cached,
    result,
    ...(screening ? { screening } : {}),
    ...(lienRecord ? { vehicle_record: lienRecord } : {}),
  });
});

carxe.post('/history', operational, async (c) => {
  const cfg = await resolveCarxeConfig(c);
  if ('response' in cfg) return cfg.response;

  const body = await c.req.json<{ vin?: string; plate?: string; state?: string }>().catch(() => ({} as { vin?: string; plate?: string; state?: string }));
  const vin = (body.vin || '').trim().toUpperCase();
  const plate = (body.plate || '').trim().toUpperCase() || undefined;
  const state = (body.state || '').trim().toUpperCase() || undefined;
  if (!vin) return c.json({ ok: false, code: 'invalid_input', message: 'vin is required' }, 400);

  const outcome = await runCarxeLookup(c, cfg.config, 'history', { vin }, (config) => getHistory(config, { vin }));
  if ('response' in outcome) return outcome.response;

  // Title brands (SALVAGE / FLOOD / LEMON) and title status are records-relevant
  // facts vehicles_records has a column for. Informational only — a salvage
  // title is not an officer-safety alert, so unlike the theft path this raises
  // no notification and never touches is_stolen.
  const historyResult = outcome.result as CarxeHistoryResult;
  let vehicle: { vehicleId: number; created: boolean; filled: number } | undefined;
  try {
    const fields = fieldsFromHistoryResult(historyResult);
    if (fields.title_status) {
      vehicle = await upsertVehicleFromCarxe(
        outcome.db,
        { vin, plate, state },
        fields,
        'Created from CarsXE history lookup',
      );
    }
  } catch (err: any) {
    log.error('[carxe] history vehicle upsert failed', { vin, error: err?.message });
  }

  return c.json({
    ok: true,
    cached: outcome.cached,
    result: outcome.result,
    ...(vehicle ? { vehicle_record: vehicle } : {}),
  });
});

carxe.get('/lookups', operational, async (c) => {
  const env = c.env as Record<string, unknown> as { DB: D1Database };
  const db = getDb(env);
  const plate = c.req.query('plate');
  const state = c.req.query('state');
  const vin = c.req.query('vin');
  const lookupType = c.req.query('lookup_type');

  let rows;
  if (vin) {
    rows = lookupType
      ? await query(db, 'SELECT id, lookup_type, plate, state, vin, response_json, created_at FROM carxe_lookups WHERE vin = ? AND lookup_type = ? ORDER BY created_at DESC LIMIT 20', vin.toUpperCase(), lookupType)
      : await query(db, 'SELECT id, lookup_type, plate, state, vin, response_json, created_at FROM carxe_lookups WHERE vin = ? ORDER BY created_at DESC LIMIT 20', vin.toUpperCase());
  } else if (plate) {
    // `state IS ?` — see findFreshCache's comment; a plate lookup made with
    // no state must be retrievable via the same null-safe equality.
    rows = await query(
      db,
      'SELECT id, lookup_type, plate, state, vin, response_json, created_at FROM carxe_lookups WHERE plate = ? AND state IS ? ORDER BY created_at DESC LIMIT 20',
      plate.toUpperCase(),
      (state || '').toUpperCase() || null,
    );
  } else {
    return c.json({ ok: false, code: 'invalid_input', message: 'plate or vin is required' }, 400);
  }

  return c.json({ ok: true, lookups: rows });
});

export default carxe;
