import { describe, it, expect } from 'vitest';
import { resolveCloseStatus } from '../src/utils/footage/closeStatus';

describe('resolveCloseStatus', () => {
  it('returns "complete" when every chunk downloaded (no missing)', () => {
    expect(resolveCloseStatus({ chunksDone: 27, hasMissing: false })).toBe('complete');
    expect(resolveCloseStatus({ chunksDone: 1, hasMissing: false })).toBe('complete');
  });

  it('returns "partial" when SOME chunks downloaded but others missing', () => {
    expect(resolveCloseStatus({ chunksDone: 19, hasMissing: true })).toBe('partial');
    expect(resolveCloseStatus({ chunksDone: 1, hasMissing: true })).toBe('partial');
  });

  it('returns "failed" when ZERO chunks downloaded AND chunks are missing', () => {
    // Trip 94's scenario: 23 chunks queued, 0 ever downloaded, all 23 missing.
    // The old close-query marked this 'partial' — misleading. Failed is honest.
    expect(resolveCloseStatus({ chunksDone: 0, hasMissing: true })).toBe('failed');
  });

  it('returns "complete" when chunks_done=0 AND no missing (zero-chunk no-op request)', () => {
    // Edge case: a request with chunk_count=0 (empty channel list, etc.).
    // Not 'failed' — nothing was queued, nothing failed.
    expect(resolveCloseStatus({ chunksDone: 0, hasMissing: false })).toBe('complete');
  });
});
