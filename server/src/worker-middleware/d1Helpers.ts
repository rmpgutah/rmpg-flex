// ============================================================
// RMPG Flex — Workers D1 Helpers
// ============================================================
// Async D1 helpers that mirror better-sqlite3 patterns used in
// Express routes. All methods return Promises.
// ============================================================

import type { D1Database, D1Result } from '@cloudflare/workers-types';

export interface D1Row {
  [key: string]: any;
}

export interface D1RunResult {
  success: boolean;
  meta: {
    changes: number;
    last_row_id: number | null;
    duration: number;
  };
}

export class D1Stmt {
  private db: D1Database;
  private sql: string;

  constructor(db: D1Database, sql: string) {
    this.db = db;
    this.sql = sql;
  }

  async get(...params: any[]): Promise<D1Row | undefined> {
    const result = await this.db.prepare(this.sql).bind(...params).first<D1Row>();
    return result || undefined;
  }

  async all(...params: any[]): Promise<D1Row[]> {
    const result = await this.db.prepare(this.sql).bind(...params).all<D1Row>();
    return result.results || [];
  }

  async run(...params: any[]): Promise<D1RunResult> {
    const result = await this.db.prepare(this.sql).bind(...params).run();
    return {
      success: true,
      meta: {
        changes: result.meta?.changes ?? 0,
        last_row_id: result.meta?.last_row_id ?? null,
        duration: result.meta?.duration ?? 0,
      },
    };
  }
}

export class D1Db {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  prepare(sql: string): D1Stmt {
    return new D1Stmt(this.db, sql);
  }

  async exec(sql: string): Promise<void> {
    await this.db.exec(sql);
  }

  transaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  private static columnCache = new Map<string, Promise<Set<string>>>();

  async getColumns(table: string): Promise<Set<string>> {
    const cached = D1Db.columnCache.get(table);
    if (cached) return cached;

    const promise = (async () => {
      const rows = await this.db.prepare(`PRAGMA table_info(\`${table}\`)`).all<{ name: string }>();
      return new Set(rows.results?.map(r => r.name) ?? []);
    })();

    D1Db.columnCache.set(table, promise);
    return promise;
  }
}

export async function filterFieldMap<T extends Record<string, any>>(
  db: D1Db,
  table: string,
  fieldMap: Record<string, (v: any) => any>,
  body: T,
  extraKeys?: Record<string, (v: any) => any>,
): Promise<{ columns: string[]; placeholders: string[]; values: any[]; setClauses: string[] }> {
  const existingCols = await db.getColumns(table);
  const columns: string[] = [];
  const placeholders: string[] = [];
  const values: any[] = [];
  const setClauses: string[] = [];
  const bodyKeys = Object.keys(body);

  for (const [key, transform] of Object.entries(fieldMap)) {
    if (bodyKeys.includes(key) && existingCols.has(key)) {
      columns.push(key);
      placeholders.push('?');
      values.push(transform(body[key]));
      setClauses.push(`${key} = ?`);
    }
  }

  if (extraKeys) {
    for (const [key, transform] of Object.entries(extraKeys)) {
      if (bodyKeys.includes(key) && existingCols.has(key)) {
        columns.push(key);
        placeholders.push('?');
        values.push(transform(body[key]));
        setClauses.push(`${key} = ?`);
      }
    }
  }

  return { columns, placeholders, values, setClauses };
}

/**
 * Retry a database operation after discovering table columns.
 * If `fn` throws a `no such column` error, this queries PRAGMA table_info,
 * caches the result, and re-invokes `fn` so it can build a valid query.
 */
export async function withColumnRetry<T>(
  db: D1Db,
  table: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    if (err?.message?.includes('no such column')) {
      await db.getColumns(table);
      return fn();
    }
    throw err;
  }
}

// Safe string helper — mirrors the Express pattern
export function safeStr(v: any): string {
  return v == null ? '' : String(v);
}

// Parameter string helper — for route params
export function paramStr(v: string | string[] | undefined): string {
  if (v === undefined) return '';
  return Array.isArray(v) ? v[0] : v;
}

export function paramNum(v: string | string[] | undefined): number {
  return parseInt(paramStr(v), 10);
}

// Re-export time utils for convenience
export { localNow, localToday } from './timeUtils';
