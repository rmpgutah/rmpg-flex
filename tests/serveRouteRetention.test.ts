import { describe, it, expect } from 'vitest';
import { sweepServeRouteRevisions, REVISION_RETENTION_DAYS } from '../src/utils/serveRouteRetention';

/** Minimal D1 stub that records the SQL + bindings and reports a change count. */
function stubDb(changes = 0) {
  const calls: { sql: string; bindings: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      const entry = { sql, bindings: [] as unknown[] };
      calls.push(entry);
      return {
        bind(...bindings: unknown[]) {
          entry.bindings = bindings;
          return { run: async () => ({ meta: { changes } }) };
        },
      };
    },
  } as unknown as D1Database;
  return { db, calls };
}

const NOW = Date.parse('2026-08-01T12:00:00Z');

describe('sweepServeRouteRevisions', () => {
  it('computes the cutoff from the retention window, not the current date', () => {
    // 2026-08-01 minus 90 days = 2026-05-03.
    const { db } = stubDb();
    return sweepServeRouteRevisions(db, NOW).then((r) => {
      expect(r.cutoff).toBe('2026-05-03');
    });
  });

  it('honours an explicit retention window', async () => {
    const { db } = stubDb();
    const r = await sweepServeRouteRevisions(db, NOW, 1);
    expect(r.cutoff).toBe('2026-07-31');
  });

  it('never deletes the newest row per (officer, date) — the plan of record', async () => {
    const { db, calls } = stubDb();
    await sweepServeRouteRevisions(db, NOW);
    const sql = calls[0].sql.replace(/\s+/g, ' ');
    // The MAX(id) per officer+date partition is explicitly excluded.
    expect(sql).toMatch(/id NOT IN \( SELECT MAX\(id\) FROM serve_routes/);
    expect(sql).toMatch(/GROUP BY officer_id, route_date/);
  });

  it('scopes the delete to dates strictly older than the cutoff', async () => {
    const { db, calls } = stubDb();
    await sweepServeRouteRevisions(db, NOW);
    const sql = calls[0].sql.replace(/\s+/g, ' ');
    expect(sql).toMatch(/route_date < \?/);
    // Both the outer filter and the MAX(id) subquery must use the SAME cutoff,
    // or the subquery would compute the plan of record over a different
    // partition than the one being deleted from.
    expect(calls[0].bindings).toEqual(['2026-05-03', '2026-05-03']);
  });

  it('excludes NULL route_date rows rather than letting them compare as less-than', async () => {
    const { db, calls } = stubDb();
    await sweepServeRouteRevisions(db, NOW);
    expect(calls[0].sql).toMatch(/route_date IS NOT NULL/);
  });

  it('reports the deleted count from D1 meta.changes', async () => {
    const { db } = stubDb(7);
    expect((await sweepServeRouteRevisions(db, NOW)).deleted).toBe(7);
  });

  it('reports 0 rather than NaN when D1 omits meta.changes', async () => {
    const db = {
      prepare: () => ({ bind: () => ({ run: async () => ({ meta: {} }) }) }),
    } as unknown as D1Database;
    expect((await sweepServeRouteRevisions(db, NOW)).deleted).toBe(0);
  });

  it('defaults to a 90-day revision window', () => {
    expect(REVISION_RETENTION_DAYS).toBe(90);
  });
});
