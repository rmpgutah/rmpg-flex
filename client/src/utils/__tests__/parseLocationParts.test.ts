import { describe, it, expect } from 'vitest';
import { parseLocationParts } from '../parseLocationParts';

describe('parseLocationParts', () => {
  it('returns all-empty for a plain street address (nothing to extract)', () => {
    expect(parseLocationParts('123 Main St, Salt Lake City, UT 84101')).toEqual({
      building: '', floor: '', suite: '',
    });
  });

  it('returns all-empty for blank / nullish input', () => {
    expect(parseLocationParts('')).toEqual({ building: '', floor: '', suite: '' });
    // @ts-expect-error — guarding the runtime nullish path
    expect(parseLocationParts(undefined)).toEqual({ building: '', floor: '', suite: '' });
  });

  it('extracts suite/unit/apt/room designators', () => {
    expect(parseLocationParts('456 S State St Ste 200').suite).toBe('200');
    expect(parseLocationParts('456 S State St, Suite 200, SLC').suite).toBe('200');
    expect(parseLocationParts('456 S State St Unit 4B').suite).toBe('4B');
    expect(parseLocationParts('456 S State St Apt 5').suite).toBe('5');
    expect(parseLocationParts('456 S State St Room 12').suite).toBe('12');
  });

  it('treats a bare "#" as a suite/unit (commercial-property convention)', () => {
    expect(parseLocationParts('456 S State St #302').suite).toBe('302');
    expect(parseLocationParts('456 S State St #4B, SLC UT').suite).toBe('4B');
  });

  it('extracts building / tower / block designators', () => {
    expect(parseLocationParts('Bldg A, 123 Main St').building).toBe('A');
    expect(parseLocationParts('123 Main St, Building 2').building).toBe('2');
    expect(parseLocationParts('123 Main St Tower 3').building).toBe('3');
  });

  it('extracts floor in both keyword and trailing-ordinal forms', () => {
    expect(parseLocationParts('100 S Main St, Floor 3').floor).toBe('3');
    expect(parseLocationParts('100 S Main St 3rd Floor').floor).toBe('3rd');
    expect(parseLocationParts('100 S Main St, Level 2').floor).toBe('2');
  });

  it('extracts a full Bldg + Floor + Suite combination', () => {
    expect(parseLocationParts('123 Main St, Tower 2, Floor 3, Ste 310')).toEqual({
      building: '2', floor: '3', suite: '310',
    });
  });

  it('does not mistake SLC grid streets or ZIPs for sub-address parts', () => {
    // No designator keywords → nothing extracted, even with many numbers.
    expect(parseLocationParts('S 200 E 300 S, Salt Lake City, UT 84111')).toEqual({
      building: '', floor: '', suite: '',
    });
  });
});
