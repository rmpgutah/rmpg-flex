// ============================================================
// tripLog — FORM PS-211 Trip Log (v2 schema)
// ============================================================
// Renders the per-officer trip log PDF from the JSON payload
// returned by GET /api/patrol/trip-log/generate. Uses the v2
// PDF engine (jsPDF) so the output matches the rest of the
// agency's form system.
//
// Columns (matches the printed FORM PS-211):
//   TYPE | CALL # | START | END | DIST (MI) | DUR (M) | MILEAGE | MAX MPH | HARSH (A/B/C)
//
// HARSH buckets:
//   A = hard acceleration
//   B = hard braking
//   C = sharp turn / cornering
//
// The PDF v2 engine TableField supports a "ratio" per column; we
// use ratios that match the screenshot's column widths.

import type { FormSchema, TableColumn } from '../engine/types';

export interface TripLogRow {
  type: 'PATROL' | 'RESPONSE';
  call_id: number | null;
  call_number: string | null;
  start: string;
  end: string;
  distance_mi: number;
  duration_min: number;
  mileage_from: number | null;
  mileage_to: number | null;
  max_mph: number;
  harsh: { a: number; b: number; c: number };
}

export interface TripLogData {
  meta: {
    officer_id: number | null;
    officer_name: string | null;
    unit_id: number | null;
    unit_call_sign: string | null;
    period: { from: string; to: string };
    generated_at: string;
    trips_logged: number;
  };
  anchor: { current_mileage: number; offset_miles: number } | null;
  rows: TripLogRow[];
  totals: {
    distance_mi: number;
    duration_min: number;
    harsh: { a: number; b: number; c: number };
  };
}

const fmtMi = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? '—' : n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const fmtMin = (m: number | null | undefined): string => {
  if (m == null || !Number.isFinite(m)) return '—';
  return `${m}`;
};

const fmtMph = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${Math.round(n)}`;
};

const fmtHarsh = (h: { a: number; b: number; c: number } | undefined): string => {
  if (!h) return '—';
  const parts: string[] = [];
  if (h.a) parts.push(`A:${h.a}`);
  if (h.b) parts.push(`B:${h.b}`);
  if (h.c) parts.push(`C:${h.c}`);
  return parts.length === 0 ? '—' : parts.join(' ');
};

const fmtTime = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  // Stored naive UTC strings like "2026-06-04 12:18:00". Render as
  // HH:MM (24h) so the PDF column stays narrow.
  const m = String(iso).match(/(\d{2}):(\d{2})/);
  if (m) return `${m[1]}:${m[2]}`;
  return String(iso);
};

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  return String(iso).slice(0, 10);
};

const TRIP_LOG_COLUMNS: TableColumn[] = [
  { key: 'type',         header: 'Type',          ratio: 0.7 },
  { key: 'call_number',  header: 'Call #',        ratio: 0.9 },
  { key: 'start',        header: 'Start',         ratio: 0.5 },
  { key: 'end',          header: 'End',            ratio: 0.5 },
  { key: 'distance_mi',  header: 'Dist (mi)',     ratio: 0.6 },
  { key: 'duration_min', header: 'Dur (m)',        ratio: 0.5 },
  { key: 'mileage',      header: 'Mileage',       ratio: 1.6 },
  { key: 'max_mph',      header: 'Max MPH',       ratio: 0.6 },
  { key: 'harsh',        header: 'Harsh (A/B/C)', ratio: 0.9 },
];

export const tripLogSchema: FormSchema<TripLogData> = {
  meta: {
    formNumber: 'PS-211',
    title: 'TRIP LOG',
    revision: '2026-03',
  },
  header: {
    kind: 'default',
    formId: 'trip_log',
    // The "case" slot in the header reads as REPORT PERIOD (date range).
    caseNumberAccessor: (d) => {
      const { from, to } = d.meta.period;
      return from === to ? from : `${from} — ${to}`;
    },
  },
  sections: [
    {
      kind: 'section',
      title: 'REPORT DETAILS',
      columns: 2,
      fields: [
        {
          kind: 'labeled',
          label: 'Unit',
          accessor: (d) => d.meta.unit_call_sign || '—',
          path: 'unit_call_sign',
        },
        {
          kind: 'labeled',
          label: 'Officer',
          accessor: (d) => d.meta.officer_name || '—',
          path: 'officer_name',
        },
        {
          kind: 'labeled',
          label: 'Trips Logged',
          accessor: (d) => d.meta.trips_logged,
          path: 'trips_logged',
        },
        {
          kind: 'labeled',
          label: 'Report Period',
          accessor: (d) => {
            const { from, to } = d.meta.period;
            return from === to ? from : `${from} — ${to}`;
          },
          path: 'report_period',
        },
        {
          kind: 'labeled',
          label: 'Generated',
          accessor: (d) => fmtDate(d.meta.generated_at),
          path: 'generated_at',
        },
        {
          kind: 'labeled',
          label: 'Anchor (current)',
          accessor: (d) => d.anchor ? fmtMi(d.anchor.current_mileage) : '—',
          path: 'anchor_current',
        },
      ],
    },
    {
      kind: 'section',
      title: 'TRIP LOG',
      columns: 1,
      fields: [
        {
          kind: 'table',
          label: '',
          columns: TRIP_LOG_COLUMNS,
          accessor: (d) => (d.rows || []).map((r) => ({
            type: r.type,
            call_number: r.call_number || '—',
            start: fmtTime(r.start),
            end: fmtTime(r.end),
            distance_mi: fmtMin(r.distance_mi),
            duration_min: fmtMin(r.duration_min),
            mileage: r.mileage_from != null && r.mileage_to != null
              ? `${fmtMi(r.mileage_from)}-${fmtMi(r.mileage_to)}`
              : '—',
            max_mph: fmtMph(r.max_mph),
            harsh: fmtHarsh(r.harsh),
          })),
          path: 'rows',
        },
      ],
    },
    {
      kind: 'section',
      title: 'TOTALS',
      columns: 2,
      fields: [
        {
          kind: 'labeled',
          label: 'Total Distance (mi)',
          accessor: (d) => fmtMi(d.totals.distance_mi),
          path: 'total_distance',
        },
        {
          kind: 'labeled',
          label: 'Total Duration (m)',
          accessor: (d) => fmtMin(d.totals.duration_min),
          path: 'total_duration',
        },
        {
          kind: 'labeled',
          label: 'Harsh A (Accel)',
          accessor: (d) => fmtMin(d.totals.harsh?.a ?? 0),
          path: 'harsh_a',
        },
        {
          kind: 'labeled',
          label: 'Harsh B (Brake)',
          accessor: (d) => fmtMin(d.totals.harsh?.b ?? 0),
          path: 'harsh_b',
        },
        {
          kind: 'labeled',
          label: 'Harsh C (Corner)',
          accessor: (d) => fmtMin(d.totals.harsh?.c ?? 0),
          path: 'harsh_c',
        },
        {
          kind: 'labeled',
          label: 'Anchor Offset (mi)',
          accessor: (d) => d.anchor ? fmtMi(d.anchor.offset_miles) : '—',
          path: 'anchor_offset',
        },
      ],
    },
  ],
};

/**
 * Sidecar-compatible data bag. The pdf engine only walks schema
 * fields that carry a `path` — see citation.ts for the same
 * pattern. Extracted for round-trip parity.
 */
export function tripLogCanonicalData(d: TripLogData): Record<string, unknown> {
  return {
    officer_name: d.meta.officer_name,
    unit_call_sign: d.meta.unit_call_sign,
    trips_logged: d.meta.trips_logged,
    report_period: `${d.meta.period.from} — ${d.meta.period.to}`,
    generated_at: d.meta.generated_at,
    anchor_current: d.anchor?.current_mileage ?? null,
    anchor_offset: d.anchor?.offset_miles ?? null,
    rows: d.rows,
    total_distance: d.totals.distance_mi,
    total_duration: d.totals.duration_min,
    harsh_a: d.totals.harsh?.a ?? 0,
    harsh_b: d.totals.harsh?.b ?? 0,
    harsh_c: d.totals.harsh?.c ?? 0,
  };
}
