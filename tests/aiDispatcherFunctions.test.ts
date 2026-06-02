// ============================================================
// AI dispatcher — new functions + OCR auto-chain selection
// ============================================================
// Covers the new read-lookups (call_status, last_dispatch) via the same
// hand-rolled D1 double as aiDispatcherSafety.test.ts, plus the pure
// OCR→lookup selector lookupFromOcr().
// ============================================================

import { describe, it, expect } from 'vitest';
import { runLookup, runAction, evaluateActionPolicy, VERBATIM_LOOKUPS } from '../src/utils/dispatcherAwareness';
import { lookupFromOcr } from '../src/utils/aiDispatcher';

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

const env = {} as unknown as import('../src/types').Bindings;

describe('lookupFromOcr — picks the most-specific runnable check', () => {
  it('prefers a plate', () => {
    const r = lookupFromOcr({ docType: 'license_plate', rawText: '', fields: { plate: 'ABC123', vin: '1HGCM82633A004352', name: 'Jane Doe' } });
    expect(r).toEqual({ type: 'plate', query: 'ABC123' });
  });
  it('falls to VIN when no plate', () => {
    const r = lookupFromOcr({ docType: 'vehicle_registration', rawText: '', fields: { vin: '1HGCM82633A004352', name: 'Jane Doe' } });
    expect(r).toEqual({ type: 'vin', query: '1HGCM82633A004352' });
  });
  it('falls to person when only a name', () => {
    const r = lookupFromOcr({ docType: 'driver_license', rawText: '', fields: { name: 'Jane Doe' } });
    expect(r).toEqual({ type: 'person', query: 'Jane Doe' });
  });
  it('returns null when nothing runnable', () => {
    expect(lookupFromOcr({ docType: 'document', rawText: 'hello', fields: {} })).toBeNull();
  });
  it('ignores a too-short plate', () => {
    expect(lookupFromOcr({ docType: 'license_plate', rawText: '', fields: { plate: 'AB' } })).toBeNull();
  });
});

describe('runLookup — call_status', () => {
  it('reads back a call by number', async () => {
    const db = fakeDb([{
      match: /FROM calls_for_service/,
      rows: [{
        call_number: 'CFS26-00042', incident_type: 'theft', status: 'active',
        priority: 'P2', location_address: '200 S Main', unit_call_signs: '12-Adam', disposition: null,
      }],
    }]);
    const r = await runLookup(env, db, { type: 'call_status', query: 'CFS26-00042' });
    expect(r?.text).toContain('CFS26-00042');
    expect(r?.text).toContain('theft');
    expect(r?.text).toContain('Status active');
    expect(r?.text).toContain('12-Adam');
  });
  it('reports no match cleanly', async () => {
    const db = fakeDb([{ match: /FROM calls_for_service/, rows: [] }]);
    const r = await runLookup(env, db, { type: 'call_status', query: 'CFS99-99999' });
    expect(r?.text).toMatch(/No call on file/i);
  });
});

describe('runLookup — last_dispatch (say again)', () => {
  it('returns the previous dispatch transmission verbatim', async () => {
    const db = fakeDb([{ match: /FROM radio_transmissions/, rows: [{ transcript: '12-Adam, copy, show you out at 200 South.' }] }]);
    const r = await runLookup(env, db, { type: 'last_dispatch', query: '' }, { channelId: 5 });
    expect(r?.text).toBe('12-Adam, copy, show you out at 200 South.');
  });
  it('handles no prior transmission', async () => {
    const db = fakeDb([{ match: /FROM radio_transmissions/, rows: [] }]);
    const r = await runLookup(env, db, { type: 'last_dispatch', query: '' }, { channelId: 5 });
    expect(r?.text).toMatch(/no prior transmission/i);
  });
});

describe('create_bolo — policy + issuer guard', () => {
  it('refuses with no detail, allows with a title', () => {
    expect(evaluateActionPolicy({ type: 'create_bolo' }).allow).toBe(false);
    expect(evaluateActionPolicy({ type: 'create_bolo', title: 'Red sedan fled scene' }).allow).toBe(true);
  });
  it('refuses (null) when there is no issuing officer — the issued_by FK', async () => {
    const db = fakeDb([]);
    const r = await runAction(env, db, { type: 'create_bolo', title: 'Suspect on foot' }, {});
    expect(r).toBeNull();
  });
  it('issues a numbered BOLO when an officer id is supplied', async () => {
    // run() must report a row id for createBolo to confirm success.
    const db = {
      prepare(sql: string) {
        const stmt = {
          bind: (..._a: unknown[]) => stmt,
          all: async () => ({ results: /MAX\(bolo_number\)/.test(sql) ? [{ max: null }] : [] }),
          first: async () => null,
          run: async () => ({ meta: { changes: 1, last_row_id: 7 } }),
        };
        return stmt;
      },
    } as unknown as import('@cloudflare/workers-types').D1Database;
    const r = await runAction(env, db, { type: 'create_bolo', bolo_type: 'vehicle', title: 'Red sedan, no plate', priority: 'P2' }, { issuedBy: 3 });
    expect(r?.summary).toMatch(/^bolo_created:BOLO\d\d-00001$/);
    expect(r?.spoken).toContain('Red sedan, no plate');
    expect(r?.spoken).toContain('BOLO');
  });
});

describe('VERBATIM_LOOKUPS set', () => {
  it('includes the new complete-line lookups', () => {
    expect(VERBATIM_LOOKUPS.has('call_status')).toBe(true);
    expect(VERBATIM_LOOKUPS.has('closest_unit')).toBe(true);
    expect(VERBATIM_LOOKUPS.has('last_dispatch')).toBe(true);
    expect(VERBATIM_LOOKUPS.has('plate')).toBe(false);
  });
});
