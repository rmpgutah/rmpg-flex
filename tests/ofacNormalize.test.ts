import { describe, it, expect } from 'vitest';
import { normalizeOfacRow, rowToCandidate, appendCautionFlag } from '../src/utils/screening/ofacAdapter';

const ROW = {
  id: 'ofac-12345',
  source: 'Specially Designated Nationals (SDN) - Treasury Department',
  type: 'Individual',
  name: 'PETROV, Ivan Sergeyevich',
  alt_names: ['PETROW, Ivan'],
  programs: ['UKRAINE-EO13662'],
  addresses: [{ country: 'RU' }],
  dates_of_birth: ['1985'],
  nationalities: ['Russia'],
  remarks: 'DOB approximate',
};

describe('normalizeOfacRow', () => {
  it('maps a CSL result to a NormalizedCandidate', () => {
    const c = normalizeOfacRow(ROW);
    expect(c.sourceKey).toBe('ofac-csl');
    expect(c.externalId).toBe('ofac-12345');
    expect(c.displayName).toBe('PETROV, Ivan Sergeyevich');
    expect(c.listType).toContain('SDN');
    expect(c.summary).toContain('UKRAINE-EO13662');
    expect(c.country).toBe('RU');
  });
});

describe('rowToCandidate', () => {
  it('tolerates malformed JSON columns without throwing', () => {
    const c = rowToCandidate({ uid: 'u1', name: 'DOE, John', source_list: 'SDN', programs: '{bad', nationalities: 'nope', addresses: null, raw_json: '' });
    expect(c.externalId).toBe('u1');
    expect(c.nationalities).toEqual([]);
    expect(c.displayName).toBe('DOE, John');
  });
  it('derives country from addresses when present', () => {
    const c = rowToCandidate({ uid: 'u2', name: 'X', addresses: JSON.stringify([{ country: 'IR' }]), nationalities: JSON.stringify(['Iran']) });
    expect(c.country).toBe('IR');
  });
});

describe('appendCautionFlag', () => {
  it('appends the first flag', () => {
    expect(appendCautionFlag('', 'OFAC SANCTIONS: SDN (a)')).toBe('OFAC SANCTIONS: SDN (a)');
  });
  it('returns null (no change) when the exact flag already present', () => {
    expect(appendCautionFlag('OFAC SANCTIONS: SDN (a)', 'OFAC SANCTIONS: SDN (a)')).toBeNull();
  });
  it('appends a distinct second sanction flag', () => {
    expect(appendCautionFlag('OFAC SANCTIONS: SDN (a)', 'OFAC SANCTIONS: SDN (b)')).toBe('OFAC SANCTIONS: SDN (a); OFAC SANCTIONS: SDN (b)');
  });
});
