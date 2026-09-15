import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  promptPreview,
  emptyUsageStats,
  logAiActivity,
  __resetAiActivityTablesForTest,
} from '../src/utils/aiActivity';

/** Minimal D1 stub: records every prepare()/bind()/run() it sees. */
function stubDb(opts: { failOn?: RegExp } = {}) {
  const calls: Array<{ sql: string; bindings: unknown[] }> = [];
  const db: any = {
    calls,
    prepare(sql: string) {
      const rec = { sql, bindings: [] as unknown[] };
      const stmt = {
        bind(...b: unknown[]) { rec.bindings = b; return stmt; },
        async run() {
          calls.push(rec);
          if (opts.failOn?.test(sql)) throw new Error('D1 exploded');
          return { success: true, meta: {} };
        },
        async all() { calls.push(rec); return { results: [] }; },
        async first() { calls.push(rec); return null; },
      };
      return stmt;
    },
  };
  return db;
}

describe('promptPreview', () => {
  it('collapses whitespace so a preview stays one line in the panel', () => {
    expect(promptPreview('a\n\n  b\tc')).toBe('a b c');
  });

  it('truncates long prompts with an ellipsis', () => {
    const out = promptPreview('x'.repeat(500));
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith('…')).toBe(true);
  });

  it('handles nullish input without throwing', () => {
    expect(promptPreview(undefined)).toBe('');
    expect(promptPreview(null)).toBe('');
  });
});

describe('emptyUsageStats', () => {
  it('returns the zeroed shape the admin panel expects', () => {
    expect(emptyUsageStats()).toEqual({
      requestsToday: 0, requestsThisWeek: 0, requestsThisMonth: 0,
      avgResponseMs: 0, cacheHitRate: 0, totalRequests: 0,
    });
  });
});

describe('logAiActivity', () => {
  beforeEach(() => __resetAiActivityTablesForTest());

  it('writes one row with the supplied fields', async () => {
    const db = stubDb();
    await logAiActivity(db, {
      taskType: 'narrative', provider: 'groq', model: 'm',
      latencyMs: 120, status: 'success', prompt: 'hello there', userId: 7,
    });
    const insert = db.calls.find((c: any) => /INSERT INTO ai_activity_log/i.test(c.sql));
    expect(insert).toBeDefined();
    expect(insert.bindings).toEqual(['narrative', 'groq', 'm', 120, 'success', 'hello there', null, 7]);
  });

  it('truncates the prompt preview before it reaches the row', async () => {
    const db = stubDb();
    await logAiActivity(db, { taskType: 't', prompt: 'y'.repeat(999) });
    const insert = db.calls.find((c: any) => /INSERT INTO ai_activity_log/i.test(c.sql));
    expect(String(insert.bindings[5]).length).toBeLessThanOrEqual(200);
  });

  it('NEVER throws when the write fails — a logging failure must not fail the AI request', async () => {
    const db = stubDb({ failOn: /INSERT INTO ai_activity_log/i });
    await expect(logAiActivity(db, { taskType: 't' })).resolves.toBeUndefined();
  });

  it('never throws when the table does not exist at all', async () => {
    const db = stubDb({ failOn: /ai_activity_log/i });
    await expect(logAiActivity(db, { taskType: 't' })).resolves.toBeUndefined();
  });

  it('reconciles the table once per isolate, not on every call', async () => {
    const db = stubDb();
    await logAiActivity(db, { taskType: 'a' });
    await logAiActivity(db, { taskType: 'b' });
    const creates = db.calls.filter((c: any) => /CREATE TABLE IF NOT EXISTS ai_activity_log/i.test(c.sql));
    expect(creates).toHaveLength(1);
  });

  it('defaults an omitted provider/status rather than binding undefined', async () => {
    const db = stubDb();
    await logAiActivity(db, { taskType: 't' });
    const insert = db.calls.find((c: any) => /INSERT INTO ai_activity_log/i.test(c.sql));
    expect(insert.bindings[1]).toBe('workers-ai');
    expect(insert.bindings[4]).toBe('success');
    expect(insert.bindings.every((b: unknown) => b !== undefined)).toBe(true);
  });

  it('records an error message when the status is error', async () => {
    const db = stubDb();
    await logAiActivity(db, { taskType: 't', status: 'error', error: 'boom' });
    const insert = db.calls.find((c: any) => /INSERT INTO ai_activity_log/i.test(c.sql));
    expect(insert.bindings[4]).toBe('error');
    expect(insert.bindings[6]).toBe('boom');
  });
});
