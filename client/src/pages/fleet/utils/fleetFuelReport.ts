// ═══════════════════════════════════════════════════════════════
// Fleet Fuel Report — per-vehicle PDF generator
//
// Client-side only: we already have every row + the computed summary
// loaded into FleetPage state by the time the user clicks "Report",
// so the PDF builds from memory without another server round-trip.
// Downloaded with a deterministic filename so the browser opens the
// native save-as dialog.
//
// Layout (1–N pages):
//   Header       — RMPG Flex title, vehicle identifier, date range
//   Summary      — 6-up grid: total gallons, total cost, avg MPG,
//                  avg $/gal, best/worst MPG, $/mile, $/day
//   Entry table  — date, gallons, $/gal, total, MPG, station, flags
//                  page-breaks automatically at ~40 rows/page
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import type { FleetVehicle, FleetFuelLog, FleetFuelSummary } from '../../../types';
import { parseTimestamp } from '../../../utils/dateUtils';
import { toDisplayLabel } from '../../../utils/formatters';

interface Args {
  vehicle: FleetVehicle;
  fuelLogs: FleetFuelLog[];
  summary: FleetFuelSummary | null;
  /** Optional period label, e.g. "Last 30 Days (2026-03-15 to 2026-04-14)".
   *  When supplied, replaces the auto-derived first→last range so the PDF
   *  header reflects whatever filter the user had selected when they printed. */
  periodLabel?: string;
}

/** Format any fuel_date string (DB local-time or HTML datetime-local) into
 *  a consistent "YYYY-MM-DD HH:MM" — no T, no seconds, no truncation.
 *  Falls back to the raw string when the date can't be parsed. */
function formatLogDate(s: string | null | undefined): string {
  if (!s) return '';
  // Strip a trailing 'Z' so JS doesn't UTC-shift a string we know is local.
  const cleaned = s.replace(/Z$/, '').replace('T', ' ');
  // Already in display-friendly shape? Slice off any seconds/ms tail.
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(cleaned)) {
    return cleaned.slice(0, 16);
  }
  const d = parseTimestamp(s);
  if (isNaN(d.getTime())) return s; // last-resort raw passthrough
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Replace common Unicode separators that don't survive jsPDF's cp1252
 *  font encoding (e.g. U+2192 right-arrow renders as "â '" / "!'"). */
function asciify(s: string): string {
  return s.replace(/→/g, ' to ').replace(/—/g, ' - ').replace(/–/g, ' - ');
}

export function generateFleetFuelReport({ vehicle, fuelLogs, summary, periodLabel }: Args): void {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const marginX = 40;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = 40;

  // ASCII-only em-dash substitute so the heading renders cleanly under
  // jsPDF's default Helvetica/WinAnsi encoding (no Unicode dashes).
  const vehicleLabel = `#${vehicle.vehicle_number} - ${[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')}`;
  const dates = fuelLogs.map(l => l.fuel_date).filter(Boolean).sort();
  const autoRange = dates.length >= 2
    ? `${dates[0].slice(0, 10)} to ${dates[dates.length - 1].slice(0, 10)}`
    : dates.length === 1 ? dates[0].slice(0, 10) : '(no entries)';
  const dateRange = periodLabel ? asciify(periodLabel) : autoRange;

  // ── Header ────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('RMPG FLEX — FUEL REPORT', marginX, y);
  y += 22;

  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(`Vehicle: ${vehicleLabel}`, marginX, y);
  y += 14;
  doc.text(`Period:  ${dateRange}`, marginX, y);
  y += 14;
  doc.text(`Generated: ${new Date().toLocaleString()}`, marginX, y);
  y += 22;

  // ── Summary ───────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('SUMMARY', marginX, y);
  y += 4;
  doc.setLineWidth(0.5);
  doc.line(marginX, y, pageW - marginX, y);
  y += 14;

  // Use ASCII '-' instead of '—' (em-dash) — em-dash IS in cp1252, but the
  // Unicode hyphen-minus '-' is universally safe and avoids any reliance
  // on jsPDF's font-encoding round-trip.
  const fmt = (n: number | null | undefined, digits = 2, prefix = '') =>
    n == null ? '-' : `${prefix}${n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

  const fullTankCount = (summary as { full_tank_count?: number } | null)?.full_tank_count
    ?? fuelLogs.filter((l) => (l as { is_full_tank?: number | boolean }).is_full_tank !== 0
      && (l as { is_full_tank?: number | boolean }).is_full_tank !== false).length;
  const cells = [
    ['Total Gallons', fmt(summary?.total_gallons, 3)],
    ['Total Cost',    fmt(summary?.total_cost, 2, '$')],
    ['Avg MPG',       fmt(summary?.avg_mpg, 1)],
    ['Avg $/Gal',     fmt(summary?.avg_cost_per_gallon, 3, '$')],
    ['Best MPG',      fmt(summary?.best_mpg, 1)],
    ['Worst MPG',     fmt(summary?.worst_mpg, 1)],
    ['Total Miles',   fmt(summary?.total_distance, 1)],
    ['$/Mile',        fmt(summary?.cost_per_mile, 3, '$')],
    ['$/Day',         fmt(summary?.fuel_cost_per_day, 2, '$')],
    ['Log Count',     `${summary?.log_count ?? fuelLogs.length} (${fullTankCount} full-tank)`],
  ];
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const colW = (pageW - marginX * 2) / 2;
  for (let i = 0; i < cells.length; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = marginX + col * colW;
    const rowY = y + row * 16;
    doc.setFont('helvetica', 'bold');
    doc.text(cells[i][0] + ':', x, rowY);
    doc.setFont('helvetica', 'normal');
    doc.text(cells[i][1], x + 90, rowY);
  }
  y += Math.ceil(cells.length / 2) * 16 + 10;

  // ── Analytics breakdowns ──────────────────────────────────
  // Aggregate the loaded rows into spend breakdowns. All client-side from
  // the in-memory history — no extra round-trip. Helpers tolerate the
  // sentinel/null values D1 text columns return (see fleetFormatters note).
  const n = (v: unknown): number => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (typeof v === 'string') { const p = parseFloat(v); return Number.isFinite(p) ? p : 0; }
    return 0;
  };
  type Agg = { gallons: number; cost: number; count: number };
  const groupBy = (keyFn: (l: FleetFuelLog) => string): Map<string, Agg> => {
    const m = new Map<string, Agg>();
    for (const l of fuelLogs) {
      const k = keyFn(l) || '(unspecified)';
      const a = m.get(k) ?? { gallons: 0, cost: 0, count: 0 };
      a.gallons += n(l.gallons); a.cost += n(l.total_cost); a.count += 1;
      m.set(k, a);
    }
    return m;
  };
  const grandCost = fuelLogs.reduce((s, l) => s + n(l.total_cost), 0) || 1;

  // Generic breakdown-table renderer. Adds a page when low on space.
  const drawBreakdown = (
    title: string,
    rows: { label: string; gallons: number; cost: number; count: number }[],
    opts: { showGallons?: boolean } = {},
  ) => {
    if (rows.length === 0) return;
    if (y > pageH - 90) { doc.addPage(); y = 40; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(title, marginX, y);
    y += 4;
    doc.line(marginX, y, pageW - marginX, y);
    y += 13;
    doc.setFontSize(8);
    const cLabel = marginX, cGal = marginX + 200, cCost = marginX + 300, cPct = marginX + 400;
    doc.setFont('helvetica', 'bold');
    doc.text('Category', cLabel, y);
    if (opts.showGallons !== false) doc.text('Gallons', cGal, y);
    doc.text('Cost', cCost, y);
    doc.text('% of Spend', cPct, y);
    doc.setFont('helvetica', 'normal');
    y += 11;
    for (const r of rows) {
      if (y > pageH - 40) { doc.addPage(); y = 40; }
      doc.text(truncate(r.label, 30), cLabel, y);
      if (opts.showGallons !== false) doc.text(r.gallons.toFixed(2), cGal, y);
      doc.text(`$${r.cost.toFixed(2)}`, cCost, y);
      doc.text(`${((r.cost / grandCost) * 100).toFixed(1)}%`, cPct, y);
      y += 11;
    }
    y += 8;
  };

  const truncate = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + '…' : s);

  // Fuel-type breakdown
  drawBreakdown('FUEL TYPE BREAKDOWN',
    [...groupBy((l) => (l.fuel_type || '').toString())]
      .map(([label, a]) => ({ label: label.toUpperCase(), ...a }))
      .sort((a, b) => b.cost - a.cost));

  // Station breakdown (top 10 by spend)
  drawBreakdown('TOP STATIONS BY SPEND',
    [...groupBy((l) => (l.station || '').toString())]
      .map(([label, a]) => ({ label, ...a }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 10));

  // Payment-method breakdown (only if any row carries one)
  const payRows = [...groupBy((l) => ((l as { payment_method?: string }).payment_method || '').toString())]
    .map(([label, a]) => ({ label: label === '(unspecified)' ? label : toDisplayLabel(label), ...a }))
    .sort((a, b) => b.cost - a.cost);
  if (payRows.some((r) => r.label !== '(unspecified)')) {
    drawBreakdown('PAYMENT METHOD BREAKDOWN', payRows, { showGallons: false });
  }

  // Monthly spend + average price trend
  const monthly = groupBy((l) => (l.fuel_date || '').toString().slice(0, 7));
  const monthRows = [...monthly].filter(([k]) => /^\d{4}-\d{2}$/.test(k)).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (monthRows.length > 0) {
    if (y > pageH - 90) { doc.addPage(); y = 40; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('MONTHLY SPEND & PRICE TREND', marginX, y);
    y += 4;
    doc.line(marginX, y, pageW - marginX, y);
    y += 13;
    doc.setFontSize(8);
    const mMonth = marginX, mGal = marginX + 120, mCost = marginX + 220, mPpg = marginX + 340, mFills = marginX + 440;
    doc.setFont('helvetica', 'bold');
    doc.text('Month', mMonth, y); doc.text('Gallons', mGal, y); doc.text('Cost', mCost, y);
    doc.text('Avg $/Gal', mPpg, y); doc.text('Fills', mFills, y);
    doc.setFont('helvetica', 'normal');
    y += 11;
    for (const [month, a] of monthRows) {
      if (y > pageH - 40) { doc.addPage(); y = 40; }
      const ppg = a.gallons > 0 ? a.cost / a.gallons : 0;
      doc.text(month, mMonth, y);
      doc.text(a.gallons.toFixed(2), mGal, y);
      doc.text(`$${a.cost.toFixed(2)}`, mCost, y);
      doc.text(`$${ppg.toFixed(3)}`, mPpg, y);
      doc.text(String(a.count), mFills, y);
      y += 11;
    }
    y += 8;
  }

  // ── Entry table ───────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`ENTRIES (${fuelLogs.length})`, marginX, y);
  y += 4;
  doc.line(marginX, y, pageW - marginX, y);
  y += 14;

  // Column layout — total inner width = pageW - 2*marginX (~535).
  // 2026-04-14: widened the Date column from 95pt to 110pt so the full
  // "YYYY-MM-DD HH:MM" timestamp (16 chars at 7pt Helvetica ≈ 75pt) fits
  // with breathing room — fixes the long-standing date-cropped bug.
  const colDate    = marginX;
  const colGal     = marginX + 110;
  const colPpg     = marginX + 160;
  const colTotal   = marginX + 210;
  const colMpg     = marginX + 260;
  const colStation = marginX + 305;
  const colFlags   = marginX + 450;

  doc.setFontSize(8);
  const drawHeader = (yy: number) => {
    doc.setFont('helvetica', 'bold');
    doc.text('Date',    colDate, yy);
    doc.text('Gallons', colGal, yy);
    doc.text('$/Gal',   colPpg, yy);
    doc.text('Total',   colTotal, yy);
    doc.text('MPG',     colMpg, yy);
    doc.text('Station', colStation, yy);
    doc.text('Flags',   colFlags, yy);
    doc.setFont('helvetica', 'normal');
  };
  drawHeader(y);
  y += 12;

  for (const log of fuelLogs) {
    if (y > pageH - 50) {
      doc.addPage();
      y = 40;
      drawHeader(y);
      y += 12;
    }
    let flagStr = '';
    // Backend may attach a `flags` JSON string not present on the
    // FleetFuelLog interface — inline-cast to read it without widening
    // the shared type.
    const logFlags = (log as { flags?: string }).flags;
    if (logFlags) {
      try {
        const arr = JSON.parse(logFlags);
        if (Array.isArray(arr)) flagStr = arr.map((f: string) => f.split(':')[0].toUpperCase()).join(' ');
      } catch { /* ignore */ }
    }
    doc.text(formatLogDate(log.fuel_date), colDate, y);
    doc.text(log.gallons != null ? log.gallons.toFixed(3) : '-', colGal, y);
    doc.text(log.cost_per_gallon != null ? log.cost_per_gallon.toFixed(3) : '-', colPpg, y);
    doc.text(log.total_cost != null ? `$${log.total_cost.toFixed(2)}` : '-', colTotal, y);
    doc.text(log.mpg != null ? log.mpg.toFixed(1) : '-', colMpg, y);
    doc.text(truncate(log.station || '', 24), colStation, y);
    if (flagStr) {
      doc.setTextColor(200, 120, 0); // amber for flagged entries
      doc.text(flagStr, colFlags, y);
      doc.setTextColor(0, 0, 0);
    }
    y += 11;
  }

  // ── Save ──────────────────────────────────────────────────
  const filename = `fuel-report-${vehicle.vehicle_number || 'vehicle'}-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}
