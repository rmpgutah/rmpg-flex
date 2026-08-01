// GET /api/citations/calculate-fine
//
// Two drifts met here, and together they made the endpoint return a flat $100
// for almost every statute:
//
//   1. The handler SELECTed the statute's own offense_level and then never read
//      it — only the caller's query param fed the schedule. So passing
//      statute_id alone always fell through to the default, even though 911 of
//      4,315 live statutes carry a level.
//   2. The schedule's key vocabulary ('misdemeanor_b', 'felony') shares exactly
//      ONE key with the live data's vocabulary ('class_b_misdemeanor',
//      'third_degree_felony', 'infraction'). So 738 of those 911 levelled
//      statutes matched nothing.
//
// The alias map deliberately targets the EXISTING schedule buckets — no new
// dollar figures were introduced, because inventing citation amounts in a law
// enforcement system is not a refactor. `source` is asserted alongside every
// amount so an estimate can never be mistaken for a statutory authority.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import citations from '../src/routes/citations';

const app = new Hono<{
  Bindings: Record<string, unknown>;
  Variables: { user: { id: number; role: string; username: string }; userId: number };
}>();
app.use('*', async (c, next) => {
  c.set('user', { id: 1, role: 'admin', username: 'test-admin' });
  c.set('userId', 1);
  await next();
});
app.route('/api/citations', citations);

const db = () => (env as unknown as { DB: D1Database }).DB;

// Live utah_statutes vocabulary, with citation_fine NULL exactly as on live.
const STATUTES: Array<[number, string | null]> = [
  [901, 'class_b_misdemeanor'],
  [902, 'third_degree_felony'],
  [903, 'infraction'],
  [904, 'class_a_misdemeanor'],
  [905, 'class_c_misdemeanor'],
  [906, 'capital_felony'],
  [907, null],
];

beforeAll(async () => {
  await execute(db(), `CREATE TABLE IF NOT EXISTS utah_statutes (
    id INTEGER PRIMARY KEY, citation TEXT, title TEXT, description TEXT,
    offense_level TEXT, citation_fine REAL
  )`);
  for (const [id, level] of STATUTES) {
    await execute(db(),
      'INSERT OR REPLACE INTO utah_statutes (id, citation, offense_level, citation_fine) VALUES (?, ?, ?, NULL)',
      id, `76-0-${id}`, level);
  }
});

const fine = async (qs: string) => {
  const res = await app.request(`/api/citations/calculate-fine?${qs}`, {}, env as unknown as Record<string, unknown>);
  expect(res.status).toBe(200);
  return (await res.json() as { data: Record<string, unknown> }).data;
};

describe('calculate-fine — the statute\'s own offense_level is used', () => {
  it('resolves a class_b_misdemeanor statute to its bucket, not the flat default', async () => {
    const d = await fine('statute_id=901');
    expect(d.offense_level_used).toBe('class_b_misdemeanor');
    expect(d.base_fine).toBe(350);
    expect(d.source).toBe('offense_level');
  });

  it('maps every live Utah level onto an existing schedule bucket', async () => {
    const expected: Record<number, [string, number]> = {
      901: ['class_b_misdemeanor', 350],
      902: ['third_degree_felony', 1000],
      903: ['infraction', 150],
      904: ['class_a_misdemeanor', 500],
      905: ['class_c_misdemeanor', 250],
      906: ['capital_felony', 1000],
    };
    for (const [id, [level, amount]] of Object.entries(expected)) {
      const d = await fine(`statute_id=${id}`);
      expect(d.offense_level_used, `statute ${id}`).toBe(level);
      expect(d.base_fine, `statute ${id} (${level})`).toBe(amount);
      expect(d.source, `statute ${id}`).toBe('offense_level');
    }
  });

  it('falls back to the flat default only when there is genuinely no level', async () => {
    const d = await fine('statute_id=907');
    expect(d.offense_level_used).toBeNull();
    expect(d.base_fine).toBe(100);
    expect(d.source).toBe('default');
  });

  it('lets an explicit caller-supplied level win over the statute row', async () => {
    const d = await fine('statute_id=902&offense_level=infraction');
    expect(d.offense_level_used).toBe('infraction');
    expect(d.base_fine).toBe(150);
  });
});

describe('calculate-fine — source is never overstated', () => {
  it('reports `default`, not `statute_fine`, while citation_fine is unpopulated', async () => {
    // citation_fine is NULL on all 4,315 live rows, so this branch must never
    // claim a statutory amount it does not have.
    const d = await fine('statute_id=903');
    expect(d.source).not.toBe('statute_fine');
  });

  it('uses citation_fine and says so when the data actually exists', async () => {
    await execute(db(), 'UPDATE utah_statutes SET citation_fine = 425 WHERE id = 903');
    const d = await fine('statute_id=903');
    expect(d.base_fine).toBe(425);
    expect(d.source).toBe('statute_fine');
    await execute(db(), 'UPDATE utah_statutes SET citation_fine = NULL WHERE id = 903');
  });

  it('still applies the type multiplier on top of the resolved base', async () => {
    const d = await fine('statute_id=901&type=criminal');
    expect(d.base_fine).toBe(350);
    expect(d.multiplier).toBe(1.5);
    expect(d.calculated_fine).toBe(525);
  });

  it('a warning citation resolves to zero regardless of level', async () => {
    const d = await fine('statute_id=902&type=warning');
    expect(d.calculated_fine).toBe(0);
  });
});
