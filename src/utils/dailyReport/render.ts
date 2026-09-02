// ============================================================
// RMPG Flex — Daily Blotter: PDF rendering (v2)
// ============================================================
// PURE: DailyReportData in, PDF bytes out. No D1, no R2, no clock.
// pdf-lib — pure JS, Workers-compatible, not billed per browser-minute.
//
// Layout: professional law-enforcement daily blotter format with
// section headers, bordered tables, consistent column alignment,
// and clear visual hierarchy.
// ============================================================

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { DailyReportData } from './types';
import { toDenverWallClock } from '../denverTime';

// ── Mountain-Time display helpers ────────────────────────────

/** Parse a D1 UTC timestamp string to a Date. */
function parseUtcStr(s: string): Date | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  let raw: string;
  if (/[Zz]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s.slice(-6))) {
    raw = s;
  } else if (/^\d{4}-\d{2}-\d{2} /.test(s)) {
    raw = s.replace(' ', 'T') + 'Z';
  } else if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    raw = s + 'Z';
  } else {
    return null;
  }
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function fmtMt(s: string | null, fallback?: string | null): string {
  const val = s || fallback;
  if (!val) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  const d = parseUtcStr(val);
  if (!d) return '—';
  const wall = toDenverWallClock(d);
  return `${wall.slice(0, 10)} ${wall.slice(11, 16)} MT`;
}

function fmtMtFull(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const wall = toDenverWallClock(d);
  return `${wall.slice(0, 10)} ${wall.slice(11, 19)} MT`;
}

const ACRONYMS = new Set(['pspso','psos','cfs','utah','slc','id','pp','gp']);

/** Convert snake_case to Title Case. */
function toDisplayLabel(s: string | null | undefined): string {
  if (!s) return '—';
  return s
    .replace(/_/g, ' ')
    .split(' ')
    .map(w => {
      const lower = w.toLowerCase();
      if (ACRONYMS.has(lower)) {
        if (lower === 'pspso' || lower === 'psos') return 'PSO';
        return lower.toUpperCase();
      }
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

/** Format unit_call_signs — treat empty/[]/null as '—'. */
function fmtUnits(s: string | null | undefined): string {
  if (!s) return '—';
  const trimmed = s.trim();
  if (trimmed === '' || trimmed === '[]' || trimmed === 'null' || trimmed === 'undefined') return '—';
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr) && arr.length > 0) {
        return arr.filter((v: unknown) => v != null && String(v).trim() !== '').join(', ') || '—';
      }
      return '—';
    } catch { return trimmed; }
  }
  return trimmed;
}

// ── Layout constants ─────────────────────────────────────────

const PAGE_W = 612;   // US Letter
const PAGE_H = 792;
const MARGIN_L = 48;
const MARGIN_R = 48;
const MARGIN_TOP = 48;
const MARGIN_BOT = 56;
const USABLE_W = PAGE_W - MARGIN_L - MARGIN_R;  // 516pt
const LINE_H = 11;
const SECTION_GAP = 18;
const TABLE_PAD = 3;

type FontRef = Awaited<ReturnType<PDFDocument['embedFont']>>;

interface Cursor {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any;
  y: number;
}

// ── Drawing primitives ───────────────────────────────────────

function drawHLine(doc: PDFDocument, cur: Cursor, color = rgb(0.3, 0.3, 0.3)): void {
  cur.page.drawLine({
    start: { x: MARGIN_L, y: cur.y + 4 },
    end: { x: PAGE_W - MARGIN_R, y: cur.y + 4 },
    thickness: 0.5,
    color,
  });
}

function drawRect(
  page: ReturnType<PDFDocument['addPage']>,
  x: number, y: number, w: number, h: number,
  color = rgb(0.92, 0.92, 0.92),
): void {
  page.drawRectangle({ x, y, width: w, height: h, color });
}

function ensureSpace(cur: Cursor, linesNeeded: number, doc: PDFDocument): void {
  if (cur.y - linesNeeded * LINE_H < MARGIN_BOT) {
    cur.page = doc.addPage([PAGE_W, PAGE_H]);
    cur.y = PAGE_H - MARGIN_TOP;
  }
}

function truncate(s: string, maxW: number, f: FontRef, size: number): string {
  if (f.widthOfTextAtSize(s, size) <= maxW) return s;
  const ellipsis = '…';
  let lo = 0, hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (f.widthOfTextAtSize(s.slice(0, mid) + ellipsis, size) <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return s.slice(0, lo) + ellipsis;
}

// ── Section header ───────────────────────────────────────────

function sectionHeader(
  cur: Cursor, title: string, bold: FontRef, doc: PDFDocument,
): void {
  ensureSpace(cur, 3, doc);
  cur.y -= 8;

  // Background bar
  drawRect(cur.page, MARGIN_L, cur.y - 2, USABLE_W, 16, rgb(0.88, 0.88, 0.88));

  // Title text
  cur.page.drawText(title.toUpperCase(), {
    x: MARGIN_L + 6, y: cur.y, size: 9,
    font: bold, color: rgb(0.1, 0.1, 0.1),
  });
  cur.y -= 18;

  // Separator line under header
  drawHLine(doc, cur, rgb(0.2, 0.2, 0.2));
  cur.y -= 4;
}

// ── Table helpers ────────────────────────────────────────────

function tableHeader(
  cur: Cursor, cols: { label: string; w: number }[],
  bold: FontRef, doc: PDFDocument,
): void {
  ensureSpace(cur, 2, doc);
  let x = MARGIN_L;
  for (const col of cols) {
    cur.page.drawText(col.label, {
      x, y: cur.y, size: 7,
      font: bold, color: rgb(0.25, 0.25, 0.25),
    });
    x += col.w;
  }
  cur.y -= 10;
  drawHLine(doc, cur, rgb(0.6, 0.6, 0.6));
  cur.y -= 3;
}

function tableRow(
  cur: Cursor, vals: string[], widths: number[],
  font: FontRef, doc: PDFDocument, stripe = false,
): void {
  ensureSpace(cur, 1, doc);

  // Zebra stripe
  if (stripe) {
    drawRect(cur.page, MARGIN_L, cur.y - 2, USABLE_W, LINE_H + 2, rgb(0.96, 0.96, 0.96));
  }

  let x = MARGIN_L;
  for (let i = 0; i < vals.length; i++) {
    const sz = 7.5;
    const maxW = widths[i] - 4;
    cur.page.drawText(truncate(vals[i], maxW, font, sz), {
      x, y: cur.y, size: sz,
      font, color: rgb(0.05, 0.05, 0.05),
    });
    x += widths[i];
  }
  cur.y -= LINE_H;
}

function noActivityRow(cur: Cursor, font: FontRef, doc: PDFDocument): void {
  ensureSpace(cur, 1, doc);
  cur.page.drawText('No activity recorded.', {
    x: MARGIN_L + 12, y: cur.y, size: 8,
    font, color: rgb(0.5, 0.5, 0.5), // italic simulated via lighter color
  });
  cur.y -= LINE_H;
}

// ── Main render ──────────────────────────────────────────────

export async function renderDailyReport(data: DailyReportData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const cur: Cursor = { page: doc.addPage([PAGE_W, PAGE_H]), y: PAGE_H - MARGIN_TOP };

  // ── Document header ──────────────────────────────────────
  // Company name
  cur.page.drawText('ROCKY MOUNTAIN PROTECTIVE GROUP', {
    x: MARGIN_L, y: cur.y, size: 18,
    font: bold, color: rgb(0.08, 0.08, 0.08),
  });
  cur.y -= 24;

  // Subtitle
  cur.page.drawText('DAILY ACTIVITY BLOTTER', {
    x: MARGIN_L, y: cur.y, size: 13,
    font: bold, color: rgb(0.2, 0.2, 0.2),
  });
  cur.y -= 18;

  // Date + generated line
  cur.page.drawText(`Report Date: ${data.date}`, {
    x: MARGIN_L, y: cur.y, size: 9,
    font, color: rgb(0.3, 0.3, 0.3),
  });
  cur.page.drawText(`Generated: ${fmtMtFull(data.generatedAt)}`, {
    x: PAGE_W - MARGIN_R - 200, y: cur.y, size: 9,
    font, color: rgb(0.3, 0.3, 0.3),
  });
  cur.y -= 12;

  // Thick separator
  cur.page.drawLine({
    start: { x: MARGIN_L, y: cur.y },
    end: { x: PAGE_W - MARGIN_R, y: cur.y },
    thickness: 1.5,
    color: rgb(0.15, 0.15, 0.15),
  });
  cur.y -= 14;

  // ── Summary counters ─────────────────────────────────────
  const totalCalls = data.operations.calls.length;
  const totalCitations = data.operations.citations.length;
  const totalTrips = data.fleet.trips.reduce((s, t) => s + (t.trips ?? 0), 0);
  const totalMiles = data.fleet.trips.reduce((s, t) => s + (t.miles ?? 0), 0);
  const totalFuel = data.fleet.fuel.length;
  const totalInspections = data.fleet.checks.length;
  const totalWorkOrders = data.fleet.workOrders.length;

  const summaryY = cur.y;
  const colW = USABLE_W / 4;

  const counters = [
    { label: 'CALLS', value: String(totalCalls) },
    { label: 'CITATIONS', value: String(totalCitations) },
    { label: 'TRIPS', value: String(totalTrips) },
    { label: 'MILES', value: String(Math.round(totalMiles)) },
  ];

  for (let i = 0; i < counters.length; i++) {
    const cx = MARGIN_L + i * colW + colW / 2;
    // Box
    drawRect(cur.page, MARGIN_L + i * colW + 8, summaryY - 4, colW - 16, 28, rgb(0.94, 0.94, 0.94));
    // Value
    const valW = bold.widthOfTextAtSize(counters[i].value, 16);
    cur.page.drawText(counters[i].value, {
      x: cx - valW / 2, y: summaryY + 8, size: 16,
      font: bold, color: rgb(0.08, 0.08, 0.08),
    });
    // Label
    const lblW = font.widthOfTextAtSize(counters[i].label, 7);
    cur.page.drawText(counters[i].label, {
      x: cx - lblW / 2, y: summaryY - 2, size: 7,
      font, color: rgb(0.4, 0.4, 0.4),
    });
  }
  cur.y -= 38;

  // ── OPERATIONS: Calls for Service ────────────────────────
  sectionHeader(cur, 'Calls for Service', bold, doc);

  if (data.operations.calls.length === 0) {
    noActivityRow(cur, font, doc);
  } else {
    const cols = [
      { label: 'TIME', w: 85 },
      { label: 'CALL #', w: 90 },
      { label: 'TYPE', w: 120 },
      { label: 'P', w: 20 },
      { label: 'LOCATION', w: 130 },
      { label: 'UNIT', w: 52 },
      { label: 'DISP', w: 69 },
    ];
    const widths = cols.map(c => c.w);
    tableHeader(cur, cols, bold, doc);

    for (let i = 0; i < data.operations.calls.length; i++) {
      const c = data.operations.calls[i];
      tableRow(cur, [
        fmtMt(c.received_at, c.created_at),
        c.call_number ?? '—',
        truncate(toDisplayLabel(c.incident_type), 130, font, 7.5),
        `P${c.priority ?? '—'}`,
        truncate(c.location_address ?? '—', 130, font, 7.5),
        fmtUnits(c.unit_call_signs),
        truncate(toDisplayLabel(c.disposition ?? c.status ?? '—'), 69, font, 7.5),
      ], widths, font, doc, i % 2 === 1);

      // Extra detail line: flags, source, zone, response time
      const flags = [
        c.weapons_involved ? 'WEAPONS' : '',
        c.domestic_violence ? 'DV' : '',
        c.mental_health_crisis ? 'MENTAL HEALTH' : '',
        c.juvenile_involved ? 'JUVENILE' : '',
        c.felony_in_progress ? 'FELONY' : '',
        c.officer_safety_caution ? 'OFFICER SAFETY' : '',
        c.k9_requested ? 'K9' : '',
        c.ems_requested ? 'EMS' : '',
        c.le_notified ? `LE:${c.le_case_number ?? '—'}` : '',
        c.supervisor_notified ? 'SUPERVISOR' : '',
      ].filter(Boolean).join(' | ');

      const meta = [
        c.source ? `Src:${c.source}` : '',
        c.sector_name ? `Sec:${c.sector_name}` : '',
        c.zone_name ? `Z:${c.zone_name}` : '',
        c.beat_name ? `B:${c.beat_name}` : '',
        c.dispatch_code ? `Code:${c.dispatch_code}` : '',
        c.caller_relationship ? `Caller:${c.caller_relationship}` : '',
        c.response_time_seconds != null ? `Resp:${Math.floor(c.response_time_seconds / 60)}m${Math.round(c.response_time_seconds % 60)}s` : '',
        c.onscene_duration_seconds != null ? `Scene:${Math.floor(c.onscene_duration_seconds / 60)}m${Math.round(c.onscene_duration_seconds % 60)}s` : '',
        c.scene_safety ? `Safe:${c.scene_safety}` : '',
        c.pso_requestor_name ? `PSO:${c.pso_requestor_name}(${c.pso_service_type ?? ''})` : '',
      ].filter(Boolean).join(' | ');

      const detailLine = [
        c.responding_officer ?? '—',
        flags,
        meta,
      ].filter(Boolean).join('  |  ');

      ensureSpace(cur, 1, doc);
      cur.page.drawText(truncate(detailLine, USABLE_W, font, 6.5), {
        x: MARGIN_L + 6, y: cur.y, size: 6.5,
        font, color: rgb(0.45, 0.45, 0.45),
      });
      cur.y -= 8;

      // Description / notes / action
      const textParts = [
        c.description ? `Dispatch: ${c.description}` : '',
        c.notes ? `Notes: ${c.notes}` : '',
        c.action_taken ? `Action: ${c.action_taken}` : '',
        c.damage_description ? `Damage: ${c.damage_description}${c.damage_estimate ? ` ($${c.damage_estimate})` : ''}` : '',
      ].filter(Boolean);
      if (textParts.length > 0) {
        const detailText = textParts.join('  |  ');
        ensureSpace(cur, 1, doc);
        cur.page.drawText(truncate(detailText, USABLE_W, font, 6.5), {
          x: MARGIN_L + 6, y: cur.y, size: 6.5,
          font, color: rgb(0.55, 0.55, 0.55),
        });
        cur.y -= 9;
      }
    }
  }

  // ── OPERATIONS: Citations ────────────────────────────────
  sectionHeader(cur, 'Citations', bold, doc);

  if (data.operations.citations.length === 0) {
    noActivityRow(cur, font, doc);
  } else {
    const cols = [
      { label: 'DATE', w: 80 },
      { label: 'CITATION #', w: 100 },
      { label: 'VIOLATION', w: 200 },
      { label: 'OFFICER', w: 80 },
      { label: 'FINE', w: 56 },
    ];
    const widths = cols.map(c => c.w);
    tableHeader(cur, cols, bold, doc);

    for (let i = 0; i < data.operations.citations.length; i++) {
      const c = data.operations.citations[i];
      tableRow(cur, [
        fmtMt(c.citation_date),
        c.citation_number ?? '—',
        truncate(c.violation_description ?? '—', 200, font, 7.5),
        truncate(c.issuing_officer_name ?? '—', 80, font, 7.5),
        `$${c.fine_amount ?? 0}`,
      ], widths, font, doc, i % 2 === 1);
    }
  }

  // ── Extended: Incidents ─────────────────────────────────
  // Note: incidents are collected via collectExtendedActivity, not passed to this PDF renderer.
  // PDF only covers base blotter data; incidents are in the HTML email only.

  // ── FLEET: Trips & Mileage ──────────────────────────────
  sectionHeader(cur, 'Fleet — Trips & Mileage', bold, doc);

  if (data.fleet.trips.length === 0) {
    noActivityRow(cur, font, doc);
  } else {
    const cols = [
      { label: 'VEHICLE', w: 160 },
      { label: 'TRIPS', w: 60 },
      { label: 'MILES', w: 80 },
      { label: 'DURATION', w: 100 },
    ];
    const widths = cols.map(c => c.w);
    tableHeader(cur, cols, bold, doc);

    for (let i = 0; i < data.fleet.trips.length; i++) {
      const t = data.fleet.trips[i];
      const durMin = Math.round((t.duration_s ?? 0) / 60);
      const hrs = Math.floor(durMin / 60);
      const mins = durMin % 60;
      tableRow(cur, [
        t.vehicle_label ?? '—',
        String(t.trips ?? 0),
        `${t.miles ?? 0}`,
        hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`,
      ], widths, font, doc, i % 2 === 1);
    }
  }

  // ── FLEET: Fuel ─────────────────────────────────────────
  sectionHeader(cur, 'Fleet — Fuel', bold, doc);

  if (data.fleet.fuel.length === 0) {
    noActivityRow(cur, font, doc);
  } else {
    const cols = [
      { label: 'DATE', w: 80 },
      { label: 'VEHICLE', w: 140 },
      { label: 'GALLONS', w: 70 },
      { label: 'COST', w: 70 },
      { label: 'ODOMETER', w: 80 },
      { label: 'STATION', w: 76 },
    ];
    const widths = cols.map(c => c.w);
    tableHeader(cur, cols, bold, doc);

    for (let i = 0; i < data.fleet.fuel.length; i++) {
      const f = data.fleet.fuel[i];
      tableRow(cur, [
        fmtMt(f.fuel_date),
        f.vehicle_label ?? '—',
        `${f.gallons ?? 0}`,
        `$${f.total_cost ?? 0}`,
        `${f.odometer ?? '—'}`,
        f.station ?? '',
      ], widths, font, doc, i % 2 === 1);
    }
  }

  // ── FLEET: Inspections ──────────────────────────────────
  sectionHeader(cur, 'Fleet — Inspections & Pre-Trip Checks', bold, doc);

  if (data.fleet.checks.length === 0) {
    noActivityRow(cur, font, doc);
  } else {
    const cols = [
      { label: 'DATE', w: 80 },
      { label: 'VEHICLE', w: 140 },
      { label: 'TYPE', w: 80 },
      { label: 'RESULT', w: 80 },
      { label: 'INSPECTOR', w: 136 },
    ];
    const widths = cols.map(c => c.w);
    tableHeader(cur, cols, bold, doc);

    for (let i = 0; i < data.fleet.checks.length; i++) {
      const c = data.fleet.checks[i];
      tableRow(cur, [
        fmtMt(c.performed_at),
        c.vehicle_label ?? '—',
        c.kind ?? '—',
        c.result ?? '—',
        c.performed_by ?? '',
      ], widths, font, doc, i % 2 === 1);
    }
  }

  // ── FLEET: Work Orders ──────────────────────────────────
  sectionHeader(cur, 'Fleet — Work Orders', bold, doc);

  if (data.fleet.workOrders.length === 0) {
    noActivityRow(cur, font, doc);
  } else {
    const cols = [
      { label: 'DATE', w: 80 },
      { label: 'ORDER #', w: 80 },
      { label: 'VEHICLE', w: 130 },
      { label: 'EVENT', w: 100 },
      { label: 'SUMMARY', w: 126 },
    ];
    const widths = cols.map(c => c.w);
    tableHeader(cur, cols, bold, doc);

    for (let i = 0; i < data.fleet.workOrders.length; i++) {
      const w = data.fleet.workOrders[i];
      tableRow(cur, [
        fmtMt(w.at),
        w.number ?? '—',
        w.vehicle_label ?? '—',
        w.event ?? '—',
        w.summary ?? '',
      ], widths, font, doc, i % 2 === 1);
    }
  }

  // ── Footer ──────────────────────────────────────────────
  // Bottom separator
  cur.y -= 12;
  drawHLine(doc, cur, rgb(0.15, 0.15, 0.15));

  const pages = doc.getPages();
  pages.forEach((p, i) => {
    // Page number centered
    const pgText = `Page ${i + 1} of ${pages.length}`;
    const pgW = font.widthOfTextAtSize(pgText, 7);
    p.drawText(pgText, {
      x: (PAGE_W - pgW) / 2, y: MARGIN_BOT - 20, size: 7, font,
      color: rgb(0.4, 0.4, 0.4),
    });
    // Confidential notice
    const confText = 'CONFIDENTIAL — Rocky Mountain Protective Group';
    const confW = font.widthOfTextAtSize(confText, 6);
    p.drawText(confText, {
      x: (PAGE_W - confW) / 2, y: MARGIN_BOT - 30, size: 6, font,
      color: rgb(0.6, 0.6, 0.6),
    });
  });

  return doc.save();
}
