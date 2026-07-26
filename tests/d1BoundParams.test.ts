// ============================================================
// D1 bound-parameter cap — regression suite
// ============================================================
// D1 rejects any query carrying more than 100 bound parameters, at BIND time,
// before execution (developers.cloudflare.com/d1/platform/limits).
//
// This bit `GET /api/fleetio/conflicts` live on 2026-07-26: it built one
// `rmpg_id IN (?,?,…)` list from however many rows the caller was rendering, so
// once the fuel log held 109 entries the request carried 110 bindings and 500'd.
// The failure mode is nasty because the query's SHAPE depends on dataset size —
// it passes every test and every dev run, then breaks on real data.
// ============================================================

import { describe, it, expect } from 'vitest';
import { chunkBindings, D1_MAX_BOUND_PARAMS } from '../src/utils/db';

describe('D1_MAX_BOUND_PARAMS', () => {
  it('matches D1\'s documented cap', () => {
    expect(D1_MAX_BOUND_PARAMS).toBe(100);
  });
});

describe('chunkBindings', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

  it('returns [] for an empty input so callers can skip the query entirely', () => {
    expect(chunkBindings([])).toEqual([]);
  });

  it('keeps a small list in a single chunk', () => {
    expect(chunkBindings(ids(5))).toEqual([[1, 2, 3, 4, 5]]);
  });

  it('fits exactly 100 items in one chunk when nothing is reserved', () => {
    const chunks = chunkBindings(ids(100));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(100);
  });

  it('splits at 101 items', () => {
    const chunks = chunkBindings(ids(101));
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(100);
    expect(chunks[1]).toEqual([101]);
  });

  it('shrinks the budget by reservedBindings', () => {
    // One reserved binding (e.g. a `rmpg_table = ?` filter) means 99 ids max.
    const chunks = chunkBindings(ids(100), 1);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(99);
    expect(chunks[1]).toEqual([100]);
  });

  it('NO chunk ever exceeds the cap once reserved bindings are added back', () => {
    // The invariant that actually matters. Swept across sizes and reservations
    // so an off-by-one in the budget maths can't hide at one particular length.
    for (const reserved of [0, 1, 2, 5, 17]) {
      for (const n of [1, 89, 90, 99, 100, 101, 109, 199, 200, 501]) {
        for (const chunk of chunkBindings(ids(n), reserved)) {
          expect(chunk.length + reserved).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS);
        }
      }
    }
  });

  it('loses no items and preserves order across chunks', () => {
    const input = ids(109);
    expect(chunkBindings(input, 1).flat()).toEqual(input);
  });

  it('reproduces the exact live failure: 109 ids + 1 table filter', () => {
    // Pre-fix this was one query with 110 bindings -> D1_ERROR -> 500.
    const chunks = chunkBindings(ids(109), 1);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length + 1).toBeLessThanOrEqual(100);
  });

  it('throws rather than silently emitting zero-length chunks when nothing fits', () => {
    // A caller reserving 100+ bindings has a design problem; an infinite loop of
    // empty chunks would be a far worse way to find out.
    expect(() => chunkBindings(ids(5), 100)).toThrow(/leaves no room/);
    expect(() => chunkBindings(ids(5), 250)).toThrow(/leaves no room/);
  });

  it('treats a negative reservation as zero rather than inflating the budget', () => {
    const chunks = chunkBindings(ids(101), -50);
    expect(chunks[0]).toHaveLength(100);
  });
});
