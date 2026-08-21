// ═══════════════════════════════════════════════════════════════
// Cleared Calls Summary — single-page (or multi-page) shift-end PDF
// for a dispatch supervisor. Lists every cleared call inside the
// requested window with its disposition + units + duration so a
// closing supervisor has one printable artifact instead of paging
// through the CSV export or printing per-call PDFs.
//
// Pure client-side: feed it the already-loaded `calls` array (no
// extra fetch); helper filters to status=cleared within the window
// and renders a banner + table. Same Arial + RMPG-gold idiom as
// darPdf / navTripPdf.
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import { registerArialFont } from './pdf/fonts/registerArial';
import type { CallForService } from '../types';
import { parseTimestamp } from './dateUtils';
import { toDisplayLabel } from './formatters';
import { drawNavyBanner } from './pdfStandaloneHeader';

const TEXT_DARK = '#1a1a1a';
const TEXT_MUTED = '#555555';
const BORDER = '#9a9a9a';

export interface ClearedSummaryInput {
  calls: CallForService[];
  windowStart: Date;
  windowEnd: Date;
  dispatcherName?: string;
}

export interface ClearedSummaryWindow {
  start: Date;
  end: Date;
}

/** Mountain Time = America/Denver. Single canonical TZ for the agency. */
const MT_TZ = 'America/Denver';

/** Compute the start of today in Mountain Time (returns a UTC Date positioned
 *  at midnight MT). Public so callers can derive a default window. DST-aware
 *  via Intl. */
export function startOfTodayMt(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MT_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  // 06:00Z ≈ 00:00 MT (MDT = UTC-6 in summer, MST = UTC-7 in winter); use 12:00Z
  // and roll back to MT midnight via timezone formatting to avoid DST math here.
  const probe = new Date(`${get('year')}-${get('month')}-${get('day')}T12:00:00Z`);
  // Walk back hour-by-hour until we land on 00:00 MT.
  for (let i = 0; i < 13; i++) {
    const h = new Intl.DateTimeFormat('en-CA', {
      timeZone: MT_TZ, hour: '2-digit', hour12: false,
    }).format(probe);
    if (h === '00') return probe;
    probe.setUTCHours(probe.getUTCHours() - 1);
  }
  return probe;
}

/** Returns the [start-of-today-MT, now] window — the default supervisor view. */
export function todayMtWindow(now: Date = new Date()): ClearedSummaryWindow {
  return { start: startOfTodayMt(now), end: now };
}

/** Filter the live calls array down to ones cleared inside the window.
 *  Falls back to `created_at` when `cleared_at` is missing so a row tagged
 *  status=cleared but missing a timestamp still surfaces. */
export function filterClearedInWindow(
  calls: CallForService[], window: ClearedSummaryWindow,
): CallForService[] {
  const startMs = window.start.getTime();
  const endMs = window.end.getTime();
  return calls.filter((c) => {
    if (c.status !== 'cleared' && c.status !== 'closed') return false;
    const ref = (c as any).cleared_at || c.created_at;
    if (!ref) return false;
    const t = parseTimestamp(ref).getTime();
    return t >= startMs && t <= endMs;
  });
}

/** "HH:MM" in Mountain Time. Stable across DST. */
function fmtMt(d: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: MT_TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
}

/** "Mon, Jun 21" in MT — used in the header. */
function fmtMtDate(d: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: MT_TZ, weekday: 'short', month: 'short', day: 'numeric',
  }).format(d);
}

/** Pretty duration (rounds to whole minutes). "—" for missing. */
function fmtDuration(createdIso: string | undefined, clearedIso: string | undefined): string {
  if (!createdIso || !clearedIso) return '—';
  const mins = Math.max(0, Math.round(
    (parseTimestamp(clearedIso).getTime() - parseTimestamp(createdIso).getTime()) / 60_000,
  ));
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/** Public for unit testing. Groups call dispositions and counts each. */
export function dispositionCounts(calls: CallForService[]): Array<{ code: string; count: number }> {
  const map = new Map<string, number>();
  for (const c of calls) {
    const k = (c.disposition || '—').toString();
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count);
}

/** Build the PDF, open in a new tab, and return the underlying doc.
 *  Layout: 8.5×11 portrait. Page-margin 0.5in. Banner is RMPG gold over
 *  charcoal; the table is monospace-tabular for column alignment. */
export function generateClearedSummaryPdf(input: ClearedSummaryInput): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  registerArialFont(doc);

  const { calls, windowStart, windowEnd, dispatcherName } = input;
  const W = doc.internal.pageSize.getWidth();
  const M = 36; // margin
  let y = 36;

  const range = `${fmtMtDate(windowStart)}  ${fmtMt(windowStart)} – ${fmtMt(windowEnd)}  MT`;
  y = drawNavyBanner(doc, {
    title: 'CLEARED CALLS SUMMARY',
    subtitle: 'Dispatch Operations',
    rightLine1: range,
  });

  // Top stats row
  doc.setDrawColor(BORDER);
  doc.setLineWidth(0.5);
  doc.rect(M, y, W - 2 * M, 38);
  doc.setFontSize(8);
  doc.setTextColor(TEXT_MUTED);
  const colW = (W - 2 * M) / 3;
  doc.text('CLEARED', M + 8, y + 12);
  doc.text('AVG DURATION', M + colW + 8, y + 12);
  doc.text('TOP DISPOSITION', M + 2 * colW + 8, y + 12);
  doc.setFontSize(14);
  doc.setFont('Arial', 'bold');
  doc.setTextColor(TEXT_DARK);
  doc.text(String(calls.length), M + 8, y + 30);

  const totalMins = calls.reduce((acc, c) => {
    const cl = (c as any).cleared_at as string | undefined;
    if (!c.created_at || !cl) return acc;
    return acc + Math.max(0, (parseTimestamp(cl).getTime() - parseTimestamp(c.created_at).getTime()) / 60_000);
  }, 0);
  const avgMins = calls.length > 0 ? Math.round(totalMins / calls.length) : 0;
  doc.text(avgMins >= 60 ? `${Math.floor(avgMins / 60)}h ${avgMins % 60}m` : `${avgMins}m`,
    M + colW + 8, y + 30);

  const top = dispositionCounts(calls)[0];
  doc.text(top ? `${top.code} (${top.count})` : '—', M + 2 * colW + 8, y + 30);
  y += 50;

  // Table header
  const cols = [
    { key: 'call_number',  label: 'CALL #',      width: 70 },
    { key: 'incident_type', label: 'TYPE',       width: 78 },
    { key: 'priority',     label: 'PRI',         width: 24 },
    { key: 'units',        label: 'UNITS',       width: 60 },
    { key: 'duration',     label: 'DURATION',    width: 50 },
    { key: 'cleared_at',   label: 'CLEARED',     width: 48 },
    { key: 'disposition',  label: 'DISPOSITION', width: 78 },
    { key: 'location',     label: 'LOCATION',    width: 134 },
  ] as const;

  doc.setFillColor('#e6e6e6');
  doc.rect(M, y, W - 2 * M, 16, 'F');
  doc.setFontSize(8);
  doc.setFont('Arial', 'bold');
  doc.setTextColor(TEXT_DARK);
  let x = M + 4;
  for (const col of cols) {
    doc.text(col.label, x, y + 11);
    x += col.width;
  }
  y += 16;

  doc.setFont('Arial', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(TEXT_DARK);

  const ellipsize = (s: string, max: number) => s.length <= max ? s : s.slice(0, max - 1) + '…';

  for (const c of calls) {
    if (y > 740) { doc.addPage(); y = 48; }
    x = M + 4;
    const clAt = (c as any).cleared_at as string | undefined;
    const row: Record<string, string> = {
      call_number: c.call_number,
      incident_type: ellipsize(toDisplayLabel(c.incident_type), 14),
      priority: c.priority,
      units: ellipsize((c.assigned_units || []).join(','), 9),
      duration: fmtDuration(c.created_at, clAt),
      cleared_at: clAt ? fmtMt(parseTimestamp(clAt)) : '—',
      disposition: ellipsize(c.disposition || '—', 14),
      location: ellipsize(c.location || '—', 26),
    };
    for (const col of cols) {
      doc.text(row[col.key] ?? '—', x, y + 10);
      x += col.width;
    }
    // Row separator
    doc.setDrawColor(BORDER);
    doc.setLineWidth(0.25);
    doc.line(M, y + 14, W - M, y + 14);
    y += 14;
  }

  if (calls.length === 0) {
    doc.setFont('Arial', 'italic');
    doc.setTextColor(TEXT_MUTED);
    doc.text('No calls cleared in this window.', M + 8, y + 14);
  }

  // Footer: generation timestamp
  doc.setFontSize(7);
  doc.setFont('Arial', 'normal');
  doc.setTextColor(TEXT_MUTED);
  const footY = doc.internal.pageSize.getHeight() - 18;
  doc.text(`Generated ${fmtMtDate(new Date())} ${fmtMt(new Date())} MT  ·  RMPG Flex CAD`, M, footY);

  return doc;
}

/** Generate + immediately open the PDF in a new tab. The doc.output('bloburl')
 *  return value is wrapped in window.open so the operator gets the OS print
 *  dialog as soon as the tab loads. */
export function openClearedSummaryPdf(input: ClearedSummaryInput): void {
  const doc = generateClearedSummaryPdf(input);
  const url = doc.output('bloburl');
  window.open(url, '_blank');
}
