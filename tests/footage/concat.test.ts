// tests/footage/concat.test.ts
import { describe, it, expect } from 'vitest';
import { buildManifest } from '../../src/utils/footage/concat';

describe('buildManifest', () => {
  const rows = [
    { seq: 1, from_ts: 40000, to_ts: 80000, status: 'downloaded', r2_key: 'k1', bytes: 10 },
    { seq: 0, from_ts: 0, to_ts: 40000, status: 'downloaded', r2_key: 'k0', bytes: 12 },
    { seq: 2, from_ts: 80000, to_ts: 120000, status: 'missing', r2_key: null, bytes: 0 },
  ];
  it('orders downloaded chunks and reports gaps + duration', () => {
    const m = buildManifest(7, rows);
    expect(m.requestId).toBe(7);
    expect(m.chunks.map((c) => c.seq)).toEqual([0, 1]);
    expect(m.gaps).toEqual([2]);
    expect(m.spanMs).toBe(120000);
    expect(m.playableMs).toBe(80000);
  });
});
