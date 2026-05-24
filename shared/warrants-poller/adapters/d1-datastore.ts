// REFERENCE IMPLEMENTATION — copy and adapt into the Cloudflare Workers repo.
//
// This file deliberately does NOT import @cloudflare/workers-types (that
// dep doesn't belong in the shared core repo). The D1Database surface is
// re-declared locally below as a minimal structural type. When you copy
// this into the CF repo, delete the local declarations and import the
// real types from @cloudflare/workers-types.
//
// Backs the DataStore interface against three D1 tables defined in
// shared/warrants-poller/README.md. If you change the schema there,
// change it here too (keep them in sync).

import type { DataStore, PersonStub, PollResult, WarrantRecord } from '../types.ts';

// === Minimal D1 surface (delete when copying into CF repo) ===
interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}
interface D1Result<T = unknown> {
  results?: T[];
  success: boolean;
  meta: { last_row_id?: number; changes?: number; rows_written?: number };
}
// === end minimal D1 surface ===

// Local persons-table shape. The CF integration site will already have a
// persons table from the legacy import; tweak field names + the JOIN below
// to match. The point of this adapter is to PROVE the SQL shape, not to
// be schema-perfect for any specific deployment.
interface LocalPersonRow {
  id: number;
  full_name: string;
  dob: string | null;
}

export interface D1DataStoreOptions {
  /** D1 binding. In the Worker this is env.DB (or whatever you named it). */
  db: D1Database;
  /** Override if your persons table isn't named "persons". */
  personsTable?: string;
  /** Override if your persons name column isn't "full_name". */
  personsNameColumn?: string;
  /** Override if your persons dob column isn't "dob". */
  personsDobColumn?: string;
}

export function makeD1DataStore(opts: D1DataStoreOptions): DataStore {
  const db = opts.db;
  const personsTable = opts.personsTable ?? 'persons';
  const nameCol = opts.personsNameColumn ?? 'full_name';
  const dobCol = opts.personsDobColumn ?? 'dob';

  return {
    async findExistingWarrant(source, sourceWarrantId): Promise<WarrantRecord | null> {
      const row = await db
        .prepare(
          'SELECT id, source, source_warrant_id, subject_name, dob, charges_json, ' +
            'bond_amount, issued_date, warrant_type, raw_json, fetched_at ' +
            'FROM warrants WHERE source = ? AND source_warrant_id = ?',
        )
        .bind(source, sourceWarrantId)
        .first();
      if (!row) return null;
      return rowToWarrant(row);
    },

    async upsertWarrant(rec): Promise<{ inserted: boolean; warrantId: number }> {
      const now = new Date().toISOString();
      // ON CONFLICT DO UPDATE returns the row id either way. We detect
      // "inserted" by comparing rows_written (1 on insert, 0 on update).
      const result = await db
        .prepare(
          'INSERT INTO warrants ' +
            '(source, source_warrant_id, subject_name, dob, charges_json, ' +
            ' bond_amount, issued_date, warrant_type, raw_json, fetched_at, ' +
            ' first_seen_at, last_seen_at) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
            'ON CONFLICT(source, source_warrant_id) DO UPDATE SET ' +
            ' subject_name = excluded.subject_name, ' +
            ' charges_json = excluded.charges_json, ' +
            ' bond_amount  = excluded.bond_amount, ' +
            ' issued_date  = excluded.issued_date, ' +
            ' warrant_type = excluded.warrant_type, ' +
            ' raw_json     = excluded.raw_json, ' +
            ' fetched_at   = excluded.fetched_at, ' +
            ' last_seen_at = excluded.last_seen_at ' +
            'RETURNING id',
        )
        .bind(
          rec.source,
          rec.sourceWarrantId,
          rec.subjectName,
          rec.dob ?? null,
          JSON.stringify(rec.charges),
          rec.bondAmount ?? null,
          rec.issuedDate ?? null,
          rec.warrantType ?? null,
          JSON.stringify(rec),
          rec.fetchedAt,
          now,
          now,
        )
        .first<{ id: number }>();
      const warrantId = result?.id ?? 0;
      // D1's RETURNING doesn't directly signal insert vs update. We detect
      // a fresh insert by checking first_seen_at == last_seen_at — the
      // upsert path above touches last_seen_at on every write but leaves
      // first_seen_at unchanged, so equality means this row's lifetime
      // started in THIS call. (Used only for PollResult counters.)
      const verify = await db
        .prepare('SELECT first_seen_at = last_seen_at AS just_inserted FROM warrants WHERE id = ?')
        .bind(warrantId)
        .first<{ just_inserted: number }>();
      return { inserted: !!verify?.just_inserted, warrantId };
    },

    async findPersonByNameDOB(name, dob): Promise<PersonStub | null> {
      // Match by exact canonical name + dob when both supplied. Without
      // dob, match by name only and return the first hit — the caller
      // (orchestrator) only uses this for new-warrant linkage, so a
      // false-positive link is recoverable (delete the link).
      const sql = dob
        ? `SELECT id, ${nameCol} AS full_name, ${dobCol} AS dob FROM ${personsTable} ` +
          `WHERE ${nameCol} = ? AND ${dobCol} = ? LIMIT 1`
        : `SELECT id, ${nameCol} AS full_name, ${dobCol} AS dob FROM ${personsTable} ` +
          `WHERE ${nameCol} = ? LIMIT 1`;
      const stmt = db.prepare(sql);
      const bound = dob ? stmt.bind(name, dob) : stmt.bind(name);
      const row = await bound.first<LocalPersonRow>();
      if (!row) return null;
      return { id: row.id, fullName: row.full_name, dob: row.dob ?? undefined };
    },

    async linkWarrantToPerson(warrantId, personId): Promise<void> {
      await db
        .prepare(
          'INSERT INTO warrant_person_links (warrant_id, person_id, linked_at) ' +
            'VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
        )
        .bind(warrantId, personId, new Date().toISOString())
        .run();
    },

    async recordAudit(result: PollResult): Promise<void> {
      await db
        .prepare(
          'INSERT INTO warrant_poll_audit ' +
            '(source, started_at, finished_at, ok, warrants_found, warrants_inserted, ' +
            ' warrants_updated, person_matches, error) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          result.source,
          result.startedAt,
          result.finishedAt,
          result.ok ? 1 : 0,
          result.warrantsFound,
          result.warrantsInserted,
          result.warrantsUpdated,
          result.personMatches,
          result.error ?? null,
        )
        .run();
    },
  };
}

function rowToWarrant(row: any): WarrantRecord {
  let charges: string[] = [];
  try { charges = JSON.parse(row.charges_json); } catch { /* tolerate corruption */ }
  return {
    source: row.source,
    sourceWarrantId: row.source_warrant_id,
    subjectName: row.subject_name,
    dob: row.dob ?? undefined,
    charges,
    bondAmount: row.bond_amount ?? undefined,
    issuedDate: row.issued_date ?? undefined,
    warrantType: row.warrant_type ?? undefined,
    fetchedAt: row.fetched_at,
  };
}
