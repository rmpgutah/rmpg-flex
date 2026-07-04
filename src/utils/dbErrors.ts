// ============================================================
// RMPG Flex — D1 error classification
// ============================================================
// Route handlers used to `return c.json({ error: 'X', detail:
// (err as Error)?.message }, 500)` on any DB failure — leaking the
// raw SQLite/D1 driver string (table/column names, SQL fragments,
// SQLITE_CORRUPT/SQLITE_CONSTRAINT internals) straight to the
// client. dbErrorResponse() replaces that: it logs the full raw
// error server-side (structured logger + fire-and-forget error_log
// row) and returns a client-safe, classified message instead.
//
// Usage (inside a route's catch block):
//   import { dbErrorResponse } from '../utils/dbErrors';
//   } catch (err) {
//     return dbErrorResponse(c, err, 'Failed to update person');
//   }
// ============================================================

import type { Context } from 'hono';
import { log, logErrorToDb } from './logger';

export type DbErrorCode =
  | 'db_corrupt'
  | 'db_constraint'
  | 'db_schema_drift'
  | 'db_type_error'
  | 'db_busy'
  | 'db_error';

interface ClassifiedDbError {
  status: 400 | 409 | 500 | 503;
  code: DbErrorCode;
  message: string;
}

/** Map a raw D1/SQLite error string to a client-safe status/code/message. */
export function classifyDbError(err: unknown): ClassifiedDbError {
  const raw = err instanceof Error ? err.message : String(err ?? '');

  if (/SQLITE_CORRUPT/i.test(raw)) {
    return {
      status: 503,
      code: 'db_corrupt',
      message: 'A database index needs repair. This has been flagged automatically — please try again shortly.',
    };
  }
  if (/SQLITE_CONSTRAINT/i.test(raw)) {
    return {
      status: 409,
      code: 'db_constraint',
      message: 'This change conflicts with existing data (duplicate value or invalid reference).',
    };
  }
  if (/no such column|no such table/i.test(raw)) {
    return {
      status: 503,
      code: 'db_schema_drift',
      message: 'A required database field is missing. This has been flagged — please try again shortly.',
    };
  }
  if (/D1_TYPE_ERROR/i.test(raw)) {
    return {
      status: 400,
      code: 'db_type_error',
      message: 'One of the submitted values has an invalid type.',
    };
  }
  if (/SQLITE_BUSY|database is locked/i.test(raw)) {
    return {
      status: 503,
      code: 'db_busy',
      message: 'The database is momentarily busy — please try again.',
    };
  }
  return {
    status: 500,
    code: 'db_error',
    message: 'An unexpected database error occurred.',
  };
}

/**
 * Log the full raw error (structured logger + error_log table) and
 * return a Hono JSON response carrying only the classified, client-safe
 * message. `fallback` is the short human label for what operation failed
 * (e.g. "Failed to update person") — shown to the client alongside the
 * classified message; the raw driver string never leaves the Worker.
 *
 * `appCode`, when given, overrides the classified `code` in the response
 * (some routes already hand out a specific business code like
 * 'AUDIT_COUNT_FAILED' or 'BULK_ERROR' — pass it through unchanged so any
 * caller keying off that string keeps working). The HTTP status is still
 * driven by the raw error's classification, not hardcoded to 500.
 */
export function dbErrorResponse(c: Context, err: unknown, fallback: string, appCode?: string) {
  const classified = classifyDbError(err);
  const traceId = (c.get as (key: string) => unknown)?.('traceId') as string | undefined;

  log.error(fallback, { code: appCode ?? classified.code, route: c.req.path }, err instanceof Error ? err : new Error(String(err)));

  const env = c.env as { DB?: D1Database } | undefined;
  if (env?.DB) {
    // `c.executionCtx` is a Hono getter that THROWS when there is none (DO
    // alarms, vitest harness paths that synthesize a Context). Guard the
    // access so we degrade to "no waitUntil" — logErrorToDb already
    // tolerates an undefined ctx (fire-and-forget best effort).
    let ctx: { waitUntil(p: Promise<unknown>): void } | undefined;
    try { ctx = c.executionCtx; } catch { ctx = undefined; }

    logErrorToDb(env.DB, {
      severity: 'error',
      category: 'route',
      message: `${fallback}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 2000),
      traceId,
      source: c.req.path,
      statusCode: classified.status,
    }, ctx);
  }

  // `detail` (not `message`) — client/src/hooks/useApi.ts:390 reads
  // `errData.detail`/`errData.details` and appends it to `error` for the
  // user-facing message. Keep that field name so the classified text
  // actually surfaces instead of silently vanishing.
  return c.json({ error: fallback, code: appCode ?? classified.code, detail: classified.message }, classified.status);
}
