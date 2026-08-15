import { log } from './logger';

export type WinnerSource = 'fz55' | 'cloudflare' | 'equal';

export function pickWinner(
  fz55UpdatedAt: string | null | undefined,
  cloudUpdatedAt: string | null | undefined,
): WinnerSource {
  if (!fz55UpdatedAt && !cloudUpdatedAt) return 'equal';
  if (!fz55UpdatedAt) return 'cloudflare';
  if (!cloudUpdatedAt) return 'fz55';
  if (fz55UpdatedAt > cloudUpdatedAt) return 'fz55';
  if (cloudUpdatedAt > fz55UpdatedAt) return 'cloudflare';
  return 'equal';
}

export interface SyncQueueRow {
  id: number;
  method: string;
  path: string;
  body: string | null;
  headers: string | null;
  created_at: string;
  attempts: number;
}

export interface ReplayResult {
  delivered: number;
  failed: number;
  skipped: number;
}

const CLOUD_BASE = 'https://api.rmpgutah.us';
const MAX_ATTEMPTS = 10;
const STALE_DAYS = 7;

export async function replayQueue(
  db: D1Database,
  jwtSecret: string,
): Promise<ReplayResult> {
  const result: ReplayResult = { delivered: 0, failed: 0, skipped: 0 };

  // Mark rows older than STALE_DAYS as failed
  await db.prepare(`
    UPDATE sync_queue SET status = 'failed', error = 'stale'
    WHERE status = 'pending'
      AND created_at < datetime('now', '-${STALE_DAYS} days')
  `).run();

  const rows = await db.prepare(`
    SELECT id, method, path, body, headers, created_at, attempts
    FROM sync_queue
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT 50
  `).all<SyncQueueRow>();

  for (const row of rows.results) {
    try {
      const headers: Record<string, string> = row.headers ? JSON.parse(row.headers) : {};
      headers['Content-Type'] = 'application/json';

      const res = await fetch(`${CLOUD_BASE}${row.path}`, {
        method: row.method,
        headers,
        body: row.body ?? undefined,
        signal: AbortSignal.timeout(10_000),
      });

      if (res.ok) {
        await db.prepare(
          `UPDATE sync_queue SET status = 'delivered', last_attempt = datetime('now') WHERE id = ?`
        ).bind(row.id).run();
        result.delivered++;
      } else if (res.status >= 400 && res.status < 500) {
        const err = await res.text().catch(() => String(res.status));
        await db.prepare(
          `UPDATE sync_queue SET status = 'failed', error = ?, last_attempt = datetime('now') WHERE id = ?`
        ).bind(err.slice(0, 500), row.id).run();
        result.failed++;
        log.warn('sync replay 4xx — not retrying', { queueId: row.id, status: res.status });
      } else {
        const newAttempts = row.attempts + 1;
        if (newAttempts >= MAX_ATTEMPTS) {
          await db.prepare(
            `UPDATE sync_queue SET status = 'failed', attempts = ?, error = 'max_attempts', last_attempt = datetime('now') WHERE id = ?`
          ).bind(newAttempts, row.id).run();
          result.failed++;
        } else {
          await db.prepare(
            `UPDATE sync_queue SET attempts = ?, last_attempt = datetime('now') WHERE id = ?`
          ).bind(newAttempts, row.id).run();
          result.skipped++;
        }
      }
    } catch (err: unknown) {
      const newAttempts = row.attempts + 1;
      const errMsg = err instanceof Error ? err.message : String(err);
      if (newAttempts >= MAX_ATTEMPTS) {
        await db.prepare(
          `UPDATE sync_queue SET status = 'failed', attempts = ?, error = ?, last_attempt = datetime('now') WHERE id = ?`
        ).bind(newAttempts, errMsg.slice(0, 500), row.id).run();
        result.failed++;
      } else {
        await db.prepare(
          `UPDATE sync_queue SET attempts = ?, last_attempt = datetime('now') WHERE id = ?`
        ).bind(newAttempts, row.id).run();
        result.skipped++;
      }
    }
  }

  return result;
}
