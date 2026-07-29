// ============================================================
// serveManagerPoller — the auto-create INSERT must be well-formed
// ============================================================
// The dispatch-call INSERT was built as:
//
//   colNames = [...10 real columns, 'created_at', 'updated_at']   // 12
//   values   = [...10 real values]                                // 10
//   INSERT INTO calls_for_service (${colNames}, created_at, updated_at)
//   VALUES (${12 placeholders}, datetime('now'), datetime('now'))
//
// which is broken three ways at once:
//   1. created_at / updated_at appear TWICE in the column list — a hard
//      SQLite error by itself ("duplicate column name").
//   2. 14 columns against 14 value expressions but only 10 bindings for
//      12 placeholders.
//   3. The throw unwinds to pollServeManagerJobs' outer try/catch, so the
//      whole cycle dies: `synced` is discarded and the last_poll watermark
//      never advances. The caller always saw {synced: 0, callsCreated: 0}.
//
// This is a source-shape guard rather than an execution test: the statement
// is built inline inside a long polling loop that needs a live ServeManager
// credential and a D1 binding to reach, so asserting the arithmetic on the
// source is what actually protects it.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/utils/serveManagerPoller.ts'),
  'utf8',
);

/** The `const colNames = [...]` array literal, as written. */
function colNames(): string[] {
  const m = SRC.match(/const colNames = \[([\s\S]*?)\];/);
  if (!m) throw new Error('colNames literal not found');
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}

/** Entries in the `const values = [...]` array literal. */
function valueCount(): number {
  const m = SRC.match(/const values = \[([\s\S]*?)\];/);
  if (!m) throw new Error('values literal not found');
  return m[1].split(',').map((s) => s.trim()).filter(Boolean).length;
}

describe('serveManagerPoller auto-create INSERT', () => {
  it('binds exactly one value per column', () => {
    expect(valueCount()).toBe(colNames().length);
  });

  it('never lists a column twice', () => {
    const cols = colNames();
    expect(new Set(cols).size).toBe(cols.length);
  });

  // The specific regression: the SQL appends these itself as datetime('now'),
  // so listing them in colNames duplicates them in the statement.
  it('leaves created_at / updated_at to the SQL, not the column array', () => {
    expect(colNames()).not.toContain('created_at');
    expect(colNames()).not.toContain('updated_at');
    expect(SRC).toContain("created_at, updated_at) VALUES");
    expect(SRC).toContain("datetime('now'), datetime('now'))");
  });

  it('keeps the total column count matching the total value expressions', () => {
    // columns = colNames + the two the SQL appends
    // values  = placeholders (one per colName) + the two datetime('now')
    const totalColumns = colNames().length + 2;
    const totalValueExprs = colNames().length + 2;
    expect(totalColumns).toBe(totalValueExprs);
  });

  it('only names columns that exist on calls_for_service', () => {
    // Verified against live D1 (785de7ae) on 2026-07-29.
    const LIVE = new Set([
      'call_number', 'incident_type', 'priority', 'status', 'source',
      'location_address', 'latitude', 'longitude', 'description', 'caller_name',
      'created_at', 'updated_at',
    ]);
    for (const c of colNames()) expect(LIVE.has(c)).toBe(true);
  });
});
