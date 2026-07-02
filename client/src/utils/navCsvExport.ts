// ============================================================
// RMPG Flex — Navigation Session CSV Export
// Emits session movement samples as RFC-4180-quoted CSV. This is a
// NEW, nav-specific exporter — it intentionally does NOT touch the
// shared utils/csvExport.ts. Speed is converted to the active unit
// label; the serializer is pure, with a guarded downloadCsv helper.
// ============================================================

import { msToSpeed, type NavUnits } from './navUnits';
import { parseTimestamp } from './dateUtils';

export interface NavSample {
  /** epoch ms (or ISO string). */
  t?: number | string;
  lat?: number;
  lng?: number;
  /** speed in m/s. */
  speed?: number;
  /** heading in degrees. */
  heading?: number;
  /** GPS accuracy in metres. */
  accuracy?: number;
  /** elevation in metres. */
  elevation?: number;
}

const HEADERS = [
  'timestamp',
  'lat',
  'lng',
  'speed',
  'heading',
  'accuracy',
  'elevation',
] as const;

/** RFC-4180 field quoting — always quote, escape embedded quotes. */
function q(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

function isoOrEmpty(t: number | string | undefined): string {
  if (t == null) return '';
  const d = typeof t === 'number' ? new Date(t) : parseTimestamp(t);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

function num(n: number | undefined, digits: number): string {
  return Number.isFinite(n as number) ? (n as number).toFixed(digits) : '';
}

/**
 * Serialize movement samples to a CSV string. The `speed` column is
 * expressed in the active unit (mph or km/h), rounded to whole units.
 */
export function sessionToCsv(samples: NavSample[], units: NavUnits): string {
  const rows: string[] = [];
  rows.push(HEADERS.map(q).join(','));
  const list = Array.isArray(samples) ? samples : [];
  for (const s of list) {
    const speedDisp = Number.isFinite(s.speed as number)
      ? String(Math.round(msToSpeed(s.speed as number, units)))
      : '';
    rows.push(
      [
        q(isoOrEmpty(s.t)),
        q(num(s.lat, 6)),
        q(num(s.lng, 6)),
        q(speedDisp),
        q(num(s.heading, 0)),
        q(num(s.accuracy, 1)),
        q(num(s.elevation, 1)),
      ].join(','),
    );
  }
  return rows.join('\r\n');
}

/** Trigger a client-side download of a CSV string. No-op outside a browser. */
export function downloadCsv(filename: string, csv: string): void {
  try {
    if (typeof document === 'undefined' || typeof Blob === 'undefined') return;
    const safeName = /\.csv$/i.test(filename) ? filename : `${filename}.csv`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch {
    /* best effort */
  }
}
