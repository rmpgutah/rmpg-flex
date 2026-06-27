import { describe, it, expect } from 'vitest';
import { evaluateStaleRequest, pickDuplicatesToPrune } from '../src/utils/footage/queueDrain';

// Anchor "now" so tests are deterministic.
const NOW = 1782028800000;            // 2026-06-21 20:00 UTC
const H  = 60 * 60 * 1000;
const STALE_THRESHOLD = 6 * H;        // 6 hours of no progress

describe('evaluateStaleRequest', () => {
  it('returns null for a request that is already terminal', () => {
    expect(evaluateStaleRequest({
      status: 'complete', updatedAtMs: NOW - 99 * H,
      chunkCount: 10, downloadedCount: 10,
    }, NOW, STALE_THRESHOLD)).toBeNull();

    expect(evaluateStaleRequest({
      status: 'failed', updatedAtMs: NOW - 99 * H,
      chunkCount: 10, downloadedCount: 0,
    }, NOW, STALE_THRESHOLD)).toBeNull();
  });

  it('returns null when the request is still fresh (within threshold)', () => {
    expect(evaluateStaleRequest({
      status: 'fulfilling', updatedAtMs: NOW - 1 * H,
      chunkCount: 10, downloadedCount: 0,
    }, NOW, STALE_THRESHOLD)).toBeNull();
  });

  it('returns {next:"failed"} for a stale fulfilling request with zero downloads', () => {
    expect(evaluateStaleRequest({
      status: 'fulfilling', updatedAtMs: NOW - 24 * H,
      chunkCount: 47, downloadedCount: 0,
    }, NOW, STALE_THRESHOLD)).toEqual({
      next: 'failed',
      reason: 'no_clips_after_24h',
    });
  });

  it('returns {next:"partial"} for a stale request that DID get some clips', () => {
    expect(evaluateStaleRequest({
      status: 'fulfilling', updatedAtMs: NOW - 12 * H,
      chunkCount: 27, downloadedCount: 19,
    }, NOW, STALE_THRESHOLD)).toEqual({
      next: 'partial',
      reason: 'partial_after_12h',
    });
  });

  it('leaves a "partial"-status stale request alone (already partial; no transition needed)', () => {
    expect(evaluateStaleRequest({
      status: 'partial', updatedAtMs: NOW - 24 * H,
      chunkCount: 27, downloadedCount: 19,
    }, NOW, STALE_THRESHOLD)).toBeNull();
  });

  it('still escalates partial → failed when zero clips downloaded (recovers a bad partial classification)', () => {
    expect(evaluateStaleRequest({
      status: 'partial', updatedAtMs: NOW - 24 * H,
      chunkCount: 27, downloadedCount: 0,
    }, NOW, STALE_THRESHOLD)).toEqual({
      next: 'failed',
      reason: 'no_clips_after_24h',
    });
  });

  it('rounds the age down to whole hours in the reason string', () => {
    const r = evaluateStaleRequest({
      status: 'fulfilling', updatedAtMs: NOW - (7 * H + 45 * 60_000),
      chunkCount: 10, downloadedCount: 0,
    }, NOW, STALE_THRESHOLD);
    expect(r).toEqual({ next: 'failed', reason: 'no_clips_after_7h' });
  });
});

describe('pickDuplicatesToPrune', () => {
  it('returns no prunes for an empty input', () => {
    expect(pickDuplicatesToPrune([])).toEqual({ keep: [], prune: [] });
  });

  it('keeps everything when all source_urls are unique', () => {
    const r = pickDuplicatesToPrune([
      { id: 1, seq: 0, source_url: 'https://a/clip-1.mp4', status: 'downloaded', r2_key: 'k/1' },
      { id: 2, seq: 1, source_url: 'https://a/clip-2.mp4', status: 'downloaded', r2_key: 'k/2' },
    ]);
    expect(r).toEqual({ keep: [1, 2], prune: [] });
  });

  it('prunes the higher-seq duplicate when two chunks share a source_url', () => {
    const r = pickDuplicatesToPrune([
      { id: 11, seq: 6, source_url: 'https://a/clip-X.mp4', status: 'downloaded', r2_key: 'k/6' },
      { id: 12, seq: 7, source_url: 'https://a/clip-X.mp4', status: 'downloaded', r2_key: 'k/7' },
      { id: 13, seq: 8, source_url: 'https://a/clip-X.mp4', status: 'downloaded', r2_key: 'k/8' },
    ]);
    expect(r).toEqual({ keep: [11], prune: [12, 13] });
  });

  it('treats source_url=null as never duplicate (legacy rows without source tracking)', () => {
    const r = pickDuplicatesToPrune([
      { id: 1, seq: 0, source_url: null, status: 'downloaded', r2_key: 'k/0' },
      { id: 2, seq: 1, source_url: null, status: 'downloaded', r2_key: 'k/1' },
    ]);
    expect(r).toEqual({ keep: [1, 2], prune: [] });
  });

  it('handles multiple dup-clusters in one request independently', () => {
    const r = pickDuplicatesToPrune([
      { id: 1, seq: 0, source_url: 'https://a/A', status: 'downloaded', r2_key: 'k/0' },
      { id: 2, seq: 1, source_url: 'https://a/B', status: 'downloaded', r2_key: 'k/1' },
      { id: 3, seq: 2, source_url: 'https://a/B', status: 'downloaded', r2_key: 'k/2' },
      { id: 4, seq: 3, source_url: 'https://a/A', status: 'downloaded', r2_key: 'k/3' },
      { id: 5, seq: 4, source_url: 'https://a/B', status: 'downloaded', r2_key: 'k/4' },
    ]);
    // A: keep id 1 (seq 0), prune id 4 (seq 3)
    // B: keep id 2 (seq 1), prune id 3 (seq 2) and id 5 (seq 4)
    expect(r.keep.sort()).toEqual([1, 2]);
    expect(r.prune.sort()).toEqual([3, 4, 5]);
  });

  it('skips chunks that are NOT downloaded (a "requested" chunk with a stray source_url is not yet a dup)', () => {
    const r = pickDuplicatesToPrune([
      { id: 1, seq: 0, source_url: 'https://a/A', status: 'downloaded', r2_key: 'k/0' },
      { id: 2, seq: 1, source_url: 'https://a/A', status: 'requested', r2_key: null },
    ]);
    expect(r).toEqual({ keep: [1], prune: [] });
  });
});
