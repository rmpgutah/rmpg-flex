// Speed-event derivation from MDT GPS breadcrumbs — PURE. No D1, no I/O, no clock.
//
// WHY THIS MODULE EXISTS AT ALL, AND WHY IT ONLY LOOKS AT SPEED:
//
// The previous event source was `dashcam_events` (ClearPath). Its credentials
// are absent from system_config, so the sync has silently no-opped for weeks
// while `unit_trips` kept recording miles — every officer would have scored
// 100/Excellent on an empty numerator. The replacement source is the internal
// MDT capture already landing in `gps_breadcrumbs`.
//
// ⚠️ HARSH BRAKING AND HARSH ACCELERATION ARE DELIBERATELY NOT DERIVED HERE,
// AND MUST NOT BE ADDED. Breadcrumb cadence averages ~34.6 seconds. At that
// sampling rate a driver slamming the brakes and a driver coasting to a red
// light produce the SAME speed delta. Any "harsh event" derived from this data
// is an inference dressed up as an observation, and this feature's whole risk
// is a confident wrong number about a named person. Each breadcrumb's `speed`,
// by contrast, is a directly measured fact at a known instant — that is what
// makes scoring on it defensible in a coaching conversation or a deposition.

export interface SpeedSample {
  recordedAtMs: number;
  /**
   * MILES PER HOUR. Callers converting from `gps_breadcrumbs.speed` MUST
   * convert first — that column stores METERS PER SECOND (W3C Geolocation
   * `coords.speed`, written straight through by src/routes/dispatch/gps.ts).
   * Feeding raw m/s in here silently makes every threshold ~2.24x too high,
   * so nobody ever trips one and every officer scores a perfect 100.
   */
  speedMph: number | null;
}

export interface SpeedEventCounts {
  speedHigh: number;
  speedVeryHigh: number;
  speedExtreme: number;
}

/**
 * Tier floors, in MPH. A run is counted once, at the highest tier its peak reaches.
 *
 * ⚠️ DO NOT "TIDY" THESE BACK TO ROUND NUMBERS (70/80/90). The floor is set by
 * law, not by aesthetics.
 *
 * Utah's MAXIMUM posted speed limit is 80 mph (rural I-15). 85 is therefore the
 * lowest threshold that cannot flag lawful driving anywhere in the state — the
 * 5 mph above 80 absorbs speedometer/GPS error rather than granting latitude.
 *
 * This was measured, not assumed. Officer 1's real distribution over 30 days
 * (77,098 samples, correctly converted from the m/s the column stores):
 *   70-79: 7,398 | 80-84: 2,779 | 85-89: 1,264 | 90-94: 174 | 95-99: 21 | 110+: 19
 * A 70 mph floor would have branded the only officer in the system "At Risk"
 * for ordinary legal cruising — a confident wrong number about a named person,
 * which is the exact failure this feature exists to prevent.
 */
export const SPEED_THRESHOLDS = { high: 85, veryHigh: 95, extreme: 105 } as const;

/**
 * A SINGLE sample above a threshold is NOT an event.
 *
 * GPS speed spikes are a known artifact — multipath in an urban canyon, a
 * tunnel exit, a re-acquired fix after signal loss. One bad reading must never
 * become a speeding allegation against a named officer, so a run has to be
 * corroborated by at least this many consecutive samples.
 */
export const MIN_SUSTAINED_SAMPLES = 2;

/**
 * Maximum seconds between two consecutive samples for them to still count as
 * the SAME sustained run. Breadcrumbs average ~34.6s apart, so 120s tolerates
 * ordinary jitter and a dropped fix or two — but a 20-minute hole in the feed
 * is not "sustained speed", it is two separate occasions with an unobserved
 * gap between them, and merging them would invent a continuity nobody recorded.
 */
export const MAX_SAMPLE_GAP_S = 120;

const MAX_SAMPLE_GAP_MS = MAX_SAMPLE_GAP_S * 1000;

interface OpenRun {
  sampleCount: number;
  peakMph: number;
  lastMs: number;
}

/**
 * Collapse breadcrumb samples into speed EVENTS.
 *
 * Samples are expected in ascending time order.
 *
 * ⚠️ ONE SUSTAINED RUN IS ONE EVENT. A ten-sample run at 72 mph is a single
 * `speedHigh`, not ten. Counting per-sample would multiply one stretch of
 * freeway driving into a double-digit event count and, through the weighted
 * rate, turn a single incident into a career-ending statistic.
 *
 * ⚠️ A RUN IS COUNTED AT ONE TIER ONLY — the highest its PEAK reaches. A run
 * peaking at 95 mph is one `speedExtreme` and is NOT also counted as
 * `speedHigh` and `speedVeryHigh`; triple-counting would treble the weight of
 * the very worst events relative to the tier table.
 */
export function deriveSpeedEvents(samples: readonly SpeedSample[]): SpeedEventCounts {
  const counts: SpeedEventCounts = { speedHigh: 0, speedVeryHigh: 0, speedExtreme: 0 };
  let run: OpenRun | null = null;

  const closeRun = () => {
    if (run === null) return;
    // Uncorroborated (single-sample) runs are DROPPED, not counted at a lower
    // tier. An unverified spike is not a lesser offense; it is not evidence.
    if (run.sampleCount >= MIN_SUSTAINED_SAMPLES) {
      if (run.peakMph >= SPEED_THRESHOLDS.extreme) counts.speedExtreme += 1;
      else if (run.peakMph >= SPEED_THRESHOLDS.veryHigh) counts.speedVeryHigh += 1;
      else counts.speedHigh += 1;
    }
    run = null;
  };

  for (const s of samples) {
    const t = s.recordedAtMs;
    const v = s.speedMph;

    // A sample with no usable speed is a hole in the observation, not a
    // reading of "slow". It ends the run rather than silently bridging it:
    // bridging would let two separate stretches merge across unobserved time.
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || !Number.isFinite(t)) {
      closeRun();
      continue;
    }

    if (v < SPEED_THRESHOLDS.high) {
      closeRun();
      continue;
    }

    if (run !== null) {
      const dt = t - (run as OpenRun).lastMs;
      // dt === 0 is legitimate: duplicate/zero-gap timestamps genuinely occur
      // in this feed. They extend the run (contributing to corroboration) and
      // still yield exactly ONE event, so they cannot double-count.
      // dt < 0 means unsorted input — treated as a break rather than trusted,
      // since a negative gap makes "sustained" meaningless.
      if (dt >= 0 && dt <= MAX_SAMPLE_GAP_MS) {
        const open = run as OpenRun;
        open.sampleCount += 1;
        if (v > open.peakMph) open.peakMph = v;
        open.lastMs = t;
        continue;
      }
      closeRun();
    }

    run = { sampleCount: 1, peakMph: v, lastMs: t };
  }

  closeRun();
  return counts;
}
