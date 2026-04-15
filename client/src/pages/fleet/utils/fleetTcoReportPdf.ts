// ═══════════════════════════════════════════════════════════════
// Fleet Total Cost-of-Ownership PDF — unified per-vehicle report.
//
// Where the older fleetFuelReport covers one stream, this PDF rolls
// all six streams into one document: header, TCO summary cards,
// category breakdown (visual bars), then the full chronological
// timeline including both actual + extrapolated entries. Synthetic
// rows (loan/insurance projections) are tagged "(projected)" in the
// description column so an auditor can distinguish recorded from
// computed entries when reconciling with bank statements.
//
// Design choices that are intentional:
//   - Portrait letter. Gives us a taller page for long timelines.
//   - Plain ASCII "to" separator in date ranges (never "→" — cp1252
//     encoding doesn't round-trip the Unicode arrow in jsPDF's
//     default Helvetica; see the same fix in flaggedAuditPdf.ts).
//   - Category breakdown bars drawn as filled rectangles rather than
//     a library chart — keeps the PDF small and avoids bringing in
//     chart deps just for a static one-shot rendering.
//   - Per-category roll-up grid at the top makes the $$ summable at
//     a glance before the reader hits the chronological detail.
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import type {
  FleetVehicle, FleetCostSummary, CostTimelineEntry, CostCategoryKey,
} from '../../../types';

interface Args {
  vehicle: FleetVehicle;
  summary: FleetCostSummary;
  timeline: CostTimelineEntry[];
  /** Optional scope label — e.g. "Last 90 Days (2026-01-15 to 2026-04-15)".
   *  When omitted we derive it from the oldest/newest entry in the timeline. */
  periodLabel?: string;
}

const CATEGORY_LABEL: Record<CostCategoryKey, string> = {
  fuel: 'Fuel',
  maintenance: 'Maintenance',
  loan: 'Loan',
  insurance: 'Insurance',
  accessory: 'Accessory',
  utility: 'Utility',
};

// RGB triplets for category bars. Matches the on-screen palette roughly.
const CATEGORY_RGB: Record<string, [number, number, number]> = {
  fuel:        [6, 182, 212],   // cyan
  maintenance: [217, 119, 6],   // amber
  loan:        [37, 99, 235],   // blue
  insurance:   [34, 197, 94],   // green
  accessory:   [234, 179, 8],   // yellow
  utility:     [168, 85, 247],  // purple
};

export function generateFleetTcoReportPdf({ vehicle, summary, timeline, periodLabel }: Args): void {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const marginX = 40;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = 40;

  const vehicleLabel = `#${vehicle.vehicle_number} - ${[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')}`;

  // Derive period from timeline extrema when the caller doesn't provide one.
  // Uses oldest→newest across all entries regardless of synthetic flag,
  // since the report covers everything visible.
  const dates = timeline.map(t => t.date).filter(Boolean).sort();
  const autoRange = dates.length >= 2
    ? `${dates[0]} to ${dates[dates.length - 1]}`
    : dates.length === 1 ? dates[0] : '(no entries)';
  const periodText = periodLabel || autoRange;

  const fmt = (n: number | null | undefined, digits = 2, prefix = '') =>
    n == null ? '-' : `${prefix}${n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

  // ── Header ────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('RMPG FLEX - TOTAL COST OF OWNERSHIP', marginX, y);
  y += 22;

  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(`Vehicle: ${vehicleLabel}`, marginX, y); y += 14;
  doc.text(`Period:  ${periodText}`, marginX, y); y += 14;
  doc.text(`Generated: ${new Date().toLocaleString()}`, marginX, y); y += 22;

  doc.setDrawColor(180);
  doc.setLineWidth(0.5);
  doc.line(marginX, y, pageW - marginX, y);
  y += 10;

  // ── Headline figures ──────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('TCO SUMMARY', marginX, y);
  y += 14;

  const summaryCells = [
    ['Lifetime Total',   fmt(summary.total_lifetime, 2, '$')],
    ['Cost / Mile',      summary.cost_per_mile != null ? fmt(summary.cost_per_mile, 3, '$') : '-'],
    ['Monthly Loan',     fmt(summary.monthly_commitment.loan, 2, '$')],
    ['Monthly Insurance', fmt(summary.monthly_commitment.insurance, 2, '$')],
    ['Monthly Commit.',  fmt(summary.monthly_commitment.total, 2, '$')],
    ['Current Mileage',  vehicle.current_mileage != null ? vehicle.current_mileage.toLocaleString() : '-'],
  ];
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const colW = (pageW - marginX * 2) / 2;
  for (let i = 0; i < summaryCells.length; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = marginX + col * colW;
    const rowY = y + row * 16;
    doc.setFont('helvetica', 'bold');
    doc.text(summaryCells[i][0] + ':', x, rowY);
    doc.setFont('helvetica', 'normal');
    doc.text(summaryCells[i][1], x + 120, rowY);
  }
  y += Math.ceil(summaryCells.length / 2) * 16 + 12;

  // ── Category breakdown bars ───────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('CATEGORY BREAKDOWN', marginX, y);
  y += 4;
  doc.line(marginX, y, pageW - marginX, y);
  y += 14;

  const total = summary.total_lifetime || 1;
  const categories: Array<[string, number]> = [
    ['Fuel',        summary.categories.fuel],
    ['Maintenance', summary.categories.maintenance],
    ['Loan',        summary.categories.loans],
    ['Insurance',   summary.categories.insurance],
    ['Accessories', summary.categories.accessories],
    ['Utilities',   summary.categories.utilities],
  ];
  const categoryColorKeys: CostCategoryKey[] = ['fuel', 'maintenance', 'loan', 'insurance', 'accessory', 'utility'];

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  const barX = marginX + 90;
  const barMaxW = pageW - marginX * 2 - 90 - 140; // leave room for the $ + % labels
  for (let i = 0; i < categories.length; i++) {
    const [label, amount] = categories[i];
    const pct = (amount / total) * 100;
    const barW = (amount / total) * barMaxW;
    // jsPDF's setFillColor/setTextColor only take RGB triples (or hex
    // strings) — not a single grayscale number. Passing 235 compiles on
    // older @types/jspdf but fails the stricter current types, so we
    // always send three equal components for grayscale.
    doc.setTextColor(60, 60, 60);
    doc.text(label, marginX, y + 8);
    // Bar track
    doc.setDrawColor(200, 200, 200);
    doc.setFillColor(235, 235, 235);
    doc.rect(barX, y, barMaxW, 10, 'F');
    // Filled segment
    const [r, g, b] = CATEGORY_RGB[categoryColorKeys[i]] || [100, 100, 100];
    doc.setFillColor(r, g, b);
    doc.rect(barX, y, Math.max(0.5, barW), 10, 'F');
    // Right-side labels
    doc.setTextColor(30, 30, 30);
    doc.text(fmt(amount, 2, '$'), pageW - marginX - 70, y + 8, { align: 'right' });
    doc.setTextColor(120, 120, 120);
    doc.text(`${pct.toFixed(1)}%`, pageW - marginX, y + 8, { align: 'right' });
    doc.setTextColor(0, 0, 0);
    y += 14;
  }
  y += 8;

  // ── Unified timeline ──────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`UNIFIED TIMELINE (${timeline.length} entries)`, marginX, y);
  y += 4;
  doc.line(marginX, y, pageW - marginX, y);
  y += 14;

  const colDate   = marginX;
  const colCat    = marginX + 110;
  const colDesc   = marginX + 170;
  const colAmount = pageW - marginX - 60;

  doc.setFontSize(8);
  const drawHeader = (yy: number) => {
    doc.setFont('helvetica', 'bold');
    doc.text('Date',        colDate,   yy);
    doc.text('Category',    colCat,    yy);
    doc.text('Description', colDesc,   yy);
    doc.text('Amount',      colAmount, yy, { align: 'right' });
    doc.setFont('helvetica', 'normal');
  };
  drawHeader(y);
  y += 10;
  doc.setDrawColor(230);
  doc.line(marginX, y - 2, pageW - marginX, y - 2);

  const truncate = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + '...' : s);

  // Running total — newest-first on screen, but we iterate as given
  // (which is newest-first from the server). The running figure in the
  // PDF goes oldest-first so we flip once, then output in original order
  // with the pre-computed running value attached.
  const oldestFirst = [...timeline].reverse();
  let running = 0;
  const runningMap = new Map<string, number>();
  for (const e of oldestFirst) {
    running += Number(e.amount) || 0;
    runningMap.set(`${e.date}|${e.category}|${e.reference_id}`, running);
  }

  for (const entry of timeline) {
    if (y > pageH - 60) {
      doc.addPage();
      y = 40;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(`UNIFIED TIMELINE (continued)`, marginX, y);
      y += 16;
      doc.setFontSize(8);
      drawHeader(y);
      y += 10;
    }

    const desc = entry.synthetic
      ? `${truncate(entry.description, 48)} (projected)`
      : truncate(entry.description, 60);

    doc.text(entry.date, colDate, y);
    doc.text(CATEGORY_LABEL[entry.category] || entry.category, colCat, y);
    doc.text(desc, colDesc, y);
    doc.text(fmt(entry.amount, 2, '$'), colAmount, y, { align: 'right' });

    // Thin ruled underline per row — supports hand-marking if printed
    doc.setDrawColor(240);
    doc.line(marginX, y + 2, pageW - marginX, y + 2);
    y += 11;
  }

  // ── Footer on every page ──────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7);
    doc.setTextColor(140);
    doc.text(`RMPG Flex - TCO Report - ${vehicleLabel}`, marginX, pageH - 20);
    doc.text(`Page ${p} of ${pageCount}`, pageW - marginX, pageH - 20, { align: 'right' });
    doc.setTextColor(0);
  }

  const filename = `tco-report-${vehicle.vehicle_number || 'vehicle'}-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}
