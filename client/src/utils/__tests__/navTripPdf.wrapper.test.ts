import { describe, it, expect, vi } from 'vitest';
import type { NavTrip } from '../../types';

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

import {
  generateNavTripReport, buildNavTripReportPdf,
  generateNavSingleTripReport, buildNavSingleTripReportPdf,
} from '../navTripPdf';

function baseTrip(): NavTrip {
  return {
    id: 501,
    officer_id: 42,
    start_lat: 40.7128,
    start_lng: -111.8996,
    start_time: '2026-06-21T09:00:00Z',
    status: 'completed',
    detected_by: 'auto',
    created_at: '2026-06-21T09:00:00Z',
    updated_at: '2026-06-21T09:20:00Z',
  };
}

describe('navTripPdf wrappers (builder-extraction)', () => {
  it('generateNavTripReport still returns void and triggers a save', () => {
    saveSpy.mockClear();
    const result = generateNavTripReport({ trips: [baseTrip()], officerName: 'Marcus Reyes' });
    expect(result).toBeUndefined();
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy.mock.calls[0][0]).toMatch(/^nav-trip-report-marcus-reyes-\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it('buildNavTripReportPdf returns the jsPDF document without saving', () => {
    saveSpy.mockClear();
    const doc = buildNavTripReportPdf({ trips: [baseTrip()] });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('generateNavSingleTripReport still returns void and triggers a save', () => {
    saveSpy.mockClear();
    const trip = { ...baseTrip(), end_lat: 40.72, end_lng: -111.9, end_time: '2026-06-21T09:20:00Z' };
    const result = generateNavSingleTripReport({ trip, officerName: 'Marcus Reyes' });
    expect(result).toBeUndefined();
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy.mock.calls[0][0]).toBe(`nav-trip-marcus-reyes-2026-06-21-${trip.id}.pdf`);
  });

  it('buildNavSingleTripReportPdf returns the jsPDF document without saving', () => {
    saveSpy.mockClear();
    const trip = { ...baseTrip(), end_lat: 40.72, end_lng: -111.9, end_time: '2026-06-21T09:20:00Z' };
    const doc = buildNavSingleTripReportPdf({ trip });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    expect(saveSpy).not.toHaveBeenCalled();
  });
});
