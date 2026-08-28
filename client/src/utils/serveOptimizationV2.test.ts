import { describe, it, expect } from 'vitest';
import { parseServeV2Solution, v2EtasToArrivalMs, type V2Solution } from './mapboxOptimizationV2';

const solution: V2Solution = {
  dropped: { services: ['12'], shipments: [] },
  routes: [{
    vehicle: 'A1',
    stops: [
      { type: 'start', location: 'officer-1-depot', eta: '2026-08-28T20:30:00.000Z' },
      { type: 'service', location: '11', eta: '2026-08-28T20:50:00.000Z', services: ['11'] },
      { type: 'service', location: '10', eta: '2026-08-28T21:20:00.000Z', services: ['10'] },
      { type: 'end', location: 'officer-1-depot', eta: '2026-08-28T21:45:00.000Z' },
    ],
  }],
};

describe('parseServeV2Solution', () => {
  it('returns service order, ETAs, and dropped ids', () => {
    const parsed = parseServeV2Solution(solution);
    expect(parsed?.orderedJobIds).toEqual([11, 10]);
    expect(parsed?.droppedJobIds).toEqual([12]);
    expect(parsed?.etaByJobId.get(11)).toBe('2026-08-28T20:50:00.000Z');
  });

  it('reads the job id from services[] when location is a depot name', () => {
    const odd: V2Solution = {
      dropped: { services: [], shipments: [] },
      routes: [{
        vehicle: 'A1',
        stops: [
          { type: 'service', location: 'officer-1-depot', eta: '2026-08-28T20:50:00.000Z', services: ['42'] },
        ],
      }],
    };
    expect(parseServeV2Solution(odd)?.orderedJobIds).toEqual([42]);
  });

  it('returns null when there are no service stops', () => {
    expect(parseServeV2Solution({ dropped: { services: [], shipments: [] }, routes: [] })).toBeNull();
  });
});

describe('v2EtasToArrivalMs', () => {
  it('parses RFC3339 ETAs to epoch ms', () => {
    const parsed = parseServeV2Solution(solution)!;
    const arrivals = v2EtasToArrivalMs(parsed.etaByJobId);
    expect(arrivals.get(11)).toBe(Date.parse('2026-08-28T20:50:00.000Z'));
  });
});
