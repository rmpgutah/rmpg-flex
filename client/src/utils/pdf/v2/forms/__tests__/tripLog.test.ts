import { describe, it } from 'vitest';
import { tripLogSchema, type TripLogData } from '../tripLog';
import { assertPdfSnapshot } from '../../__tests__/snapshotHelpers';

const SAMPLE: TripLogData = {
  meta: {
    officer_id: 7,
    officer_name: 'OFFICER 1',
    unit_id: 3,
    unit_call_sign: '12-Adam',
    period: { from: '2026-06-04', to: '2026-06-04' },
    generated_at: '2026-06-04T18:30:00Z',
    trips_logged: 2,
  },
  anchor: { current_mileage: 92607, offset_miles: 0 },
  rows: [
    {
      type: 'RESPONSE',
      call_id: 1,
      call_number: 'CFS26-00040',
      start: '2026-06-04 16:32:00',
      end: '2026-06-04 16:46:00',
      distance_mi: 5.2,
      duration_min: 14,
      mileage_from: 92589.9,
      mileage_to: 92595.1,
      max_mph: 47,
      harsh: { a: 1, b: 0, c: 0 },
    },
    {
      type: 'PATROL',
      call_id: null,
      call_number: null,
      start: '2026-06-04 16:46:00',
      end: '2026-06-04 17:05:00',
      distance_mi: 2.1,
      duration_min: 19,
      mileage_from: null,
      mileage_to: null,
      max_mph: 32,
      harsh: { a: 0, b: 0, c: 0 },
    },
    {
      type: 'RESPONSE',
      call_id: 2,
      call_number: 'CFS26-00042',
      start: '2026-06-04 17:05:00',
      end: '2026-06-04 17:28:00',
      distance_mi: 6.7,
      duration_min: 23,
      mileage_from: 92595.1,
      mileage_to: 92601.8,
      max_mph: 52,
      harsh: { a: 0, b: 2, c: 0 },
    },
  ],
  totals: {
    distance_mi: 14.0,
    duration_min: 56,
    harsh: { a: 1, b: 2, c: 0 },
  },
};

describe('trip_log (FORM PS-211)', () => {
  it('renders to stable bytes (baseline)', async () => {
    await assertPdfSnapshot(tripLogSchema, SAMPLE, 'trip_log.populated');
  });
});
