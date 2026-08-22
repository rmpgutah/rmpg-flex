// ============================================================
// RMPG Flex — Fleet.io integration: sync engine (PR 4)
// ============================================================
// Two top-level entry points the reconciliation cron and webhook receiver
// call:
//
//   applyOutbound(deps): drain pending outbound rows from `fleetio_events`,
//   call the Fleet.io adapter for each (filtered by ownership map), mark
//   each row as completed or failed (with exponential backoff capped at 7
//   attempts).
//
//   applyInbound(deps, eventId): given a queued inbound event row, decode
//   its payload, look up ownership per field, apply allowed fields to D1,
//   log conflicts for rmpg-owned fields, and surface `unresolved` conflicts
//   for shared fields whose updated_at lies inside the conflict window.
//
// Pure logic — both functions accept typed deps (`db`, `now`, adapter
// functions) so tests don't need a live Worker. Mirrors the pattern in
// src/utils/fleetio/events.ts: never throws, always returns a structured
// outcome so the caller can decide whether to log / surface / silently
// continue.
//
// Backoff schedule (per spec): 1s, 4s, 16s, 60s, 5m, 30m, 2h. After 7
// attempts the event is marked `failed` and shows up in the
// /admin/fleetio-health queue (PR 4b).
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import {
  outboundFieldFilter,
  partitionInboundFields,
  resolveSharedConflict,
  getOwnership,
} from './ownership';
import type { FleetioConfig, FleetioFuelEntry } from './client';
import type { FleetioVehicle } from './types';
import { mapVehicleFieldsToFleetio, mapFuelEntryFieldsToFleetio, mapVendorFieldsToFleetio, mapPartFieldsToFleetio, mapWorkOrderFieldsToFleetio } from './seed';
import {
  FLEETIO_LINK_RESOURCE,
  FLEETIO_RMPG_TABLE,
  RMPG_TABLE_TO_KIND,
  acceptedLinkResources,
  type FleetioResourceKind,
} from './resources';
import {
  FleetioRateLimitError,
  FleetioHttpError,
  FleetioTimeoutError,
  FleetioConfigError,
} from './errors';

// ─── Pacing ───────────────────────────────────────────────

/** Inter-request spacing for every paced Fleet.io loop (self-imposed pacing;
 *  Fleet.io limits are plan-dependent — no fixed published number). Shared by
 *  the route-level /seed, /seed-vendors, /seed-parts and /pull loops AND the
 *  applyOutbound drain below, so no caller can quietly diverge and start
 *  earning 429s. */
export const PACE_MS = 1200;

export const pace = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** D1's bind() throws on non-scalar values (objects/arrays). Inbound Fleet.io
 *  payload fields are usually scalars, but nested objects (e.g. an embedded
 *  `specs` dict) do arrive; store those as their JSON text rather than letting
 *  the bind throw — which used to dead-letter the whole event (applyInbound)
 *  or 500 the admin's conflict-resolve. */
export function coerceScalarForD1(v: unknown): unknown {
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}

// ─── Backoff schedule ─────────────────────────────────────

export const BACKOFF_SECONDS = [1, 4, 16, 60, 5 * 60, 30 * 60, 2 * 60 * 60];

export function nextAttemptDelaySeconds(attemptCount: number): number {
  if (attemptCount < 0) return 0;
  if (attemptCount >= BACKOFF_SECONDS.length) return BACKOFF_SECONDS[BACKOFF_SECONDS.length - 1];
  return BACKOFF_SECONDS[attemptCount];
}

export function maxAttempts(): number { return BACKOFF_SECONDS.length; }

/**
 * Seconds a row must sit idle after its Nth failure before the drain may take
 * it again: failure 1 → BACKOFF_SECONDS[0], failure 2 → [1], and so on.
 * `attempts = 0` (never tried) is always due immediately.
 *
 * The final element is unreachable by construction — `maxAttempts()` is the
 * array length, so a row with `attempts === length` is already 'failed' and
 * never re-selected. It is kept so the array reads as a complete schedule.
 *
 * ⚠️ Under the 30-minute cron this gate can only ever make retries LATER, never
 * sooner: the drain runs once per tick, so the sub-30-minute steps (1s, 4s,
 * 16s, 60s, 5m) are already dominated by tick granularity. What it actually
 * buys is the tail — the 30m step is honored instead of collapsing to one
 * attempt per tick. With 4xx now failing fast, everything still retrying is a
 * 5xx or a timeout, i.e. exactly when backing off is the correct behavior.
 */
export function backoffDelayAfterFailures(attempts: number): number {
  if (attempts <= 0) return 0;
  return nextAttemptDelaySeconds(attempts - 1);
}

/** Pure mirror of `backoffDueSql()` — same verdict, in TS, for tests. */
export function isBackoffElapsed(
  attempts: number,
  processedAtMs: number | null,
  nowMs: number,
): boolean {
  if (attempts <= 0) return true;
  if (processedAtMs === null) return true;
  return nowMs - processedAtMs >= backoffDelayAfterFailures(attempts) * 1000;
}

/**
 * SQL predicate form of `isBackoffElapsed`, generated FROM `BACKOFF_SECONDS`
 * so the schedule has exactly one definition. Hand-writing the CASE arms is
 * how the two would drift.
 *
 * Interpolation is safe: every value comes from a module-level numeric
 * constant, never from a request. Kept as literals rather than bound
 * parameters because D1 caps a statement at 100 bound params and this clause
 * would spend one per arm for a value that never varies at runtime.
 */
export function backoffDueSql(): string {
  const arms = BACKOFF_SECONDS
    .map((secs, i) => `WHEN ${i + 1} THEN ${Number(secs)}`)
    .join(' ');
  const fallback = Number(BACKOFF_SECONDS[BACKOFF_SECONDS.length - 1]);
  return `(attempts = 0 OR processed_at IS NULL OR datetime(processed_at, '+' || (CASE attempts ${arms} ELSE ${fallback} END) || ' seconds') <= datetime('now'))`;
}

// ─── Permanent vs transient failure ───────────────────────
// A 4xx from Fleet.io is a verdict on the PAYLOAD, not on the connection:
// replaying identical bytes cannot change the answer. Retrying one burns all
// maxAttempts() attempts, dead-letters, and pages an operator ~3h after the
// fact with an error string that no longer says why.
//
// Observed live 2026-08-01: fuel_entry/create event id=23 (fleet_fuel_log 117)
// was rejected 422 because that row was ALREADY linked to Fleet.io fuel entry
// 218945340 and its odometer (93,917 on 07-18) reads BACKWARD from the 07-17
// entry's 93,918.8. Seven attempts, one dead letter, and a Retry button that
// re-armed the whole cycle — for a rejection that was correct every time.
//
// 408 (Request Timeout) and 429 (Too Many Requests) are 4xx by number but
// transient by meaning, so they stay retryable. 429 never reaches here anyway
// — FleetioRateLimitError is its own class and aborts the drain — but the
// carve-out is kept so this predicate is correct in isolation.
const TRANSIENT_4XX = new Set([408, 429]);

/** True when the failure can never succeed on replay, so the event should be
 *  dead-lettered on attempt 1 instead of burning the retry budget. */
export function isPermanentFleetioFailure(err: unknown): boolean {
  if (err instanceof FleetioConfigError) return false; // config can be fixed; drain aborts anyway
  if (!(err instanceof FleetioHttpError)) return false;
  const status = err.status;
  if (typeof status !== 'number') return false;
  return status >= 400 && status < 500 && !TRANSIENT_4XX.has(status);
}

/** Marker prefix stamped onto `fleetio_events.error` for permanent failures.
 *  The retry endpoint reads it back to refuse a retry that cannot succeed —
 *  a shared seam so writer and reader can't drift. Preferred over a new
 *  column: `fleetio_events` gains nothing from more schema for one bit. */
export const PERMANENT_ERROR_PREFIX = 'PERMANENT: ';

/** Reader half of `PERMANENT_ERROR_PREFIX`. */
export function isPermanentFailureMessage(error: string | null | undefined): boolean {
  return typeof error === 'string' && error.startsWith(PERMANENT_ERROR_PREFIX);
}

/**
 * Flattens an error into the string persisted to `fleetio_events.error`.
 *
 * `FleetioHttpError.message` is only ever `"Fleet.io <status>"` — the actual
 * validation text lives in `.detail` (the parsed response body) and was being
 * dropped on the floor. That is why the Health tab could show a red failed
 * event whose stated reason was the useless string "Fleet.io 422".
 */
export function formatFleetioError(err: unknown): string {
  const base = err instanceof Error ? err.message : String(err);
  let out = base;
  if (err instanceof FleetioHttpError && err.detail !== undefined && err.detail !== null) {
    const detail = typeof err.detail === 'string' ? err.detail : safeStringify(err.detail);
    if (detail && detail !== '{}' && detail !== '""') out = `${base}: ${detail}`;
  }
  return isPermanentFleetioFailure(err) ? `${PERMANENT_ERROR_PREFIX}${out}` : out;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

// ─── Shared types ─────────────────────────────────────────

export interface FleetioEventRow {
  id: number;
  direction: 'inbound' | 'outbound';
  event_id: string;
  resource: string;          // 'vehicle' | 'fuel_entry' | ...
  resource_id: number | null; // RMPG row id (outbound) or Fleet.io id (inbound)
  action: 'create' | 'update' | 'delete';
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';
  attempts: number;
  payload_json: string;
  error: string | null;
  created_at: string;
  processed_at: string | null;
}

/** Adapter surface the sync engine relies on. Real impl lives in client.ts;
 *  tests pass a hand-rolled object. */
export interface FleetioAdapter {
  createVehicle(args: { payload: Record<string, unknown> }): Promise<FleetioVehicle>;
  updateVehicle(args: { fleetioId: number; payload: Record<string, unknown> }): Promise<FleetioVehicle>;
  archiveVehicle(args: { fleetioId: number; archivedAtIso: string }): Promise<FleetioVehicle>;
  createFuelEntry(args: { payload: Record<string, unknown> }): Promise<FleetioFuelEntry>;
  updateFuelEntry(args: { fleetioId: number; payload: Record<string, unknown> }): Promise<FleetioFuelEntry>;
  deleteFuelEntry(args: { fleetioId: number }): Promise<unknown>;
  createWorkOrder(args: { payload: Record<string, unknown> }): Promise<{ id: number; [k: string]: unknown }>;
  updateWorkOrder(args: { fleetioId: number; payload: Record<string, unknown> }): Promise<{ id: number; [k: string]: unknown }>;
  createVendor(args: { payload: Record<string, unknown> }): Promise<{ id: number; [k: string]: unknown }>;
  updateVendor(args: { fleetioId: number; payload: Record<string, unknown> }): Promise<{ id: number; [k: string]: unknown }>;
  archiveVendor(args: { fleetioId: number }): Promise<unknown>;
  createPart(args: { payload: Record<string, unknown> }): Promise<{ id: number; [k: string]: unknown }>;
  updatePart(args: { fleetioId: number; payload: Record<string, unknown> }): Promise<{ id: number; [k: string]: unknown }>;
  deletePart(args: { fleetioId: number }): Promise<unknown>;
}

/** Pure typed deps for applyOutbound — eliminates I/O coupling for tests. */
export interface ApplyOutboundDeps {
  db: D1Database;
  adapter: FleetioAdapter;
  config: FleetioConfig; // present so the adapter has what it needs
  now?: () => Date;
  limit?: number;        // max events to drain per invocation; default 50
  /** Inter-event delay in ms; defaults to PACE_MS. Tests pass 0. */
  paceMs?: number;
}

export interface ApplyOutboundResult {
  attempted: number;
  completed: number;
  failed: number;
  skipped: number;
  errors: { event_id: string; error: string }[];
}

// ─── applyOutbound ────────────────────────────────────────

const DEFAULT_OUTBOUND_LIMIT = 50;

export async function applyOutbound(deps: ApplyOutboundDeps): Promise<ApplyOutboundResult> {
  const limit = deps.limit ?? DEFAULT_OUTBOUND_LIMIT;
  const result: ApplyOutboundResult = { attempted: 0, completed: 0, failed: 0, skipped: 0, errors: [] };

  // ── Reap abandoned claims first ──
  // A row claimed as 'processing' whose drain never finished — the Worker was
  // evicted, the waitUntil budget ran out, an unhandled throw escaped — would
  // otherwise sit in 'processing' forever: invisible to this SELECT (which only
  // takes 'pending'), invisible to getQueueHealth (which counts 'failed' and
  // 'pending'), and never retried. Claims older than the stale window go back
  // to 'pending' WITHOUT touching `attempts`, since an abandoned claim is not
  // evidence that Fleet.io rejected anything.
  //
  // 30 minutes = one full cron period, so a claim can only be reaped after the
  // tick that made it has certainly ended.
  //
  // The age test is on `processed_at` (which the claim below stamps), NOT
  // `created_at`. `created_at` is when the event was QUEUED — an event queued
  // days ago and claimed one second ago would be instantly reapable, handing a
  // concurrent drain the exact double-dispatch the claim exists to prevent. A
  // NULL `processed_at` means the row was claimed by a pre-claim-stamp bundle,
  // so it's reapable on sight.
  try {
    const reaped = await deps.db.prepare(
      `UPDATE fleetio_events SET status='pending'
       WHERE direction='outbound' AND status='processing'
         AND (processed_at IS NULL OR processed_at <= datetime('now', '-30 minutes'))`,
    ).run();
    const n = reaped?.meta?.changes ?? 0;
    if (n > 0) console.log(`[fleetio.sync] reaped ${n} abandoned 'processing' event(s) back to pending`);
  } catch (err) {
    console.error('[fleetio.sync] stale-claim reaper failed', err);
  }

  let pending: FleetioEventRow[];
  try {
    const rs = await deps.db.prepare(
      `SELECT id, direction, event_id, resource, resource_id, action, status,
              attempts, payload_json, error, created_at, processed_at
       FROM fleetio_events
       WHERE direction = 'outbound' AND status = 'pending' AND attempts < ?
         AND ${backoffDueSql()}
       ORDER BY id ASC
       LIMIT ?`,
    ).bind(maxAttempts(), limit).all<FleetioEventRow>();
    pending = rs.results ?? [];
  } catch (err) {
    console.error('[fleetio.sync] applyOutbound SELECT failed', err);
    return result;
  }

  for (const row of pending) {
    // ── Claim the row before dispatching ──
    // `status='processing'` was in fleetio_events' CHECK constraint from
    // migration 0133 but never actually used, so two overlapping drains saw the
    // same 'pending' rows and both dispatched them. For a `create` that means a
    // DUPLICATE remote record plus an orphaned link (INSERT OR IGNORE keeps the
    // first id, so the second remote row is unreachable forever). Overlap is
    // reachable in production: the drain runs on the */30 cron via waitUntil
    // with per-event pacing, and nothing bounds it to under 30 minutes.
    //
    // The conditional UPDATE is the compare-and-swap — `changes === 0` means a
    // concurrent drain claimed it first, so this one skips rather than races.
    let claimed: boolean;
    try {
      // `processed_at` doubles as the claim timestamp so the reaper above can
      // age claims out without a new column (0133's fleetio_events has no
      // claimed_at, and `calls_for_service`-style column pressure isn't worth a
      // migration here). It's overwritten on completion, and every reader of
      // `processed_at` already filters on status='completed' — see
      // /fleetio/analytics' latency query and /health's last-completed probe.
      const claim = await deps.db.prepare(
        `UPDATE fleetio_events SET status='processing', processed_at=datetime('now')
         WHERE id = ? AND status='pending'`,
      ).bind(row.id).run();
      claimed = (claim?.meta?.changes ?? 0) > 0;
    } catch (err) {
      console.error('[fleetio.sync] failed to claim event', { event_id: row.event_id, err });
      claimed = false;
    }
    if (!claimed) {
      result.skipped++;
      continue;
    }
    // Real inter-event pacing (the drain previously fired up to `limit`
    // Fleet.io requests back-to-back despite the comment above claiming
    // per-event pacing). Sleep BEFORE each dispatch after the first, so the
    // final event never trails a useless sleep.
    if (result.attempted > 0) {
      await pace(deps.paceMs ?? PACE_MS);
    }
    result.attempted++;
    try {
      await dispatchOutbound(row, deps);
      await deps.db.prepare(
        `UPDATE fleetio_events SET status='completed', processed_at=datetime('now'), attempts=attempts+1
         WHERE id = ?`,
      ).bind(row.id).run();
      result.completed++;
    } catch (err) {
      // Carries Fleet.io's own validation text (err.detail), plus the
      // PERMANENT: marker when replay is provably futile.
      const errMsg = formatFleetioError(err);
      const permanent = isPermanentFleetioFailure(err);
      result.errors.push({ event_id: row.event_id, error: errMsg });
      try {
        await deps.db.prepare(
          `UPDATE fleetio_events
           SET status = CASE
             WHEN ? = 1 OR attempts + 1 >= ? THEN 'failed' ELSE 'pending'
           END,
           attempts = attempts + 1,
           error = ?
           WHERE id = ?`,
        ).bind(permanent ? 1 : 0, maxAttempts(), errMsg.slice(0, 1000), row.id).run();
      } catch (markErr) {
        console.error('[fleetio.sync] failed to mark event status', { event_id: row.event_id, markErr });
      }
      if (err instanceof FleetioConfigError) {
        // No point hammering the API; abort the whole drain.
        result.skipped += pending.length - result.attempted;
        break;
      }
      if (err instanceof FleetioRateLimitError) {
        // Stop early — let the next cron tick respect the Retry-After.
        result.skipped += pending.length - result.attempted;
        break;
      }
      // Must mirror the CASE above, or a permanent failure would be marked
      // 'failed' in the DB while the drain reported failed=0 to the cron log.
      if (permanent || row.attempts + 1 >= maxAttempts()) result.failed++;
    }
  }
  return result;
}

// ─── FK translation map ──────────────────────────────────
// RMPG payloads carry LOCAL ids (vehicle_id = fleet_vehicles.id) that
// Fleet.io can't resolve. For each outbound resource, list the FK fields
// that reference a RMPG table — the dispatch translates them via
// fleetio_links before sending. If a REQUIRED FK has no link, the
// dispatch returns a no-op completion (parent isn't synced yet; sending
// would 422). OPTIONAL FKs are silently dropped from the payload when
// unlinked, so Fleet.io receives a clean null.
//
// Discovered production-side 2026-06-22: work_order/create event
// id=3 failed with Fleet.io 422 because vehicle_id=1 (RMPG) doesn't
// exist on Fleet.io's side (no vehicles seeded yet).

interface FkRef { rmpgTable: string; required: boolean }

// ⚠️ `rmpgTable` must match the value stored in `fleetio_links.rmpg_table`
// EXACTLY. It previously read 'vendors' for both vendor_id entries, while every
// vendor link is written under 'ref_vendors' (RMPG's actual vendor table — see
// FLEETIO_RMPG_TABLE). So `lookupFleetioId(db, 'vendors', id)` never matched a
// row, and because vendor_id is an OPTIONAL FK the field was silently DELETED
// from the payload — meaning no outbound work order or fuel entry has ever
// carried its vendor to Fleet.io. Sourcing the name from FLEETIO_RMPG_TABLE
// makes that class of typo impossible.
const OUTBOUND_FK_MAP: Record<string, Record<string, FkRef>> = {
  work_order: {
    vehicle_id:          { rmpgTable: FLEETIO_RMPG_TABLE.vehicle, required: true  },
    vendor_id:           { rmpgTable: FLEETIO_RMPG_TABLE.vendor,  required: false },
    assigned_to_user_id: { rmpgTable: 'users',                    required: false },
  },
  fuel_entry: {
    vehicle_id:          { rmpgTable: FLEETIO_RMPG_TABLE.vehicle, required: true  },
    vendor_id:           { rmpgTable: FLEETIO_RMPG_TABLE.vendor,  required: false },
    driver_id:           { rmpgTable: 'users',                    required: false },
  },
  // vehicle/create has no outbound FKs (fuel_type_id, tire_size_id etc.
  // are Fleet.io's own reference IDs; the seed path resolves them).
};

/**
 * INBOUND counterpart of OUTBOUND_FK_MAP: local columns whose value is a
 * FOREIGN KEY into an RMPG table, and which resource kind that key points at.
 *
 * An inbound webhook payload carries FLEET.IO ids. Both `vendor_id` (work
 * orders, fuel entries) and `vehicle_id` are classified 'shared' in
 * ownership.ts, so `applyInbound` used to write Fleet.io's id verbatim into a
 * column that references `ref_vendors.id` / `fleet_vehicles.id`. The row then
 * points at an unrelated local record (or a nonexistent one) — a silent FK
 * corruption that no error surfaces and that reads as legitimate data
 * downstream. Every field listed here is reverse-translated through
 * fleetio_links before it can be applied, and DROPPED (never guessed) when no
 * link exists.
 */
const INBOUND_FK_MAP: Record<string, Record<string, FleetioResourceKind>> = {
  work_order: { vehicle_id: 'vehicle', vendor_id: 'vendor' },
  fuel_entry: { vehicle_id: 'vehicle', vendor_id: 'vendor' },
};

export interface InboundFkTranslation {
  /** Fields whose FK value was rewritten from a Fleet.io id to an RMPG id. */
  translated: string[];
  /** Fields dropped because no fleetio_links row mapped the remote id. */
  dropped: string[];
}

/** Rewrites inbound FK values in place on `payload`, reporting what changed. */
async function translateInboundFks(
  db: D1Database,
  resource: string,
  payload: Record<string, unknown>,
  fields: readonly string[],
): Promise<InboundFkTranslation> {
  const out: InboundFkTranslation = { translated: [], dropped: [] };
  const fks = INBOUND_FK_MAP[resource];
  if (!fks) return out;
  for (const field of fields) {
    const kind = fks[field];
    if (!kind) continue;
    const raw = payload[field];
    if (raw == null) continue;
    const remoteId = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(remoteId)) { out.dropped.push(field); continue; }
    const localId = await lookupRmpgId(db, kind, remoteId);
    if (localId == null) { out.dropped.push(field); continue; }
    payload[field] = localId;
    out.translated.push(field);
  }
  return out;
}

/** Result: `null` if a required FK can't be translated (caller should
 *  no-op the dispatch); otherwise the payload with FKs replaced. */
async function translateOutboundFks(
  db: D1Database,
  resource: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const fks = OUTBOUND_FK_MAP[resource];
  if (!fks) return payload;
  const out: Record<string, unknown> = { ...payload };
  for (const [field, ref] of Object.entries(fks)) {
    const rawId = out[field];
    if (rawId == null) continue;
    const rmpgId = typeof rawId === 'number' ? rawId : Number(rawId);
    if (!Number.isFinite(rmpgId)) { delete out[field]; continue; }
    const fleetioId = await lookupFleetioId(db, ref.rmpgTable, rmpgId);
    if (fleetioId != null) {
      out[field] = fleetioId;
    } else if (ref.required) {
      return null;
    } else {
      delete out[field];
    }
  }
  return out;
}

/** Pure dispatch — given a row + adapter, call the right method. Throws
 *  to signal failure (caller decides how to record it). */
async function dispatchOutbound(row: FleetioEventRow, deps: ApplyOutboundDeps): Promise<unknown> {
  const payload = parsePayload(row.payload_json);
  // outboundFieldFilter trims `fleetio`-owned fields out of the payload so
  // we don't overwrite a value the remote system owns.
  const filteredPayload: Record<string, unknown> = {};
  const keep = new Set(outboundFieldFilter(row.resource, Object.keys(payload)));
  for (const k of keep) filteredPayload[k] = payload[k];

  if (row.resource === 'vehicle' && row.action === 'create') {
    // Already linked? Idempotent — fall through to update path on subsequent
    // writes. Without this guard a duplicate emit would create a 2nd remote
    // vehicle and orphan the original.
    const existing = await lookupFleetioId(deps.db, 'fleet_vehicles', row.resource_id);
    if (existing) return null;
    const mapped = mapVehicleFieldsToFleetio(filteredPayload, true);
    if (!mapped.name) return null; // no derivable name — nothing safe to create with
    const created = await deps.adapter.createVehicle({ payload: mapped });
    await recordLink(deps.db, FLEETIO_RMPG_TABLE.vehicle, row.resource_id, 'vehicle', created.id, now(deps));
    return created;
  }
  if (row.resource === 'vehicle' && row.action === 'update') {
    const fleetioId = await lookupFleetioId(deps.db, 'fleet_vehicles', row.resource_id);
    if (!fleetioId) {
      // No link yet — the seed route is responsible for the first push.
      // Mark as completed (no-op for now) so we don't retry forever.
      return null;
    }
    return deps.adapter.updateVehicle({ fleetioId, payload: mapVehicleFieldsToFleetio(filteredPayload) });
  }
  if (row.resource === 'vehicle' && row.action === 'delete') {
    // Fleet.io archives instead of hard-deleting — and only if the row was
    // ever pushed in the first place. Unlinked delete = local-only soft
    // delete, which is fine; record success and move on.
    const fleetioId = await lookupFleetioId(deps.db, 'fleet_vehicles', row.resource_id);
    if (!fleetioId) return null;
    return deps.adapter.archiveVehicle({ fleetioId, archivedAtIso: now(deps).toISOString() });
  }
  if (row.resource === 'fuel_entry' && row.action === 'create') {
    // Already linked? Idempotent no-op — mirrors the vehicle/create guard
    // above. Its absence here is the root cause of the 2026-08-01 incident:
    // `fleet_fuel_log` rows already pushed to Fleet.io were re-emitted as
    // creates, so every replay either (a) POSTed a DUPLICATE remote fuel
    // entry whose id `recordLink`'s INSERT OR IGNORE then silently discarded,
    // orphaning it forever, or (b) got a 422 from Fleet.io's meter-entry
    // validation and dead-lettered. Events 26/27 (fleet_fuel_log 115, already
    // linked to 219997437) were queued and neutralized by hand before the
    // cron could double-post them.
    const existing = await lookupFleetioId(deps.db, FLEETIO_RMPG_TABLE.fuel_entry, row.resource_id);
    if (existing) return null;
    const translated = await translateOutboundFks(deps.db, 'fuel_entry', filteredPayload);
    if (translated == null) return null;       // parent vehicle not linked yet
    const created = await deps.adapter.createFuelEntry({ payload: mapFuelEntryFieldsToFleetio(translated) });
    await recordLink(deps.db, FLEETIO_RMPG_TABLE.fuel_entry, row.resource_id, 'fuel_entry', created.id, now(deps));
    return created;
  }
  if (row.resource === 'work_order' && row.action === 'create') {
    const existing = await lookupFleetioId(deps.db, 'work_orders', row.resource_id);
    if (existing) return null;
    const translated = await translateOutboundFks(deps.db, 'work_order', filteredPayload);
    if (translated == null) return null;       // parent vehicle not linked yet
    const created = await deps.adapter.createWorkOrder({ payload: mapWorkOrderFieldsToFleetio(translated) });
    await recordLink(deps.db, FLEETIO_RMPG_TABLE.work_order, row.resource_id, 'work_order', created.id, now(deps));
    return created;
  }
  if (row.resource === 'fuel_entry' && row.action === 'update') {
    // Fuel entries created after this fix have a `fleetio_links` row (recorded
    // by the create branch above), and pulled-in entries get one too via
    // /fleetio/pull's own INSERT OR IGNORE — so this guard is mainly defensive
    // for rows that predate the fix or otherwise never got linked. No-op so
    // the queue doesn't pile up in that edge case; the original create (or
    // pull) already reflects the accurate values.
    const fleetioId = await lookupFleetioId(deps.db, 'fleet_fuel_log', row.resource_id);
    if (!fleetioId) return null;
    const translated = await translateOutboundFks(deps.db, 'fuel_entry', filteredPayload);
    if (translated == null) return null;
    return deps.adapter.updateFuelEntry({ fleetioId, payload: mapFuelEntryFieldsToFleetio(translated) });
  }
  if (row.resource === 'fuel_entry' && row.action === 'delete') {
    // src/routes/fleet.ts's `DELETE /fleet/fuel/:id` has emitted 'fuel.delete'
    // since PR 3, but no handler existed — so every fuel-log deletion fell
    // through to the 501 branch below, exhausted all 7 retries over ~3h,
    // dead-lettered, and fired a `fleetio_event_dead_lettered` alert. The
    // verbs are symmetric (both sides hard-delete), so this is a plain DELETE.
    const fleetioId = await lookupFleetioId(deps.db, FLEETIO_RMPG_TABLE.fuel_entry, row.resource_id);
    if (!fleetioId) return null;          // local-only entry; nothing remote to remove
    const deleted = await deps.adapter.deleteFuelEntry({ fleetioId });
    await dropLink(deps.db, FLEETIO_RMPG_TABLE.fuel_entry, row.resource_id);
    return deleted;
  }
  if (row.resource === 'work_order' && row.action === 'update') {
    const fleetioId = await lookupFleetioId(deps.db, 'work_orders', row.resource_id);
    if (!fleetioId) return null;               // parent never pushed → nothing to update
    const translated = await translateOutboundFks(deps.db, 'work_order', filteredPayload);
    if (translated == null) return null;
    return deps.adapter.updateWorkOrder({ fleetioId, payload: mapWorkOrderFieldsToFleetio(translated) });
  }
  if (row.resource === 'vendor' && row.action === 'create') {
    const existing = await lookupFleetioId(deps.db, 'ref_vendors', row.resource_id);
    if (existing) return null;
    const created = await deps.adapter.createVendor({ payload: mapVendorFieldsToFleetio(filteredPayload) });
    await recordLink(deps.db, FLEETIO_RMPG_TABLE.vendor, row.resource_id, 'vendor', created.id, now(deps));
    return created;
  }
  if (row.resource === 'vendor' && row.action === 'update') {
    const fleetioId = await lookupFleetioId(deps.db, 'ref_vendors', row.resource_id);
    if (!fleetioId) return null; // never pushed — first push happens on next create-shaped emit
    return deps.adapter.updateVendor({ fleetioId, payload: mapVendorFieldsToFleetio(filteredPayload) });
  }
  if (row.resource === 'vendor' && row.action === 'delete') {
    const fleetioId = await lookupFleetioId(deps.db, 'ref_vendors', row.resource_id);
    if (!fleetioId) return null;
    try {
      return await deps.adapter.archiveVendor({ fleetioId });
    } catch (err) {
      // Same reasoning as the hard-delete 404 case above: if the vendor is
      // already gone on Fleet.io's side (deleted directly in their UI,
      // outside RMPG's control), archiving it again can never succeed —
      // retrying just burns all 7 attempts and dead-letters. The archived
      // end state is unreachable either way, so treat "already gone" as
      // "goal already met": drop the stale link and stop retrying.
      // Confirmed live 2026-07-29 (vendor/delete event id=13, Fleet.io 404).
      if (err instanceof FleetioHttpError && err.status === 404) {
        await dropLink(deps.db, 'ref_vendors', row.resource_id);
        return null;
      }
      throw err;
    }
  }
  if (row.resource === 'part' && row.action === 'create') {
    const existing = await lookupFleetioId(deps.db, 'fleet_parts', row.resource_id);
    if (existing) return null;
    const created = await deps.adapter.createPart({ payload: mapPartFieldsToFleetio(filteredPayload) });
    await recordLink(deps.db, FLEETIO_RMPG_TABLE.part, row.resource_id, 'part', created.id, now(deps));
    return created;
  }
  if (row.resource === 'part' && row.action === 'update') {
    const fleetioId = await lookupFleetioId(deps.db, 'fleet_parts', row.resource_id);
    if (!fleetioId) return null;
    return deps.adapter.updatePart({ fleetioId, payload: mapPartFieldsToFleetio(filteredPayload) });
  }
  if (row.resource === 'part' && row.action === 'delete') {
    // Fleet.io parts support a hard DELETE (unlike vehicles/vendors), and
    // RMPG's `DELETE /fleet/parts/:id` hard-deletes locally too, so the verbs
    // are symmetric. Only meaningful if the row was ever linked; otherwise it
    // was local-only.
    const fleetioId = await lookupFleetioId(deps.db, FLEETIO_RMPG_TABLE.part, row.resource_id);
    if (!fleetioId) return null;
    const deleted = await deps.adapter.deletePart({ fleetioId });
    await dropLink(deps.db, FLEETIO_RMPG_TABLE.part, row.resource_id);
    return deleted;
  }
  if (row.resource === 'inspection') {
    // Inspections are intentionally RMPG-only — see INSPECTION_OWNERSHIP in
    // ownership.ts (every column is 'rmpg' because Fleet.io's
    // inspection_submissions shape differs and an inbound update wouldn't
    // round-trip cleanly). No Fleet.io equivalent to push to; mark the event
    // completed so it stops surfacing in /admin/fleetio-health.
    return null;
  }
  // Genuinely unsupported — today that's work_order/delete only. No RMPG route
  // emits it (workOrders.ts emits create/update/close), so reaching this branch
  // means a new emit site was added without a matching dispatch handler. Left
  // deliberately unimplemented rather than guessed: RMPG closes work orders
  // instead of deleting them, so there's no verified symmetric verb to pick.
  //
  // ⚠️ Every emit kind in events.ts's EMIT_KIND_TO_RESOURCE must have a branch
  // above. A missing one isn't inert — it throws 501, burns all 7 retries over
  // ~3h, dead-letters, and pages an operator. That's exactly what fuel/delete
  // did for weeks before its handler was added.
  throw new FleetioHttpError(
    `Unsupported outbound (${row.resource}/${row.action}) — sync handler not yet implemented`,
    501,
  );
}

/** `INSERT OR IGNORE` — duplicate (rmpg_table, rmpg_id) shouldn't ever
 *  happen given the existing-link guards above, but being idempotent is
 *  cheap insurance against a concurrent emit race.
 *
 *  `fleetioResource` is always taken from FLEETIO_LINK_RESOURCE (never a
 *  hand-written string) — see src/utils/fleetio/resources.ts for why the value
 *  is load-bearing rather than descriptive. */
async function recordLink(
  db: D1Database,
  rmpgTable: string,
  rmpgId: number | null,
  kind: FleetioResourceKind,
  fleetioId: number,
  nowDate: Date,
): Promise<void> {
  if (rmpgId == null) return;
  const iso = nowDate.toISOString();
  await db.prepare(
    `INSERT OR IGNORE INTO fleetio_links
       (rmpg_table, rmpg_id, fleetio_resource, fleetio_id, last_pushed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(rmpgTable, rmpgId, FLEETIO_LINK_RESOURCE[kind], fleetioId, iso, iso, iso).run();
}

/** Drop the link row after the remote record is genuinely gone (hard delete),
 *  so a stale mapping can't make a later event PATCH a record that no longer
 *  exists — Fleet.io answers that with a 404, which the queue treats as a real
 *  failure and dead-letters. Archive verbs deliberately KEEP their link: the
 *  remote row still exists and may be restored. */
async function dropLink(db: D1Database, rmpgTable: string, rmpgId: number | null): Promise<void> {
  if (rmpgId == null) return;
  try {
    await db.prepare(`DELETE FROM fleetio_links WHERE rmpg_table = ? AND rmpg_id = ?`)
      .bind(rmpgTable, rmpgId).run();
  } catch (err) {
    // Non-fatal: the remote delete already succeeded, and a leftover link is
    // recoverable. Never let this turn a completed dispatch into a retry.
    console.error('[fleetio.sync] failed to drop link after delete', { rmpgTable, rmpgId, err });
  }
}

function now(deps: { now?: () => Date }): Date {
  return deps.now ? deps.now() : new Date();
}

/**
 * Resolve the Fleet.io id for an RMPG row.
 *
 * Filters on `fleetio_resource` as well as (rmpg_table, rmpg_id). The table
 * alone was previously the whole key, which happened to work only because
 * UNIQUE(rmpg_table, rmpg_id) allows exactly one link per row — but it meant a
 * row linked under the WRONG resource spelling still resolved, hiding the
 * 'vehicle'/'vehicles' split (see resources.ts) instead of surfacing it. The
 * legacy singular spelling stays accepted here so links written by an older
 * Worker bundle keep resolving until migration 0206 normalizes them.
 */
async function lookupFleetioId(db: D1Database, rmpgTable: string, rmpgId: number | null): Promise<number | null> {
  if (rmpgId == null) return null;
  const kind = RMPG_TABLE_TO_KIND[rmpgTable];
  if (!kind) {
    // Table isn't on the sync surface — no canonical resource to filter by.
    const row = await db.prepare(
      `SELECT fleetio_id FROM fleetio_links WHERE rmpg_table = ? AND rmpg_id = ? LIMIT 1`,
    ).bind(rmpgTable, rmpgId).first<{ fleetio_id: number }>();
    return row ? row.fleetio_id : null;
  }
  const accepted = acceptedLinkResources(kind);
  const row = await db.prepare(
    `SELECT fleetio_id FROM fleetio_links
     WHERE rmpg_table = ? AND rmpg_id = ? AND fleetio_resource IN (${accepted.map(() => '?').join(',')})
     LIMIT 1`,
  ).bind(rmpgTable, rmpgId, ...accepted).first<{ fleetio_id: number }>();
  return row ? row.fleetio_id : null;
}

/**
 * Inverse of `lookupFleetioId` — Fleet.io id → RMPG row id.
 *
 * Needed by inbound FK reverse-translation: a webhook payload's `vendor_id` is
 * a FLEET.IO id, and writing it straight into RMPG's `vendor_id` column (which
 * references `ref_vendors.id`) silently repoints the row at an unrelated local
 * vendor, or at nothing at all.
 */
async function lookupRmpgId(db: D1Database, kind: FleetioResourceKind, fleetioId: number | null): Promise<number | null> {
  if (fleetioId == null) return null;
  const accepted = acceptedLinkResources(kind);
  const row = await db.prepare(
    `SELECT rmpg_id FROM fleetio_links
     WHERE rmpg_table = ? AND fleetio_resource IN (${accepted.map(() => '?').join(',')}) AND fleetio_id = ?
     LIMIT 1`,
  ).bind(FLEETIO_RMPG_TABLE[kind], ...accepted, fleetioId).first<{ rmpg_id: number }>();
  return row ? row.rmpg_id : null;
}

// ─── Queue health (Fleet.io reliability & observability hardening) ────

export interface FleetioQueueHealth {
  failedTotal: number;
  oldestPendingCreatedAt: string | null;
}

/** Two cheap COUNT/single-row queries — the same "unhealthy" signal both
 *  the /fleetio/sync-status route and the healthSweep cron consumer read,
 *  so the definition of "unhealthy" can't drift between the two. */
export async function getQueueHealth(db: D1Database): Promise<FleetioQueueHealth> {
  const [failedRow, oldestPendingRow] = await Promise.all([
    db.prepare(
      `SELECT COUNT(*) AS n FROM fleetio_events WHERE direction='outbound' AND status='failed'`,
    ).first<{ n: number }>(),
    db.prepare(
      `SELECT created_at FROM fleetio_events WHERE direction='outbound' AND status='pending' ORDER BY id ASC LIMIT 1`,
    ).first<{ created_at: string }>(),
  ]);
  return {
    failedTotal: failedRow?.n ?? 0,
    oldestPendingCreatedAt: oldestPendingRow?.created_at ?? null,
  };
}

const UNHEALTHY_FAILED_THRESHOLD = 5;
const UNHEALTHY_PENDING_AGE_MS = 2 * 60 * 60 * 1000;
const UNHEALTHY_ALERT_COOLDOWN_MS = 2 * 60 * 60 * 1000;

/** Pure — no I/O, no clock reads. `nowMs` is the caller's `Date.now()`
 *  (or a fixed value in tests) so this stays deterministic. */
export function isFleetioQueueUnhealthy(health: FleetioQueueHealth, nowMs: number): boolean {
  if (health.failedTotal >= UNHEALTHY_FAILED_THRESHOLD) return true;
  if (health.oldestPendingCreatedAt) {
    const parsed = parseD1TimestampMs(health.oldestPendingCreatedAt);
    if (parsed !== null && nowMs - parsed > UNHEALTHY_PENDING_AGE_MS) return true;
  }
  return false;
}

/** Pure — dedupes the queue-unhealthy alert so it doesn't refire every
 *  30-min cron tick; `lastAlertedIso` comes from fleetio_sync_state. */
export function shouldFireUnhealthyAlert(lastAlertedIso: string | null, nowMs: number): boolean {
  if (!lastAlertedIso) return true;
  const parsed = parseD1TimestampMs(lastAlertedIso);
  return parsed === null || nowMs - parsed > UNHEALTHY_ALERT_COOLDOWN_MS;
}

// ─── applyInbound ─────────────────────────────────────────

export interface ApplyInboundDeps {
  db: D1Database;
  now?: () => Date;
}

export interface ApplyInboundResult {
  status: 'applied' | 'no_op' | 'failed' | 'unknown_event' | 'unlinked';
  applied_fields: string[];
  conflict_fields: string[];
  unresolved_fields: string[];
  unknown_fields: string[];
  /** Fields skipped because their FK value couldn't be mapped from a Fleet.io
   *  id back to an RMPG id — see INBOUND_FK_MAP. Not an error; the rest of the
   *  payload still applies. */
  dropped_fk_fields: string[];
  /** The resolved LOCAL row id (`fleetio_events.resource_id` holds the Fleet.io
   *  id on inbound rows). Null when no fleetio_links row maps the remote id. */
  local_id: number | null;
  error?: string;
}

/** Mark an inbound event as retry-exhausted-or-pending, mirroring the outbound
 *  accounting so both directions surface in the same health queue. */
async function markInboundFailure(db: D1Database, row: FleetioEventRow, errMsg: string): Promise<void> {
  try {
    await db.prepare(
      `UPDATE fleetio_events
       SET status = CASE WHEN attempts + 1 >= ? THEN 'failed' ELSE 'pending' END,
           attempts = attempts + 1,
           error = ?
       WHERE id = ?`,
    ).bind(maxAttempts(), errMsg.slice(0, 1000), row.id).run();
  } catch (err) {
    console.error('[fleetio.sync] failed to mark inbound failure', { event_id: row.event_id, err });
  }
}

/** Given an inbound event id, look up + apply per ownership rules.
 *  The webhook receiver writes the event then calls this in waitUntil. */
export async function applyInbound(deps: ApplyInboundDeps, eventId: string): Promise<ApplyInboundResult> {
  const empty: ApplyInboundResult = {
    status: 'no_op', applied_fields: [], conflict_fields: [], unresolved_fields: [], unknown_fields: [],
    dropped_fk_fields: [], local_id: null,
  };
  let row: FleetioEventRow | null;
  try {
    row = await deps.db.prepare(
      `SELECT id, direction, event_id, resource, resource_id, action, status,
              attempts, payload_json, error, created_at, processed_at
       FROM fleetio_events
       WHERE direction = 'inbound' AND event_id = ?`,
    ).bind(eventId).first<FleetioEventRow>();
  } catch (err) {
    return { ...empty, status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
  if (!row) return { ...empty, status: 'unknown_event' };
  if (row.status === 'completed') return { ...empty, status: 'no_op' };

  // ── Resolve the LOCAL row id ──
  // 🔴 `fleetio_events.resource_id` means different things per direction (see
  // FleetioEventRow): the RMPG row id for outbound, but the FLEET.IO id for
  // inbound — that's what the webhook receiver extracts from the payload
  // (normalizeResource → norm.resource_id). Everything below this point needs
  // the LOCAL id.
  //
  // Every inbound path previously used `row.resource_id` directly as the local
  // id, so a webhook for Fleet.io vehicle 501 executed
  // `UPDATE fleet_vehicles SET ... WHERE id = 501` — writing remote values onto
  // whatever unrelated RMPG vehicle happens to hold id 501, and filing
  // `fleetio_conflicts` rows against that same wrong row. Silent cross-record
  // corruption with no error surface.
  //
  // No link → 'no_op'. An unlinked remote record has no local counterpart to
  // update, and guessing (e.g. matching by VIN here) is what /pull is for.
  const kind = RMPG_TABLE_TO_KIND[resourceToRmpgTable(row.resource)];
  let localId: number | null = null;
  if (kind && row.resource_id != null) {
    try {
      localId = await lookupRmpgId(deps.db, kind, row.resource_id);
    } catch (err) {
      return { ...empty, status: 'failed', error: err instanceof Error ? err.message : String(err) };
    }
  }
  if (kind && row.resource_id != null && localId == null) {
    // Remote record we've never linked. Distinct from 'no_op' so the caller can
    // tell "nothing to do" apart from "we don't know this record" — the latter
    // is the signal that /pull should be run to reconcile the roster. The event
    // is still marked completed below; replaying it wouldn't create the link.
    await deps.db.prepare(
      `UPDATE fleetio_events SET status='completed', processed_at=datetime('now'), error=? WHERE id = ?`,
    ).bind(`no fleetio_links row for ${row.resource} ${row.resource_id}`, row.id).run()
      .catch((err: unknown) => console.error('[fleetio.sync] failed to mark unlinked inbound', { eventId, err }));
    return { ...empty, status: 'unlinked' };
  }

  // `payload_json` on an INBOUND row is the raw webhook body (see
  // fleetioWebhook.ts), i.e. the whole envelope normalizeResource() parses —
  // NOT a flat field dict. Fleet.io's real shape nests the actual fields
  // under `payload` (`{ event: 'vehicle_updated', payload: { vehicle_id, ... } }`);
  // other emitter conventions nest under `data`. Reading Object.keys() on the
  // envelope itself previously yielded only ['event','payload'] (or
  // ['event_type','data']), so `partitionInboundFields` saw no real field
  // names and every inbound update silently applied nothing — masked because
  // this file's own tests constructed payload_json as an already-flat dict,
  // which the real webhook receiver never produces. Unwrap the same way
  // normalizeResource() does (data, then payload, then the envelope itself
  // for the flat subject_type/verb variant) before extracting fields.
  const envelope = parsePayload(row.payload_json);
  const payload = (
    envelope.data && typeof envelope.data === 'object' ? envelope.data
    : envelope.payload && typeof envelope.payload === 'object' ? envelope.payload
    : envelope
  ) as Record<string, unknown>;
  const fields = Object.keys(payload);
  const { apply, conflict, unknown } = partitionInboundFields(row.resource, fields);

  // Reverse-translate FK values (Fleet.io ids → RMPG ids) BEFORE anything reads
  // them — the conflict snapshots below and the UPDATE all consume `payload`.
  // Untranslatable FKs are removed from the apply set entirely rather than
  // written through: a `vendor_id` we can't map is not "no vendor", it's
  // "unknown vendor", and writing the remote id would point the row at an
  // arbitrary local vendor. See INBOUND_FK_MAP.
  let fkTranslation: InboundFkTranslation = { translated: [], dropped: [] };
  if (localId != null) {
    try {
      fkTranslation = await translateInboundFks(deps.db, row.resource, payload, apply);
    } catch (err) {
      console.error('[fleetio.sync] inbound FK translation failed', { event_id: eventId, err });
      // Treat every mapped FK as undroppable-unknown so we can't write a
      // remote id into a local FK column on the strength of a failed lookup.
      fkTranslation = { translated: [], dropped: Object.keys(INBOUND_FK_MAP[row.resource] ?? {}) };
    }
  }
  const droppedFks = new Set(fkTranslation.dropped);
  const applicable = apply.filter((f) => !droppedFks.has(f));

  // — Conflict on rmpg-owned fields: log + (per spec) caller queues an
  //   outbound re-assertion. Logging here ONLY; the re-assertion is the
  //   caller's job to keep this function side-effect-narrow.
  if (conflict.length > 0) {
    for (const field of conflict) {
      try {
        const localValue = localId != null
          ? await readLocalFieldValue(deps.db, row.resource, localId, field)
          : null;
        await deps.db.prepare(
          `INSERT INTO fleetio_conflicts (rmpg_table, rmpg_id, field, local_value, remote_value, resolution, created_at)
           VALUES (?, ?, ?, ?, ?, 'local_wins', datetime('now'))`,
        ).bind(
          resourceToRmpgTable(row.resource),
          localId,
          field,
          localValue,
          JSON.stringify(payload[field] ?? null),
        ).run();
      } catch (err) {
        console.error('[fleetio.sync] failed to log conflict', { event_id: eventId, field, err });
      }
    }
  }

  // — Apply fleetio-owned + shared fields. shared resolution is per-field
  //   based on the timestamps; conflict_window is honored here.
  const applied: string[] = [];
  const unresolved: string[] = [];
  if (applicable.length > 0 && localId != null) {
    const setCols: string[] = [];
    const bindings: unknown[] = [];
    const localUpdatedAt = await readLocalUpdatedAtMs(deps.db, row.resource, localId);
    const remoteUpdatedAt = remoteUpdatedAtMs(payload);

    for (const f of applicable) {
      // For shared fields, run the timestamp resolver.
      const klass = getOwnership(row.resource, f);
      if (klass === 'shared' && localUpdatedAt !== null && remoteUpdatedAt !== null) {
        const verdict = resolveSharedConflict(localUpdatedAt, remoteUpdatedAt);
        if (verdict === 'local_wins') {
          // Keep local. Don't overwrite.
          continue;
        }
        if (verdict === 'unresolved') {
          // Apply remote as default + flag the field for the badge.
          unresolved.push(f);
          try {
            const localValue = await readLocalFieldValue(deps.db, row.resource, localId, f);
            await deps.db.prepare(
              `INSERT INTO fleetio_conflicts (rmpg_table, rmpg_id, field, local_value, remote_value, resolution, created_at)
               VALUES (?, ?, ?, ?, ?, 'unresolved', datetime('now'))`,
            ).bind(
              resourceToRmpgTable(row.resource),
              localId,
              f,
              localValue,
              JSON.stringify(payload[f] ?? null),
            ).run();
          } catch (err) {
            console.error('[fleetio.sync] failed to log unresolved', { event_id: eventId, f, err });
          }
        }
      }
      setCols.push(`${f} = ?`);
      bindings.push(coerceScalarForD1(payload[f] ?? null));
      applied.push(f);
    }
    if (setCols.length > 0) {
      try {
        bindings.push(localId);
        await deps.db.prepare(
          `UPDATE ${resourceToRmpgTable(row.resource)} SET ${setCols.join(', ')}, updated_at = datetime('now')
           WHERE id = ?`,
        ).bind(...bindings).run();
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        // Record the failure ON THE EVENT ROW. Previously this returned early
        // and left the row in 'pending' with attempts=0 and error=NULL forever:
        // no retry (nothing re-drives inbound events), no dead-letter, and
        // invisible to getQueueHealth (which counts direction='outbound' only)
        // and to the health sweep's dead-letter notifier. A failed inbound apply
        // was a silent data-loss event.
        await markInboundFailure(deps.db, row, errMsg);
        return {
          status: 'failed',
          applied_fields: [], conflict_fields: conflict, unresolved_fields: unresolved,
          unknown_fields: unknown, dropped_fk_fields: fkTranslation.dropped, local_id: localId,
          error: errMsg,
        };
      }
    }
  }

  // Mark event complete so the cron doesn't re-process it.
  try {
    await deps.db.prepare(
      `UPDATE fleetio_events SET status='completed', processed_at=datetime('now') WHERE id = ?`,
    ).bind(row.id).run();
  } catch (err) {
    console.error('[fleetio.sync] failed to mark inbound complete', { event_id: eventId, err });
  }

  return {
    status: applied.length > 0 ? 'applied' : 'no_op',
    applied_fields: applied,
    conflict_fields: conflict,
    unresolved_fields: unresolved,
    unknown_fields: unknown,
    dropped_fk_fields: fkTranslation.dropped,
    local_id: localId,
  };
}

// ─── Helpers ──────────────────────────────────────────────

function parsePayload(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    return {};
  } catch {
    return {};
  }
}

function resourceToRmpgTable(resource: string): string {
  // Inbound resource name → local table. Trust map; bad resource is caller bug.
  // The old `default: return resource` fallback was a latent bug: an inbound
  // work_order/vendor/part update would try `UPDATE work_order SET ...`
  // against a table literally named "work_order", which doesn't exist —
  // every resource that can reach the UPDATE path below MUST have an
  // explicit case.
  switch (resource) {
    case 'vehicle':    return 'fleet_vehicles';
    case 'fuel_entry': return 'fleet_fuel_log';
    case 'work_order': return 'work_orders';
    case 'vendor':      return 'ref_vendors';
    case 'part':        return 'fleet_parts';
    default:           return resource; // defensive — inspection has no inbound path
  }
}

/** Snapshot the current local value of a single field before an inbound
 *  update potentially overwrites it, so `fleetio_conflicts.local_value`
 *  actually shows what RMPG had — previously always written as NULL,
 *  which meant the conflict-resolver UI never showed the local side of
 *  a disagreement. `field` is only ever a key that survived
 *  `getOwnership()` (i.e. present in a hard-coded ownership map), never
 *  raw webhook input, so interpolating it into the column list is safe. */
async function readLocalFieldValue(
  db: D1Database,
  resource: string,
  id: number | null,
  field: string,
): Promise<string | null> {
  if (id == null || getOwnership(resource, field) === null) return null;
  try {
    const row = await db.prepare(
      `SELECT ${field} AS v FROM ${resourceToRmpgTable(resource)} WHERE id = ?`,
    ).bind(id).first<{ v: unknown }>();
    if (!row) return null;
    return JSON.stringify(row.v ?? null);
  } catch {
    return null;
  }
}

/**
 * Parse a D1 timestamp to epoch ms, treating a missing zone as UTC.
 *
 * D1's `datetime('now')` yields `'YYYY-MM-DD HH:MM:SS'` — no `T`, no zone.
 * `Date.parse` treats that form as LOCAL time per ECMA-262, so this is only
 * accidentally correct on a Worker (whose local zone is UTC) and silently wrong
 * anywhere else — including a developer's machine and any test run under
 * TZ=America/Denver, where it shifts by 6–7 hours. A 7-hour skew against
 * Fleet.io's ISO-8601 (UTC) `updated_at` makes every `shared` field resolve
 * `local_wins`/`remote_wins` by timezone rather than by who edited last, and
 * silently empties the 60-second unresolved window.
 *
 * `isFleetioQueueUnhealthy` and `shouldFireUnhealthyAlert` already normalized
 * this way inline; centralizing it keeps the three from drifting apart.
 */
export function parseD1TimestampMs(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Already zoned (trailing Z, or a ±HH:MM offset after the time) → as-is.
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  const normalized = hasZone
    ? trimmed.replace(' ', 'T')
    : `${trimmed.replace(' ', 'T')}Z`;
  const ts = Date.parse(normalized);
  return Number.isFinite(ts) ? ts : null;
}

async function readLocalUpdatedAtMs(db: D1Database, resource: string, id: number): Promise<number | null> {
  try {
    const row = await db.prepare(
      `SELECT updated_at FROM ${resourceToRmpgTable(resource)} WHERE id = ?`,
    ).bind(id).first<{ updated_at: string | null }>();
    if (!row) return null;
    return parseD1TimestampMs(row.updated_at);
  } catch {
    return null;
  }
}

function remoteUpdatedAtMs(payload: Record<string, unknown>): number | null {
  const raw = payload.updated_at;
  if (typeof raw !== 'string') return null;
  return parseD1TimestampMs(raw);
}

/** Inverse of `resourceToRmpgTable` — used by the conflict-resolve route to
 *  turn a `fleetio_conflicts.rmpg_table` value back into a resource name +
 *  the emit kind for re-asserting the local value outbound. Returns null
 *  for tables with no outbound resource (shouldn't happen; conflicts are
 *  only ever logged against synced resources). */
export function rmpgTableToResource(table: string): { resource: string; updateKind: string } | null {
  switch (table) {
    case 'fleet_vehicles': return { resource: 'vehicle', updateKind: 'vehicle.update' };
    case 'fleet_fuel_log': return { resource: 'fuel_entry', updateKind: 'fuel.update' };
    case 'work_orders':    return { resource: 'work_order', updateKind: 'work_order.update' };
    case 'ref_vendors':    return { resource: 'vendor', updateKind: 'vendor.update' };
    case 'fleet_parts':    return { resource: 'part', updateKind: 'part.update' };
    default: return null;
  }
}

// Exported for tests so they don't have to re-derive these helpers.
export const _internals = {
  parsePayload, resourceToRmpgTable, readLocalUpdatedAtMs, remoteUpdatedAtMs,
  dispatchOutbound, lookupFleetioId, lookupRmpgId, readLocalFieldValue,
  translateInboundFks, translateOutboundFks, dropLink,
};
// Also re-export the error types the dispatch layer surfaces so tests can
// instanceof-discriminate without re-importing from ./errors.
export { FleetioTimeoutError, FleetioRateLimitError, FleetioHttpError, FleetioConfigError };
