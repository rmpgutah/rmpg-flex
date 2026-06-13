// client/src/utils/__tests__/searchText.test.ts
import { describe, it, expect } from 'vitest';
import { coded } from '../searchText';
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
