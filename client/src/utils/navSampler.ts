// ============================================================
// RMPG Flex — Session Telemetry Sampler
// Bounded movement-sample collector feeding the CSV/GPX exporters.
// Retains samples at a minimum time spacing so a long shift doesn't
// grow memory without bound. Pure — no React, no DOM, no storage.
// ============================================================

export interface TimedSample {
  /** epoch ms of the sample. Falls back to push-time Date.now(). */
  t?: number;
  [k: string]: unknown;
}

export interface Sampler<T extends TimedSample> {
  /** Offer a sample; kept only if ≥ intervalMs since the last kept one. */
  push(sample: T): boolean;
  /** All retained samples (oldest → newest). */
  getSamples(): T[];
  /** How many samples are retained. */
  size(): number;
  /** Drop everything. */
  clear(): void;
}

/**
 * Create a min-spacing sampler.
 *   const s = createSampler(5000); // keep at most one sample / 5s
 *   s.push({ t: 0 });      // true  (first)
 *   s.push({ t: 1000 });   // false (too soon)
 *   s.push({ t: 6000 });   // true  (≥ 5s gap)
 * An optional maxSamples hard-caps retention (FIFO eviction) so memory
 * stays bounded even across a multi-hour shift.
 */
export function createSampler<T extends TimedSample>(
  intervalMs: number,
  maxSamples = 5000,
): Sampler<T> {
  const spacing = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 0;
  const cap = Number.isFinite(maxSamples) && maxSamples > 0 ? Math.floor(maxSamples) : Infinity;
  let samples: T[] = [];
  let lastKeptT = -Infinity;

  return {
    push(sample: T): boolean {
      const t = Number.isFinite(sample?.t as number) ? (sample.t as number) : Date.now();
      const normalized = { ...sample, t } as T;
      if (samples.length && t - lastKeptT < spacing) return false;
      samples.push(normalized);
      lastKeptT = t;
      if (samples.length > cap) {
        samples = samples.slice(samples.length - cap);
      }
      return true;
    },
    getSamples(): T[] {
      return samples.slice();
    },
    size(): number {
      return samples.length;
    },
    clear(): void {
      samples = [];
      lastKeptT = -Infinity;
    },
  };
}
