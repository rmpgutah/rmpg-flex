import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  applyPending,
  classifyPendingFile,
  isIgnorableD1Error,
  isLocalOnlyMigration,
  isUnsafeRemoteRebuild,
  MIGRATIONS_DIR,
  splitSqlStatements,
} from '../scripts/d1PendingMigrations';

describe('isIgnorableD1Error', () => {
  it('treats duplicate column as ignorable so the rest of the batch can run', () => {
    expect(isIgnorableD1Error('duplicate column name: starting_mileage: SQLITE_ERROR [code: 7500]')).toBe(true);
  });

  it('does not swallow a missing table', () => {
    expect(isIgnorableD1Error('no such table: person_intel_cross_refs')).toBe(false);
  });
});

describe('classifyPendingFile', () => {
  it('marks FZ-55 local-only files as track-only', () => {
    const sql = '-- Local-only: run on FZ-55 via migrate:local. Do NOT apply to live D1.\nCREATE TABLE IF NOT EXISTS sync_queue (id INTEGER);';
    expect(isLocalOnlyMigration(sql, '0249_sync_queue.sql')).toBe(true);
    expect(classifyPendingFile('0249_sync_queue.sql', sql).action).toBe('track-only');
  });

  it('refuses to DROP live calls_for_service (0262 would wipe 100-col CAD rows)', () => {
    const sql = 'DROP TABLE calls_for_service;\nALTER TABLE calls_for_service_new RENAME TO calls_for_service;';
    expect(isUnsafeRemoteRebuild(sql)).toBe(true);
    expect(classifyPendingFile('0262_calls_status_merged_split.sql', sql).action).toBe('track-only');
  });

  it('applies additive CREATE/ALTER files', () => {
    const sql = 'CREATE TABLE IF NOT EXISTS person_intel_cross_refs (id INTEGER);\nALTER TABLE person_intelligence ADD COLUMN cross_refs_found INTEGER;';
    expect(classifyPendingFile('0265_person_intel_crossref_verification.sql', sql).action).toBe('apply');
  });
});

describe('splitSqlStatements', () => {
  it('splits ALTERs so a duplicate first column does not skip the rest', () => {
    const stmts = splitSqlStatements(`
      -- comment
      ALTER TABLE time_entries ADD COLUMN starting_mileage REAL;
      ALTER TABLE time_entries ADD COLUMN ending_mileage REAL;
    `);
    expect(stmts).toEqual([
      'ALTER TABLE time_entries ADD COLUMN starting_mileage REAL',
      'ALTER TABLE time_entries ADD COLUMN ending_mileage REAL',
    ]);
  });
});

describe('applyPending', () => {
  it('keeps applying later files after an ignorable duplicate-column error', async () => {
    const executed: string[] = [];
    const already = fs.readdirSync(MIGRATIONS_DIR).filter((f) =>
      f.endsWith('.sql')
      && f !== '0227_time_entries_mileage_reason_repair.sql'
      && f !== '0265_person_intel_crossref_verification.sql',
    );
    const summary = await applyPending({
      listAppliedNames: async () => already,
      executeSql: async (sql: string) => {
        executed.push(sql);
        if (/starting_mileage/.test(sql)) {
          return { ok: false, message: 'duplicate column name: starting_mileage' };
        }
        return { ok: true };
      },
      log: { info() {}, error() {} },
    });
    expect(summary.failed).toEqual([]);
    expect(summary.applied).toEqual(expect.arrayContaining([
      '0227_time_entries_mileage_reason_repair.sql',
      '0265_person_intel_crossref_verification.sql',
    ]));
    expect(executed.some((s) => /ending_mileage/.test(s))).toBe(true);
    expect(executed.some((s) => /person_intel_cross_refs/.test(s))).toBe(true);
  });
});
