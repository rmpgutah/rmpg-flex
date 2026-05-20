// ============================================================
// RMPG Flex — Observable Plot Charts
// ============================================================
// Declarative chart generation for CompStat reports, crime
// analytics, and operational dashboards. Returns SVG elements
// that can be inserted into any React component or PDF export.
// ============================================================

import * as Plot from '@observablehq/plot';

// ── Types ─────────────────────────────────────────────────

export interface CrimeByBeat {
  beat: string;
  count: number;
  type?: string;
}

export interface TimeSeriesPoint {
  date: Date | string;
  value: number;
  category?: string;
}

export interface HourDayCell {
  hour: number;
  day: number; // 0=Sun, 6=Sat
  count: number;
}

// ── Chart generators ──────────────────────────────────────

/**
 * Crime count bar chart by beat — for CompStat briefings.
 */
export function crimeByBeatChart(
  data: CrimeByBeat[],
  options: { width?: number; height?: number; title?: string } = {}
): SVGSVGElement | HTMLElement {
  const { width = 640, height = 400, title = 'Incidents by Beat' } = options;
  return Plot.plot({
    width,
    height,
    marginLeft: 60,
    marginBottom: 40,
    style: { background: '#0a0a0a', color: '#888' },
    x: { label: 'Beat', tickRotate: -45 },
    y: { label: 'Count', grid: true },
    marks: [
      Plot.barY(data, {
        x: 'beat',
        y: 'count',
        fill: '#d4a017',
        sort: { x: '-y' },
        tip: true,
      }),
      Plot.ruleY([0]),
    ],
    title,
  });
}

/**
 * Incident trend line chart over time — daily/weekly/monthly.
 */
export function incidentTrendChart(
  data: TimeSeriesPoint[],
  options: { width?: number; height?: number; title?: string } = {}
): SVGSVGElement | HTMLElement {
  const { width = 640, height = 300, title = 'Incident Trend' } = options;
  return Plot.plot({
    width,
    height,
    style: { background: '#0a0a0a', color: '#888' },
    x: { label: 'Date', type: 'utc' },
    y: { label: 'Count', grid: true },
    color: { legend: true },
    marks: [
      Plot.lineY(data, {
        x: 'date',
        y: 'value',
        stroke: data[0]?.category ? 'category' : '#d4a017',
        strokeWidth: 2,
        tip: true,
      }),
      Plot.dot(data, {
        x: 'date',
        y: 'value',
        fill: data[0]?.category ? 'category' : '#d4a017',
        r: 3,
      }),
    ],
    title,
  });
}

/**
 * Hour-of-day × day-of-week heatmap — shows peak crime times.
 */
export function crimeHeatmapChart(
  data: HourDayCell[],
  options: { width?: number; height?: number; title?: string } = {}
): SVGSVGElement | HTMLElement {
  const { width = 640, height = 300, title = 'Crime Density by Hour & Day' } = options;
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const enriched = data.map(d => ({ ...d, dayName: dayNames[d.day] }));

  return Plot.plot({
    width,
    height,
    style: { background: '#0a0a0a', color: '#888' },
    x: { label: 'Hour', domain: Array.from({ length: 24 }, (_, i) => i) },
    y: { label: 'Day', domain: dayNames },
    color: { scheme: 'YlOrRd', legend: true },
    marks: [
      Plot.cell(enriched, {
        x: 'hour',
        y: 'dayName',
        fill: 'count',
        tip: true,
      }),
    ],
    title,
  });
}

/**
 * Response time distribution chart — box-and-whisker style.
 */
export function responseTimeChart(
  data: Array<{ unit: string; responseMinutes: number }>,
  options: { width?: number; height?: number } = {}
): SVGSVGElement | HTMLElement {
  const { width = 640, height = 300 } = options;
  return Plot.plot({
    width,
    height,
    style: { background: '#0a0a0a', color: '#888' },
    x: { label: 'Response Time (min)' },
    y: { label: 'Unit' },
    marks: [
      Plot.boxX(data, {
        x: 'responseMinutes',
        y: 'unit',
        fill: '#d4a017',
        fillOpacity: 0.5,
        stroke: '#d4a017',
      }),
    ],
    title: 'Response Time Distribution by Unit',
  });
}

/**
 * Citation type pie/donut breakdown.
 */
export function citationBreakdownChart(
  data: Array<{ type: string; count: number }>,
  options: { width?: number; height?: number } = {}
): SVGSVGElement | HTMLElement {
  const { width = 400, height = 400 } = options;
  return Plot.plot({
    width,
    height,
    style: { background: '#0a0a0a', color: '#888' },
    marks: [
      Plot.barX(data, {
        x: 'count',
        y: 'type',
        fill: 'type',
        sort: { y: '-x' },
        tip: true,
      }),
      Plot.ruleX([0]),
    ],
    title: 'Citations by Type',
  });
}

// ── Utility ───────────────────────────────────────────────

/**
 * Mount a Plot chart into a container element (React useEffect pattern).
 * Returns a cleanup function to remove the chart.
 */
export function mountChart(
  container: HTMLElement,
  chart: SVGSVGElement | HTMLElement
): () => void {
  container.innerHTML = '';
  container.appendChild(chart);
  return () => {
    container.innerHTML = '';
  };
}
