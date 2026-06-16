import { describe, it, expect } from 'vitest';
import { retentionCutoffMs, isPurgeable } from '../src/utils/footage/retention';

describe('retentionCutoffMs', () => {
  it('subtracts retention days from now (ms)', () => {
    const now = Date.UTC(2026, 5, 15, 0, 0, 0); // 2026-06-15
    expect(retentionCutoffMs(now, 120)).toBe(now - 120 * 86_400_000);
  });
  it('returns null for non-positive / non-finite days (keep forever)', () => {
    expect(retentionCutoffMs(1_000, 0)).toBeNull();
    expect(retentionCutoffMs(1_000, -5)).toBeNull();
    expect(retentionCutoffMs(1_000, NaN)).toBeNull();
  });
});

describe('isPurgeable', () => {
  const cutoff = 1_000_000;
  it('purges an old, unlocked request', () => {
    expect(isPurgeable({ created_ms: 500_000, evidence_locked: 0 }, cutoff)).toBe(true);
  });
  it('never purges a locked request, however old', () => {
    expect(isPurgeable({ created_ms: 1, evidence_locked: 1 }, cutoff)).toBe(false);
  });
  it('keeps a request newer than the cutoff', () => {
    expect(isPurgeable({ created_ms: 2_000_000, evidence_locked: 0 }, cutoff)).toBe(false);
  });
  it('treats null/undefined evidence_locked as unlocked', () => {
    expect(isPurgeable({ created_ms: 1, evidence_locked: null }, cutoff)).toBe(true);
  });
});
