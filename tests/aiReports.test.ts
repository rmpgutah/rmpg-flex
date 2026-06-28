// ============================================================
// AI reports — /api/radio/ai/* route tests
// ============================================================
// Mounts the radio route against a hand-rolled D1 double + a fake Workers AI
// binding (same approach as tests/audit.test.ts). Verifies the data-gathering
// + response shape; the LLM is stubbed (we're not testing the model).
// ============================================================

import { describe, it, expect } from 'vitest';
import radio from '../src/routes/radio';

type Row = Record<string, unknown>;
function fakeDb(canned: { match: RegExp; rows: Row[] }[]) {
  const resultsFor = (sql: string) => {
    for (const c of canned) if (c.match.test(sql)) return c.rows;
    return [];
  };
  return {
    prepare(sql: string) {
      const stmt = {
        bind: (..._a: unknown[]) => stmt,
        all: async () => ({ results: resultsFor(sql) }),
        first: async () => resultsFor(sql)[0] ?? null,
        run: async () => ({ meta: { changes: 0, last_row_id: 0 } }),
      };
      return stmt;
    },
  } as unknown as D1Database;
}

// Fake Workers AI — echoes a canned report so the route's shape can be checked.
const fakeAi = { run: async () => ({ response: 'On the date in question, the unit responded and cleared the call.' }) };

function env(db: D1Database) {
  return { DB: db, AI: fakeAi } as unknown as Parameters<typeof radio.request>[2];
}

describe('POST /ai/incident-narrative', () => {
  const callRow = {
    call_number: 'CFS26-00042', incident_type: 'suspicious_vehicle', priority: 'P3', status: 'cleared',
    location_address: '200 S Main St', description: 'gray sedan', notes: null, disposition: 'gone on arrival',
    unit_call_signs: '12-Adam', caller_name: null, created_at: '2026-05-30 02:00:00', cleared_at: '2026-05-30 02:30:00',
  };

  it('400s when neither call_id nor call_number is given', async () => {
    const res = await radio.request('/ai/incident-narrative', { method: 'POST', body: '{}' }, env(fakeDb([])));
    expect(res.status).toBe(400);
  });

  it('returns a narrative for an existing call', async () => {
    const db = fakeDb([
      { match: /FROM calls_for_service WHERE id =/, rows: [callRow] },
      { match: /FROM radio_transmissions/, rows: [{ unit_label: '12-Adam', transcript: 'show me out at 200 South', transmitted_at: '2026-05-30 02:01:00' }] },
    ]);
    const res = await radio.request('/ai/incident-narrative', { method: 'POST', body: JSON.stringify({ call_id: 1 }) }, env(db));
    expect(res.status).toBe(200);
    const json = await res.json() as { call_number: string; narrative: string };
    expect(json.call_number).toBe('CFS26-00042');
    expect(json.narrative).toMatch(/cleared the call/);
  });

  it('400s when the call does not exist', async () => {
    const db = fakeDb([{ match: /FROM calls_for_service/, rows: [] }]);
    const res = await radio.request('/ai/incident-narrative', { method: 'POST', body: JSON.stringify({ call_number: 'NOPE' }) }, env(db));
    expect(res.status).toBe(400);
  });
});

describe('GET /ai/shift-summary', () => {
  it('requires a unit', async () => {
    const res = await radio.request('/ai/shift-summary', {}, env(fakeDb([])));
    expect(res.status).toBe(400);
  });

  it('returns a summary + stats for a unit', async () => {
    const db = fakeDb([
      { match: /FROM calls_for_service/, rows: [
        { call_number: 'CFS26-00042', incident_type: 'traffic_stop', disposition: 'citation', status: 'cleared' },
        { call_number: 'CFS26-00043', incident_type: 'alarm', disposition: 'false', status: 'cleared' },
      ] },
      { match: /COUNT\(\*\) AS n FROM radio_transmissions/, rows: [{ n: 7 }] },
      { match: /FROM units/, rows: [{ status: 'available' }] },
    ]);
    const res = await radio.request('/ai/shift-summary?unit=12-Adam&hours=8', {}, env(db));
    expect(res.status).toBe(200);
    const json = await res.json() as { unit: string; summary: string; stats: { calls: number; transmissions: number } };
    expect(json.unit).toBe('12-Adam');
    expect(json.stats).toEqual({ calls: 2, transmissions: 7 });
    expect(json.summary.length).toBeGreaterThan(0);
  });
});
