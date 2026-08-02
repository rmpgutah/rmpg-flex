import { describe, it, expect } from 'vitest';
import {
  computeScore, severityWeight,
  MIN_EXPOSURE_MILES, SCORE_VERSION,
  type SpeedEventCounts,
} from '../src/utils/driverPerformance/score';

const NO_EVENTS: SpeedEventCounts = { speedHigh: 0, speedVeryHigh: 0, speedExtreme: 0 };
const ev = (p: Partial<SpeedEventCounts>): SpeedEventCounts => ({ ...NO_EVENTS, ...p });

/** Default samples for tests not exercising the dead-feed guard. */
const SAMPLES = 1000;
const score = (
  milesDriven: number,
  events: SpeedEventCounts,
  recordedPct = 1,
  breadcrumbSamples = SAMPLES,
) => computeScore({ milesDriven, events, recordedPct, breadcrumbSamples });

describe('exposure floor', () => {
  it('returns insufficient_data one mile below the floor', () => {
    const r = score(MIN_EXPOSURE_MILES - 1, ev({ speedHigh: 3 }));
    expect(r).toMatchObject({ status: 'insufficient_data', reason: 'below_exposure_floor' });
  });

  it('scores exactly at the floor', () => {
    expect(score(MIN_EXPOSURE_MILES, ev({ speedHigh: 3 })).status).toBe('scored');
  });

  it('never divides by zero mileage', () => {
    expect(score(0, ev({ speedExtreme: 5 })).status).toBe('insufficient_data');
  });

  it('treats negative mileage as insufficient rather than inverting the score', () => {
    expect(score(-100, NO_EVENTS).status).toBe('insufficient_data');
  });
});

describe('dead-feed guard (miles with no observations)', () => {
  it('refuses to score an above-floor officer-day with ZERO breadcrumb samples', () => {
    const r = score(1000, NO_EVENTS, 1, 0);
    // The reassuring reading — 1000 clean miles — is exactly the trap. No
    // samples means nothing was observed, not that nothing happened.
    expect(r).toMatchObject({ status: 'insufficient_data', reason: 'no_breadcrumb_samples' });
  });

  it('scores the same day once even a single sample exists', () => {
    expect(score(1000, NO_EVENTS, 1, 1)).toMatchObject({ status: 'scored', score: 100 });
  });

  it('distinguishes a dead feed from a below-floor officer by reason', () => {
    const dead = score(1000, NO_EVENTS, 1, 0);
    const short = score(10, NO_EVENTS, 1, SAMPLES);
    if (dead.status !== 'insufficient_data' || short.status !== 'insufficient_data') {
      throw new Error('both should be unscored');
    }
    expect(dead.reason).not.toBe(short.reason);
  });

  it('treats a NaN sample count as no observations rather than as scoreable', () => {
    expect(score(1000, NO_EVENTS, 1, NaN).status).toBe('insufficient_data');
  });

  it('a dead feed is unscored even when events somehow accompany it', () => {
    expect(score(1000, ev({ speedExtreme: 2 }), 1, 0).status).toBe('insufficient_data');
  });
});

describe('event count sanitization', () => {
  it('a negative event count produces the same score as 0 for that tier', () => {
    const withNegative = score(1000, ev({ speedHigh: -5 }));
    const withZero = score(1000, ev({ speedHigh: 0 }));
    if (withNegative.status !== 'scored' || withZero.status !== 'scored') throw new Error('both should score');
    expect(withNegative.score).toBe(withZero.score);
    expect(withNegative.score).toBeLessThanOrEqual(withZero.score);
  });

  it('NaN event counts are treated as 0', () => {
    const withNaN = score(1000, { ...NO_EVENTS, speedHigh: NaN });
    const withZero = score(1000, ev({ speedHigh: 0 }));
    if (withNaN.status !== 'scored' || withZero.status !== 'scored') throw new Error('both should score');
    expect(withNaN.score).toBe(withZero.score);
  });

  it('Infinity event counts are treated as 0', () => {
    const withInfinity = score(1000, { ...NO_EVENTS, speedHigh: Infinity });
    const withZero = score(1000, ev({ speedHigh: 0 }));
    if (withInfinity.status !== 'scored' || withZero.status !== 'scored') throw new Error('both should score');
    expect(withInfinity.score).toBe(withZero.score);
  });
});

describe('scoring', () => {
  it('gives an observed driver with no speed events the maximum score', () => {
    expect(score(1000, NO_EVENTS)).toMatchObject({ status: 'scored', score: 100, band: 'excellent' });
  });

  it('is monotonic — more events never scores higher', () => {
    const few = score(1000, ev({ speedHigh: 2 }));
    const many = score(1000, ev({ speedHigh: 20 }));
    if (few.status !== 'scored' || many.status !== 'scored') throw new Error('both should score');
    expect(many.score).toBeLessThan(few.score);
  });

  it('normalizes by exposure — double miles with double events scores the same', () => {
    const a = score(1000, ev({ speedHigh: 4 }));
    const b = score(2000, ev({ speedHigh: 8 }));
    if (a.status !== 'scored' || b.status !== 'scored') throw new Error('both should score');
    expect(b.score).toBeCloseTo(a.score, 5);
  });

  it('does not grade on a curve — score depends only on this officer', () => {
    expect(score(1000, ev({ speedHigh: 3 }))).toEqual(score(1000, ev({ speedHigh: 3 })));
  });

  it('clamps at zero rather than going negative on an extreme rate', () => {
    const r = score(250, ev({ speedExtreme: 500 }));
    if (r.status !== 'scored') throw new Error('should score');
    expect(r.score).toBe(0);
  });

  it('reports the version it was computed under', () => {
    const r = score(1000, NO_EVENTS);
    if (r.status !== 'scored') throw new Error('should score');
    expect(r.scoreVersion).toBe(SCORE_VERSION);
  });

  it('pins the live score version so a weight change cannot ship without bumping it', () => {
    expect(SCORE_VERSION).toBe('v1-speed');
  });
});

describe('attribution confidence', () => {
  it('flags a majority-inferred score as inferred', () => {
    const r = score(1000, ev({ speedHigh: 2 }), 0.4);
    if (r.status !== 'scored') throw new Error('should score');
    expect(r.confidence).toBe('inferred');
  });

  it('flags a majority-recorded score as recorded', () => {
    const r = score(1000, ev({ speedHigh: 2 }), 0.9);
    if (r.status !== 'scored') throw new Error('should score');
    expect(r.confidence).toBe('recorded');
  });

  it('flags exactly 0.5 recordedPct as recorded (at-or-above threshold)', () => {
    const r = score(1000, ev({ speedHigh: 2 }), 0.5);
    if (r.status !== 'scored') throw new Error('should score');
    expect(r.confidence).toBe('recorded');
  });
});

describe('severity weights', () => {
  it('ranks each speed tier strictly above the one below it', () => {
    expect(severityWeight('speedExtreme')).toBeGreaterThan(severityWeight('speedVeryHigh'));
    expect(severityWeight('speedVeryHigh')).toBeGreaterThan(severityWeight('speedHigh'));
  });

  it('assigns a positive weight to every tier', () => {
    (Object.keys(NO_EVENTS) as (keyof SpeedEventCounts)[])
      .forEach((k) => expect(severityWeight(k)).toBeGreaterThan(0));
  });

  it('pins the approved weights — changing one requires bumping SCORE_VERSION', () => {
    expect(severityWeight('speedHigh')).toBe(3);
    expect(severityWeight('speedVeryHigh')).toBe(8);
    expect(severityWeight('speedExtreme')).toBe(20);
  });
});
