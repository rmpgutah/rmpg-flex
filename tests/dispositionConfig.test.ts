import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DISPOSITIONS,
  isDispositionRow,
  mergeDispositions,
  type DispositionConfigRow,
} from '../src/utils/dispositionConfig';

const legacyRow = (code: string, description: string): DispositionConfigRow => ({
  config_key: `disposition.${code}`,
  config_value: JSON.stringify({ code, description, color: '#123456' }),
  category: 'dispositions',
});

// What AdminSystemTab.tsx:733 actually writes: a constant config_key, with the
// meaning carried by `category`.
const adminTabRow = (code: string, description: string): DispositionConfigRow => ({
  config_key: 'disposition_code',
  config_value: JSON.stringify({ code, description, color: '#abcdef' }),
  category: 'dispositions',
});

describe('isDispositionRow', () => {
  it('recognizes the legacy disposition.<code> key namespace', () => {
    expect(isDispositionRow(legacyRow('GOA', 'Gone on Arrival'))).toBe(true);
  });

  it('recognizes rows whose category is dispositions regardless of key', () => {
    expect(isDispositionRow(adminTabRow('TRESPASS', 'Trespass Warning Issued'))).toBe(true);
  });

  it('ignores unrelated config rows', () => {
    expect(isDispositionRow({ config_key: 'agency_ori', config_value: 'UT0190000', category: 'system_settings' })).toBe(false);
  });
});

describe('mergeDispositions', () => {
  it('surfaces a disposition created by the admin tab', () => {
    const merged = mergeDispositions([adminTabRow('PATROL CHECK', 'Patrol Check Completed')]);
    const found = merged.find((d) => d.code === 'PATROL CHECK');
    expect(found).toBeDefined();
    expect(found!.description).toBe('Patrol Check Completed');
    expect(found!.is_active).toBe(true);
  });

  it('includes the built-in roster so a fresh database is never empty', () => {
    const merged = mergeDispositions([]);
    expect(merged).toHaveLength(DEFAULT_DISPOSITIONS.length);
    expect(merged.map((d) => d.code)).toContain('Report Taken');
  });

  it('lets a custom row override a built-in of the same code without duplicating it', () => {
    const merged = mergeDispositions([adminTabRow('GOA', 'Gone on Arrival (custom wording)')]);
    const matches = merged.filter((d) => d.code === 'GOA');
    expect(matches).toHaveLength(1);
    expect(matches[0].description).toBe('Gone on Arrival (custom wording)');
  });

  it('does not double-list a code present in both key namespaces', () => {
    const merged = mergeDispositions([
      legacyRow('UTL', 'Unable to Locate (legacy)'),
      adminTabRow('UTL', 'Unable to Locate (admin tab)'),
    ]);
    const matches = merged.filter((d) => d.code === 'UTL');
    expect(matches).toHaveLength(1);
    // The legacy namespace is processed first and wins, so an old explicit
    // override is never silently replaced.
    expect(matches[0].description).toBe('Unable to Locate (legacy)');
  });

  it('skips malformed JSON instead of throwing', () => {
    const merged = mergeDispositions([
      { config_key: 'disposition_code', config_value: '{not json', category: 'dispositions' },
    ]);
    expect(merged).toHaveLength(DEFAULT_DISPOSITIONS.length);
  });

  it('honors an explicit is_active:false on a custom row', () => {
    const merged = mergeDispositions([{
      config_key: 'disposition_code',
      config_value: JSON.stringify({ code: 'RETIRED', description: 'Retired code', is_active: false }),
      category: 'dispositions',
    }]);
    expect(merged.find((d) => d.code === 'RETIRED')!.is_active).toBe(false);
  });
});
