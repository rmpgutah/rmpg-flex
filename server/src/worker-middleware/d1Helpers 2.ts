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
    // D1 auto-batches statements within a single prepare/bind chain.
    // For explicit transactions, we rely on the caller to batch.
    // D1 doesn't support explicit BEGIN/COMMIT in the same way.
    return fn();
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
