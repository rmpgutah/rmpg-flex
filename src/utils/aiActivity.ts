// ============================================================
// aiActivity — usage metering for every /api/ai endpoint
// ============================================================
// GET /ai/stats, GET /ai/activity and GET /ai/dev-chat/history used to return
// hardcoded zeros / empty arrays, so AIActivityPanel, AICommandCenterPanel and
// AdminAISettingsTab rendered as permanently-empty shells. This module is the
// write side that makes them real, backed by `ai_activity_log`
// (migration 0291_ai_activity_log.sql).
//
// Hard rule: logging is observability, not the product. logAiActivity() can
// never throw and never blocks — an officer's narrative assist must succeed
// even if the log table is missing, locked, or the D1 write fails. Every path
// here is try/caught and returns void.
//
// The table is also reconciled at runtime (once per isolate) so a deploy that
// lands the route ahead of the migration degrades to "logs nothing" rather
// than "every AI endpoint 500s", which is the same posture src/routes/alpr.ts
// takes for alpr_captures.
// ============================================================

import { execute, query, queryFirst } from './db';
import { log } from './logger';

const PREVIEW_MAX = 200;

export type AiActivityStatus = 'success' | 'error' | 'fallback';

export interface AiActivityEntry {
  taskType: string;
  provider?: string;
  model?: string | null;
  latencyMs?: number;
  status?: AiActivityStatus;
  /** Raw prompt/query — truncated and whitespace-collapsed before storage. */
  prompt?: string | null;
  error?: string | null;
  userId?: number | null;
}

export interface AiUsageStats {
  requestsToday: number;
  requestsThisWeek: number;
  requestsThisMonth: number;
  avgResponseMs: number;
  cacheHitRate: number;
  totalRequests: number;
}

export interface AiActivityRow {
  id: number;
  task_type: string;
  provider: string;
  latency_ms: number;
  status: string;
  prompt_preview: string;
  created_at: string;
}

/** Zeroed stats — the honest answer when the log table is unavailable. */
export function emptyUsageStats(): AiUsageStats {
  return {
    requestsToday: 0,
    requestsThisWeek: 0,
    requestsThisMonth: 0,
    avgResponseMs: 0,
    cacheHitRate: 0,
    totalRequests: 0,
  };
}

/**
 * One-line, length-capped preview of a prompt.
 * The activity panel renders these in a table row, so an embedded newline
 * would break the layout and a full narrative would blow out the column.
 */
export function promptPreview(text: string | null | undefined): string {
  if (!text) return '';
  const flat = String(text).replace(/\s+/g, ' ').trim();
  if (flat.length <= PREVIEW_MAX) return flat;
  return `${flat.slice(0, PREVIEW_MAX - 1)}…`;
}

const CREATE_ACTIVITY_SQL = `
  CREATE TABLE IF NOT EXISTS ai_activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_type TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'workers-ai',
    model TEXT,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'success',
    prompt_preview TEXT,
    error TEXT,
    user_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`;

// Per-isolate latch. Reconciling on every request would add a needless D1
// round-trip to every AI call.
let tablesReady = false;

/** @internal — test seam so each test starts from a cold isolate. */
export function __resetAiActivityTablesForTest(): void {
  tablesReady = false;
}

async function ensureTables(db: D1Database): Promise<boolean> {
  if (tablesReady) return true;
  try {
    await execute(db, CREATE_ACTIVITY_SQL);
    tablesReady = true;
    return true;
  } catch (err) {
    log.warn('[aiActivity] could not reconcile ai_activity_log', {
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Record one AI call. Fire-and-forget: awaiting it is optional and it never
 * rejects. Pass `ctx` to push the write off the response path entirely.
 */
export async function logAiActivity(
  db: D1Database,
  entry: AiActivityEntry,
  ctx?: { waitUntil(p: Promise<unknown>): void },
): Promise<void> {
  const write = (async () => {
    try {
      if (!(await ensureTables(db))) return;
      await execute(
        db,
        `INSERT INTO ai_activity_log
           (task_type, provider, model, latency_ms, status, prompt_preview, error, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        entry.taskType,
        entry.provider ?? 'workers-ai',
        entry.model ?? null,
        Math.max(0, Math.round(entry.latencyMs ?? 0)),
        entry.status ?? 'success',
        promptPreview(entry.prompt),
        entry.error ? String(entry.error).slice(0, 500) : null,
        entry.userId ?? null,
      );
    } catch (err) {
      // Swallow deliberately — see the module header.
      log.warn('[aiActivity] log write failed', {
        taskType: entry.taskType,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  })();

  if (ctx?.waitUntil) {
    ctx.waitUntil(write);
    return;
  }
  await write;
}

/** Aggregate counters for GET /ai/stats. Degrades to zeros, never throws. */
export async function getAiUsageStats(db: D1Database): Promise<AiUsageStats> {
  try {
    const row = await queryFirst<{
      today: number; week: number; month: number;
      total: number; avg_ms: number | null; fallbacks: number;
    }>(db, `
      SELECT
        SUM(CASE WHEN created_at >= datetime('now', '-1 day')   THEN 1 ELSE 0 END) AS today,
        SUM(CASE WHEN created_at >= datetime('now', '-7 days')  THEN 1 ELSE 0 END) AS week,
        SUM(CASE WHEN created_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END) AS month,
        COUNT(*) AS total,
        AVG(CASE WHEN status = 'success' THEN latency_ms END) AS avg_ms,
        SUM(CASE WHEN status = 'fallback' THEN 1 ELSE 0 END) AS fallbacks
      FROM ai_activity_log`);
    if (!row) return emptyUsageStats();
    const total = row.total ?? 0;
    return {
      requestsToday: row.today ?? 0,
      requestsThisWeek: row.week ?? 0,
      requestsThisMonth: row.month ?? 0,
      avgResponseMs: Math.round(row.avg_ms ?? 0),
      // There is no response cache in front of the AI calls, so the panel's
      // "cache hit rate" tile is repurposed as the share of requests served
      // by the PRIMARY provider (i.e. that did not have to fall back).
      cacheHitRate: total > 0 ? Math.round(((total - (row.fallbacks ?? 0)) / total) * 100) : 0,
      totalRequests: total,
    };
  } catch (err) {
    log.warn('[aiActivity] stats query failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return emptyUsageStats();
  }
}

/** Recent rows for GET /ai/activity. Degrades to [], never throws. */
export async function getAiActivity(db: D1Database, limit: number): Promise<AiActivityRow[]> {
  const safeLimit = Math.min(Math.max(1, Math.trunc(limit) || 25), 200);
  try {
    return await query<AiActivityRow>(db, `
      SELECT id, task_type, provider, latency_ms, status,
             COALESCE(prompt_preview, '') AS prompt_preview, created_at
      FROM ai_activity_log
      ORDER BY id DESC
      LIMIT ?`, safeLimit);
  } catch (err) {
    log.warn('[aiActivity] activity query failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
