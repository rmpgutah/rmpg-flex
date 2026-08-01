import { describe, it, expect, vi } from 'vitest';
import type { MapSituationReportData } from '../mapSituationReportPdf';

const saveSpy = vi.fn();
vi.mock('jspdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jspdf')>();
  class PatchedJsPDF extends actual.jsPDF {
    constructor(...args: ConstructorParameters<typeof actual.jsPDF>) {
      super(...args);
      this.save = ((filename?: string) => {
        saveSpy(filename);
        return this;
      }) as unknown as typeof this.save;
    }
  }
  return { ...actual, default: PatchedJsPDF, jsPDF: PatchedJsPDF };
});

import { generateMapSituationReport, buildMapSituationReportPdf } from '../mapSituationReportPdf';

function baseData(): MapSituationReportData {
  return {
    mapImageDataUrl: null,
    mapAspect: 1.6,
    operator: 'Marcus Reyes',
    center: { lat: 40.7128, lng: -111.8996 },
    zoom: 12,
    calls: [],
    units: [],
  };
}

describe('mapSituationReportPdf wrapper (builder-extraction)', () => {
  it('generateMapSituationReport still returns void and triggers a save', async () => {
    saveSpy.mockClear();
    const result = await generateMapSituationReport(baseData());
    expect(result).toBeUndefined();
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy.mock.calls[0][0]).toMatch(/^RMPG_Situation_Report_\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it('buildMapSituationReportPdf returns the jsPDF document without saving', async () => {
    saveSpy.mockClear();
    const doc = await buildMapSituationReportPdf(baseData());
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    expect(saveSpy).not.toHaveBeenCalled();
  });
});
