import { describe, it, expect, vi } from 'vitest';
import type { PatrolTrackingReportData } from '../patrolTrackingPdfGenerator';

// `save` is assigned as an own instance property inside jsPDF's constructor
// (not on the prototype), so vi.spyOn(jsPDF.prototype, 'save') cannot see it.
// Wrap the constructor instead so every instance's `save` is a spy — see
// darPdf.test.ts for the original precedent of this technique.
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

import { generatePatrolTrackingPdf, buildPatrolTrackingPdf } from '../patrolTrackingPdfGenerator';

function baseData(): PatrolTrackingReportData {
  return {
    trails: [
      {
        unit_id: 1,
        call_sign: '4-Adam-12',
        officer_name: 'Marcus Reyes',
        badge_number: '4417',
        points: [],
        stats: {
          total_points: 0, stationary_points: 0, moving_points: 0,
          total_distance_miles: 0, max_speed_mph: 0, avg_speed_mph: 0, duration_minutes: 0,
        },
        response_segments: [],
      },
    ],
    query: { startDate: '2026-06-21T00:00:00Z', endDate: '2026-06-21T23:59:00Z', hours: 24 },
    total_units: 1,
    total_points: 0,
  };
}

describe('patrolTrackingPdfGenerator wrapper (builder-extraction)', () => {
  it('generatePatrolTrackingPdf still returns void and triggers a save', async () => {
    saveSpy.mockClear();
    const result = await generatePatrolTrackingPdf(baseData());
    expect(result).toBeUndefined();
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy.mock.calls[0][0]).toMatch(/^RMPG_Patrol_Tracking_4-Adam-12_\d{8}\.pdf$/);
  });

  it('buildPatrolTrackingPdf returns the jsPDF document without saving', async () => {
    saveSpy.mockClear();
    const doc = await buildPatrolTrackingPdf(baseData());
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    expect(saveSpy).not.toHaveBeenCalled();
  });
});
