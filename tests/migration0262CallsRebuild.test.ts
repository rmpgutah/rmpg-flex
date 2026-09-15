// ============================================================
// Guard: migrations/0262_calls_status_merged_split.sql must rebuild
// calls_for_service with EXACTLY the live column set.
// ============================================================
// The original 0262 declared a 38-column `calls_for_service_new` with the
// wrong names (call_type / location / assigned_unit …) and then
// DROP TABLE'd the real 100-column table. Inside wrangler's per-file
// transaction the copy failed on `no such column: call_type` and the whole
// file rolled back — but applied statement-by-statement (the local baseline
// flow, or a manual `d1 execute`) it silently replaced the CFS table with an
// empty shell and every dispatch read 500'd with `no such column:
// c.incident_type`.
//
// This test parses the migration and asserts its column list is exactly the
// baseline snapshot's list (live sits at D1's 100-column hard cap, so no later
// ADD COLUMN can have landed), in order, and that the copy is an
// explicit-column INSERT naming the same set behind a precondition guard.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIG_DIR = join(__dirname, '..', 'migrations');

function extractCreateColumns(sql: string, tableName: string): string[] {
  const re = new RegExp(`CREATE TABLE(?: IF NOT EXISTS)? ${tableName} \\(([\\s\\S]*?)\\n\\);`, 'm');
  const m = sql.match(re);
  if (!m) throw new Error(`no CREATE TABLE ${tableName} found`);
  return m[1]
    .split('\n')
    .flatMap((line) => line.split(/,(?![^()]*\))/)) // split trailing one-line column runs
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('--') && !/^(FOREIGN KEY|CHECK|UNIQUE|PRIMARY KEY)\b/.test(s))
    .map((s) => s.split(/\s+/)[0]);
}

// D1's SQLite is compiled with SQLITE_MAX_COLUMN = 100 (verified 2026-09-05:
// a 101-column calls_for_service made workerd report "malformed database
// schema … too many columns" and the whole table went SQLITE_CORRUPT). The
// live table sits at exactly 100, so the rebuild must copy exactly the
// baseline snapshot's columns — no post-baseline ADD COLUMN can have landed
// on live without destroying the table.
const D1_MAX_COLUMNS = 100;

describe('0262_calls_status_merged_split rebuild', () => {
  const text = readFileSync(join(MIG_DIR, '0262_calls_status_merged_split.sql'), 'utf8');
  const baselineText = readFileSync(join(MIG_DIR, 'baseline', 'schema.sql'), 'utf8');
  const expected = extractCreateColumns(baselineText, 'calls_for_service');
  const actual = extractCreateColumns(text, 'calls_for_service_new');

  it('baseline snapshot is at the D1 column cap (sanity for the assertions below)', () => {
    expect(expected).toHaveLength(D1_MAX_COLUMNS);
    // Every ALTER ... ADD COLUMN on this table after the baseline snapshot
    // (migrations >= 0072) would push live past the cap — none may exist
    // except ones already known not to have landed.
    const post = readdirSync(MIG_DIR).filter((f) => /^\d{4}_.*\.sql$/.test(f) && f >= '0072').sort();
    const offenders: string[] = [];
    for (const f of post) {
      for (const m of readFileSync(join(MIG_DIR, f), 'utf8').matchAll(/ALTER TABLE calls_for_service ADD COLUMN (\w+)/g)) offenders.push(`${f}:${m[1]}`);
    }
    // 0128 predates the cap discovery; it cannot have applied on live (the
    // table would be unreadable). Anything new here is a regression.
    expect(offenders).toEqual(['0128_reanalysis_columns.sql:analytics_replayed_at']);
  });

  it('recreates every live column, in baseline order, and nothing else', () => {
    expect(actual).toEqual(expected);
    expect(actual.length).toBeLessThanOrEqual(D1_MAX_COLUMNS);
    expect(actual).toContain('incident_type');
    expect(actual).toContain('location_address');
    expect(actual).toContain('assigned_unit_ids');
    expect(actual).toContain('pso_attempt_number');
    expect(actual).not.toContain('call_type');
  });

  it('widens the status CHECK to include on_hold, merged and split', () => {
    const check = text.match(/status TEXT NOT NULL DEFAULT 'pending'\s+CHECK\(status IN \(([^)]*)\)\)/);
    expect(check, 'status CHECK present').toBeTruthy();
    const values = check![1].split(',').map((v) => v.trim().replace(/'/g, ''));
    for (const v of ['pending', 'dispatched', 'enroute', 'onscene', 'cleared', 'closed', 'cancelled', 'archived', 'on_hold', 'merged', 'split']) {
      expect(values).toContain(v);
    }
  });

  it('copies with an explicit column list that matches the new table (never SELECT * or a partial list)', () => {
    const m = text.match(/INSERT INTO calls_for_service_new \(([\s\S]*?)\)\s*SELECT\s+([\s\S]*?)\s+FROM calls_for_service;/);
    expect(m, 'explicit INSERT ... SELECT present').toBeTruthy();
    const target = m![1].split(',').map((s) => s.trim()).filter(Boolean);
    const source = m![2].split(',').map((s) => s.trim()).filter(Boolean);
    expect(target).toEqual(actual);
    expect(source).toEqual(actual);
  });

  it('swaps the table only after the copy and recreates the CFS indexes', () => {
    const copy = text.indexOf('INSERT INTO calls_for_service_new');
    const drop = text.indexOf('DROP TABLE calls_for_service;');
    const rename = text.indexOf('ALTER TABLE calls_for_service_new RENAME TO calls_for_service;');
    expect(copy).toBeGreaterThan(-1);
    expect(drop).toBeGreaterThan(copy);
    expect(rename).toBeGreaterThan(drop);
    for (const idx of ['idx_cfs_status', 'idx_cfs_priority', 'idx_cfs_zone', 'idx_cfs_beat', 'idx_cfs_case', 'idx_cfs_client', 'idx_calls_lat_lng_created']) {
      expect(text).toContain(idx);
    }
  });

  it('aborts unless the live table has exactly the expected column count (precondition guard)', () => {
    const guard = text.indexOf("WHEN (SELECT COUNT(*) FROM pragma_table_info('calls_for_service')) <> 100");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(text.indexOf('CREATE TABLE calls_for_service_new'));
    // Side-effect-free abort: a conditional integer overflow, not a scratch table.
    expect(text).toMatch(/THEN abs\(-9223372036854775808\)/);
    expect(text).not.toMatch(/_cfs_rebuild_guard/);
  });
});
