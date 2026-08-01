import { describe, it, expect } from 'vitest';
import {
  computeScore, severityWeight, weightsPendingReview,
  MIN_EXPOSURE_MILES, SCORE_VERSION,
  type EventCounts,
} from '../src/utils/driverPerformance/score';

const NO_EVENTS: EventCounts = {
  forwardCollision: 0, laneDeparture: 0, closeFollowing: 0,
  harshBrake: 0, harshAccel: 0, speeding: 0,
};
const ev = (p: Partial<EventCounts>): EventCounts => ({ ...NO_EVENTS, ...p });

describe('exposure floor', () => {
  it('returns insufficient_data one mile below the floor', () => {
    const r = computeScore({ milesDriven: MIN_EXPOSURE_MILES - 1, events: ev({ harshBrake: 3 }), recordedPct: 1 });
    expect(r.status).toBe('insufficient_data');
  });

  it('scores exactly at the floor', () => {
    const r = computeScore({ milesDriven: MIN_EXPOSURE_MILES, events: ev({ harshBrake: 3 }), recordedPct: 1 });
    expect(r.status).toBe('scored');
  });

  it('never divides by zero mileage', () => {
    const r = computeScore({ milesDriven: 0, events: ev({ forwardCollision: 5 }), recordedPct: 1 });
    expect(r.status).toBe('insufficient_data');
  });

  it('treats negative mileage as insufficient rather than inverting the score', () => {
    const r = computeScore({ milesDriven: -100, events: NO_EVENTS, recordedPct: 1 });
    expect(r.status).toBe('insufficient_data');
  });
});

describe('scoring', () => {
  it('gives a clean driver the maximum score', () => {
    const r = computeScore({ milesDriven: 1000, events: NO_EVENTS, recordedPct: 1 });
    expect(r).toMatchObject({ status: 'scored', score: 100, band: 'excellent' });
  });

  it('is monotonic — more events never scores higher', () => {
    const few = computeScore({ milesDriven: 1000, events: ev({ harshBrake: 2 }), recordedPct: 1 });
    const many = computeScore({ milesDriven: 1000, events: ev({ harshBrake: 20 }), recordedPct: 1 });
    if (few.status !== 'scored' || many.status !== 'scored') throw new Error('both should score');
    expect(many.score).toBeLessThan(few.score);
  });

  it('normalizes by exposure — double miles with double events scores the same', () => {
    const a = computeScore({ milesDriven: 1000, events: ev({ harshBrake: 4 }), recordedPct: 1 });
    const b = computeScore({ milesDriven: 2000, events: ev({ harshBrake: 8 }), recordedPct: 1 });
    if (a.status !== 'scored' || b.status !== 'scored') throw new Error('both should score');
    expect(b.score).toBeCloseTo(a.score, 5);
  });

  it('does not grade on a curve — score depends only on this officer', () => {
    const r1 = computeScore({ milesDriven: 1000, events: ev({ speeding: 3 }), recordedPct: 1 });
    const r2 = computeScore({ milesDriven: 1000, events: ev({ speeding: 3 }), recordedPct: 1 });
    expect(r1).toEqual(r2);
  });

  it('clamps at zero rather than going negative on an extreme rate', () => {
    const r = computeScore({ milesDriven: 250, events: ev({ forwardCollision: 500 }), recordedPct: 1 });
    if (r.status !== 'scored') throw new Error('should score');
    expect(r.score).toBe(0);
  });

  it('reports the version it was computed under', () => {
    const r = computeScore({ milesDriven: 1000, events: NO_EVENTS, recordedPct: 1 });
    if (r.status !== 'scored') throw new Error('should score');
    expect(r.scoreVersion).toBe(SCORE_VERSION);
  });
});

describe('attribution confidence', () => {
  it('flags a majority-inferred score as inferred', () => {
    const r = computeScore({ milesDriven: 1000, events: ev({ harshBrake: 2 }), recordedPct: 0.4 });
    if (r.status !== 'scored') throw new Error('should score');
    expect(r.confidence).toBe('inferred');
  });

  it('flags a majority-recorded score as recorded', () => {
    const r = computeScore({ milesDriven: 1000, events: ev({ harshBrake: 2 }), recordedPct: 0.9 });
    if (r.status !== 'scored') throw new Error('should score');
    expect(r.confidence).toBe('recorded');
  });
});

describe('severity weights', () => {
  it('ranks a forward-collision warning above a close-following event', () => {
    expect(severityWeight('forwardCollision')).toBeGreaterThan(severityWeight('closeFollowing'));
  });

  it('assigns a positive weight to every event type', () => {
    (Object.keys(NO_EVENTS) as (keyof EventCounts)[])
      .forEach((k) => expect(severityWeight(k)).toBeGreaterThan(0));
  });

  it('reports weights as pending review while the version is a placeholder', () => {
    // The runtime guard in the route keys off this. It is a normal assertion:
    // it documents current state and flips to a real, meaningful failure the
    // moment SCORE_VERSION is set to 'v1' without the guard being removed.
    expect(weightsPendingReview()).toBe(SCORE_VERSION.includes('placeholder'));
  });
});
