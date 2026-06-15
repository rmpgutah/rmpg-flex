import { describe, it, expect } from 'vitest';
import { confirmReviewStatus, confirmWarning } from '../src/utils/alprReview';

describe('confirmReviewStatus', () => {
  it('confirmed when the authoritative write persisted', () => {
    expect(confirmReviewStatus(true)).toBe('confirmed');
  });
  it('confirmed_unlinked when persistence failed', () => {
    expect(confirmReviewStatus(false)).toBe('confirmed_unlinked');
  });
  it('warning only on failure', () => {
    expect(confirmWarning(true)).toBeUndefined();
    expect(confirmWarning(false)).toMatch(/not (be )?created|not saved|retry/i);
  });
});
