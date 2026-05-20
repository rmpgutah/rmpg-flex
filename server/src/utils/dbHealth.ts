// Database health & monitoring
import { getDb } from '../models/database';
import { logger } from './logger';

interface DbHealthResult {
  status: 'ok' | 'degraded' | 'error';
  responseTimeMs: number;
  walMode: boolean;
  pageSize: number;
  pageCount: number;
  freePages: number;
  journalMode: string;
  integrityOk: boolean | null;
}

/** Run a comprehensive database health check */
export function checkDbHealth(): DbHealthResult {
  const start = performance.now();
  try {
    const db = getDb();

    // Basic connectivity test
    db.prepare('SELECT 1').get();
    const responseTimeMs = performance.now() - start;

    // Gather database stats
    const journalMode =
      (db.prepare('PRAGMA journal_mode').get() as any)?.journal_mode || 'unknown';
    const pageSize = (db.prepare('PRAGMA page_size').get() as any)?.page_size || 0;
    const pageCount = (db.prepare('PRAGMA page_count').get() as any)?.page_count || 0;
    const freePages =
      (db.prepare('PRAGMA freelist_count').get() as any)?.freelist_count || 0;

    // Quick integrity check (checks first page only for speed)
    let integrityOk: boolean | null = null;
    try {
      const result = db.prepare('PRAGMA quick_check(1)').get() as any;
      integrityOk = result?.quick_check === 'ok';
    } catch {
      integrityOk = null;
    }

    return {
      status: responseTimeMs > 1000 ? 'degraded' : 'ok',
      responseTimeMs: Math.round(responseTimeMs * 100) / 100,
      walMode: journalMode === 'wal',
      pageSize,
      pageCount,
      freePages,
      journalMode,
      integrityOk,
    };
  } catch {
    return {
      status: 'error',
      responseTimeMs: performance.now() - start,
      walMode: false,
      pageSize: 0,
      pageCount: 0,
      freePages: 0,
      journalMode: 'unknown',
      integrityOk: false,
    };
  }
}

/** Time a database query and log if slow */
export function timeQuery<T>(label: string, fn: () => T, slowThresholdMs = 100): T {
  const start = performance.now();
  const result = fn();
  const elapsed = performance.now() - start;

  if (elapsed > slowThresholdMs) {
    logger.warn(
      { query: label, durationMs: Math.round(elapsed) },
      'Slow database query detected'
    );
  }

  return result;
}

/** Get table sizes in the database */
export function getTableSizes(): Array<{ table: string; rowCount: number }> {
  try {
    const db = getDb();
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all() as Array<{ name: string }>;

    return tables.map((t) => {
      try {
        const row = db.prepare(`SELECT COUNT(*) as cnt FROM "${t.name}"`).get() as any;
        return { table: t.name, rowCount: row?.cnt || 0 };
      } catch {
        return { table: t.name, rowCount: -1 };
      }
    });
  } catch {
    return [];
  }
}
