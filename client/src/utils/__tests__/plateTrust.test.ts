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
  it('labels a mid-trust multi-read as review', () => {
    const b = trustBadge({ trustScore: 0.82, readCount: 5, basis: '4/5 agree' });
    expect(b.label).toBe('REVIEW'); expect(b.tone).toBe('warn');
  });
  it('treats the 0.85 boundary as verified (inclusive lower bound)', () => {
    const b = trustBadge({ trustScore: 0.85, readCount: 5, basis: 'consensus' });
    expect(b.label).toBe('VERIFIED'); expect(b.tone).toBe('good');
  });
  it('treats the 0.80 boundary as review (inclusive lower bound)', () => {
    const b = trustBadge({ trustScore: 0.80, readCount: 5, basis: 'borderline consensus' });
    expect(b.label).toBe('REVIEW'); expect(b.tone).toBe('warn');
  });
  it('never trusts a single high-confidence read (anti-fake-100% guard)', () => {
    const b = trustBadge({ trustScore: 0.99, readCount: 1, basis: 'single read — model self-reported' });
    expect(b.label).toBe('UNVERIFIED'); expect(b.tone).toBe('warn');
  });
});
