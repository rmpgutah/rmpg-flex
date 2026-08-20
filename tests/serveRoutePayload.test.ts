import { describe, it, expect } from 'vitest';
import { routeJsonColumn } from '../src/utils/serveRoutePayload';

describe('routeJsonColumn', () => {
  it('passes the live client spelling (already-stringified *_json) through untouched', () => {
    // This is the exact shape ServeRoutePlanner's "Apply Route" POSTs. The
    // handler used to ignore it entirely and store "[]".
    const out = routeJsonColumn('[101,102,103]', undefined);
    expect(out).toBe('[101,102,103]');
    expect(JSON.parse(out)).toEqual([101, 102, 103]);
  });

  it('does NOT double-encode — the stored value must parse to an ARRAY, not a string', () => {
    // Double-encoding is the silent variant of the original bug: the column is
    // non-empty, so the Route tab's `savedRoute.optimized_order_json` guard
    // passes, then JSON.parse yields a string and the stop list renders empty.
    const parsed = JSON.parse(routeJsonColumn('[7]', undefined));
    expect(Array.isArray(parsed)).toBe(true);
  });

  it('falls back to the bare array spelling for older callers', () => {
    expect(routeJsonColumn(undefined, [4, 5])).toBe('[4,5]');
  });

  it('encodes a raw array/object sent under the *_json key exactly once', () => {
    expect(routeJsonColumn([{ id: 1, lat: 40.7, lng: -111.9 }], undefined))
      .toBe('[{"id":1,"lat":40.7,"lng":-111.9}]');
  });

  it('prefers the *_json spelling when a caller sends both', () => {
    expect(routeJsonColumn('[1,2]', [9, 9, 9])).toBe('[1,2]');
  });

  it('yields an empty JSON array when neither key is present', () => {
    expect(routeJsonColumn(undefined, undefined)).toBe('[]');
    expect(routeJsonColumn(null, null)).toBe('[]');
  });

  it('treats an empty/whitespace *_json string as absent rather than storing it', () => {
    // '' would otherwise be written into a column the readers JSON.parse().
    expect(routeJsonColumn('', [3])).toBe('[3]');
    expect(routeJsonColumn('   ', undefined)).toBe('[]');
  });
});
