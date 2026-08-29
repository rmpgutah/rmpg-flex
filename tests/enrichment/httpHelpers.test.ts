import { describe, it, expect } from 'vitest';
import { splitPersonName } from '../../src/utils/enrichment/sources/http';

describe('splitPersonName', () => {
  it('keeps explicit first + last when last is a single token', () => {
    expect(splitPersonName('Karl', 'Turley')).toEqual({ first: 'Karl', last: 'Turley' });
  });

  it('uses first and last token for three-part names', () => {
    expect(splitPersonName('Karl Allen', 'Turley')).toEqual({ first: 'Karl', last: 'Turley' });
    expect(splitPersonName('Karl', 'Allen Turley')).toEqual({ first: 'Karl', last: 'Turley' });
    expect(splitPersonName('', '', 'Karl Allen Turley')).toEqual({ first: 'Karl', last: 'Turley' });
  });

  it('handles single-token input', () => {
    expect(splitPersonName('Turley', '')).toEqual({ first: 'Turley', last: '' });
  });
});
