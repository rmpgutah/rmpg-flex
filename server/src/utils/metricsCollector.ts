// Metrics collection

interface MetricPoint {
  value: number;
  timestamp: number;
}

interface MetricSummary {
  current: number;
  min: number;
  max: number;
  avg: number;
  count: number;
}

const metrics = new Map<string, MetricPoint[]>();
const counters = new Map<string, number>();
const gauges = new Map<string, number>();
const MAX_HISTORY = 1000;

const serverStartTime = Date.now();

/** Record a metric value (histogram-style) */
export function recordMetric(name: string, value: number): void {
  if (!metrics.has(name)) metrics.set(name, []);
  const points = metrics.get(name)!;
  points.push({ value, timestamp: Date.now() });

  // Trim history
  if (points.length > MAX_HISTORY) {
    points.splice(0, points.length - MAX_HISTORY);
  }
}

/** Increment a counter */
export function incrementCounter(name: string, by = 1): void {
  counters.set(name, (counters.get(name) || 0) + by);
}

/** Set a gauge value */
export function setGauge(name: string, value: number): void {
  gauges.set(name, value);
}

/** Get metric summary for a named metric */
export function getMetricSummary(name: string): MetricSummary | null {
  const points = metrics.get(name);
  if (!points || points.length === 0) return null;

  const values = points.map((p) => p.value);
  return {
    current: values[values.length - 1],
    min: Math.min(...values),
    max: Math.max(...values),
    avg: values.reduce((a, b) => a + b, 0) / values.length,
    count: values.length,
  };
}

/** Get memory usage stats */
export function getMemoryUsage(): Record<string, number> {
  const mem = process.memoryUsage();
  return {
    heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
    heapTotalMb: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
    rssMb: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
    externalMb: Math.round((mem.external / 1024 / 1024) * 100) / 100,
    arrayBuffersMb: Math.round((mem.arrayBuffers / 1024 / 1024) * 100) / 100,
  };
}

/** Get server uptime and start time */
export function getServerTiming(): {
  uptimeSeconds: number;
  startedAt: string;
  startTimeMs: number;
} {
  return {
    uptimeSeconds: Math.round((Date.now() - serverStartTime) / 1000),
    startedAt: new Date(serverStartTime).toISOString(),
    startTimeMs: serverStartTime,
  };
}

/** Get all collected metrics as a snapshot */
export function getMetricsSnapshot(): {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  histograms: Record<string, MetricSummary>;
  memory: Record<string, number>;
  server: { uptimeSeconds: number; startedAt: string };
} {
  const histograms: Record<string, MetricSummary> = {};
  for (const [name] of metrics) {
    const summary = getMetricSummary(name);
    if (summary) histograms[name] = summary;
  }

  return {
    counters: Object.fromEntries(counters),
    gauges: Object.fromEntries(gauges),
    histograms,
    memory: getMemoryUsage(),
    server: getServerTiming(),
  };
}

/** Error rate tracking */
const errorCounts = new Map<string, { count: number; windowStart: number }>();
const ERROR_WINDOW_MS = 60_000; // 1-minute window

export function trackError(category: string): void {
  const now = Date.now();
  const entry = errorCounts.get(category);

  if (!entry || now - entry.windowStart > ERROR_WINDOW_MS) {
    errorCounts.set(category, { count: 1, windowStart: now });
  } else {
    entry.count++;
  }
}

export function getErrorRates(): Record<
  string,
  { count: number; windowSeconds: number }
> {
  const result: Record<string, { count: number; windowSeconds: number }> = {};
  const now = Date.now();

  for (const [category, entry] of errorCounts) {
    if (now - entry.windowStart <= ERROR_WINDOW_MS) {
      result[category] = {
        count: entry.count,
        windowSeconds: Math.round((now - entry.windowStart) / 1000),
      };
    }
  }

  return result;
}
