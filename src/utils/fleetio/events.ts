// ============================================================
// RMPG Flex — Fleet.io integration: outbound event queue (PR 3)
// ============================================================
// One call site per RMPG write path (fuel POST, vehicle UPDATE today; work
// order + inspection in PRs 5/6). Writes a row into `fleetio_events`
// (direction='outbound') with a deterministic event_id so replays /
// concurrent writes dedupe via the UNIQUE (direction, event_id) constraint.
//
// PR 3 contract: this helper ONLY queues — it does NOT dispatch to Fleet.io.
// The 30-minute reconciliation cron (today a no-op stub from PR 1) will
// become the consumer once PR 4 lands the sync engine. Events accumulate
// in `status='pending'` until then. That's intentional — operators can
// already inspect the queue depth via /admin/fleetio-health (PR 4).
//
// The event_id is `sha256(rmpg_table:rmpg_id:action:version_token)`. Per
// the design spec, that combination is the cheapest deterministic key:
//   - rmpg_table + rmpg_id locate the row in RMPG.
//   - action distinguishes create / update / delete on the same row.
//   - version_token = the calling route's chosen monotonic value (updated_at
//     ISO timestamp, or a request-scoped UUID, or — fallback — Date.now()
//     coerced via the route's existing audit_log row). Same token across
//     duplicate writes = dedup; different token = a new logical event.
//
// CRITICAL: this module never throws on the happy path. Failure to queue
// must NEVER cascade into the originating route's response — fall back to
// console.error and let the reconciliation pass pick up the slack later.
// ============================================================

import type { Context } from 'hono';
import type { Env } from '../../types';
import { getDb } from '../db';

/** Resources we currently emit for. Add more as later PRs come online. */
export type FleetioEmitKind =
  | 'vehicle.create'
  | 'vehicle.update'
  | 'vehicle.delete'
  | 'fuel.create'
  | 'fuel.update'
  | 'fuel.delete'
  | 'work_order.create'
  | 'work_order.update'
  | 'work_order.close'
  | 'inspection.create'
  | 'inspection.submit'
  | 'vendor.create'
  | 'vendor.update'
  | 'vendor.delete'
  | 'part.create'
  | 'part.update'
  | 'part.delete';

export interface EmitOpts {
  /** The RMPG table the source row lives in. Required for the event_id hash. */
  rmpgTable: string;
  /** The RMPG row id. Required for the event_id hash. */
  rmpgId: number;
  /**
   * Monotonic-ish token that DIFFERS across distinct logical events on the same row.
   * `updated_at` (after the write) is the canonical choice for update/create. For
   * deletes, the deletion timestamp. For idempotent retries within one request,
   * pass the SAME token so the duplicate is silently dropped.
   */
  versionToken: string;
}

export interface EmitResult {
  event_id: string;
  queued: boolean;
  /** Reason the helper didn't write a new row. Populated when queued=false. */
  skipped_reason?: 'duplicate' | 'db_error';
  /** When queued=false because of an error, the message is captured here too. */
  error_message?: string;
}

// ─── Pure helpers (unit-testable, no I/O) ────────────────────

const EMIT_KIND_TO_RESOURCE: Record<FleetioEmitKind, { resource: string; action: 'create' | 'update' | 'delete' }> = {
  'vehicle.create':       { resource: 'vehicle',     action: 'create' },
  'vehicle.update':       { resource: 'vehicle',     action: 'update' },
  'vehicle.delete':       { resource: 'vehicle',     action: 'delete' },
  'fuel.create':          { resource: 'fuel_entry', action: 'create' },
  'fuel.update':          { resource: 'fuel_entry', action: 'update' },
  'fuel.delete':          { resource: 'fuel_entry', action: 'delete' },
  'work_order.create':    { resource: 'work_order', action: 'create' },
  'work_order.update':    { resource: 'work_order', action: 'update' },
  'work_order.close':     { resource: 'work_order', action: 'update' },
  'inspection.create':    { resource: 'inspection', action: 'create' },
  'inspection.submit':    { resource: 'inspection', action: 'update' },
  'vendor.create':        { resource: 'vendor',     action: 'create' },
  'vendor.update':        { resource: 'vendor',     action: 'update' },
  'vendor.delete':        { resource: 'vendor',     action: 'delete' },
  'part.create':          { resource: 'part',       action: 'create' },
  'part.update':          { resource: 'part',       action: 'update' },
  'part.delete':          { resource: 'part',       action: 'delete' },
};

export function resolveEmitKind(kind: FleetioEmitKind): { resource: string; action: 'create' | 'update' | 'delete' } {
  const m = EMIT_KIND_TO_RESOURCE[kind];
  if (!m) {
    // Defensive — typescript would normally prevent this, but a runtime
    // string could slip through if a caller widens the type.
    throw new Error(`Unknown FleetioEmitKind: ${String(kind)}`);
  }
  return m;
}

/** Deterministic event_id input. Pure function. */
export function buildEventIdInput(opts: EmitOpts, kind: FleetioEmitKind): string {
  const { resource, action } = resolveEmitKind(kind);
  return `${opts.rmpgTable}:${opts.rmpgId}:${resource}:${action}:${opts.versionToken}`;
}

/** SHA-256 hex digest of a UTF-8 string. Uses Web Crypto, Worker-safe. */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex;
}

// ─── Stateful seam — call inside `c.executionCtx.waitUntil(...)` ──

/**
 * Queue an outbound Fleet.io event by inserting a row into `fleetio_events`.
 *
 * The helper NEVER throws. On any failure it returns `{ queued: false }`
 * with a populated `skipped_reason` so the caller's `waitUntil` chain
 * settles cleanly.
 */
export async function emitFleetioEvent(
  c: Context<{ Bindings: Env['Bindings']; Variables: Env['Variables'] }>,
  kind: FleetioEmitKind,
  payload: unknown,
  opts: EmitOpts,
): Promise<EmitResult> {
  let eventId: string;
  try {
    eventId = await sha256Hex(buildEventIdInput(opts, kind));
  } catch (err) {
    console.error('[fleetio.events] failed to hash event_id', {
      kind, rmpgTable: opts.rmpgTable, rmpgId: opts.rmpgId, error: (err as Error)?.message,
    });
    return { event_id: '', queued: false, skipped_reason: 'db_error', error_message: (err as Error)?.message };
  }
  const { resource, action } = resolveEmitKind(kind);
  const db = getDb(c.env);
  try {
    // INSERT OR IGNORE — UNIQUE (direction, event_id) silently absorbs
    // duplicate retries (Fleet.io webhook retry policy, dispatched cron
    // replays, idempotent client double-clicks).
    const result = await db.prepare(
      `INSERT OR IGNORE INTO fleetio_events
         (direction, event_id, resource, resource_id, action, status, attempts, payload_json, created_at)
       VALUES ('outbound', ?, ?, ?, ?, 'pending', 0, ?, datetime('now'))`,
    ).bind(
      eventId,
      resource,
      opts.rmpgId,
      action,
      JSON.stringify(payload ?? null),
    ).run();
    // D1 returns meta.changes=0 when the row was ignored due to the unique
    // constraint. queued=true ONLY when an actual row landed.
    const changes = result?.meta?.changes ?? 0;
    if (changes === 0) {
      return { event_id: eventId, queued: false, skipped_reason: 'duplicate' };
    }
    return { event_id: eventId, queued: true };
  } catch (err) {
    // D1 down, schema drift (fleetio_events table missing), etc. Don't
    // crash the originating route — log and return a soft failure. PR 4
    // reconciliation will close the gap by replaying events from the audit
    // log if needed.
    console.error('[fleetio.events] INSERT failed', {
      kind, event_id: eventId, error: (err as Error)?.message,
    });
    return {
      event_id: eventId,
      queued: false,
      skipped_reason: 'db_error',
      error_message: (err as Error)?.message,
    };
  }
}
