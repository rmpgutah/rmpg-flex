// Route-level test for GET /api/citations/statutes/lookup — the statute
// autocomplete.
//
// The search term is built straight from the `q` query parameter, and D1 caps
// a LIKE pattern at 50 BYTES (verified against local D1 here: a 50-byte
// pattern succeeds, 52 throws `D1_ERROR: LIKE or GLOB pattern too complex`).
// The route's only length guard was `q.length < 2` — a minimum, no maximum —
// so any search longer than 48 bytes threw.
//
// ⚠️ That failure was SILENT to the officer. The handler's catch logs and
// returns `{ data: [] }`, so a long statute search produced an empty
// autocomplete indistinguishable from "no such statute" rather than an error.
// The tests below therefore assert on the ROWS, never just on res.status.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import citations from '../src/routes/citations';

const db = () => (env as unknown as { DB: D1Database }).DB;

function app() {
  const a = new Hono<{ Bindings: Record<string, unknown> }>();
  a.route('/api/citations', citations);
  return a;
}

async function lookup(q: string, extra = '') {
  const res = await app().request(
    `/api/citations/statutes/lookup?q=${encodeURIComponent(q)}${extra}`,
    {},
    env as unknown as Record<string, unknown>,
  );
  return { status: res.status, json: (await res.json()) as { data: Array<Record<string, unknown>> } };
}

// 61 characters / 61 bytes — comfortably past the 48-byte needle budget, and a
// plausible thing to type into a statute search.
const LONG_DESCRIPTION =
  'Operating a motor vehicle while the registration is suspended or revoked';

describe('GET /api/citations/statutes/lookup — LIKE pattern byte cap', () => {
  beforeAll(async () => {
    await execute(db(), `CREATE TABLE IF NOT EXISTS utah_statutes (
      id INTEGER PRIMARY KEY, citation TEXT, title TEXT, offense_level TEXT,
      citation_fine REAL, description TEXT)`);
    await execute(db(), `DELETE FROM utah_statutes WHERE id IN (9101, 9102)`);
    await execute(
      db(),
      `INSERT INTO utah_statutes (id, citation, title, offense_level, citation_fine, description)
       VALUES (9101, '41-1a-1303', 'Registration suspended', 'infraction', 120.0, ?),
              (9102, '41-6a-1716', 'Café résumé naïve façade — a very long accented description indeed', 'infraction', 90.0, 'short')`,
      LONG_DESCRIPTION,
    );
  });

  it('finds a statute by a short search term', async () => {
    const { status, json } = await lookup('41-1a');
    expect(status).toBe(200);
    expect(json.data.some((r) => r.citation_code === '41-1a-1303')).toBe(true);
  });

  // The regression. Before the fix this threw inside query(), the catch
  // swallowed it, and the officer saw an empty autocomplete.
  it('still finds a statute when the search term exceeds the byte cap', async () => {
    expect(new TextEncoder().encode(LONG_DESCRIPTION).length).toBeGreaterThan(48);
    const { status, json } = await lookup(LONG_DESCRIPTION);
    expect(status).toBe(200);
    expect(json.data.length).toBeGreaterThan(0);
    expect(json.data.some((r) => r.citation_code === '41-1a-1303')).toBe(true);
  });

  // A non-ASCII term is the case a character-based `.slice(0, 48)` would still
  // have got wrong: 48 accented characters is up to 96 bytes.
  it('does not throw on a long non-ASCII search term', async () => {
    const accented = 'Café résumé naïve façade — a very long accented description indeed';
    expect(new TextEncoder().encode(accented).length).toBeGreaterThan(50);
    const { status, json } = await lookup(accented);
    expect(status).toBe(200);
    expect(json.data.some((r) => r.citation_code === '41-6a-1716')).toBe(true);
  });

  it('survives an absurdly long search term', async () => {
    const { status, json } = await lookup('A'.repeat(5000));
    expect(status).toBe(200);
    // No match expected — the point is that it answers rather than throwing.
    expect(Array.isArray(json.data)).toBe(true);
  });

  it('keeps honouring the two-character minimum', async () => {
    expect((await lookup('4')).json.data).toEqual([]);
  });

  it('still applies the offense_level filter alongside a long term', async () => {
    const { json } = await lookup(LONG_DESCRIPTION, '&offense_level=felony');
    expect(json.data).toEqual([]);
    const { json: matching } = await lookup(LONG_DESCRIPTION, '&offense_level=infraction');
    expect(matching.data.some((r) => r.citation_code === '41-1a-1303')).toBe(true);
  });
});
