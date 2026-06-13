import { describe, it, expect } from 'vitest';
import { normalizeOfacRow } from '../src/utils/screening/ofacAdapter';

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
