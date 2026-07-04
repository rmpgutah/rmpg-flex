import { describe, it, expect } from 'vitest';
import { callMatchesSearch, deriveCallWarnings } from '../dispatchFormatters';

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

describe('deriveCallWarnings', () => {
  it('returns no warnings for a clean call', () => {
    expect(deriveCallWarnings(baseCall)).toEqual([]);
  });

  it('flags weapons_involved as ARMED/critical, excluding "none"-ish values', () => {
    expect(deriveCallWarnings({ ...baseCall, weapons_involved: 'handgun' }))
      .toEqual([{ type: 'ARMED', label: 'ARMED / WEAPONS', severity: 'critical', source: 'call' }]);
    for (const noneValue of ['', '0', 'none', 'None']) {
      expect(deriveCallWarnings({ ...baseCall, weapons_involved: noneValue })).toEqual([]);
    }
  });

  it('flags domestic_violence as DV/high and injuries_reported as INJURIES/high', () => {
    expect(deriveCallWarnings({ ...baseCall, domestic_violence: true }))
      .toEqual([{ type: 'DV', label: 'DOMESTIC VIOLENCE', severity: 'high', source: 'call' }]);
    expect(deriveCallWarnings({ ...baseCall, injuries_reported: true }))
      .toEqual([{ type: 'INJURIES', label: 'INJURIES REPORTED', severity: 'high', source: 'call' }]);
  });

  it('combines multiple flags on the same call', () => {
    const hot = { ...baseCall, weapons_involved: 'rifle', domestic_violence: true, injuries_reported: true };
    expect(deriveCallWarnings(hot).map((w) => w.type)).toEqual(['ARMED', 'DV', 'INJURIES']);
  });

  it('tolerates missing optional fields without throwing', () => {
    const sparse = { id: 'c3', call_number: '2026-000453', incident_type: 'alarm' } as any;
    expect(() => deriveCallWarnings(sparse)).not.toThrow();
    expect(deriveCallWarnings(sparse)).toEqual([]);
  });
});
