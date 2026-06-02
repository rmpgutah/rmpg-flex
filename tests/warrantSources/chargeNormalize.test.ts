import { describe, it, expect } from 'vitest';
import { normalizeCharge } from '../../src/utils/warrantSources/chargeNormalize';

describe('normalizeCharge', () => {
  it('classifies an assault as a misdemeanor by default', () => {
    expect(normalizeCharge('ASSAULT').severity).toBe('misdemeanor');
  });
  it('flags felony keywords', () => {
    expect(normalizeCharge('FELONY DRUG POSSESSION').severity).toBe('felony');
    expect(normalizeCharge('AGGRAVATED ROBBERY').severity).toBe('felony');
  });
  it('flags DUI/influence', () => {
    expect(normalizeCharge('DRIVING UNDER THE INFLUENCE - 1ST').normalized).toMatch(/DUI/i);
  });
  it('returns infraction for traffic/equipment', () => {
    expect(normalizeCharge('TAIL LIGHT VIOLATION').severity).toBe('infraction');
  });
  it('handles a JSON-array charge string', () => {
    expect(normalizeCharge('["BATTERY"]').normalized).toBe('Battery');
  });
  it('degrades gracefully on empty', () => {
    expect(normalizeCharge('').severity).toBe('unknown');
  });
});
