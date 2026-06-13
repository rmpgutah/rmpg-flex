import { describe, it, expect } from 'vitest';
import { normalizeInterpolNotice, interpolSubjectNames } from '../src/utils/screening/interpolAdapter';

const RED = {
  entity_id: '2021/12345',
  forename: 'IVAN', name: 'PETROV',
  date_of_birth: '1985/04/12',
  nationalities: ['RU'], sex_id: 'M',
  _links: { thumbnail: { href: 'https://ws-public.interpol.int/.../thumbnail' } },
};

describe('normalizeInterpolNotice', () => {
  it('maps a HAL notice to a NormalizedCandidate', () => {
    const c = normalizeInterpolNotice(RED, 'red');
    expect(c.sourceKey).toBe('interpol-red');
    expect(c.externalId).toBe('2021/12345');
    expect(c.displayName).toBe('IVAN PETROV');
    expect(c.listType).toBe('red');
    expect(c.nationalities).toEqual(['RU']);
    expect(c.photoUrl).toContain('thumbnail');
    expect(c.dob).toBe('1985/04/12');
  });
  it('tolerates missing optional fields', () => {
    const c = normalizeInterpolNotice({ entity_id: 'x/1' }, 'yellow');
    expect(c.externalId).toBe('x/1');
    expect(c.sourceKey).toBe('interpol-yellow');
    expect(c.nationalities).toEqual([]);
  });
});

describe('interpolSubjectNames', () => {
  it('uses structured raw_json forename/name (multi-word forename keeps surname intact)', () => {
    const raw = JSON.stringify({ forename: 'JEAN MARIE', name: 'DUPONT' });
    expect(interpolSubjectNames(raw, 'JEAN MARIE DUPONT')).toEqual({ first: 'JEAN MARIE', last: 'DUPONT' });
  });
  it('falls back to display_name split when raw_json is null', () => {
    expect(interpolSubjectNames(null, 'Ivan Petrov')).toEqual({ first: 'Ivan', last: 'Petrov' });
  });
  it('handles a single-token display name', () => {
    expect(interpolSubjectNames(null, 'UNKNOWN')).toEqual({ first: 'UNKNOWN', last: 'UNKNOWN' });
  });
  it('falls back gracefully on malformed raw_json', () => {
    expect(interpolSubjectNames('{not json', 'Ivan Petrov')).toEqual({ first: 'Ivan', last: 'Petrov' });
  });
});
