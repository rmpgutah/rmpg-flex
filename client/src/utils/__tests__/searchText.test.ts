// client/src/utils/__tests__/searchText.test.ts
import { describe, it, expect } from 'vitest';
import { coded, matchesQuery, humanizeField, codedByKey } from '../searchText';
import { humanizeType, humanizePriority } from '../statusLabels';

describe('coded', () => {
  it('includes raw and humanized forms, lowercased', () => {
    const h = coded('traffic_stop', humanizeType);
    expect(h).toContain('traffic_stop');
    expect(h).toContain('traffic stop');
    expect(h).toBe(h.toLowerCase());
  });
  it('expands a coded priority', () => {
    // humanizePriority('P1') → 'P1 — Emergency', so haystack is 'p1 p1 — emergency'
    expect(coded('P1', humanizePriority)).toContain('emergency');
    expect(coded('P1', humanizePriority)).toContain('p1');
  });
  it('is null/empty safe', () => {
    expect(coded(null)).toBe('');
    expect(coded(undefined)).toBe('');
    expect(coded('')).toBe('');
  });
  it('does not double when humanizer returns the raw value unchanged', () => {
    const h = coded('weird_unknown_code', (v) => String(v));
    expect(h).toBe('weird_unknown_code');
  });
  it('works with no humanizer (raw only, lowercased)', () => {
    expect(coded('SomeValue')).toBe('somevalue');
  });
});

describe('matchesQuery', () => {
  it('requires every whitespace-separated term to appear (new-site convenience)', () => {
    expect(matchesQuery('traffic stop', coded('traffic_stop', humanizeType))).toBe(true);
    expect(matchesQuery('stop bogus', coded('traffic_stop', humanizeType))).toBe(false);
  });
  it('empty query matches everything', () => {
    expect(matchesQuery('', 'anything')).toBe(true);
  });
  it('skips null/empty parts', () => {
    expect(matchesQuery('john', 'John Smith', null, undefined, '')).toBe(true);
  });
});

describe('humanizeField / codedByKey', () => {
  it('dispatches known keys to the right humanizer', () => {
    expect(humanizeField('incident_type', 'traffic_stop').toLowerCase()).toBe('traffic stop');
    // humanizePriority('P1') → 'P1 — Emergency'; lowercased contains 'emergency'
    expect(humanizeField('priority', 'P1').toLowerCase()).toContain('emergency');
  });
  it('falls back to generic Title-Case for unknown keys', () => {
    // formatEnumValue('foo_bar') → 'FOO BAR'; lowercased → 'foo bar'
    expect(humanizeField('some_other_key', 'foo_bar').toLowerCase()).toBe('foo bar');
  });
  it('codedByKey produces raw + humanized', () => {
    const h = codedByKey('incident_type', 'traffic_stop');
    expect(h).toContain('traffic_stop');
    expect(h).toContain('traffic stop');
  });
});
