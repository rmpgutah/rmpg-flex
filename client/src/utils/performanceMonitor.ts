// Performance monitoring utility

interface PerformanceEntry {
  name: string;
  durationMs: number;
  timestamp: number;
}

const entries: PerformanceEntry[] = [];
const MAX_ENTRIES = 500;

/** Measure the duration of an operation */
export function measure<T>(name: string, fn: () => T): T {
  const start = performance.now();
  const result = fn();
  const duration = performance.now() - start;

  entries.push({
    name,
    durationMs: Math.round(duration * 100) / 100,
    timestamp: Date.now(),
  });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);

  return result;
}

/** Measure an async operation */
export async function measureAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await fn();
  const duration = performance.now() - start;

  entries.push({
    name,
    durationMs: Math.round(duration * 100) / 100,
    timestamp: Date.now(),
  });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);

  return result;
}

/** Get performance summary */
export function getPerformanceSummary(): Record<
  string,
  { avg: number; min: number; max: number; count: number }
> {
  const grouped: Record<string, number[]> = {};

  for (const entry of entries) {
    if (!grouped[entry.name]) grouped[entry.name] = [];
    grouped[entry.name].push(entry.durationMs);
  }

  const summary: Record<
    string,
    { avg: number; min: number; max: number; count: number }
  > = {};
  for (const [name, values] of Object.entries(grouped)) {
    summary[name] = {
      avg:
        Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100,
      min: Math.min(...values),
      max: Math.max(...values),
      count: values.length,
    };
  }

  return summary;
}

/** Clear performance entries */
export function clearPerformanceEntries(): void {
  entries.length = 0;
}

/** Get Web Vitals (if available) */
export function getWebVitals(): Record<string, number | null> {
  const vitals: Record<string, number | null> = {
    navigationStart: null,
    domContentLoaded: null,
    loadComplete: null,
    firstPaint: null,
    firstContentfulPaint: null,
  };

  try {
    const navEntries = performance.getEntriesByType('navigation');
    const nav = navEntries.length > 0 ? (navEntries[0] as PerformanceNavigationTiming) : null;
    if (nav) {
      vitals.navigationStart = Math.round(nav.startTime);
      vitals.domContentLoaded = Math.round(nav.domContentLoadedEventEnd);
      vitals.loadComplete = Math.round(nav.loadEventEnd);
    }

    const paint = performance.getEntriesByType('paint');
    for (const p of paint) {
      if (p.name === 'first-paint') vitals.firstPaint = Math.round(p.startTime);
      if (p.name === 'first-contentful-paint')
        vitals.firstContentfulPaint = Math.round(p.startTime);
    }
  } catch {
    // Performance API not available
  }

  return vitals;
}
