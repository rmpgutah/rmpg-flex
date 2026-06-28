import { describe, it, expect } from 'vitest';
import { sortGridRows } from '../gridSort';

const rows = [
  { id: 'a', p: 3, nature: 'Theft' },
  { id: 'b', p: 1, nature: 'Fire' },
  { id: 'c', p: 2, nature: 'Accident' },
  { id: 'd', p: 1, nature: 'Assault' },
];

describe('sortGridRows', () => {
  it('sorts numbers ascending by default', () => {
    expect(sortGridRows(rows, 'p').map((r) => r.id)).toEqual(['b', 'd', 'c', 'a']);
  });
  it('sorts numbers descending', () => {
    expect(sortGridRows(rows, 'p', 'desc').map((r) => r.id)).toEqual(['a', 'c', 'b', 'd']);
  });
  it('sorts strings naturally', () => {
    expect(sortGridRows(rows, 'nature').map((r) => r.nature))
      .toEqual(['Accident', 'Assault', 'Fire', 'Theft']);
  });
  it('keeps equal-key rows in original order (stable)', () => {
    expect(sortGridRows(rows, 'p').filter((r) => r.p === 1).map((r) => r.id)).toEqual(['b', 'd']);
  });
  it('puts null/undefined keys last and does not mutate input', () => {
    const withGaps = [{ id: '1', t: 5 }, { id: '2', t: null }, { id: '3', t: 2 }];
    const out = sortGridRows(withGaps, 't');
    expect(out.map((r) => r.id)).toEqual(['3', '1', '2']);
    expect(withGaps.map((r) => r.id)).toEqual(['1', '2', '3']);
  });
});
