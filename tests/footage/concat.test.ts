// tests/footage/concat.test.ts
import { describe, it, expect } from 'vitest';
import { buildManifest, buildPlayerManifest } from '../../src/utils/footage/concat';

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

describe('buildPlayerManifest', () => {
  const trip = { id: 42, start_time: 1_000_000, end_time: 1_300_000 };

  it('returns empty manifest when no chunks exist', () => {
    const m = buildPlayerManifest(trip, 'outside', []);
    expect(m.clips).toEqual([]);
    expect(m.gaps).toEqual([]);
    expect(m.stillDownloading).toBe(0);
    expect(m.totalDurationMs).toBe(0);
  });

  it('marks not-yet-downloaded chunks in stillDownloading', () => {
    const m = buildPlayerManifest(trip, 'outside', [
      { id: 1, request_id: 9, seq: 0, channel: 'outside', from_ts: 1_000_000, to_ts: 1_040_000, status: 'downloaded', r2_key: 'k0', sha256: null, bytes: 5 },
      { id: 2, request_id: 9, seq: 1, channel: 'outside', from_ts: 1_040_000, to_ts: 1_080_000, status: 'pending',    r2_key: null, sha256: null, bytes: 0 },
    ]);
    expect(m.clips).toHaveLength(1);
    expect(m.clips[0].seq).toBe(0);
    expect(m.stillDownloading).toBe(1);
  });

  it('sorts by from_ts and computes contiguous-no-gaps', () => {
    const m = buildPlayerManifest(trip, 'outside', [
      { id: 2, request_id: 9, seq: 1, channel: 'outside', from_ts: 1_040_000, to_ts: 1_080_000, status: 'downloaded', r2_key: 'k1', sha256: null, bytes: 5 },
      { id: 1, request_id: 9, seq: 0, channel: 'outside', from_ts: 1_000_000, to_ts: 1_040_000, status: 'downloaded', r2_key: 'k0', sha256: null, bytes: 5 },
    ]);
    expect(m.clips.map((c) => c.seq)).toEqual([0, 1]);
    expect(m.gaps).toEqual([]);
    expect(m.totalDurationMs).toBe(80_000);
  });

  it('detects a gap > 500ms between consecutive downloaded chunks', () => {
    const m = buildPlayerManifest(trip, 'outside', [
      { id: 1, request_id: 9, seq: 0, channel: 'outside', from_ts: 1_000_000, to_ts: 1_040_000, status: 'downloaded', r2_key: 'k0', sha256: null, bytes: 5 },
      { id: 2, request_id: 9, seq: 1, channel: 'outside', from_ts: 1_046_000, to_ts: 1_086_000, status: 'downloaded', r2_key: 'k1', sha256: null, bytes: 5 },
    ]);
    expect(m.gaps).toHaveLength(1);
    expect(m.gaps[0].durationMs).toBe(6_000);
    expect(m.gaps[0].startTs).toBe(1_040_000);
    expect(m.gaps[0].endTs).toBe(1_046_000);
  });

  it('treats a ≤500ms boundary as contiguous (clock drift tolerance)', () => {
    const m = buildPlayerManifest(trip, 'outside', [
      { id: 1, request_id: 9, seq: 0, channel: 'outside', from_ts: 1_000_000, to_ts: 1_040_000, status: 'downloaded', r2_key: 'k0', sha256: null, bytes: 5 },
      { id: 2, request_id: 9, seq: 1, channel: 'outside', from_ts: 1_040_400, to_ts: 1_080_400, status: 'downloaded', r2_key: 'k1', sha256: null, bytes: 5 },
    ]);
    expect(m.gaps).toEqual([]);
  });

  it('filters by channel', () => {
    const m = buildPlayerManifest(trip, 'outside', [
      { id: 1, request_id: 9, seq: 0, channel: 'outside', from_ts: 1_000_000, to_ts: 1_040_000, status: 'downloaded', r2_key: 'k0', sha256: null, bytes: 5 },
      { id: 2, request_id: 9, seq: 0, channel: 'interior', from_ts: 1_000_000, to_ts: 1_040_000, status: 'downloaded', r2_key: 'k1', sha256: null, bytes: 5 },
    ]);
    expect(m.clips).toHaveLength(1);
    expect(m.clips[0].seq).toBe(0);
    expect(m.clips[0].url).toBe('/api/flexcam/footage/9/chunk/0/stream');
  });

  it('uses the chunk-streaming endpoint as the URL', () => {
    const m = buildPlayerManifest(trip, 'outside', [
      { id: 1, request_id: 9, seq: 0, channel: 'outside', from_ts: 1_000_000, to_ts: 1_040_000, status: 'downloaded', r2_key: 'k0', sha256: 'abc', bytes: 5 },
    ]);
    expect(m.clips[0].url).toBe('/api/flexcam/footage/9/chunk/0/stream');
    expect(m.clips[0].sha256).toBe('abc');
  });
});
