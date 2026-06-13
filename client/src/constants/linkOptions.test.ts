import { describe, it, expect } from 'vitest';
import { DEFAULT_LINK_OPTIONS, mergeLinkOptions, type LinkOption } from './linkOptions';

describe('mergeLinkOptions', () => {
  it('returns defaults unchanged when no DB rows', () => {
    const merged = mergeLinkOptions('person_role', []);
    expect(merged).toEqual(DEFAULT_LINK_OPTIONS.person_role);
  });

  it('overrides a default label and re-sorts by sort_order', () => {
    const db: LinkOption[] = [{ value: 'suspect', label: 'Primary Suspect', sort_order: 5, is_active: 1 }];
    const merged = mergeLinkOptions('person_role', db);
    const suspect = merged.find((o) => o.value === 'suspect');
    expect(suspect?.label).toBe('Primary Suspect');
    expect(merged[0].value).toBe('suspect'); // sort_order 5 floats to top
  });

  it('appends a custom DB-only value', () => {
    const db: LinkOption[] = [{ value: 'co_signer', label: 'Co-Signer', sort_order: 999, is_active: 1 }];
    const merged = mergeLinkOptions('person_role', db);
    expect(merged.some((o) => o.value === 'co_signer')).toBe(true);
  });

  it('hides a default when DB marks it inactive', () => {
    const db: LinkOption[] = [{ value: 'other', label: 'Other', sort_order: 170, is_active: 0 }];
    const merged = mergeLinkOptions('person_role', db);
    expect(merged.some((o) => o.value === 'other')).toBe(false);
  });
});
