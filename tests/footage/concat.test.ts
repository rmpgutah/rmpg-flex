// tests/footage/concat.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildManifest, buildPlayerManifest, remuxMp4ToFmp4 } from '../../src/utils/footage/concat';

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

const mockR2 = (storage: Record<string, Uint8Array>) => ({
  UPLOADS: {
    get: vi.fn(async (key: string) =>
      storage[key]
        ? { body: new Response(storage[key]).body, arrayBuffer: async () => storage[key].buffer }
        : null,
    ),
    put: vi.fn(async (_key: string, _body: unknown, _opts: unknown) => ({ etag: 'fake' })),
  },
});

describe('remuxMp4ToFmp4', () => {
  it('returns "ready" and writes a merged object when all chunks fetch ok', async () => {
    const storage = {
      'flexcam/trips/0/0.mp4': new Uint8Array([1, 2, 3]),
      'flexcam/trips/0/1.mp4': new Uint8Array([4, 5, 6]),
    };
    const env = mockR2(storage);

    // Force mp4box wrapper to a stub so we don't depend on real binaries here.
    vi.doMock('../../src/utils/footage/mp4box', () => ({
      remuxMp4SegmentsToFmp4: vi.fn(async (segs: Uint8Array[]) => ({
        bytes: new Uint8Array(segs.reduce((s, x) => s + x.byteLength, 0)),
        sha256: 'fake-sha',
      })),
      Mp4BoxError: class extends Error {},
    }));

    const result = await remuxMp4ToFmp4(env as any, 'flexcam/trips/merged/0.mp4', [
      { seq: 0, r2_key: 'flexcam/trips/0/0.mp4' },
      { seq: 1, r2_key: 'flexcam/trips/0/1.mp4' },
    ]);
    expect(result.state).toBe('ready');
    expect(result.sha256).toBe('fake-sha');
    expect(env.UPLOADS.put).toHaveBeenCalledTimes(1);
    vi.doUnmock('../../src/utils/footage/mp4box');
  });

  it('returns "failed" with a code when ≥10% of chunks are missing from R2', async () => {
    const storage = {
      'flexcam/trips/0/0.mp4': new Uint8Array([1, 2, 3]),
      // 1.mp4 missing
      'flexcam/trips/0/2.mp4': new Uint8Array([7, 8, 9]),
      // 3.mp4 missing
      'flexcam/trips/0/4.mp4': new Uint8Array([7, 8, 9]),
    };
    const env = mockR2(storage);
    const result = await remuxMp4ToFmp4(env as any, 'flexcam/trips/merged/0.mp4', [
      { seq: 0, r2_key: 'flexcam/trips/0/0.mp4' },
      { seq: 1, r2_key: 'flexcam/trips/0/1.mp4' },
      { seq: 2, r2_key: 'flexcam/trips/0/2.mp4' },
      { seq: 3, r2_key: 'flexcam/trips/0/3.mp4' },
      { seq: 4, r2_key: 'flexcam/trips/0/4.mp4' },
    ]);
    expect(result.state).toBe('failed');
    expect(result.errorCode).toBe('integrity_threshold_exceeded');
  });

  it('skips ≤10% missing chunks and continues', async () => {
    const storage: Record<string, Uint8Array> = {};
    for (let i = 0; i < 20; i++) storage[`flexcam/trips/0/${i}.mp4`] = new Uint8Array([i]);
    delete storage['flexcam/trips/0/5.mp4']; // 1/20 = 5% missing
    const env = mockR2(storage);

    vi.doMock('../../src/utils/footage/mp4box', () => ({
      remuxMp4SegmentsToFmp4: vi.fn(async () => ({ bytes: new Uint8Array(10), sha256: 'ok' })),
      Mp4BoxError: class extends Error {},
    }));

    const chunks = Array.from({ length: 20 }, (_, i) => ({ seq: i, r2_key: `flexcam/trips/0/${i}.mp4` }));
    const result = await remuxMp4ToFmp4(env as any, 'flexcam/trips/merged/0.mp4', chunks);
    expect(result.state).toBe('ready');
    expect(result.skipped).toEqual([5]);
    vi.doUnmock('../../src/utils/footage/mp4box');
  });
});
