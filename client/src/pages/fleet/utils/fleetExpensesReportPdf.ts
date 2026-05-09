// ═══════════════════════════════════════════════════════════════
// Fleet Expenses Report PDF — per-vehicle or fleet-wide expense log
//
// Layout (portrait letter, 1–N pages):
//   Header        — title, vehicle or "Fleet-wide", date range
//   Summary       — by-category totals with percentages
//   Table         — date, category, vendor, description, amount
//   Totals        — grand total at bottom
//   Footer        — page numbers + sign-off
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import type { FleetVehicle } from '../../../types';

interface ExpenseRecord {
  id?: number | string;
  expense_date: string;
  category: string;
  amount: number;
  vendor?: string;
  description?: string;
  odometer_reading?: number;
  recurring?: boolean | number;
  recurring_frequency?: string;
  notes?: string;
}

interface Args {
  vehicle?: FleetVehicle | null;
  expenses: ExpenseRecord[];
  periodLabel?: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  registration: 'Registration/Renewal',
  tolls: 'Tolls',
  parking: 'Parking',
  car_wash: 'Car Wash/Cleaning',
  tickets: 'Tickets/Fines',
  towing: 'Towing',
  permits: 'Permits',
  misc: 'Miscellaneous',
};

export function generateFleetExpensesReportPdf({ vehicle, expenses, periodLabel }: Args): void {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const marginX = 40;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = 40;

  const fmtCurrency = (n: number | null | undefined) =>
    n == null ? '-' : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const truncate = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + '...' : s);

  const scopeLabel = vehicle
    ? `#${vehicle.vehicle_number} - ${[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')}`
    : 'Fleet-wide';

  const dates = expenses.map(e => e.expense_date).filter(Boolean).sort();
  const autoRange = dates.length >= 2
    ? `${dates[0].slice(0, 10)} to ${dates[dates.length - 1].slice(0, 10)}`
    : dates.length === 1 ? dates[0].slice(0, 10) : '(no entries)';

  // ── Header ────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('RMPG FLEX - EXPENSES REPORT', marginX, y);
  y += 22;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(`Scope: ${scopeLabel}`, marginX, y); y += 14;
  doc.text(`Period: ${periodLabel || autoRange}`, marginX, y); y += 14;
  doc.text(`Generated: ${new Date().toLocaleString()}`, marginX, y); y += 20;

  doc.setDrawColor(180);
  doc.line(marginX, y, pageW - marginX, y);
  y += 16;

  // ── Category Summary ───────────────────────────────────────
  const grandTotal = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const byCategory: Record<string, { count: number; total: number }> = {};
  for (const e of expenses) {
    const cat = e.category || 'misc';
    if (!byCategory[cat]) byCategory[cat] = { count: 0, total: 0 };
    byCategory[cat].count++;
    byCategory[cat].total += e.amount || 0;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('CATEGORY BREAKDOWN', marginX, y); y += 16;

  doc.setFontSize(9);
  doc.text('Category', marginX, y);
  doc.text('Count', marginX + 180, y);
  doc.text('Total', marginX + 240, y);
  doc.text('% of Total', marginX + 320, y);
  y += 12;
  doc.setFont('helvetica', 'normal');

  const sortedCats = Object.entries(byCategory).sort((a, b) => b[1].total - a[1].total);
  for (const [cat, { count, total }] of sortedCats) {
    const pct = grandTotal > 0 ? ((total / grandTotal) * 100).toFixed(1) : '0.0';
    doc.text(CATEGORY_LABELS[cat] || cat, marginX, y);
    doc.text(String(count), marginX + 180, y);
    doc.text(fmtCurrency(total), marginX + 240, y);
    doc.text(`${pct}%`, marginX + 320, y);
    y += 12;
  }
  y += 4;
  doc.setFont('helvetica', 'bold');
  doc.text('GRAND TOTAL', marginX, y);
  doc.text(fmtCurrency(grandTotal), marginX + 240, y);
  y += 20;

  // ── Entries Table ──────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`ENTRIES (${expenses.length})`, marginX, y);
  y += 4;
  doc.line(marginX, y, pageW - marginX, y);
  y += 14;

  const colDate = marginX;
  const colCat = marginX + 82;
  const colVendor = marginX + 195;
  const colDesc = marginX + 295;
  const colAmount = marginX + 450;

  const drawTableHeader = (yy: number) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('Date', colDate, yy);
    doc.text('Category', colCat, yy);
    doc.text('Vendor', colVendor, yy);
    doc.text('Description', colDesc, yy);
    doc.text('Amount', colAmount, yy);
    doc.setFont('helvetica', 'normal');
  };
  drawTableHeader(y);
  y += 12;

  doc.setFontSize(8);
  for (const e of expenses) {
    if (y > pageH - 50) {
      doc.addPage();
      y = 40;
      drawTableHeader(y);
      y += 12;
    }
    doc.text(e.expense_date ? e.expense_date.slice(0, 10) : '-', colDate, y);
    doc.text(CATEGORY_LABELS[e.category] || e.category || '-', colCat, y);
    doc.text(truncate(e.vendor || '-', 16), colVendor, y);
    doc.text(truncate(e.description || '-', 24), colDesc, y);
    doc.text(fmtCurrency(e.amount), colAmount, y);
    y += 11;
  }

  // ── Sign-off ───────────────────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    const signY = pageH - 44;
    doc.setDrawColor(140);
    doc.setLineWidth(0.5);
    doc.line(marginX, signY, marginX + 220, signY);
    doc.line(marginX + 280, signY, pageW - marginX, signY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text('Reviewed by (signature)', marginX, signY + 10);
    doc.text('Date', marginX + 280, signY + 10);
    doc.text(`Page ${p} of ${pageCount}`, pageW - marginX, signY + 10, { align: 'right' });
    doc.setTextColor(0);
  }

  const scopePart = vehicle ? vehicle.vehicle_number || 'vehicle' : 'fleet';
  const filename = `expenses-report-${scopePart}-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}
