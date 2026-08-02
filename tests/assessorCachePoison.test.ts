// tests/assessorCachePoison.test.ts
//
// The 2026-08-01 picker bug had TWO halves. The parser fix stopped NEW bad
// values being written; this covers the half that kept the bug on screen
// afterwards — the values already in KV.
//
// Clearing them is not a matter of waiting: putCachedDurable() writes a
// companion key with NO expirationTtl, so a poisoned durable entry lives
// forever and answers the moment the fresh key is cleared. A manual Refresh
// deletes the fresh key and the durable key serves the same corrupt value
// straight back. Hence validate-on-read.

import { describe, it, expect, beforeEach } from 'vitest';
import { isValidParcelNumber, getCachedValidated } from '../src/utils/sl-assessor/cache';

/** Minimal in-memory KVNamespace stand-in. */
function makeKV(seed: Record<string, unknown> = {}) {
  const store = new Map<string, string>(
    Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]),
  );
  return {
    store,
    kv: {
      get: async (key: string, _type?: string) => {
        const raw = store.get(key);
        return raw === undefined ? null : JSON.parse(raw);
      },
      put: async (key: string, value: string) => { store.set(key, value); },
      delete: async (key: string) => { store.delete(key); },
    } as unknown as KVNamespace,
  };
}

describe('isValidParcelNumber', () => {
  it('accepts the only shape the county issues', () => {
    expect(isValidParcelNumber('16-31-127-029-0000')).toBe(true);
    expect(isValidParcelNumber('15-34-377-012-0000')).toBe(true);
  });

  it('rejects the search-form placeholder', () => {
    // <input id="parcelid" placeholder="00-00-000-000-0000">
    expect(isValidParcelNumber('00-00-000-000')).toBe(false);
    expect(isValidParcelNumber('00-00-000-000-0000')).toBe(false);
  });

  it('rejects a 12-digit BLOCK id', () => {
    // Not cosmetic: the county answers a block id with HTTP 200 + its search
    // form, so caching one guarantees silent downstream failure.
    expect(isValidParcelNumber('16-31-127-029')).toBe(false);
  });

  it('rejects non-strings and junk', () => {
    for (const v of [null, undefined, 42, '', 'N/A', {}]) {
      expect(isValidParcelNumber(v)).toBe(false);
    }
  });
});

describe('getCachedValidated — self-heals poisoned entries', () => {
  const KEY = 'assessor:parcels:4000 s redwood rd';
  const GOOD = [{ parcel_number: '15-34-377-012-0000', owner_of_record: 'BIG 4000 REDWOOD UT, LLC' }];
  const POISONED = [{ parcel_number: '00-00-000-000', owner_of_record: 'BIG 4000 REDWOOD UT, LLC' }];
  const extract = (v: any) => (Array.isArray(v) ? v.map((p) => p.parcel_number) : []);

  let kvh: ReturnType<typeof makeKV>;
  beforeEach(() => { kvh = makeKV(); });

  it('returns a valid cached entry untouched', async () => {
    kvh = makeKV({ [KEY]: GOOD });
    const out = await getCachedValidated<any>({ KV: kvh.kv }, KEY, extract);
    expect(out).toEqual(GOOD);
    expect(kvh.store.has(KEY)).toBe(true);
  });

  it('returns null AND deletes a placeholder-poisoned entry', async () => {
    kvh = makeKV({ [KEY]: POISONED });
    const out = await getCachedValidated<any>({ KV: kvh.kv }, KEY, extract);
    expect(out).toBeNull();
    // Deleted, so the next read falls through to a live fetch and repopulates.
    expect(kvh.store.has(KEY)).toBe(false);
  });

  it('deletes an entry poisoned with a 12-digit block id', async () => {
    kvh = makeKV({ [KEY]: [{ parcel_number: '16-31-127-029' }] });
    expect(await getCachedValidated<any>({ KV: kvh.kv }, KEY, extract)).toBeNull();
    expect(kvh.store.has(KEY)).toBe(false);
  });

  it('drops the WHOLE list when any single row is poisoned', async () => {
    // A list with one bad row came out of the broken parser, so its other
    // rows are not trustworthy either — filtering would keep bad data.
    kvh = makeKV({ [KEY]: [...GOOD, { parcel_number: '00-00-000-000' }] });
    expect(await getCachedValidated<any>({ KV: kvh.kv }, KEY, extract)).toBeNull();
    expect(kvh.store.has(KEY)).toBe(false);
  });

  it('heals the DURABLE key too, not just the TTL key', async () => {
    // The durable key has no expirationTtl. If validation skipped it, Refresh
    // would clear the fresh key and this would immediately serve the same
    // corrupt value back — which is exactly what was observed.
    const DUR = 'assessor:parcels:durable:4000 s redwood rd';
    kvh = makeKV({ [DUR]: POISONED });
    expect(await getCachedValidated<any>({ KV: kvh.kv }, DUR, extract)).toBeNull();
    expect(kvh.store.has(DUR)).toBe(false);
  });

  it('validates a single Parcel payload, not just lists', async () => {
    const PK = 'assessor:parcel:00-00-000-000';
    kvh = makeKV({ [PK]: { parcel_number: '00-00-000-000', owner_of_record: 'X' } });
    const out = await getCachedValidated<any>({ KV: kvh.kv }, PK, (v) => [v?.parcel_number]);
    expect(out).toBeNull();
    expect(kvh.store.has(PK)).toBe(false);
  });

  it('is a no-op on a genuine cache miss', async () => {
    expect(await getCachedValidated<any>({ KV: kvh.kv }, KEY, extract)).toBeNull();
  });

  it('keeps payloads that carry no parcel numbers at all', async () => {
    // An empty list is a legitimate cached "no match" — not poison.
    kvh = makeKV({ [KEY]: [] });
    expect(await getCachedValidated<any>({ KV: kvh.kv }, KEY, extract)).toEqual([]);
    expect(kvh.store.has(KEY)).toBe(true);
  });

  it('does not delete data when the extractor throws on an odd shape', async () => {
    kvh = makeKV({ [KEY]: { unexpected: true } });
    const out = await getCachedValidated<any>({ KV: kvh.kv }, KEY, () => { throw new Error('bad shape'); });
    expect(out).toEqual({ unexpected: true });
    expect(kvh.store.has(KEY)).toBe(true);
  });
});
