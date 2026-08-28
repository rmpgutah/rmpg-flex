import { describe, it, expect } from 'vitest';
import { identityMatch } from '../src/utils/warrantSources/identityMatch';
import type { RawWarrantHit, PersonRow } from '../src/utils/warrantSources/types';

const person = (o: Partial<PersonRow> = {}): PersonRow => ({
  id: 1, first_name: 'John', middle_name: null, last_name: 'Smith', dob: '1990-01-01', ...o,
});
const hit = (o: Partial<RawWarrantHit> = {}): RawWarrantHit => ({
  source_key: 's1', warrant_id: 'W1', ...o,
});

function trueAge(dob: string): number {
  const born = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const m = now.getMonth() - born.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < born.getDate())) age--;
  return age;
}

describe('identityMatch — name gate', () => {
  it('full first+last match, dob match => true', () => {
    expect(identityMatch(hit({ first_name: 'John', last_name: 'Smith', date_of_birth: '1990-01-01' }), person())).toBe(true);
  });

  it('partial match (last exact + first initial), dob match => true', () => {
    expect(identityMatch(hit({ first_name: 'Jon', last_name: 'Smith', date_of_birth: '1990-01-01' }), person())).toBe(true);
  });

  it('last name mismatch => false, even with matching dob', () => {
    expect(identityMatch(hit({ first_name: 'John', last_name: 'Jones', date_of_birth: '1990-01-01' }), person())).toBe(false);
  });

  it('first initial mismatch (not full, not partial) => false', () => {
    expect(identityMatch(hit({ first_name: 'Robert', last_name: 'Smith', date_of_birth: '1990-01-01' }), person())).toBe(false);
  });

  it('falls back to full_name when discrete first/last are blank', () => {
    expect(identityMatch(hit({ full_name: 'John Smith', date_of_birth: '1990-01-01' }), person())).toBe(true);
  });

  it('full_name fallback still enforces the partial-match rule', () => {
    expect(identityMatch(hit({ full_name: 'Jon Smith', date_of_birth: '1990-01-01' }), person())).toBe(true);
    expect(identityMatch(hit({ full_name: 'Robert Smith', date_of_birth: '1990-01-01' }), person())).toBe(false);
  });

  it('hit with no name info at all (blank first/last/full_name) => false', () => {
    expect(identityMatch(hit({ date_of_birth: '1990-01-01' }), person())).toBe(false);
  });

  it('name matching is case-insensitive and whitespace-tolerant', () => {
    expect(identityMatch(hit({ first_name: '  john  ', last_name: 'SMITH', date_of_birth: '1990-01-01' }), person())).toBe(true);
  });
});

describe('identityMatch — dob/age gate', () => {
  it('exact dob match on both sides => true (with matching name)', () => {
    expect(identityMatch(hit({ first_name: 'John', last_name: 'Smith', date_of_birth: '1990-01-01' }), person({ dob: '1990-01-01' }))).toBe(true);
  });

  it('dob mismatch on both sides => false', () => {
    expect(identityMatch(hit({ first_name: 'John', last_name: 'Smith', date_of_birth: '1985-06-15' }), person({ dob: '1990-01-01' }))).toBe(false);
  });

  it('person has dob, hit has age within tolerance => true', () => {
    expect(identityMatch(hit({ first_name: 'John', last_name: 'Smith', age: trueAge('1990-01-01') }), person({ dob: '1990-01-01' }))).toBe(true);
  });

  it('person has dob, hit age off by exactly 1 => true (boundary)', () => {
    expect(identityMatch(hit({ first_name: 'John', last_name: 'Smith', age: trueAge('1990-01-01') + 1 }), person({ dob: '1990-01-01' }))).toBe(true);
  });

  it('person has dob, hit age off by more than 1 => false', () => {
    expect(identityMatch(hit({ first_name: 'John', last_name: 'Smith', age: trueAge('1990-01-01') + 5 }), person({ dob: '1990-01-01' }))).toBe(false);
  });

  it('neither side has any dob or age => false (reject, no positive evidence)', () => {
    expect(identityMatch(hit({ first_name: 'John', last_name: 'Smith' }), person({ dob: '' }))).toBe(false);
  });

  it('person has no dob but hit has an age => age-only comparison is impossible (no person age to compare), so false', () => {
    expect(identityMatch(hit({ first_name: 'John', last_name: 'Smith', age: 35 }), person({ dob: '' }))).toBe(false);
  });

  it('person has a dob but the hit carries no dob/age at all => false (no positive evidence on the hit)', () => {
    expect(identityMatch(hit({ first_name: 'John', last_name: 'Smith' }), person({ dob: '1990-01-01' }))).toBe(false);
  });

  it('US MM/DD/YYYY dob matches ISO YYYY-MM-DD', () => {
    expect(identityMatch(
      hit({ first_name: 'John', last_name: 'Smith', date_of_birth: '10/11/2001' }),
      person({ dob: '2001-10-11' }),
    )).toBe(true);
  });
});
