import { describe, it, expect, vi } from 'vitest';
import { parseDarArray, darCounts, darSectionRows } from './darPdf';
import type { DailyActivityReport } from '../types';

// `save` is assigned as an own instance property inside jsPDF's constructor
// (not on the prototype), so vi.spyOn(jsPDF.prototype, 'save') cannot see it.
// Wrap the constructor instead so every instance's `save` is a spy — this
// lets the wrapper test assert generateDarPdf still triggers a save without
// vitest actually writing a file.
const saveSpy = vi.fn();
vi.mock('jspdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jspdf')>();
  class PatchedJsPDF extends actual.jsPDF {
    constructor(...args: ConstructorParameters<typeof actual.jsPDF>) {
      super(...args);
      this.save = ((filename?: string) => {
        saveSpy(filename);
        return this;
      }) as typeof this.save;
    }
  }
  return { ...actual, default: PatchedJsPDF, jsPDF: PatchedJsPDF };
});

import { generateDarPdf, buildDarPdf } from './darPdf';

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

  it('generateDarPdf still returns void and triggers a save (builder-extraction wrapper is behaviour-preserving)', () => {
    saveSpy.mockClear();
    const r = {
      id: 701,
      dar_number: 'DAR-2026-0044',
      status: 'submitted',
      officer_id: 42,
      shift_date: '2026-06-21',
      calls_handled: '[]',
      incidents_created: '[]',
      citations_issued: '[]',
      patrols_completed: '[]',
      created_at: '2026-06-21T18:05:00Z',
      updated_at: '2026-06-21T18:05:00Z',
    } as DailyActivityReport;

    const result = generateDarPdf(r);

    expect(result).toBeUndefined();
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledWith('DAR_DAR-2026-0044.pdf');
  });

  it('buildDarPdf returns the jsPDF document without saving', () => {
    saveSpy.mockClear();
    const r = {
      id: 701,
      dar_number: 'DAR-2026-0044',
      status: 'submitted',
      officer_id: 42,
      shift_date: '2026-06-21',
      calls_handled: '[]',
      incidents_created: '[]',
      citations_issued: '[]',
      patrols_completed: '[]',
      created_at: '2026-06-21T18:05:00Z',
      updated_at: '2026-06-21T18:05:00Z',
    } as DailyActivityReport;

    const doc = buildDarPdf(r);

    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    expect(saveSpy).not.toHaveBeenCalled();
  });
});
