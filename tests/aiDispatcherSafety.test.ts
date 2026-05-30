// ============================================================
// AI dispatcher — safety + expanded lookup/action tests
// ============================================================
// Covers the new pure policy gating (clear_call / dispatch_backup) and the
// new lookups (premise hazards, VIN) using the same hand-rolled D1 double as
// tests/audit.test.ts — no Workers runtime needed (these functions only touch
// the D1 prepare/bind/all/first chain).
// ============================================================

import { describe, it, expect } from 'vitest';
import { evaluateActionPolicy, runLookup, checkPremiseHazards } from '../src/utils/dispatcherAwareness';

type Row = Record<string, unknown>;
function fakeDb(canned: { match: RegExp; rows: Row[] }[]) {
  const resultsFor = (sql: string) => {
    for (const c of canned) if (c.match.test(sql)) return c.rows;
    return [];
  };
  const db = {
    prepare(sql: string) {
      const stmt = {
        bind: (..._a: unknown[]) => stmt,
        all: async () => ({ results: resultsFor(sql) }),
        first: async () => resultsFor(sql)[0] ?? null,
        run: async () => ({ meta: { changes: 0, last_row_id: 0 } }),
      };
      return stmt;
    },
  };
  return db as unknown as import('@cloudflare/workers-types').D1Database;
}

describe('evaluateActionPolicy — new write actions', () => {
  it('clear_call requires a call number', () => {
    expect(evaluateActionPolicy({ type: 'clear_call' }).allow).toBe(false);
    expect(evaluateActionPolicy({ type: 'clear_call', call_number: 'CFS26-00042' }).allow).toBe(true);
  });

  it('dispatch_backup needs a unit or a call to attach to', () => {
    expect(evaluateActionPolicy({ type: 'dispatch_backup' }).allow).toBe(false);
    expect(evaluateActionPolicy({ type: 'dispatch_backup', unit: '12-Adam' }).allow).toBe(true);
    expect(evaluateActionPolicy({ type: 'dispatch_backup', call_number: 'CFS26-00042' }).allow).toBe(true);
  });
});

describe('checkPremiseHazards — proactive officer-safety warning', () => {
  const hazardRows = [{
    alert_type: 'caution', alert_level: 'high', title: 'Weapons on premises',
    description: 'prior firearms call', flags: '["weapons","violence"]',
  }];

  it('returns a spoken caution that names the hazard + flags', async () => {
    const db = fakeDb([{ match: /FROM premise_alerts/, rows: hazardRows }]);
    const warn = await checkPremiseHazards(db, '200 S Main St');
    expect(warn).toMatch(/Be advised/i);
    expect(warn).toMatch(/Weapons on premises/);
    expect(warn).toMatch(/weapons/);
    expect(warn).toMatch(/use caution/i);
  });

  it('returns null when the address is clean', async () => {
    const db = fakeDb([{ match: /FROM premise_alerts/, rows: [] }]);
    expect(await checkPremiseHazards(db, '999 Nowhere Ave')).toBeNull();
  });

  it('ignores a too-short address (no query)', async () => {
    const db = fakeDb([{ match: /FROM premise_alerts/, rows: hazardRows }]);
    expect(await checkPremiseHazards(db, 'a')).toBeNull();
  });
});

describe('runLookup — premise + VIN', () => {
  it('reads premise alerts back on request', async () => {
    const db = fakeDb([{
      match: /FROM premise_alerts/,
      rows: [{ alert_type: 'caution', alert_level: 'warning', title: 'Dog on property', description: null, flags: '[]' }],
    }]);
    const r = await runLookup(db, { type: 'premise', query: '5th and Main' });
    expect(r).toMatch(/Premise alert/i);
    expect(r).toMatch(/Dog on property/);
  });

  it('decodes a VIN and flags stolen', async () => {
    const db = fakeDb([{
      match: /FROM vehicles_records/,
      rows: [{
        vin: '1HGCM82633A004352', plate_number: 'ABC123', make: 'Honda', model: 'Accord',
        year: 2003, color: 'silver', is_stolen: 1, registered_owner: 'John Doe',
      }],
    }]);
    const r = await runLookup(db, { type: 'vin', query: '1HGCM82633A004352' });
    expect(r).toMatch(/Honda Accord/);
    expect(r).toMatch(/FLAGGED STOLEN/);
  });

  it('reports no record for an unknown VIN', async () => {
    const db = fakeDb([{ match: /FROM vehicles_records/, rows: [] }]);
    const r = await runLookup(db, { type: 'vin', query: '0000000000ZZZZZ99' });
    expect(r).toMatch(/No vehicle on file/i);
  });
});
