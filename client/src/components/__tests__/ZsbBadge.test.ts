import { describe, it, expect } from 'vitest';
import { zsbComposite } from '../ZsbBadge';

// The Z/S/B chart code must ALWAYS present as the full printout composite
// "SEC/ZONE/BEAT" (e.g. "SL1/SSL/A1") regardless of which form the record's
// geography fields arrive in.
describe('zsbComposite', () => {
  it('full embedded codes → SL1/SSL/A1', () => {
    expect(zsbComposite({ zoneId: 'SL1-SSL', beatId: 'SL1-SSL/A1' })).toBe('SL1/SSL/A1');
  });

  it('leaf-only beat recovers parents from zone_id', () => {
    expect(zsbComposite({ zoneId: 'SL1-SSL', beatId: 'A1' })).toBe('SL1/SSL/A1');
  });

  it('missing zone_id recovers zone+sector from a full beat code', () => {
    expect(zsbComposite({ beatId: 'SL1-SSL/A1' })).toBe('SL1/SSL/A1');
  });

  it('zone only (no beat) → SL1/SSL', () => {
    expect(zsbComposite({ zoneId: 'SL1-SSL' })).toBe('SL1/SSL');
  });

  it('explicit sectionCode wins over the embedded prefix', () => {
    expect(zsbComposite({ sectionCode: 'SL2', zoneId: 'SL1-SSL', beatId: 'A1' })).toBe('SL2/SSL/A1');
  });

  it('sector only (resolved code) → SL1', () => {
    expect(zsbComposite({ sectionCode: 'SL1' })).toBe('SL1');
  });

  it('falls back to stored dispatch_code when no geography fields', () => {
    expect(zsbComposite({ dispatchCode: 'SL1/SSL/A1' })).toBe('SL1/SSL/A1');
  });

  it('geography fields beat a stale stored dispatch_code', () => {
    expect(zsbComposite({ zoneId: 'SL1-HER', beatId: 'SL1-HER/C', dispatchCode: 'OLD/X/Y' })).toBe('SL1/HER/C');
  });

  it('empty record → empty string (badge hidden)', () => {
    expect(zsbComposite({})).toBe('');
  });
});
