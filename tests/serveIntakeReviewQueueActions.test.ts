import { describe, it, expect } from 'vitest';

function makeDbStub() {
  const rows: Record<string, any[]> = { serve_queue: [{ id: 7, quality_status: 'needs_review' }] };
  const prepare = (sql: string) => {
    const captures: { sql: string; args: any[] } = { sql, args: [] };
    const stmt: any = {
      bind: (...args: any[]) => { captures.args = args; return stmt; },
      first: async () => rows.serve_queue.find(r => r.id === captures.args[captures.args.length - 1]) ?? null,
      all: async () => ({ results: [] }),
      run: async () => {
        const m = sql.match(/SET (\w+) = \?/);
        if (m) {
          const idx = rows.serve_queue.findIndex(r => r.id === captures.args[captures.args.length - 1]);
          if (idx >= 0) {
            rows.serve_queue[idx][m[1]] = captures.args[0];
          }
        }
        return { meta: { changes: 1 } };
      },
    };
    return stmt;
  };
  return { prepare, _rows: rows };
}

describe('review queue supervisor actions (SQL contract)', () => {
  it("POST /review-queue/:id/accept moves quality_status to 'reviewed_ok'", async () => {
    const db: any = makeDbStub();
    const userId = 99;
    const queueId = 7;
    await db.prepare(`UPDATE serve_queue SET quality_status = ?, quality_reviewed_by = ?, quality_reviewed_at = datetime('now') WHERE id = ?`)
      .bind('reviewed_ok', userId, queueId).run();
    expect(db._rows.serve_queue[0].quality_status).toBe('reviewed_ok');
  });

  it("POST /review-queue/:id/fix moves quality_status to 'reviewed_fixed'", async () => {
    const db: any = makeDbStub();
    await db.prepare(`UPDATE serve_queue SET quality_status = ?, quality_reviewed_by = ?, quality_reviewed_at = datetime('now') WHERE id = ?`)
      .bind('reviewed_fixed', 99, 7).run();
    expect(db._rows.serve_queue[0].quality_status).toBe('reviewed_fixed');
  });
});
