import type { D1Database, D1Result } from '@cloudflare/workers-types';

export function getDb(env: { DB: D1Database }) {
  return env.DB;
}

export async function query<T = unknown>(
  db: D1Database,
  sql: string,
  ...bindings: unknown[]
): Promise<T[]> {
  const stmt = db.prepare(sql);
  const result = await (bindings.length > 0 ? stmt.bind(...bindings) : stmt).all<T>();
  return result.results ?? [];
}

export async function queryFirst<T = unknown>(
  db: D1Database,
  sql: string,
  ...bindings: unknown[]
): Promise<T | null> {
  const stmt = db.prepare(sql);
  const result = await (bindings.length > 0 ? stmt.bind(...bindings) : stmt).first<T>();
  return result ?? null;
}

export async function execute(
  db: D1Database,
  sql: string,
  ...bindings: unknown[]
): Promise<D1Result> {
  const stmt = db.prepare(sql);
  return await (bindings.length > 0 ? stmt.bind(...bindings) : stmt).run();
}

export async function executeBatch(
  db: D1Database,
  statements: { sql: string; bindings?: unknown[] }[]
): Promise<D1Result[]> {
  return await db.batch(
    statements.map((s) => {
      const stmt = db.prepare(s.sql);
      return s.bindings?.length ? stmt.bind(...s.bindings) : stmt;
    })
  );
}
