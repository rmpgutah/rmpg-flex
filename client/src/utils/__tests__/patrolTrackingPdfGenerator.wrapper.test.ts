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
      const self = this;
      // jsPDF#save is overloaded — sync, returning `jsPDF`, by default, or
      // `Promise<void>` when called with `{ returnPromise: true }`. Declared
      // with real overload signatures (same as the library's own type)
      // instead of casting past the mismatch, per darPdf.test.ts precedent.
      function patchedSave(filename?: string): PatchedJsPDF;
      function patchedSave(filename: string, options: { returnPromise: true }): Promise<void>;
      function patchedSave(
        filename?: string,
        options?: { returnPromise: true },
      ): PatchedJsPDF | Promise<void> {
        saveSpy(filename);
        return options?.returnPromise ? Promise.resolve() : self;
      }
      this.save = patchedSave;
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

/** One synthetic unit's trail — a few breadcrumb points so per-unit content
 *  (summary card + detail page) is genuinely present, not just a stub. */
function trailFor(callSign: string, officerName: string, badgeNumber: string, unitId: number): PatrolTrackingReportData['trails'][number] {
  return {
    unit_id: unitId,
    call_sign: callSign,
    officer_name: officerName,
    badge_number: badgeNumber,
    points: [
      {
        lat: 40.7291, lng: -111.8879, accuracy: 8, heading_cardinal: 'N', speed_mph: 22,
        status: 'dispatched', current_call_number: 'C-2026-004417', current_call_type: 'trespass',
        time: '2026-06-21T09:00:00Z', distance_from_prev_meters: 0, is_stationary: false,
        road_name: 'S State St', nearest_intersection: '1400 S', source: 'clearpathgps',
        beat_id: 'A1', beat_code: 'A1', zone: 'Riverton D2', cumulative_distance_miles: 0,
      },
      {
        lat: 40.7301, lng: -111.8889, accuracy: 8, heading_cardinal: 'NE', speed_mph: 30,
        status: 'available', current_call_number: null, current_call_type: null,
        time: '2026-06-21T09:05:00Z', distance_from_prev_meters: 300, is_stationary: false,
        road_name: 'S State St', nearest_intersection: '1400 S', source: 'clearpathgps',
        beat_id: 'A1', beat_code: 'A1', zone: 'Riverton D2', cumulative_distance_miles: 0.2,
      },
    ],
    stats: {
      total_points: 2, stationary_points: 0, moving_points: 2,
      total_distance_miles: 0.2, max_speed_mph: 30, avg_speed_mph: 26, duration_minutes: 5,
    },
    response_segments: [
      {
        call_number: 'C-2026-004417', incident_type: 'trespass', priority: 'P2',
        dispatched_at: '2026-06-21T09:00:00Z', onscene_at: '2026-06-21T09:05:00Z',
        time_to_onscene_seconds: 300, response_distance_miles: 0.2, breadcrumb_count: 2,
      },
    ],
  };
}

/** Three-unit patrol tracking report — plate/address/unit house style,
 *  US units (miles/mph). Regression fixture for the single-save fix: the
 *  original generator's per-trail loop wrapped save()/finalize/page-numbers,
 *  so a 3-unit report fired 3 separate downloads from one click. */
function threeTrailData(): PatrolTrackingReportData {
  return {
    trails: [
      trailFor('4-Adam-12', 'Marcus Reyes', '4417', 1),
      trailFor('4-Baker-7', 'Dana Whitlock', '4418', 2),
      trailFor('4-Charlie-3', 'Alex Kim', '4419', 3),
    ],
    query: { startDate: '2026-06-21T00:00:00Z', endDate: '2026-06-21T23:59:00Z', hours: 24 },
    total_units: 3,
    total_points: 6,
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

  // Regression coverage for the single-save fix (operator-approved behaviour
  // change, see the BEHAVIOUR CHANGE section of the batch report). Before the
  // builder-extraction refactor, page-numbering/finalize/save all lived
  // inside the per-trail `for` loop, so an N-unit report called `doc.save()`
  // N times from one click. This test would have failed against that code
  // (it asserts exactly ONE save for a 3-unit report) and will fail again if
  // that scoping regresses.
  it('generatePatrolTrackingPdf saves exactly ONCE for a three-unit (multi-trail) report', async () => {
    saveSpy.mockClear();
    const result = await generatePatrolTrackingPdf(threeTrailData());
    expect(result).toBeUndefined();
    expect(saveSpy).toHaveBeenCalledTimes(1);
    // total_units === 3 (not 1) => suffix is empty per the existing filename expression.
    expect(saveSpy.mock.calls[0][0]).toMatch(/^RMPG_Patrol_Tracking_\d{8}\.pdf$/);
  });

  // Positive evidence that all three trails' content survived being moved out
  // of the per-iteration finalize — a single, all-inclusive document, not a
  // document that silently dropped the later trails when finalize stopped
  // re-running per trail.
  it('buildPatrolTrackingPdf produces a document with at least as many pages for three trails as for one', async () => {
    saveSpy.mockClear();
    const singleDoc = await buildPatrolTrackingPdf(baseData());
    const threeDoc = await buildPatrolTrackingPdf(threeTrailData());
    expect(threeDoc.getNumberOfPages()).toBeGreaterThanOrEqual(singleDoc.getNumberOfPages());
    expect(saveSpy).not.toHaveBeenCalled();
  });
});
