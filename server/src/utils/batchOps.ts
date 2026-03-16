// ============================================================
// RMPG Flex — Batch Operations Helper
// ============================================================
// Provides transactional batch insert, update, and delete
// operations for SQLite via better-sqlite3.
//
// All operations run inside a transaction for atomicity.
// If any row fails, the entire batch is rolled back.
// ============================================================

import { getDb } from '../models/database';

/** Validate a SQL identifier (table/column name) to prevent injection.
 *  Uses an ALLOWLIST approach — only permits characters that are valid in SQL identifiers.
 *  For simple identifiers (table/column names): alphanumeric + underscores only.
 *  For compound expressions (JOINs, SELECT lists): also allows dots, spaces, commas,
 *  parens, *, and quoted identifiers — but still rejects semicolons, comments, and
 *  dangerous statement keywords that should never appear in an identifier context. */
function assertSafeIdentifier(value: string, label: string): void {
  if (!value || typeof value !== 'string') {
    throw new Error(`Empty or invalid ${label}`);
  }

  // Strip quoted identifiers (e.g. "column_name") for validation — these are safe
  const stripped = value.replace(/"[^"]+"/g, 'QUOTED');

  // ALLOWLIST: Only permit characters valid in SQL identifier expressions
  // Letters, digits, underscores, dots, spaces, commas, parens, *, =, <, >, !, single quotes (for values)
  // This covers: table.column, aliases, JOIN...ON expressions, ORDER BY, SELECT lists
  const ALLOWED_CHARS = /^[a-zA-Z0-9_.*, ()=<>!|'\-\n\r\t]+$/;
  if (!ALLOWED_CHARS.test(stripped)) {
    throw new Error(`Unsafe characters in ${label}: "${value}"`);
  }

  // DENYLIST (defense-in-depth): reject dangerous SQL statement keywords
  // even if individual characters pass — prevents multi-statement injection
  const DANGEROUS_KEYWORDS = /\b(UNION|EXEC|EXECUTE|ATTACH|DETACH|PRAGMA|LOAD_EXTENSION|VACUUM)\b/i;
  if (DANGEROUS_KEYWORDS.test(stripped)) {
    throw new Error(`Unsafe SQL keyword in ${label}: "${value}"`);
  }

  // Block SQL comment sequences
  if (/--|\/\*|\*\//.test(stripped)) {
    throw new Error(`SQL comment sequence in ${label}: "${value}"`);
  }

  // Block semicolons (statement terminators)
  if (/;/.test(stripped)) {
    throw new Error(`Statement terminator in ${label}: "${value}"`);
  }
}

/**
 * Batch insert rows into a table within a transaction.
 * Returns the number of rows inserted.
 *
 * @example
 * const count = batchInsert('evidence', [
 *   { incident_id: 1, description: 'Knife', type: 'weapon' },
 *   { incident_id: 1, description: 'Phone', type: 'electronic' },
 * ]);
 */
export function batchInsert(
  table: string,
  rows: Record<string, any>[],
): number {
  if (rows.length === 0) return 0;
  assertSafeIdentifier(table, 'table');

  const db = getDb();
  const columns = Object.keys(rows[0]);
  columns.forEach(c => assertSafeIdentifier(c, 'column'));
  const placeholders = columns.map(() => '?').join(', ');
  const sql = `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`;

  const stmt = db.prepare(sql);
  let count = 0;

  const insertAll = db.transaction(() => {
    for (const row of rows) {
      const values = columns.map((col) => row[col] ?? null);
      stmt.run(...values);
      count++;
    }
  });

  insertAll();
  return count;
}

/**
 * Batch update rows in a table within a transaction.
 * Each item must include an `id` field for the WHERE clause.
 * Returns the number of rows affected.
 *
 * @example
 * const affected = batchUpdate('warrants', [
 *   { id: 1, status: 'served', served_date: '2025-01-15' },
 *   { id: 2, status: 'served', served_date: '2025-01-15' },
 * ]);
 */
export function batchUpdate(
  table: string,
  rows: Array<Record<string, any> & { id: string | number }>,
  idColumn = 'id',
): number {
  if (rows.length === 0) return 0;
  assertSafeIdentifier(table, 'table');
  assertSafeIdentifier(idColumn, 'idColumn');

  const db = getDb();
  let totalAffected = 0;

  const updateAll = db.transaction(() => {
    for (const row of rows) {
      const { [idColumn]: id, ...fields } = row;
      const columns = Object.keys(fields);
      if (columns.length === 0) continue;

      const setClauses = columns.map((col) => `"${col}" = ?`).join(', ');
      const sql = `UPDATE "${table}" SET ${setClauses} WHERE "${idColumn}" = ?`;
      const values = [...columns.map((col) => fields[col] ?? null), id];

      const result = db.prepare(sql).run(...values);
      totalAffected += result.changes;
    }
  });

  updateAll();
  return totalAffected;
}

/**
 * Batch delete rows from a table by IDs within a transaction.
 * Returns the number of rows deleted.
 *
 * @example
 * const deleted = batchDelete('temp_records', [101, 102, 103]);
 */
export function batchDelete(
  table: string,
  ids: Array<string | number>,
  idColumn = 'id',
): number {
  if (ids.length === 0) return 0;
  assertSafeIdentifier(table, 'table');
  assertSafeIdentifier(idColumn, 'idColumn');

  const db = getDb();
  const placeholders = ids.map(() => '?').join(', ');
  const sql = `DELETE FROM "${table}" WHERE "${idColumn}" IN (${placeholders})`;

  const result = db.prepare(sql).run(...ids);
  return result.changes;
}

/**
 * Execute a batch of arbitrary SQL statements in a single transaction.
 * Useful for complex multi-table operations.
 *
 * @example
 * runInTransaction((db) => {
 *   db.prepare('UPDATE calls SET status = ? WHERE id = ?').run('closed', callId);
 *   db.prepare('UPDATE units SET status = ? WHERE id = ?').run('available', unitId);
 *   db.prepare('INSERT INTO activity_log ...').run(...);
 * });
 */
export function runInTransaction<T>(
  fn: (db: ReturnType<typeof getDb>) => T,
): T {
  const db = getDb();
  const txn = db.transaction(() => fn(db));
  return txn();
}

/**
 * Upsert (insert or update on conflict) multiple rows.
 * Uses SQLite's INSERT OR REPLACE syntax.
 *
 * @param table      Table name
 * @param rows       Array of row objects
 * @param conflictColumns  Columns that form the unique constraint
 */
export function batchUpsert(
  table: string,
  rows: Record<string, any>[],
  conflictColumns: string[],
): number {
  if (rows.length === 0) return 0;
  assertSafeIdentifier(table, 'table');
  conflictColumns.forEach(c => assertSafeIdentifier(c, 'conflictColumn'));

  const db = getDb();
  const columns = Object.keys(rows[0]);
  columns.forEach(c => assertSafeIdentifier(c, 'column'));
  const placeholders = columns.map(() => '?').join(', ');
  const updateCols = columns.filter((c) => !conflictColumns.includes(c));
  const updateSet = updateCols.map((c) => `"${c}" = excluded."${c}"`).join(', ');

  const sql = `
    INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(', ')})
    VALUES (${placeholders})
    ON CONFLICT (${conflictColumns.map((c) => `"${c}"`).join(', ')})
    DO UPDATE SET ${updateSet}
  `;

  const stmt = db.prepare(sql);
  let count = 0;

  const upsertAll = db.transaction(() => {
    for (const row of rows) {
      const values = columns.map((col) => row[col] ?? null);
      stmt.run(...values);
      count++;
    }
  });

  upsertAll();
  return count;
}

/**
 * Build a paginated query with dynamic WHERE conditions.
 * Returns { data, total, totalPages }.
 *
 * @example
 * const result = paginatedQuery({
 *   table: 'warrants w LEFT JOIN users u ON w.officer_id = u.id',
 *   select: 'w.*, u.full_name as officer_name',
 *   conditions: [
 *     { column: 'w.status', operator: '=', value: 'active' },
 *     { column: 'w.warrant_number', operator: 'LIKE', value: '%2025%' },
 *   ],
 *   orderBy: 'w.created_at DESC',
 *   page: 1,
 *   limit: 25,
 * });
 */
export function paginatedQuery<T = any>(opts: {
  table: string;
  select?: string;
  conditions?: Array<{
    column: string;
    operator: '=' | '!=' | '<' | '>' | '<=' | '>=' | 'LIKE' | 'IN' | 'IS NULL' | 'IS NOT NULL';
    value?: any;
  }>;
  orderBy?: string;
  page?: number;
  limit?: number;
}): { data: T[]; total: number; totalPages: number; page: number; limit: number } {
  const db = getDb();
  const {
    table,
    select = '*',
    conditions = [],
    orderBy = 'id DESC',
    page = 1,
    limit = 25,
  } = opts;

  assertSafeIdentifier(table, 'table');
  assertSafeIdentifier(select, 'select');
  assertSafeIdentifier(orderBy, 'orderBy');

  const whereParts: string[] = [];
  const params: any[] = [];

  for (const cond of conditions) {
    assertSafeIdentifier(cond.column, 'condition.column');
    if (cond.operator === 'IS NULL' || cond.operator === 'IS NOT NULL') {
      whereParts.push(`${cond.column} ${cond.operator}`);
    } else if (cond.operator === 'IN' && Array.isArray(cond.value)) {
      const placeholders = cond.value.map(() => '?').join(', ');
      whereParts.push(`${cond.column} IN (${placeholders})`);
      params.push(...cond.value);
    } else {
      whereParts.push(`${cond.column} ${cond.operator} ?`);
      params.push(cond.value);
    }
  }

  const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
  const offset = (page - 1) * limit;

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM ${table} ${whereClause}`).get(...params) as any;
  const total = countRow?.total || 0;
  const totalPages = Math.ceil(total / limit);

  const data = db.prepare(
    `SELECT ${select} FROM ${table} ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset) as T[];

  return { data, total, totalPages, page, limit };
}
