// ═══════════════════════════════════════════════════════════════
// Fleet Fuel Analytics PDF — landscape printable mirror of the
// /fuel-analytics dashboard, built from the three aggregate endpoints
// the analytics page already loaded. No extra fetching here.
//
// Layout (landscape letter, 1–N pages):
//   Header          — title, window label, generation timestamp
//   Totals strip    — fills, gallons, cost, avg $/gal, flag rate
//   Per-vehicle     — ranked by cost, paginates at ~30 rows/page
//   Per-driver      — ranked by cost
//   Per-card        — monthly spend vs limit
//   Top stations    — top 10 by fill count
//   Flagged board   — vehicles with most flagged fills
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import type {
  FuelAnalyticsOverview, FuelAnalyticsByOfficer, FuelAnalyticsByCard,
} from '../../../types';

interface Args {
  overview: FuelAnalyticsOverview;
  byOfficer: FuelAnalyticsByOfficer[];
  byCard: FuelAnalyticsByCard[];
}

export function generateFleetFuelAnalyticsPdf({ overview, byOfficer, byCard }: Args): void {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const marginX = 36;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const contentW = pageW - marginX * 2;
  let y = 36;

  const fmtCurrency = (n: number | null | undefined, d = 2) =>
    n == null ? '—' : `$${n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}`;
  const fmtNumber = (n: number | null | undefined, d = 0) =>
    n == null ? '—' : n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  const truncate = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + '…' : s);

  // Page-break helper — drops to next page when we've run out of room and
  // re-runs an optional heading-drawer on the new page.
  const ensureSpace = (needed: number, drawHeader?: () => void) => {
    if (y + needed > pageH - 36) {
      doc.addPage();
      y = 36;
      if (drawHeader) drawHeader();
    }
  };

  // ── Header ────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('RMPG FLEX — FLEET FUEL ANALYTICS', marginX, y);
  y += 18;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Window: last ${overview.days} days (since ${overview.since})`, marginX, y);
  doc.text(`Generated: ${new Date().toLocaleString()}`, pageW - marginX, y, { align: 'right' });
  y += 14;

  doc.setDrawColor(180);
  doc.setLineWidth(0.5);
  doc.line(marginX, y, pageW - marginX, y);
  y += 10;

  // ── Totals strip ──────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('SUMMARY', marginX, y);
  y += 10;
  doc.setFontSize(9);
  const totalsCells: [string, string][] = [
    ['Fills',       fmtNumber(overview.totals.fill_count)],
    ['Gallons',     fmtNumber(overview.totals.total_gallons, 1)],
    ['Total Cost',  fmtCurrency(overview.totals.total_cost)],
    ['Avg $/Gal',   overview.totals.avg_cpg != null ? `$${overview.totals.avg_cpg.toFixed(3)}` : '—'],
    ['Flag Rate',   `${overview.totals.flag_rate.toFixed(1)}%`],
  ];
  const cellW = contentW / totalsCells.length;
  for (let i = 0; i < totalsCells.length; i++) {
    const x = marginX + i * cellW;
    doc.setDrawColor(200);
    doc.rect(x, y, cellW - 4, 30);
    doc.setFont('helvetica', 'bold');
    doc.text(totalsCells[i][1], x + (cellW - 4) / 2, y + 14, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(totalsCells[i][0].toUpperCase(), x + (cellW - 4) / 2, y + 24, { align: 'center' });
    doc.setFontSize(9);
  }
  y += 38;

  // ── Helper: table header + rows ───────────────────────────
  const drawSection = (
    title: string,
    columns: Array<{ header: string; width: number; align?: 'left' | 'right' }>,
    rows: Array<(string | number)[]>,
  ) => {
    ensureSpace(30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(title, marginX, y);
    y += 4;
    doc.setDrawColor(180);
    doc.line(marginX, y, pageW - marginX, y);
    y += 12;

    const drawHeaderRow = () => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      let x = marginX;
      for (const col of columns) {
        const textX = col.align === 'right' ? x + col.width - 4 : x + 2;
        doc.text(col.header, textX, y, { align: col.align || 'left' });
        x += col.width;
      }
      doc.setFont('helvetica', 'normal');
      y += 10;
      doc.setDrawColor(230);
      doc.line(marginX, y - 2, pageW - marginX, y - 2);
    };
    drawHeaderRow();

    for (const row of rows) {
      ensureSpace(12, () => {
        // Re-title + header on new page
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text(title + ' (continued)', marginX, y);
        y += 4;
        doc.setDrawColor(180);
        doc.line(marginX, y, pageW - marginX, y);
        y += 12;
        drawHeaderRow();
      });
      let x = marginX;
      for (let i = 0; i < columns.length; i++) {
        const col = columns[i];
        const val = row[i] != null ? String(row[i]) : '';
        const textX = col.align === 'right' ? x + col.width - 4 : x + 2;
        doc.text(truncate(val, Math.floor(col.width / 4)), textX, y, { align: col.align || 'left' });
        x += col.width;
      }
      y += 11;
    }
    y += 10;
  };

  // ── Per-vehicle ranking ───────────────────────────────────
  drawSection('VEHICLES BY COST', [
    { header: 'Vehicle',   width: contentW * 0.35 },
    { header: 'Fills',     width: contentW * 0.08, align: 'right' },
    { header: 'Gallons',   width: contentW * 0.12, align: 'right' },
    { header: 'Cost',      width: contentW * 0.15, align: 'right' },
    { header: 'Avg MPG',   width: contentW * 0.12, align: 'right' },
    { header: 'Flag %',    width: contentW * 0.10, align: 'right' },
    { header: 'Mileage',   width: contentW * 0.08, align: 'right' },
  ], (overview.vehicles || []).filter(v => v.fill_count > 0).map(v => [
    `#${v.vehicle_number} ${[v.year, v.make, v.model].filter(Boolean).join(' ')}`,
    v.fill_count,
    v.total_gallons.toFixed(1),
    fmtCurrency(v.total_cost),
    v.avg_mpg != null ? v.avg_mpg.toFixed(1) : '—',
    `${v.flag_rate.toFixed(1)}%`,
    '',
  ]));

  // ── Per-driver ────────────────────────────────────────────
  drawSection('DRIVERS BY COST', [
    { header: 'Driver',   width: contentW * 0.35 },
    { header: 'Fills',    width: contentW * 0.08, align: 'right' },
    { header: 'Gallons',  width: contentW * 0.12, align: 'right' },
    { header: 'Cost',     width: contentW * 0.15, align: 'right' },
    { header: 'Avg MPG',  width: contentW * 0.12, align: 'right' },
    { header: 'Flag %',   width: contentW * 0.10, align: 'right' },
    { header: 'Avg $/Gal',width: contentW * 0.08, align: 'right' },
  ], byOfficer.map(o => [
    o.display_name,
    o.fill_count,
    o.total_gallons.toFixed(1),
    fmtCurrency(o.total_cost),
    o.avg_mpg != null ? o.avg_mpg.toFixed(1) : '—',
    `${o.flag_rate.toFixed(1)}%`,
    o.avg_cpg != null ? `$${o.avg_cpg.toFixed(3)}` : '—',
  ]));

  // ── Per-card ──────────────────────────────────────────────
  drawSection('FUEL CARDS — PERIOD SPEND', [
    { header: 'Card',        width: contentW * 0.30 },
    { header: 'Vehicle',     width: contentW * 0.25 },
    { header: 'Spent',       width: contentW * 0.15, align: 'right' },
    { header: 'Limit',       width: contentW * 0.15, align: 'right' },
    { header: 'Utilization', width: contentW * 0.15, align: 'right' },
  ], byCard.map(c => [
    `${c.card_number}${c.provider ? ` · ${c.provider}` : ''}`,
    c.vehicle_number ? `#${c.vehicle_number} ${[c.vehicle_make, c.vehicle_model].filter(Boolean).join(' ')}` : '(unassigned)',
    fmtCurrency(c.spent),
    c.monthly_limit != null ? fmtCurrency(c.monthly_limit) : '—',
    c.pct_of_limit != null ? `${c.pct_of_limit.toFixed(1)}%` : 'no limit',
  ]));

  // ── Top stations ──────────────────────────────────────────
  drawSection('TOP STATIONS', [
    { header: 'Station',     width: contentW * 0.55 },
    { header: 'Fills',       width: contentW * 0.15, align: 'right' },
    { header: 'Spent',       width: contentW * 0.15, align: 'right' },
    { header: 'Avg $/Gal',   width: contentW * 0.15, align: 'right' },
  ], (overview.top_stations || []).map(s => [
    s.station,
    s.fill_count,
    fmtCurrency(s.total_spent),
    s.avg_cpg != null ? `$${s.avg_cpg.toFixed(3)}` : '—',
  ]));

  // ── Flagged leaderboard ───────────────────────────────────
  if ((overview.flagged_leaderboard || []).length > 0) {
    drawSection('FLAGGED-ENTRY LEADERBOARD', [
      { header: 'Vehicle',       width: contentW * 0.70 },
      { header: 'Flagged Fills', width: contentW * 0.30, align: 'right' },
    ], (overview.flagged_leaderboard || []).map(v => [
      `#${v.vehicle_number} ${[v.make, v.model].filter(Boolean).join(' ')}`,
      v.flagged_count,
    ]));
  }

  // ── Footer on every page ──────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7);
    doc.setTextColor(140);
    doc.text('RMPG Flex — Fleet Fuel Analytics', marginX, pageH - 18);
    doc.text(`Page ${p} of ${pageCount}`, pageW - marginX, pageH - 18, { align: 'right' });
    doc.setTextColor(0);
  }

  const filename = `fuel-analytics-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}
