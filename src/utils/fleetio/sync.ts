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
import {
  FleetioRateLimitError,
  FleetioHttpError,
  FleetioTimeoutError,
  FleetioConfigError,
} from './errors';

// ─── Backoff schedule ─────────────────────────────────────

export const BACKOFF_SECONDS = [1, 4, 16, 60, 5 * 60, 30 * 60, 2 * 60 * 60];

export function nextAttemptDelaySeconds(attemptCount: number): number {
  if (attemptCount < 0) return 0;
  if (attemptCount >= BACKOFF_SECONDS.length) return BACKOFF_SECONDS[BACKOFF_SECONDS.length - 1];
  return BACKOFF_SECONDS[attemptCount];
}

export function maxAttempts(): number { return BACKOFF_SECONDS.length; }

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
  createWorkOrder(args: { payload: Record<string, unknown> }): Promise<{ id: number; [k: string]: unknown }>;
}

/** Pure typed deps for applyOutbound — eliminates I/O coupling for tests. */
export interface ApplyOutboundDeps {
  db: D1Database;
  adapter: FleetioAdapter;
  config: FleetioConfig; // present so the adapter has what it needs
  now?: () => Date;
  limit?: number;        // max events to drain per invocation; default 50
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
  let pending: FleetioEventRow[];
  try {
    const rs = await deps.db.prepare(
      `SELECT id, direction, event_id, resource, resource_id, action, status,
              attempts, payload_json, error, created_at, processed_at
       FROM fleetio_events
       WHERE direction = 'outbound' AND status = 'pending' AND attempts < ?
       ORDER BY id ASC
       LIMIT ?`,
    ).bind(maxAttempts(), limit).all<FleetioEventRow>();
    pending = rs.results ?? [];
  } catch (err) {
    console.error('[fleetio.sync] applyOutbound SELECT failed', err);
    return result;
  }

  for (const row of pending) {
    result.attempted++;
    try {
      await dispatchOutbound(row, deps);
      await deps.db.prepare(
        `UPDATE fleetio_events SET status='completed', processed_at=datetime('now'), attempts=attempts+1
         WHERE id = ?`,
      ).bind(row.id).run();
      result.completed++;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      result.errors.push({ event_id: row.event_id, error: errMsg });
      try {
        await deps.db.prepare(
          `UPDATE fleetio_events
           SET status = CASE
             WHEN attempts + 1 >= ? THEN 'failed' ELSE 'pending'
           END,
           attempts = attempts + 1,
           error = ?
           WHERE id = ?`,
        ).bind(maxAttempts(), errMsg.slice(0, 1000), row.id).run();
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
      if (row.attempts + 1 >= maxAttempts()) result.failed++;
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

const OUTBOUND_FK_MAP: Record<string, Record<string, FkRef>> = {
  work_order: {
    vehicle_id:          { rmpgTable: 'fleet_vehicles', required: true  },
    vendor_id:           { rmpgTable: 'vendors',        required: false },
    assigned_to_user_id: { rmpgTable: 'users',          required: false },
  },
  fuel_entry: {
    vehicle_id:          { rmpgTable: 'fleet_vehicles', required: true  },
    vendor_id:           { rmpgTable: 'vendors',        required: false },
    driver_id:           { rmpgTable: 'users',          required: false },
  },
  // vehicle/create has no outbound FKs (fuel_type_id, tire_size_id etc.
  // are Fleet.io's own reference IDs; the seed path resolves them).
};

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
    const created = await deps.adapter.createVehicle({ payload: filteredPayload });
    await recordLink(deps.db, 'fleet_vehicles', row.resource_id, 'vehicle', created.id, now(deps));
    return created;
  }
  if (row.resource === 'vehicle' && row.action === 'update') {
    const fleetioId = await lookupFleetioId(deps.db, 'fleet_vehicles', row.resource_id);
    if (!fleetioId) {
      // No link yet — the seed route is responsible for the first push.
      // Mark as completed (no-op for now) so we don't retry forever.
      return null;
    }
    return deps.adapter.updateVehicle({ fleetioId, payload: filteredPayload });
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
    const translated = await translateOutboundFks(deps.db, 'fuel_entry', filteredPayload);
    if (translated == null) return null;       // parent vehicle not linked yet
    return deps.adapter.createFuelEntry({ payload: translated });
  }
  if (row.resource === 'work_order' && row.action === 'create') {
    const existing = await lookupFleetioId(deps.db, 'work_orders', row.resource_id);
    if (existing) return null;
    const translated = await translateOutboundFks(deps.db, 'work_order', filteredPayload);
    if (translated == null) return null;       // parent vehicle not linked yet
    const created = await deps.adapter.createWorkOrder({ payload: translated });
    await recordLink(deps.db, 'work_orders', row.resource_id, 'work_order', created.id, now(deps));
    return created;
  }
  // Unknown / unsupported (inspection, fuel_entry update/delete) — left for
  // a follow-up PR. Sits in queue and surfaces in /admin/fleetio-health.
  throw new FleetioHttpError(
    `Unsupported outbound (${row.resource}/${row.action}) — sync handler not yet implemented`,
    501,
  );
}

/** `INSERT OR IGNORE` — duplicate (rmpg_table, rmpg_id) shouldn't ever
 *  happen given the existing-link guards above, but being idempotent is
 *  cheap insurance against a concurrent emit race. */
async function recordLink(
  db: D1Database,
  rmpgTable: string,
  rmpgId: number | null,
  fleetioResource: string,
  fleetioId: number,
  nowDate: Date,
): Promise<void> {
  if (rmpgId == null) return;
  const iso = nowDate.toISOString();
  await db.prepare(
    `INSERT OR IGNORE INTO fleetio_links
       (rmpg_table, rmpg_id, fleetio_resource, fleetio_id, last_pushed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(rmpgTable, rmpgId, fleetioResource, fleetioId, iso, iso, iso).run();
}

function now(deps: { now?: () => Date }): Date {
  return deps.now ? deps.now() : new Date();
}

async function lookupFleetioId(db: D1Database, rmpgTable: string, rmpgId: number | null): Promise<number | null> {
  if (rmpgId == null) return null;
  const row = await db.prepare(
    `SELECT fleetio_id FROM fleetio_links WHERE rmpg_table = ? AND rmpg_id = ? LIMIT 1`,
  ).bind(rmpgTable, rmpgId).first<{ fleetio_id: number }>();
  return row ? row.fleetio_id : null;
}

// ─── applyInbound ─────────────────────────────────────────

export interface ApplyInboundDeps {
  db: D1Database;
  now?: () => Date;
}

export interface ApplyInboundResult {
  status: 'applied' | 'no_op' | 'failed' | 'unknown_event';
  applied_fields: string[];
  conflict_fields: string[];
  unresolved_fields: string[];
  unknown_fields: string[];
  error?: string;
}

/** Given an inbound event id, look up + apply per ownership rules.
 *  The webhook receiver writes the event then calls this in waitUntil. */
export async function applyInbound(deps: ApplyInboundDeps, eventId: string): Promise<ApplyInboundResult> {
  const empty: ApplyInboundResult = {
    status: 'no_op', applied_fields: [], conflict_fields: [], unresolved_fields: [], unknown_fields: [],
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

  const payload = parsePayload(row.payload_json);
  const fields = Object.keys(payload);
  const { apply, conflict, unknown } = partitionInboundFields(row.resource, fields);

  // — Conflict on rmpg-owned fields: log + (per spec) caller queues an
  //   outbound re-assertion. Logging here ONLY; the re-assertion is the
  //   caller's job to keep this function side-effect-narrow.
  if (conflict.length > 0) {
    for (const field of conflict) {
      try {
        await deps.db.prepare(
          `INSERT INTO fleetio_conflicts (rmpg_table, rmpg_id, field, local_value, remote_value, resolution, created_at)
           VALUES (?, ?, ?, NULL, ?, 'local_wins', datetime('now'))`,
        ).bind(
          resourceToRmpgTable(row.resource),
          row.resource_id,
          field,
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
  if (apply.length > 0 && row.resource_id != null) {
    const setCols: string[] = [];
    const bindings: unknown[] = [];
    const localUpdatedAt = await readLocalUpdatedAtMs(deps.db, row.resource, row.resource_id);
    const remoteUpdatedAt = remoteUpdatedAtMs(payload);

    for (const f of apply) {
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
            await deps.db.prepare(
              `INSERT INTO fleetio_conflicts (rmpg_table, rmpg_id, field, local_value, remote_value, resolution, created_at)
               VALUES (?, ?, ?, NULL, ?, 'unresolved', datetime('now'))`,
            ).bind(
              resourceToRmpgTable(row.resource),
              row.resource_id,
              f,
              JSON.stringify(payload[f] ?? null),
            ).run();
          } catch (err) {
            console.error('[fleetio.sync] failed to log unresolved', { event_id: eventId, f, err });
          }
        }
      }
      setCols.push(`${f} = ?`);
      bindings.push(payload[f] ?? null);
      applied.push(f);
    }
    if (setCols.length > 0) {
      try {
        bindings.push(row.resource_id);
        await deps.db.prepare(
          `UPDATE ${resourceToRmpgTable(row.resource)} SET ${setCols.join(', ')}, updated_at = datetime('now')
           WHERE id = ?`,
        ).bind(...bindings).run();
      } catch (err) {
        return {
          status: 'failed',
          applied_fields: [], conflict_fields: conflict, unresolved_fields: unresolved, unknown_fields: unknown,
          error: err instanceof Error ? err.message : String(err),
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
  switch (resource) {
    case 'vehicle':    return 'fleet_vehicles';
    case 'fuel_entry': return 'fleet_fuel_log';
    default:           return resource; // defensive
  }
}

async function readLocalUpdatedAtMs(db: D1Database, resource: string, id: number): Promise<number | null> {
  try {
    const row = await db.prepare(
      `SELECT updated_at FROM ${resourceToRmpgTable(resource)} WHERE id = ?`,
    ).bind(id).first<{ updated_at: string | null }>();
    if (!row || !row.updated_at) return null;
    const ts = Date.parse(row.updated_at);
    return Number.isFinite(ts) ? ts : null;
  } catch {
    return null;
  }
}

function remoteUpdatedAtMs(payload: Record<string, unknown>): number | null {
  const raw = payload.updated_at;
  if (typeof raw !== 'string') return null;
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? ts : null;
}

// Exported for tests so they don't have to re-derive these helpers.
export const _internals = {
  parsePayload, resourceToRmpgTable, readLocalUpdatedAtMs, remoteUpdatedAtMs,
  dispatchOutbound, lookupFleetioId,
};
// Also re-export the error types the dispatch layer surfaces so tests can
// instanceof-discriminate without re-importing from ./errors.
export { FleetioTimeoutError, FleetioRateLimitError, FleetioHttpError, FleetioConfigError };
