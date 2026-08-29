import { describe, it, expect } from 'vitest';
import { extractAliases } from '../../src/utils/enrichment/ofacSync';

describe('OFAC alias extraction', () => {
  it('pulls a.k.a. names from remarks', () => {
    const remarks = "DOB 01 Jan 1970; a.k.a. 'IVANOV, Ivan'; a.k.a. JOHN SMITH; nationality Russia";
    expect(extractAliases(remarks)).toEqual(['IVANOV, Ivan', 'JOHN SMITH']);
  });

  it('returns empty when remarks have no aliases', () => {
    expect(extractAliases('DOB 1970; nationality Cuba')).toEqual([]);
  });
});
