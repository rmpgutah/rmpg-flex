import { describe, it, expect } from 'vitest';
import {
  deriveSpeedEvents,
  SPEED_THRESHOLDS,
  MIN_SUSTAINED_SAMPLES,
  MAX_SAMPLE_GAP_S,
  type SpeedSample,
} from '../src/utils/driverPerformance/speedEvents';

const T0 = Date.parse('2026-07-01T12:00:00Z');
const S = 1000;

/** Build ascending samples spaced `gapS` seconds apart (default: the live ~35s cadence). */
function samples(speeds: (number | null)[], gapS = 35, startMs = T0): SpeedSample[] {
  return speeds.map((speedMph, i) => ({ recordedAtMs: startMs + i * gapS * S, speedMph }));
}

const NONE = { speedHigh: 0, speedVeryHigh: 0, speedExtreme: 0 };

describe('deriveSpeedEvents — corroboration', () => {
  it('returns no events for empty input', () => {
    expect(deriveSpeedEvents([])).toEqual(NONE);
  });

  it('ignores a SINGLE sample above the threshold (GPS spike, not an event)', () => {
    expect(deriveSpeedEvents(samples([30, 95, 30]))).toEqual(NONE);
  });

  it('ignores a single extreme spike even at the top tier', () => {
    expect(deriveSpeedEvents(samples([10, 140, 10]))).toEqual(NONE);
  });

  it('counts two consecutive above-threshold samples as exactly ONE event', () => {
    expect(deriveSpeedEvents(samples([30, 72, 73, 30]))).toEqual({ ...NONE, speedHigh: 1 });
  });

  it('MIN_SUSTAINED_SAMPLES is the documented corroboration floor', () => {
    const justUnder = samples(Array(MIN_SUSTAINED_SAMPLES - 1).fill(72));
    const atFloor = samples(Array(MIN_SUSTAINED_SAMPLES).fill(72));
    expect(deriveSpeedEvents(justUnder)).toEqual(NONE);
    expect(deriveSpeedEvents(atFloor)).toEqual({ ...NONE, speedHigh: 1 });
  });
});

describe('deriveSpeedEvents — one run is one event', () => {
  it('counts a ten-sample run at 72 mph as ONE speedHigh, not ten', () => {
    expect(deriveSpeedEvents(samples(Array(10).fill(72)))).toEqual({ ...NONE, speedHigh: 1 });
  });

  it('counts two runs separated by a drop below threshold as two events', () => {
    expect(deriveSpeedEvents(samples([72, 72, 40, 40, 72, 72])))
      .toEqual({ ...NONE, speedHigh: 2 });
  });
});

describe('deriveSpeedEvents — gap handling', () => {
  it('splits one run into TWO when consecutive samples are more than MAX_SAMPLE_GAP_S apart', () => {
    const a = { recordedAtMs: T0, speedMph: 72 };
    const b = { recordedAtMs: T0 + 30 * S, speedMph: 72 };
    // A 20-minute hole in the feed is not sustained speed.
    const c = { recordedAtMs: b.recordedAtMs + 1200 * S, speedMph: 72 };
    const d = { recordedAtMs: c.recordedAtMs + 30 * S, speedMph: 72 };
    expect(deriveSpeedEvents([a, b, c, d])).toEqual({ ...NONE, speedHigh: 2 });
  });

  it('keeps a run together at exactly MAX_SAMPLE_GAP_S', () => {
    expect(deriveSpeedEvents(samples([72, 72], MAX_SAMPLE_GAP_S)))
      .toEqual({ ...NONE, speedHigh: 1 });
  });

  it('breaks the run one second past MAX_SAMPLE_GAP_S, leaving two uncorroborated singles', () => {
    expect(deriveSpeedEvents(samples([72, 72], MAX_SAMPLE_GAP_S + 1))).toEqual(NONE);
  });

  it('a gap-split run whose halves are each corroborated yields two events', () => {
    const first = samples([72, 72, 72]);
    const lastMs = first[first.length - 1].recordedAtMs;
    const second = samples([72, 72, 72], 35, lastMs + 600 * S);
    expect(deriveSpeedEvents([...first, ...second])).toEqual({ ...NONE, speedHigh: 2 });
  });
});

describe('deriveSpeedEvents — tiering by run peak', () => {
  it('tiers a run by its PEAK and counts it ONCE at that tier only', () => {
    // Peaks at 95: one speedExtreme, and NOT also a high/veryHigh.
    expect(deriveSpeedEvents(samples([72, 84, 95, 74])))
      .toEqual({ speedHigh: 0, speedVeryHigh: 0, speedExtreme: 1 });
  });

  it('tiers a run peaking in the 80s as speedVeryHigh only', () => {
    expect(deriveSpeedEvents(samples([72, 85, 71])))
      .toEqual({ speedHigh: 0, speedVeryHigh: 1, speedExtreme: 0 });
  });

  it('counts each tier boundary at the tier it reaches', () => {
    expect(deriveSpeedEvents(samples([SPEED_THRESHOLDS.high, SPEED_THRESHOLDS.high])))
      .toEqual({ ...NONE, speedHigh: 1 });
    expect(deriveSpeedEvents(samples([SPEED_THRESHOLDS.veryHigh, SPEED_THRESHOLDS.veryHigh])))
      .toEqual({ ...NONE, speedVeryHigh: 1 });
    expect(deriveSpeedEvents(samples([SPEED_THRESHOLDS.extreme, SPEED_THRESHOLDS.extreme])))
      .toEqual({ ...NONE, speedExtreme: 1 });
  });

  it('does not count a run one mph below the high threshold', () => {
    expect(deriveSpeedEvents(samples([SPEED_THRESHOLDS.high - 1, SPEED_THRESHOLDS.high - 1])))
      .toEqual(NONE);
  });

  it('tallies separate runs into their own tiers', () => {
    expect(deriveSpeedEvents(samples([72, 72, 10, 85, 85, 10, 95, 95])))
      .toEqual({ speedHigh: 1, speedVeryHigh: 1, speedExtreme: 1 });
  });
});

describe('deriveSpeedEvents — unusable readings', () => {
  it('ignores null speeds and does not bridge a run across them', () => {
    expect(deriveSpeedEvents(samples([72, null, 72]))).toEqual(NONE);
  });

  it('ignores negative speeds', () => {
    expect(deriveSpeedEvents(samples([-5, -90, -95]))).toEqual(NONE);
  });

  it('ignores NaN and Infinity speeds rather than treating them as extreme', () => {
    expect(deriveSpeedEvents(samples([NaN, Infinity, NaN]))).toEqual(NONE);
  });

  it('a run bracketed by nulls is still counted once', () => {
    expect(deriveSpeedEvents(samples([null, 72, 72, null]))).toEqual({ ...NONE, speedHigh: 1 });
  });

  it('ignores samples with a non-finite timestamp', () => {
    expect(deriveSpeedEvents([
      { recordedAtMs: NaN, speedMph: 95 },
      { recordedAtMs: NaN, speedMph: 95 },
    ])).toEqual(NONE);
  });
});

describe('deriveSpeedEvents — duplicate and out-of-order timestamps', () => {
  it('duplicate (zero-gap) timestamps corroborate a run without double-counting it', () => {
    expect(deriveSpeedEvents([
      { recordedAtMs: T0, speedMph: 72 },
      { recordedAtMs: T0, speedMph: 72 },
      { recordedAtMs: T0, speedMph: 72 },
    ])).toEqual({ ...NONE, speedHigh: 1 });
  });

  it('duplicate timestamps still tier by peak, once', () => {
    expect(deriveSpeedEvents([
      { recordedAtMs: T0, speedMph: 72 },
      { recordedAtMs: T0, speedMph: 91 },
    ])).toEqual({ ...NONE, speedExtreme: 1 });
  });

  it('a backwards timestamp breaks the run rather than being trusted', () => {
    expect(deriveSpeedEvents([
      { recordedAtMs: T0, speedMph: 72 },
      { recordedAtMs: T0 - 60 * S, speedMph: 72 },
    ])).toEqual(NONE);
  });
});
