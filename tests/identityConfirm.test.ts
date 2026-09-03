import { describe, it, expect } from 'vitest';
import {
  confirmIdentity, identityConfirmed, nameMatches, dobOrAgeConfirms, parsePersonName, ageFromDob,
} from '../src/utils/identityConfirm';

describe('identityConfirm', () => {
  it('links John Doe born 10/11/2001 and rejects a namesake of a different age', () => {
    const seed = { first: 'John', last: 'Doe', dob: '10/11/2001', age: 24, city: 'Salt Lake City', state: 'UT' };
    const match = { first: 'John', last: 'Doe', dob: '2001-10-11', age: 24, city: 'Salt Lake City', state: 'Utah' };
    const namesake = { first: 'John', last: 'Doe', dob: '1980-01-01', age: 46, city: 'Provo', state: 'UT' };
    expect(identityConfirmed(seed, match)).toBe(true);
    expect(identityConfirmed(seed, namesake)).toBe(false);
  });

  it('rejects name-only matches with no DOB/age on either side', () => {
    expect(identityConfirmed(
      { first: 'John', last: 'Doe' },
      { first: 'John', last: 'Doe' },
    )).toBe(false);
  });

  it('rejects when the person has a DOB but the hit carries none', () => {
    expect(identityConfirmed(
      { first: 'John', last: 'Doe', dob: '2001-10-11' },
      { first: 'John', last: 'Doe' },
    )).toBe(false);
  });

  it('treats a city conflict as a hard reject even when age agrees', () => {
    expect(identityConfirmed(
      { first: 'John', last: 'Doe', dob: '2001-10-11', city: 'Salt Lake City' },
      { first: 'John', last: 'Doe', age: ageFromDob('2001-10-11'), city: 'Provo' },
    )).toBe(false);
  });

  it('accepts SLC as an alias of Salt Lake City', () => {
    expect(confirmIdentity(
      { first: 'John', last: 'Doe', dob: '2001-10-11', city: 'SLC', state: 'UT' },
      { first: 'John', last: 'Doe', dob: '2001-10-11', city: 'Salt Lake City', state: 'Utah' },
    ).place).toBe(true);
  });

  it('nameMatches requires last name and first initial', () => {
    expect(nameMatches({ first: 'Jon', last: 'Doe' }, { first: 'John', last: 'Doe' })).toBe(true);
    expect(nameMatches({ first: 'Robert', last: 'Doe' }, { first: 'John', last: 'Doe' })).toBe(false);
    expect(nameMatches({ first: 'John', last: 'Smith' }, { first: 'John', last: 'Doe' })).toBe(false);
  });

  it('dobOrAgeConfirms normalizes US and ISO dates', () => {
    expect(dobOrAgeConfirms({ dob: '10/11/2001' }, { dob: '2001-10-11' })).toBe(true);
    expect(dobOrAgeConfirms({ dob: '2001-10-11' }, { age: ageFromDob('2001-10-11') })).toBe(true);
  });

  it('parsePersonName splits first/last', () => {
    expect(parsePersonName('John Michael Doe')).toEqual({ first: 'JOHN', last: 'DOE' });
  });
});
