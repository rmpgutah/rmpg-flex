import { describe, it, expect } from 'vitest';
import { trustBadge } from '../plateTrust';

describe('trustBadge', () => {
  it('labels a verified high-trust read', () => {
    const b = trustBadge({ trustScore: 0.94, readCount: 9, basis: '8/9 agree · CA format valid' });
    expect(b.label).toBe('VERIFIED'); expect(b.tone).toBe('good');
  });
  it('labels a single-read low-trust as unverified, never shows 100%', () => {
    const b = trustBadge({ trustScore: 0.7, readCount: 1, basis: 'single read — unverified' });
    expect(b.label).toBe('UNVERIFIED'); expect(b.tone).toBe('warn');
  });
});
