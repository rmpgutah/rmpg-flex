// ============================================================
// D1 100-bound-parameter cap
// ============================================================
// D1 rejects any query carrying more than 100 bound parameters, AT BIND TIME
// -- before the query runs. That makes an IN-list built from a caller- or
// data-supplied array a landmine whose SHAPE grows with the data: it passes
// every test and every dev run, then fails the first time real data crosses
// 100 rows.
//
// Four sites were live:
//
//   serveStaleAutoCloseSweep  SELECT ... LIMIT 500, then IN(500)  -- a cron
//                             sweep, so the throw was invisible
//   radioSettings purge       batch defaults to 500, then IN(500). Worse than
//                             a no-op: the R2 audio was deleted FIRST, so the
//                             blobs went and the rows stayed, leaving records
//                             pointing at objects that no longer exist
//   serveBillingEnhanced      unbounded select + a bare catch, so invoices
//                             silently never got marked overdue
//   serveRouteOptimizer       caller-supplied route plan
//
// The fix is always the same: route through chunkBindings / queryInChunks /
// executeInChunks in utils/db.ts, which own the cap. This test pins that, and
// pins the arithmetic so the cap itself cannot be quietly raised.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chunkBindings } from '../src/utils/db';

const SRC = join(__dirname, '..', 'src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

describe('chunkBindings', () => {
  it('never emits a chunk that would exceed the cap', () => {
    for (const n of [1, 99, 100, 101, 500, 1000]) {
      const items = Array.from({ length: n }, (_, i) => i);
      for (const chunk of chunkBindings(items)) {
        expect(chunk.length, `${n} items`).toBeLessThanOrEqual(100);
      }
    }
  });

  it('accounts for parameters bound OUTSIDE the IN-list', () => {
    // leadingBindings squeeze the budget: 3 leading + chunk must still be
    // <= 100, or the query fails on the very rows the chunking was meant to
    // protect.
    const items = Array.from({ length: 500 }, (_, i) => i);
    for (const chunk of chunkBindings(items, 3)) {
      expect(chunk.length + 3).toBeLessThanOrEqual(100);
    }
  });

  it('loses nothing', () => {
    const items = Array.from({ length: 457 }, (_, i) => i);
    expect(chunkBindings(items).flat()).toEqual(items);
  });
});

describe('no unbounded IN-list survives', () => {
  const SITES: Array<[string, string]> = [
    ['utils/serveStaleAutoCloseSweep.ts', 'executeInChunks'],
    ['utils/radioSettings.ts', 'executeInChunks'],
    ['utils/serveBillingEnhanced.ts', 'executeInChunks'],
    ['utils/serveRouteOptimizer.ts', 'queryInChunks'],
  ];

  for (const [file, helper] of SITES) {
    it(`${file} chunks through ${helper}`, () => {
      const src = read(file);
      expect(src).toContain(helper);
      // The hand-rolled placeholder builder is what the helpers replace.
      expect(src).not.toContain("map(() => '?')");
    });
  }
});

// Second wave (2026-07-31). These files legitimately KEEP other
// `map(() => '?')` builders -- for schema column arrays and fixed status
// constants, whose length is set by the code, not by the data -- so the
// blanket "not.toContain" assertion above cannot be reused. Each site is
// pinned by the specific hand-rolled builder that was removed.
describe('no unbounded IN-list survives (wave 2)', () => {
  const SITES: Array<{ file: string; helper: string; removed: string; why: string }> = [
    {
      file: 'routes/records.ts',
      helper: 'executeInChunks',
      removed: "const ps = ids.map(() => '?')",
      why: 'retention sweep SELECTs LIMIT 500 then bound all of them -- 5x the cap',
    },
    {
      file: 'routes/shiftPlans.ts',
      helper: 'executeInChunks',
      removed: "body.plan_ids.map(() => '?')",
      why: 'bulk-activate binds a caller-supplied plan_ids array',
    },
    {
      file: 'routes/hr.ts',
      helper: 'executeInChunks',
      removed: "const placeholders = ids.map(() => '?')",
      why: 'disciplinary + grievance bulk-status bind body.ids, with leading bindings',
    },
    {
      file: 'routes/crm.ts',
      helper: 'executeInChunks',
      removed: "const ph = ids.map(() => '?')",
      why: 'lead bulk-action binds caller-supplied lead_ids across four branches',
    },
    {
      file: 'routes/personnel.ts',
      helper: 'queryInChunks',
      removed: "const placeholders = ids.map(() => '?')",
      why: 'time-entry edit lookup had no LIMIT on the entries query',
    },
  ];

  for (const { file, helper, removed, why } of SITES) {
    it(`${file} chunks through ${helper} (${why})`, () => {
      const src = read(file);
      expect(src, `${file} should import/use ${helper}`).toContain(helper);
      expect(src, `${file} still hand-rolls: ${removed}`).not.toContain(removed);
    });
  }

  it('leading bindings are declared where the write binds more than the IN-list', () => {
    // hr.ts binds status/updated_at (2) and status/resolved_at/updated_at (3)
    // BEFORE the IN-list. Omitting them from executeInChunks would size chunks
    // at the full 100 and blow the cap by exactly the leading count -- the
    // subtlest way to "fix" this bug and still ship it broken.
    const hr = read('routes/hr.ts');
    expect(hr).toContain('[status, nowIso()]');
    expect(hr).toContain('[status, resolvedAt, now]');
    // crm.ts's assign branch binds assigned_to ahead of the IN-list.
    expect(read('routes/crm.ts')).toContain('[b.value ?? null]');
  });
});

describe('route optimizer schema', () => {
  // Five column references in the stop fetch did not exist on live D1, so the
  // optimizer threw on every call and never produced a route. Verified via
  // pragma_table_info when the fix landed.
  // Strip comments before asserting. The negative assertions below name the
  // very column references the fix removed, and those names also appear in
  // the explanatory comment ABOVE the query -- so a naive whole-file match
  // fails on the documentation of the fix. check-new-date.js and the
  // timestamp-slice ratchet both have this same trap.
  const src = read('utils/serveRouteOptimizer.ts')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');

  it('the stop fetch joins on serve_attempts.serve_queue_id', () => {
    expect(src).toContain('a.serve_queue_id AS queueId');
    expect(src).toContain('JOIN serve_queue q ON q.id = a.serve_queue_id');
  });

  it('no query in this module references a serve_attempts column that never shipped', () => {
    // The three remaining queries used serve_attempts.server_id / .queue_id /
    // .scheduled_date / .status; pragma_table_info confirms ZERO of those four
    // exist on live D1. The first three had exact live equivalents
    // (officer_id / serve_queue_id / attempt_at) and were renamed.
    for (const dead of ['a.queue_id', 'a.server_id', 'a.scheduled_date', 'a.status']) {
      expect(src, `${dead} does not exist on live serve_attempts`).not.toContain(dead);
    }
  });

  it('treats an unresolved attempt as one with no recorded result', () => {
    // `.status IN ('scheduled','pending')` had no live equivalent: serve_attempts
    // records attempts that HAPPENED (attempt_at, result), so there is no
    // pending-attempt state column. Standing in `result IS NULL OR result =
    // 'pending'` keeps the three queries executable instead of throwing "no
    // such column" on every call, but whether a route stop should instead be
    // driven off pending serve_queue rows is still a PRODUCT decision — see
    // the module header. Pinned so that choice can't drift unnoticed.
    const guards = (src.match(/a\.result IS NULL OR a\.result = 'pending'/g) || []).length;
    expect(guards, "unresolved-attempt stand-in for the absent status column").toBe(3);
  });

  it('reads the geocoded and address columns serve_queue actually has', () => {
    expect(src).toContain('q.recipient_lat AS lat');
    expect(src).toContain('q.recipient_lng AS lng');
    expect(src).toContain('q.recipient_address AS address');
  });

  it('derives isBusiness rather than selecting a column that does not exist', () => {
    expect(src).toContain('(q.business_id IS NOT NULL) AS isBusiness');
    expect(src).not.toContain('q.is_business');
  });
});
