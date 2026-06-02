import { describe, it, expect } from 'vitest';
import { reconcileHits } from '../../src/utils/warrantSources/reconcile';
import type { RawWarrantHit, PersonRow } from '../../src/utils/warrantSources/types';

const dobPerson: PersonRow = { id: 7, first_name: 'John', middle_name: null, last_name: 'Smith', dob: '1990-01-01' };
const noDobPerson: PersonRow = { id: 8, first_name: 'John', middle_name: null, last_name: 'Smith', dob: '' };
const hit = (o: Partial<RawWarrantHit>): RawWarrantHit => ({ source_key: 's1', warrant_id: 'W1', ...o });

// Compute the person's true age from DOB + the real current date so the
// "corroborates" assertions stay honest regardless of the run year.
function trueAge(dob: string): number {
  const born = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const m = now.getMonth() - born.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < born.getDate())) age--;
  return age;
}

describe('reconcileHits', () => {
  it('merges the same warrant_id reported by two sources into one hit with two sources', () => {
    const out = reconcileHits([hit({ source_key: 'ada-county-id', warrant_id: 'W1' }), hit({ source_key: 'natrona-county-wy', warrant_id: 'W1' })], dobPerson);
    expect(out).toHaveLength(1);
    expect(out[0].sources.sort()).toEqual(['ada-county-id', 'natrona-county-wy']);
  });

  it('DOB-less person => every hit unverified', () => {
    const out = reconcileHits([hit({ warrant_id: 'W1', age: 33 })], noDobPerson);
    expect(out[0].confidence).toBe('unverified');
  });

  it('DOB person whose age corroborates => confirmed', () => {
    const out = reconcileHits([hit({ warrant_id: 'W1', age: trueAge('1990-01-01') })], dobPerson);
    expect(out[0].confidence).toBe('confirmed');
  });

  it('DOB person whose hit age is off by >1 => unverified', () => {
    const out = reconcileHits([hit({ warrant_id: 'W1', age: 50 })], dobPerson);
    expect(out[0].confidence).toBe('unverified');
  });

  it('dedups on case_number when no warrant_id', () => {
    const a = hit({ source_key: 's1', warrant_id: '', case_number: 'C9' });
    const b = hit({ source_key: 's2', warrant_id: '', case_number: 'C9' });
    const out = reconcileHits([a, b], dobPerson);
    expect(out).toHaveLength(1);
    expect(out[0].sources.length).toBe(2);
  });

  it('merge fills gaps from a richer source', () => {
    const sparse = hit({ warrant_id: 'W1', charge_description: null });
    const rich = hit({ warrant_id: 'W1', source_key: 's2', charge_description: 'BATTERY', court_name: 'X' });
    const out = reconcileHits([sparse, rich], dobPerson);
    expect(out[0].charge_description).toBe('BATTERY');
    expect(out[0].court_name).toBe('X');
  });

  it('sets person_id on every hit', () => {
    const out = reconcileHits([hit({})], dobPerson);
    expect(out[0].person_id).toBe(7);
  });

  // --- additional valuable cases ---

  it('DOB person but hit has NO age => still confirmed (absence is not disconfirming)', () => {
    const out = reconcileHits([hit({ warrant_id: 'W1', age: null })], dobPerson);
    expect(out[0].confidence).toBe('confirmed');
  });

  it('age off by exactly 1 is within tolerance => confirmed', () => {
    const out = reconcileHits([hit({ warrant_id: 'W1', age: trueAge('1990-01-01') + 1 })], dobPerson);
    expect(out[0].confidence).toBe('confirmed');
  });

  it('falls back to last_name|court_name|issue_date composite when no ids', () => {
    const a = hit({ source_key: 's1', warrant_id: '', case_number: '', last_name: 'Smith', court_name: 'Ada District', issue_date: '2025-03-01' });
    const b = hit({ source_key: 's2', warrant_id: '', case_number: '', last_name: 'SMITH', court_name: 'ADA DISTRICT', issue_date: '2025-03-01' });
    const out = reconcileHits([a, b], dobPerson);
    expect(out).toHaveLength(1);
    expect(out[0].sources.sort()).toEqual(['s1', 's2']);
  });

  it('distinct warrants are kept separate', () => {
    const out = reconcileHits([hit({ warrant_id: 'W1' }), hit({ warrant_id: 'W2', source_key: 's2' })], dobPerson);
    expect(out).toHaveLength(2);
  });

  it('sources are deduped and ordered first-seen', () => {
    const out = reconcileHits([
      hit({ source_key: 's2', warrant_id: 'W1' }),
      hit({ source_key: 's1', warrant_id: 'W1' }),
      hit({ source_key: 's2', warrant_id: 'W1' }),
    ], dobPerson);
    expect(out[0].sources).toEqual(['s2', 's1']);
  });

  it('empty input => empty output', () => {
    expect(reconcileHits([], dobPerson)).toEqual([]);
  });
});
