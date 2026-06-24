// ============================================================
// RMPG Flex — Structured JSON Logger
// ============================================================
// Replaces ad-hoc console.log/error calls with structured JSON
// lines that carry service name, log level, trace ID, and
// machine-parseable payloads. Compatible with Workers Logs,
// wrangler tail --format json, and external log sinks.
//
// Usage:
//   import { log } from '../utils/logger';
//   log.info('User logged in', { userId: 123 });
//   log.error('DB query failed', { sql }, err);
//
// Trace IDs are auto-generated per-request and propagated via
// Hono's c.set/c.get. Attach the traceMiddleware to get them:
//   app.use('*', traceMiddleware);
//   const traceId = c.get('traceId');
// ============================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  /** ISO-8601 UTC timestamp */
  t: string;
  /** Log level */
  l: LogLevel;
  /** Service identifier */
  s: string;
  /** Correlation / trace ID */
  trace?: string;
  /** Human-readable message */
  msg: string;
  /** Structured key-value context */
  ctx?: Record<string, unknown>;
  /** Error details (only on error level) */
  err?: { name?: string; message?: string; stack?: string };
}

// ── Trace ID generation ─────────────────────────────────────

const HEX = '0123456789abcdef';
export function generateTraceId(): string {
  // 16 hex chars = 64 bits of entropy, compact and readable
  let id = '';
  for (let i = 0; i < 16; i++) {
    id += HEX[(Math.random() * 16) | 0];
  }
  return id;
}

// ── Hono middleware ─────────────────────────────────────────

import type { MiddlewareHandler } from 'hono';

/**
 * Middleware that attaches a unique trace ID to every request.
 * Access via c.get('traceId'). The ID is also set as the
 * `X-Trace-Id` response header for client-side correlation.
 */
export function traceMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    // Reuse client-provided trace ID if present (for distributed tracing)
    const traceId = c.req.header('X-Trace-Id') || generateTraceId();
    c.set('traceId', traceId);
    c.res.headers.set('X-Trace-Id', traceId);
    await next();
  };
}

// ── Logger implementation ───────────────────────────────────

/** Get the trace ID from a context-like object (duck-typed so it
 *  works with both Hono c and standalone usage where ctx is null). */
function resolveTrace(ctx?: { get?: (k: string) => unknown }): string | undefined {
  try {
    const t = ctx?.get?.('traceId');
    return typeof t === 'string' && t.length > 0 ? t : undefined;
  } catch {
    return undefined;
  }
}

function writeEntry(entry: LogEntry): void {
  // Workers Logs (observability) captures console.log output as JSON.
  // Using console.log for everything since wrangler tail --format json
  // can parse it; the log level is embedded in the structured payload.
  const line = JSON.stringify(entry);
  if (entry.l === 'error') {
    console.error(line);
  } else if (entry.l === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>, err?: unknown): void;
  /** Create a child logger with a fixed trace ID */
  withTrace(traceId: string): Logger;
  /** Create a child logger with extra context merged into every call */
  withCtx(extra: Record<string, unknown>): Logger;
}

function makeLogger(traceOverride?: string, baseCtx?: Record<string, unknown>): Logger {
  const ctx = baseCtx ?? {};
  const mk = (level: LogLevel) => (msg: string, extra?: Record<string, unknown>, err?: unknown) => {
    const trace = traceOverride || resolveTrace((globalThis as any).__honoCtx);
    const entry: LogEntry = {
      t: new Date().toISOString(),
      l: level,
      s: 'rmpg-flex-api',
      msg,
    };
    if (trace) entry.trace = trace;
    const merged = { ...ctx, ...extra };
    if (Object.keys(merged).length > 0) entry.ctx = merged;
    if (err) {
      if (err instanceof Error) {
        entry.err = { name: err.name, message: err.message, stack: err.stack?.split('\n').slice(0, 4).join('; ') };
      } else {
        entry.err = { message: String(err) };
      }
    }
    writeEntry(entry);
  };

  return {
    debug: mk('debug'),
    info: mk('info'),
    warn: mk('warn'),
    error: mk('error'),
    withTrace(traceId: string): Logger {
      return makeLogger(traceId, ctx);
    },
    withCtx(extra: Record<string, unknown>): Logger {
      return makeLogger(traceOverride, { ...ctx, ...extra });
    },
  };
}

/** Default singleton logger — no fixed trace ID (uses middleware). */
export const log: Logger = makeLogger();

// ── D1 error persistence ────────────────────────────────────

export interface ErrorLogEntry {
  severity: 'error' | 'critical' | 'warning';
  category: 'route' | 'cron' | 'integration' | 'db' | 'auth';
  message: string;
  details?: Record<string, unknown>;
  traceId?: string;
  userId?: number;
  source?: string;
  statusCode?: number;
}

/**
 * Persist an error to the `error_log` D1 table (migration 0156).
 * Fire-and-forget via waitUntil — never awaits, never throws into
 * the request path. Idempotent: safe to call before the migration
 * lands (INSERT silently fails on missing table via try/catch).
 *
 * @param db     D1 binding
 * @param entry  structured error details
 * @param ctx    ExecutionContext for waitUntil (optional — when absent,
 *               the INSERT runs inline and may block the response)
 */
export function logErrorToDb(
  db: D1Database,
  entry: ErrorLogEntry,
  ctx?: ExecutionContext,
): void {
  const work = (async () => {
    try {
      await db.prepare(
        `INSERT INTO error_log (severity, category, message, details_json, trace_id, user_id, source, status_code)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        entry.severity,
        entry.category,
        entry.message.slice(0, 2000),
        entry.details ? JSON.stringify(entry.details) : null,
        entry.traceId ?? null,
        entry.userId ?? null,
        entry.source ?? null,
        entry.statusCode ?? null,
      ).run();
    } catch {
      // Table may not exist yet (migration 0156 not applied) — silent
    }
  })();
  if (ctx) {
    ctx.waitUntil(work);
  } else {
    void work;
  }
}

// ── Hono-compatible: patch c.logger? No — Hono's logger() already
// logs every request. We REPLACE it by providing our own middleware
// that replicates the request-log format in JSON.

/**
 * Request logging middleware — replaces `logger()` from Hono.
 * Logs every request with method, path, status, duration, and trace ID.
 */
export function requestLogMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const start = Date.now();
    const method = c.req.method;
    const path = new URL(c.req.url).pathname;
    const traceId = c.get('traceId') as string | undefined;

    // Store trace on global for non-middleware access
    if (traceId) {
      try { (globalThis as any).__honoCtx = c; } catch { /* ignore */ }
    }

    await next();

    const duration = Date.now() - start;
    const status = c.res.status;

    writeEntry({
      t: new Date().toISOString(),
      l: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
      s: 'rmpg-flex-api',
      trace: traceId,
      msg: `${method} ${path} → ${status}`,
      ctx: { method, path, status, duration_ms: duration },
    });
  };
}
