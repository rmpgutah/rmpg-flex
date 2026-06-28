import { describe, it, expect } from 'vitest';
import { parseDarArray, darCounts, darSectionRows } from './darPdf';
import type { DailyActivityReport } from '../types';

describe('darPdf helpers', () => {
  it('parseDarArray is tolerant', () => {
    expect(parseDarArray('[{"a":1},{"a":2}]')).toHaveLength(2);
    expect(parseDarArray('')).toEqual([]);
    expect(parseDarArray(undefined)).toEqual([]);
    expect(parseDarArray('not json')).toEqual([]);
    expect(parseDarArray('{"not":"array"}')).toEqual([]);
  });

  it('darCounts counts each JSON section', () => {
    const r = {
      calls_handled: '[{},{},{}]',
      incidents_created: '[{}]',
      citations_issued: '[]',
      patrols_completed: '[{},{}]',
    } as DailyActivityReport;
    expect(darCounts(r)).toEqual({ calls: 3, incidents: 1, citations: 0, patrols: 2 });
  });

  it('darSectionRows maps fields with fallbacks', () => {
    const calls = darSectionRows(
      [{ call_number: 'C-1', incident_type: 'Welfare', created_at: '2026-06-13' }], 'calls');
    expect(calls[0]).toEqual(['C-1', 'Welfare', '2026-06-13']);

    const cites = darSectionRows(
      [{ citation_number: 'CIT-9', charge: 'Speeding', violation_date: '2026-06-13' }], 'citations');
    expect(cites[0]).toEqual(['CIT-9', 'Speeding', '2026-06-13']);

    const patrols = darSectionRows([{ location: 'Gate 4', status: 'ok' }], 'patrols');
    expect(patrols[0][0]).toBe('Gate 4');
    expect(patrols[0][1]).toBe('ok');
  });

  it('darSectionRows yields empty strings for missing fields, never throws', () => {
    const rows = darSectionRows([{}], 'incidents');
    expect(rows[0]).toEqual(['', '', '']);
  });
});
