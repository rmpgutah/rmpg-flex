// ═══════════════════════════════════════════════════════════════
// Fleet Total Cost of Ownership (TCO) PDF — comprehensive cost summary
//
// Layout (portrait letter, 1–2 pages):
//   Header            — title, vehicle, generation date
//   Lifetime Summary  — grand total, cost/mile, cost/day, months owned
//   Category Breakdown — fuel, maintenance, expenses, loans, insurance,
//                        accessories, utilities (with % bars)
//   Monthly Trend     — last 12 months cost per month table
//   Projections       — annual cost estimate, replacement threshold
//   Sign-off          — management signature line
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import type { FleetVehicle } from '../../../types';

interface CostCategory {
  label: string;
  amount: number;
}

interface MonthlyData {
  month: string;   // "2026-04" format
  amount: number;
}

interface Args {
  vehicle: FleetVehicle;
  categories: CostCategory[];
  monthlyTrend?: MonthlyData[];
  totalMiles?: number;
  monthsOwned?: number;
}

export function generateFleetCostOwnershipPdf({ vehicle, categories, monthlyTrend, totalMiles, monthsOwned }: Args): void {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const marginX = 40;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = 40;

  const fmtCurrency = (n: number | null | undefined) =>
    n == null ? '-' : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const vehicleLabel = `#${vehicle.vehicle_number} - ${[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')}`;
  const grandTotal = categories.reduce((s, c) => s + c.amount, 0);
  const costPerMile = totalMiles && totalMiles > 0 ? grandTotal / totalMiles : null;
  const costPerMonth = monthsOwned && monthsOwned > 0 ? grandTotal / monthsOwned : null;
  const costPerDay = costPerMonth ? costPerMonth / 30 : null;

  // ── Header ────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('RMPG FLEX - TOTAL COST OF OWNERSHIP', marginX, y);
  y += 22;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(`Vehicle: ${vehicleLabel}`, marginX, y); y += 14;
  doc.text(`Generated: ${new Date().toLocaleString()}`, marginX, y); y += 22;

  doc.setDrawColor(180);
  doc.line(marginX, y, pageW - marginX, y);
  y += 18;

  // ── Lifetime Summary ───────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('LIFETIME SUMMARY', marginX, y); y += 16;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const summaryItems: [string, string][] = [
    ['Grand Total', fmtCurrency(grandTotal)],
    ['Total Miles', totalMiles ? totalMiles.toLocaleString() : '-'],
    ['Months Owned', monthsOwned ? String(monthsOwned) : '-'],
    ['Cost / Mile', costPerMile != null ? fmtCurrency(costPerMile) : '-'],
    ['Cost / Month', costPerMonth != null ? fmtCurrency(costPerMonth) : '-'],
    ['Cost / Day', costPerDay != null ? fmtCurrency(costPerDay) : '-'],
    ['Annualized Cost', costPerMonth != null ? fmtCurrency(costPerMonth * 12) : '-'],
  ];

  const colW = (pageW - marginX * 2) / 2;
  for (let i = 0; i < summaryItems.length; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = marginX + col * colW;
    const rowY = y + row * 15;
    doc.setFont('helvetica', 'bold');
    doc.text(summaryItems[i][0] + ':', x, rowY);
    doc.setFont('helvetica', 'normal');
    doc.text(summaryItems[i][1], x + 110, rowY);
  }
  y += Math.ceil(summaryItems.length / 2) * 15 + 16;

  // ── Category Breakdown ─────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('COST BREAKDOWN BY CATEGORY', marginX, y);
  y += 4;
  doc.line(marginX, y, pageW - marginX, y);
  y += 14;

  const barMaxW = 200;
  const maxCat = Math.max(...categories.map(c => c.amount), 1);

  doc.setFontSize(10);
  for (const cat of categories) {
    if (y > pageH - 60) { doc.addPage(); y = 40; }
    const pct = grandTotal > 0 ? ((cat.amount / grandTotal) * 100).toFixed(1) : '0.0';
    const barW = (cat.amount / maxCat) * barMaxW;

    doc.setFont('helvetica', 'normal');
    doc.text(cat.label, marginX, y);
    doc.text(fmtCurrency(cat.amount), marginX + 140, y);
    doc.text(`(${pct}%)`, marginX + 210, y);

    // Draw bar
    doc.setFillColor(212, 160, 23); // brand gold
    doc.rect(marginX + 260, y - 8, barW, 10, 'F');
    y += 16;
  }
  y += 10;

  // ── Monthly Trend ──────────────────────────────────────────
  if (monthlyTrend && monthlyTrend.length > 0) {
    if (y > pageH - 200) { doc.addPage(); y = 40; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('MONTHLY COST TREND (LAST 12 MONTHS)', marginX, y);
    y += 4;
    doc.line(marginX, y, pageW - marginX, y);
    y += 14;

    doc.setFontSize(9);
    doc.text('Month', marginX, y);
    doc.text('Amount', marginX + 100, y);
    doc.text('Bar', marginX + 180, y);
    y += 12;

    doc.setFont('helvetica', 'normal');
    const maxMonthly = Math.max(...monthlyTrend.map(m => m.amount), 1);
    for (const m of monthlyTrend.slice(-12)) {
      if (y > pageH - 40) { doc.addPage(); y = 40; }
      doc.text(m.month, marginX, y);
      doc.text(fmtCurrency(m.amount), marginX + 100, y);
      const bw = (m.amount / maxMonthly) * 200;
      doc.setFillColor(100, 100, 100);
      doc.rect(marginX + 180, y - 7, bw, 9, 'F');
      y += 13;
    }
  }

  // ── Sign-off ───────────────────────────────────────────────
  const signPage = doc.getNumberOfPages();
  doc.setPage(signPage);
  const signY = pageH - 70;
  doc.setDrawColor(140);
  doc.setLineWidth(0.5);
  doc.line(marginX, signY, marginX + 220, signY);
  doc.line(marginX + 300, signY, pageW - marginX, signY);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text('Fleet Manager (signature)', marginX, signY + 12);
  doc.text('Date', marginX + 300, signY + 12);
  doc.setTextColor(0);

  // ── Page numbers ───────────────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text(`Page ${p} of ${pageCount}`, pageW - marginX, pageH - 20, { align: 'right' });
    doc.setTextColor(0);
  }

  const filename = `tco-report-${vehicle.vehicle_number || 'vehicle'}-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}
