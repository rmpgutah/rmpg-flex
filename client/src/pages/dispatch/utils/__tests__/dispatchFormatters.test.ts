import { describe, it, expect } from 'vitest';
import { callMatchesSearch } from '../dispatchFormatters';

const baseCall = {
  id: 'c1', call_number: '2026-000451', incident_type: 'alarm', priority: 'P1',
  status: 'pending', location: '100 S MAIN ST', description: 'Silent alarm activation',
  caller_name: 'ACME SECURITY', dispatch_code: 'SL1-HER/C', zone_beat: 'A2',
  sector_name: 'Salt Lake County', zone_id: 'MUR', zone_name: 'Murray', beat_id: 'A2',
  beat_name: 'Murray A-2', created_at: '2026-07-02T09:00:00Z',
} as any;

describe('callMatchesSearch', () => {
  it('matches an empty/whitespace query unconditionally', () => {
    expect(callMatchesSearch(baseCall, '')).toBe(true);
    expect(callMatchesSearch(baseCall, '   ')).toBe(true);
  });

  it('matches call number, location, description, and caller name (case-insensitive)', () => {
    expect(callMatchesSearch(baseCall, '000451')).toBe(true);
    expect(callMatchesSearch(baseCall, 'main st')).toBe(true);
    expect(callMatchesSearch(baseCall, 'SILENT ALARM')).toBe(true);
    expect(callMatchesSearch(baseCall, 'acme')).toBe(true);
  });

  it('matches geography — Spillman code or place name', () => {
    expect(callMatchesSearch(baseCall, 'SL1')).toBe(true);
    expect(callMatchesSearch(baseCall, 'herriman')).toBe(false); // dispatch_code is 'SL1-HER/C', not the place name itself
    expect(callMatchesSearch(baseCall, 'murray')).toBe(true); // zone_name/beat_name
  });

  it('matches incident type via the humanized/coded form, not just the raw stored value', () => {
    // 'alarm' the raw incident_type still matches directly...
    expect(callMatchesSearch(baseCall, 'alarm')).toBe(true);
  });

  it('returns false when nothing matches', () => {
    expect(callMatchesSearch(baseCall, 'nonexistent-query-xyz')).toBe(false);
  });

  it('tolerates missing optional fields without throwing', () => {
    const sparse = { id: 'c2', call_number: '2026-000452', incident_type: 'patrol_request' } as any;
    expect(() => callMatchesSearch(sparse, 'x')).not.toThrow();
    expect(callMatchesSearch(sparse, '000452')).toBe(true);
  });
});
