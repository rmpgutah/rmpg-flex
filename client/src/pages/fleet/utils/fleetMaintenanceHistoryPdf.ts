// ═══════════════════════════════════════════════════════════════
// Fleet Maintenance History PDF — per-vehicle full maintenance log
//
// Layout (portrait letter, 1–N pages):
//   Header        — title, vehicle identifier, date range
//   Summary       — total records, total cost, avg cost, types breakdown
//   Table         — date, type, description, vendor, mileage, cost
//   Footer        — page numbers + generation timestamp
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import type { FleetVehicle, FleetMaintenance } from '../../../types';

interface Args {
  vehicle: FleetVehicle;
  records: FleetMaintenance[];
  periodLabel?: string;
}

export function generateFleetMaintenanceHistoryPdf({ vehicle, records, periodLabel }: Args): void {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const marginX = 40;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = 40;

  const fmtCurrency = (n: number | null | undefined) =>
    n == null ? '-' : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const truncate = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + '...' : s);

  const vehicleLabel = `#${vehicle.vehicle_number} - ${[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')}`;
  const dates = records.map(r => r.performed_at).filter(Boolean).sort();
  const autoRange = dates.length >= 2
    ? `${dates[0].slice(0, 10)} to ${dates[dates.length - 1].slice(0, 10)}`
    : dates.length === 1 ? dates[0].slice(0, 10) : '(no entries)';

  // ── Header ────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('RMPG FLEX - MAINTENANCE HISTORY', marginX, y);
  y += 22;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(`Vehicle: ${vehicleLabel}`, marginX, y); y += 14;
  doc.text(`Period:  ${periodLabel || autoRange}`, marginX, y); y += 14;
  doc.text(`Generated: ${new Date().toLocaleString()}`, marginX, y); y += 22;

  doc.setDrawColor(180);
  doc.line(marginX, y, pageW - marginX, y);
  y += 16;

  // ── Summary ───────────────────────────────────────────────
  const totalCost = records.reduce((s, r) => s + (r.cost || 0), 0);
  const avgCost = records.length > 0 ? totalCost / records.length : 0;
  const typeCounts: Record<string, number> = {};
  for (const r of records) {
    const t = r.type || 'other';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('SUMMARY', marginX, y); y += 16;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const summaryItems: [string, string][] = [
    ['Total Records', String(records.length)],
    ['Total Cost', fmtCurrency(totalCost)],
    ['Average Cost', fmtCurrency(avgCost)],
    ['Types', Object.entries(typeCounts).map(([t, c]) => `${t.replace('_', ' ')}(${c})`).join(', ') || '-'],
  ];
  for (const [label, value] of summaryItems) {
    doc.setFont('helvetica', 'bold');
    doc.text(label + ':', marginX, y);
    doc.setFont('helvetica', 'normal');
    doc.text(value, marginX + 100, y);
    y += 14;
  }
  y += 10;

  // ── Table ─────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`ENTRIES (${records.length})`, marginX, y);
  y += 4;
  doc.line(marginX, y, pageW - marginX, y);
  y += 14;

  const colDate = marginX;
  const colType = marginX + 85;
  const colDesc = marginX + 170;
  const colVendor = marginX + 330;
  const colMileage = marginX + 420;
  const colCost = marginX + 480;

  const drawHeader = (yy: number) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('Date', colDate, yy);
    doc.text('Type', colType, yy);
    doc.text('Description', colDesc, yy);
    doc.text('Vendor', colVendor, yy);
    doc.text('Mileage', colMileage, yy);
    doc.text('Cost', colCost, yy);
    doc.setFont('helvetica', 'normal');
  };
  drawHeader(y);
  y += 12;

  doc.setFontSize(8);
  for (const r of records) {
    if (y > pageH - 50) {
      doc.addPage();
      y = 40;
      drawHeader(y);
      y += 12;
    }
    doc.text(r.performed_at ? r.performed_at.slice(0, 10) : '-', colDate, y);
    doc.text((r.type || 'other').replace('_', ' '), colType, y);
    doc.text(truncate(r.description || '', 28), colDesc, y);
    doc.text(truncate(r.vendor || '-', 14), colVendor, y);
    doc.text(r.mileage_at_service != null ? r.mileage_at_service.toLocaleString() : '-', colMileage, y);
    doc.text(r.cost != null ? fmtCurrency(r.cost) : '-', colCost, y);
    y += 11;
  }

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

  const filename = `maintenance-history-${vehicle.vehicle_number || 'vehicle'}-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}
