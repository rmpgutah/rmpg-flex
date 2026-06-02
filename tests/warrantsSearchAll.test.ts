// ============================================================
// POST /api/warrants/search-all — scraped bucket smoke test.
// ============================================================
// Verifies the unified cross-source search now surfaces rows from
// the scraped_warrants table (multi-source orchestrator cache) in
// the `scraped` bucket, alongside `local` + `utah`, and that
// meta.sources advertises 'scraped'. Uses the hand-rolled D1 double
// (tests/helpers/fakeD1.ts) — same approach as tests/audit.test.ts:
// shape validation, not SQL correctness.
// ============================================================

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import warrants from '../src/routes/warrants';
import type { Env } from '../src/types';
import { makeFakeDb } from './helpers/fakeD1';

function buildApp(db: D1Database) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 1, username: 'tester', role: 'admin', full_name: 'Test User' } as any);
    await next();
  });
  app.route('/api/warrants', warrants);
  return (path: string, init?: RequestInit) => app.request(path, init, { DB: db });
}

function postJson(body: Record<string, unknown>): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

describe('POST /api/warrants/search-all', () => {
  it('populates the scraped bucket from scraped_warrants and lists it in meta.sources', async () => {
    const scrapedRow = {
      source_key: 'ada',
      first_name: 'JOHN',
      last_name: 'DOE',
      charge_description: 'DUI',
      court_name: 'Ada County District Court',
      case_number: 'CR-2026-1234',
      issue_date: '2026-01-15',
      bail_amount: 5000,
      offense_level: 'MISDEMEANOR',
      warrant_id: 'ada:abc123',
      city: 'Boise',
      state: 'ID',
    };
    const request = buildApp(
      makeFakeDb([
        { match: /FROM warrants/, rows: [] },
        { match: /FROM utah_warrants/, rows: [] },
        { match: /FROM scraped_warrants/, rows: [scrapedRow] },
      ]),
    );

    const res = await request('/api/warrants/search-all', postJson({ lastName: 'Doe' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      local: unknown[];
      utah: unknown[];
      scraped: Record<string, unknown>[];
      meta: { sources: string[]; totalHits: number };
    };

    expect(body.scraped).toHaveLength(1);
    expect(body.scraped[0].source_key).toBe('ada');
    expect(body.scraped[0].charge_description).toBe('DUI');
    expect(body.meta.sources).toContain('scraped');
    expect(body.meta.totalHits).toBe(1);
  });

  it('leaves the scraped bucket empty when no name/court/charge/number filter is supplied', async () => {
    const request = buildApp(
      makeFakeDb([
        { match: /FROM scraped_warrants/, rows: [{ source_key: 'ada', first_name: 'A', last_name: 'B' }] },
      ]),
    );
    // dob-only filter must NOT trigger the scraped (or utah) branch.
    const res = await request('/api/warrants/search-all', postJson({ dob: '1990-01-01' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { scraped: unknown[] };
    expect(body.scraped).toHaveLength(0);
  });
});
