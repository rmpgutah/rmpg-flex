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

// Speeds are expressed RELATIVE to the live thresholds, never as literals.
// Hardcoding 72/85/95 silently decoupled these tests from SPEED_THRESHOLDS the
// moment the tiers were recalibrated (70/80/90 -> 85/95/105), which is exactly
// the kind of drift that would let a retune ship with green tests.
const LOW = SPEED_THRESHOLDS.high - 40;   // plainly below every tier
const HI = SPEED_THRESHOLDS.high + 2;     // in the high tier
const VHI = SPEED_THRESHOLDS.veryHigh + 2;
const EXT = SPEED_THRESHOLDS.extreme + 2;

describe('threshold calibration', () => {
  it('pins the tiers above every posted Utah limit (max is 80 mph on rural I-15)', () => {
    // A 70 mph floor would flag ordinary legal cruising. Changing these
    // requires re-justifying them against the posted-limit ceiling, not
    // rounding them for neatness.
    expect(SPEED_THRESHOLDS.high).toBe(85);
    expect(SPEED_THRESHOLDS.veryHigh).toBe(95);
    expect(SPEED_THRESHOLDS.extreme).toBe(105);
    expect(SPEED_THRESHOLDS.high).toBeGreaterThan(80);
  });

  it('suppresses an isolated 110+ mph GPS spike (18 of 19 such live samples were isolated)', () => {
    expect(deriveSpeedEvents(samples([LOW, 176, LOW]))).toEqual(NONE);
  });
});

describe('deriveSpeedEvents — corroboration', () => {
  it('returns no events for empty input', () => {
    expect(deriveSpeedEvents([])).toEqual(NONE);
  });

  it('ignores a SINGLE sample above the threshold (GPS spike, not an event)', () => {
    expect(deriveSpeedEvents(samples([LOW, EXT, LOW]))).toEqual(NONE);
  });

  it('ignores a single extreme spike even at the top tier', () => {
    expect(deriveSpeedEvents(samples([LOW, SPEED_THRESHOLDS.extreme + 35, LOW]))).toEqual(NONE);
  });

  it('counts two consecutive above-threshold samples as exactly ONE event', () => {
    expect(deriveSpeedEvents(samples([LOW, HI, HI + 1, LOW]))).toEqual({ ...NONE, speedHigh: 1 });
  });

  it('MIN_SUSTAINED_SAMPLES is the documented corroboration floor', () => {
    const justUnder = samples(Array(MIN_SUSTAINED_SAMPLES - 1).fill(HI));
    const atFloor = samples(Array(MIN_SUSTAINED_SAMPLES).fill(HI));
    expect(deriveSpeedEvents(justUnder)).toEqual(NONE);
    expect(deriveSpeedEvents(atFloor)).toEqual({ ...NONE, speedHigh: 1 });
  });
});

describe('deriveSpeedEvents — one run is one event', () => {
  it('counts a ten-sample run at one speed as ONE speedHigh, not ten', () => {
    expect(deriveSpeedEvents(samples(Array(10).fill(HI)))).toEqual({ ...NONE, speedHigh: 1 });
  });

  it('counts two runs separated by a drop below threshold as two events', () => {
    expect(deriveSpeedEvents(samples([HI, HI, LOW, LOW, HI, HI])))
      .toEqual({ ...NONE, speedHigh: 2 });
  });
});

describe('deriveSpeedEvents — gap handling', () => {
  it('splits one run into TWO when consecutive samples are more than MAX_SAMPLE_GAP_S apart', () => {
    const a = { recordedAtMs: T0, speedMph: HI };
    const b = { recordedAtMs: T0 + 30 * S, speedMph: HI };
    // A 20-minute hole in the feed is not sustained speed.
    const c = { recordedAtMs: b.recordedAtMs + 1200 * S, speedMph: HI };
    const d = { recordedAtMs: c.recordedAtMs + 30 * S, speedMph: HI };
    expect(deriveSpeedEvents([a, b, c, d])).toEqual({ ...NONE, speedHigh: 2 });
  });

  it('keeps a run together at exactly MAX_SAMPLE_GAP_S', () => {
    expect(deriveSpeedEvents(samples([HI, HI], MAX_SAMPLE_GAP_S)))
      .toEqual({ ...NONE, speedHigh: 1 });
  });

  it('breaks the run one second past MAX_SAMPLE_GAP_S, leaving two uncorroborated singles', () => {
    expect(deriveSpeedEvents(samples([HI, HI], MAX_SAMPLE_GAP_S + 1))).toEqual(NONE);
  });

  it('a gap-split run whose halves are each corroborated yields two events', () => {
    const first = samples([HI, HI, HI]);
    const lastMs = first[first.length - 1].recordedAtMs;
    const second = samples([HI, HI, HI], 35, lastMs + 600 * S);
    expect(deriveSpeedEvents([...first, ...second])).toEqual({ ...NONE, speedHigh: 2 });
  });
});

describe('deriveSpeedEvents — tiering by run peak', () => {
  it('tiers a run by its PEAK and counts it ONCE at that tier only', () => {
    // Peaks in the extreme tier: one speedExtreme, NOT also a high/veryHigh.
    expect(deriveSpeedEvents(samples([HI, VHI, EXT, HI])))
      .toEqual({ speedHigh: 0, speedVeryHigh: 0, speedExtreme: 1 });
  });

  it('tiers a run peaking in the veryHigh tier as speedVeryHigh only', () => {
    expect(deriveSpeedEvents(samples([HI, VHI, HI])))
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
    expect(deriveSpeedEvents(samples([HI, HI, LOW, VHI, VHI, LOW, EXT, EXT])))
      .toEqual({ speedHigh: 1, speedVeryHigh: 1, speedExtreme: 1 });
  });
});

describe('deriveSpeedEvents — unusable readings', () => {
  it('ignores null speeds and does not bridge a run across them', () => {
    expect(deriveSpeedEvents(samples([HI, null, HI]))).toEqual(NONE);
  });

  it('ignores negative speeds', () => {
    expect(deriveSpeedEvents(samples([-5, -90, -EXT]))).toEqual(NONE);
  });

  it('ignores NaN and Infinity speeds rather than treating them as extreme', () => {
    expect(deriveSpeedEvents(samples([NaN, Infinity, NaN]))).toEqual(NONE);
  });

  it('a run bracketed by nulls is still counted once', () => {
    expect(deriveSpeedEvents(samples([null, HI, HI, null]))).toEqual({ ...NONE, speedHigh: 1 });
  });

  it('ignores samples with a non-finite timestamp', () => {
    expect(deriveSpeedEvents([
      { recordedAtMs: NaN, speedMph: EXT },
      { recordedAtMs: NaN, speedMph: EXT },
    ])).toEqual(NONE);
  });
});

describe('deriveSpeedEvents — duplicate and out-of-order timestamps', () => {
  it('duplicate (zero-gap) timestamps corroborate a run without double-counting it', () => {
    expect(deriveSpeedEvents([
      { recordedAtMs: T0, speedMph: HI },
      { recordedAtMs: T0, speedMph: HI },
      { recordedAtMs: T0, speedMph: HI },
    ])).toEqual({ ...NONE, speedHigh: 1 });
  });

  it('duplicate timestamps still tier by peak, once', () => {
    expect(deriveSpeedEvents([
      { recordedAtMs: T0, speedMph: HI },
      { recordedAtMs: T0, speedMph: EXT },
    ])).toEqual({ ...NONE, speedExtreme: 1 });
  });

  it('a backwards timestamp breaks the run rather than being trusted', () => {
    expect(deriveSpeedEvents([
      { recordedAtMs: T0, speedMph: HI },
      { recordedAtMs: T0 - 60 * S, speedMph: HI },
    ])).toEqual(NONE);
  });
});
