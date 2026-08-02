// ============================================================
// RMPG Flex — Daily Blotter: PDF rendering
// ============================================================
// PURE: DailyReportData in, PDF bytes out. No D1, no R2, no clock —
// `generatedAt` arrives on the data. That purity is what lets the tests
// run with no bindings at all.
//
// pdf-lib rather than the [browser] Browser Rendering binding: it is
// pure JS, Workers-compatible, and not billed per browser-minute.
// The client keeps its own jsPDF v2 engine; the two coexist.
// ============================================================

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { DailyReportData } from './types';

const PAGE_W = 612;   // US Letter, points
const PAGE_H = 792;
const MARGIN = 48;
const LINE = 12;
const NO_ACTIVITY = 'No activity recorded.';
const MAX_TEXT_W = PAGE_W - MARGIN * 2;   // 516pt of usable line width

/** Truncate to what actually fits, measured — not a character count.
 *  A fixed char cap cannot work: 120 chars of 8pt Helvetica runs 480–530pt
 *  depending on character mix, and real call rows concatenate to ~168 chars
 *  (address alone reaches 77 on live data), so a digit- or uppercase-heavy
 *  line silently ran off the right edge. */
function fitToWidth(s: string, size: number, f: Awaited<ReturnType<PDFDocument['embedFont']>>): string {
  if (f.widthOfTextAtSize(s, size) <= MAX_TEXT_W) return s;
  const ellipsis = '…';
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (f.widthOfTextAtSize(s.slice(0, mid) + ellipsis, size) <= MAX_TEXT_W) lo = mid;
    else hi = mid - 1;
  }
  return s.slice(0, lo) + ellipsis;
}

interface Cursor { page: ReturnType<PDFDocument['addPage']>; y: number; }

export async function renderDailyReport(data: DailyReportData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const cur: Cursor = { page: doc.addPage([PAGE_W, PAGE_H]), y: PAGE_H - MARGIN };

  const newPage = (): void => {
    cur.page = doc.addPage([PAGE_W, PAGE_H]);
    cur.y = PAGE_H - MARGIN;
  };

  const text = (s: string, size: number, useBold: boolean): void => {
    if (cur.y < MARGIN + LINE) newPage();
    const useFont = useBold ? bold : font;
    cur.page.drawText(fitToWidth(s, size, useFont), {
      x: MARGIN, y: cur.y, size,
      font: useFont,
      color: rgb(0.05, 0.05, 0.05),
    });
    cur.y -= size + 4;
  };

  const heading = (s: string): void => { cur.y -= 6; text(s, 12, true); };
  const row = (s: string): void => text(s, 8, false);

  // ── Header ──
  text('Rocky Mountain Protective Group', 16, true);
  text(`Daily Blotter — ${data.date}`, 12, true);
  text(`Generated ${data.generatedAt}`, 8, false);

  // ── Operations ──
  heading('OPERATIONS — Calls for Service');
  if (data.operations.calls.length === 0) row(NO_ACTIVITY);
  for (const c of data.operations.calls) {
    row(`${c.received_at ?? '—'}  ${c.call_number ?? '—'}  ${c.incident_type ?? '—'}  P${c.priority ?? '—'}`);
    row(`    ${c.location_address ?? '—'}  |  unit ${c.unit_call_signs ?? '—'}  |  ${c.responding_officer ?? '—'}  |  ${c.disposition ?? c.status ?? '—'}`);
  }

  heading('OPERATIONS — Citations');
  if (data.operations.citations.length === 0) row(NO_ACTIVITY);
  for (const c of data.operations.citations) {
    row(`${c.citation_date ?? '—'}  ${c.citation_number ?? '—'}  ${c.violation_description ?? '—'}  $${c.fine_amount ?? 0}`);
  }

  // ── Fleet ──
  heading('FLEET — Trips & Mileage');
  if (data.fleet.trips.length === 0) row(NO_ACTIVITY);
  for (const t of data.fleet.trips) {
    row(`${t.vehicle_label}  ${t.trips} trip(s)  ${t.miles ?? 0} mi  ${Math.round((t.duration_s ?? 0) / 60)} min`);
  }

  heading('FLEET — Fuel');
  if (data.fleet.fuel.length === 0) row(NO_ACTIVITY);
  for (const f of data.fleet.fuel) {
    row(`${f.fuel_date ?? '—'}  ${f.vehicle_label}  ${f.gallons ?? 0} gal  $${f.total_cost ?? 0}  odo ${f.odometer ?? '—'}  ${f.station ?? ''}`);
  }

  heading('FLEET — Inspections & Pre-Trip Checks');
  if (data.fleet.checks.length === 0) row(NO_ACTIVITY);
  for (const c of data.fleet.checks) {
    row(`${c.performed_at ?? '—'}  ${c.vehicle_label}  ${c.kind}  ${c.result ?? '—'}  ${c.performed_by ?? ''}`);
  }

  heading('FLEET — Work Orders');
  if (data.fleet.workOrders.length === 0) row(NO_ACTIVITY);
  for (const w of data.fleet.workOrders) {
    row(`${w.at ?? '—'}  ${w.number ?? '—'}  ${w.vehicle_label}  ${w.event}  ${w.summary ?? ''}`);
  }

  // ── Footer page numbers ──
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawText(`Page ${i + 1} of ${pages.length}`, {
      x: PAGE_W - MARGIN - 70, y: MARGIN - 20, size: 7, font,
      color: rgb(0.4, 0.4, 0.4),
    });
  });

  return doc.save();
}
