// ═══════════════════════════════════════════════════════════════
// Fleet Vehicle Summary PDF — single-vehicle overview report
//
// Layout (portrait letter, 1–2 pages):
//   Header           — RMPG Flex title, vehicle identifier
//   Vehicle Info     — make/model/year, VIN, plate, status, mileage
//   Assignment       — current officer/unit, assignment history summary
//   Cost Summary     — lifetime fuel, maintenance, expenses totals
//   Service Status   — next service due, insurance/registration expiry
//   Footer           — generation timestamp + sign-off line
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import type { FleetVehicle } from '../../../types';

interface CostTotals {
  fuel: number;
  maintenance: number;
  expenses: number;
  loans: number;
  insurance: number;
  accessories: number;
  utilities: number;
}

interface Args {
  vehicle: FleetVehicle;
  assignedOfficer?: string;
  assignedUnit?: string;
  costTotals?: Partial<CostTotals>;
  recentMaintenance?: Array<{ type: string; performed_at: string; cost?: number }>;
}

export function generateFleetVehicleSummaryPdf({ vehicle, assignedOfficer, assignedUnit, costTotals, recentMaintenance }: Args): void {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const marginX = 40;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = 40;

  const fmtCurrency = (n: number | null | undefined) =>
    n == null ? '-' : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtNumber = (n: number | null | undefined) =>
    n == null ? '-' : n.toLocaleString();

  const vehicleLabel = `#${vehicle.vehicle_number} - ${[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')}`;

  // ── Header ────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('RMPG FLEX - VEHICLE SUMMARY REPORT', marginX, y);
  y += 22;
  doc.setFontSize(12);
  doc.text(vehicleLabel, marginX, y);
  y += 16;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Generated: ${new Date().toLocaleString()}`, marginX, y);
  y += 22;

  doc.setDrawColor(180);
  doc.line(marginX, y, pageW - marginX, y);
  y += 18;

  // ── Vehicle Information ────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('VEHICLE INFORMATION', marginX, y);
  y += 16;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const infoFields: [string, string][] = [
    ['Vehicle Number', `#${vehicle.vehicle_number}`],
    ['Status', (vehicle.status || 'unknown').replace('_', ' ').toUpperCase()],
    ['Year / Make / Model', [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || '-'],
    ['Color', vehicle.color || '-'],
    ['VIN', vehicle.vin || '-'],
    ['License Plate', vehicle.plate_number ? `${vehicle.plate_number} (${vehicle.plate_state || '-'})` : '-'],
    ['Current Mileage', fmtNumber(vehicle.current_mileage)],
  ];

  const colW = (pageW - marginX * 2) / 2;
  for (let i = 0; i < infoFields.length; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = marginX + col * colW;
    const rowY = y + row * 15;
    doc.setFont('helvetica', 'bold');
    doc.text(infoFields[i][0] + ':', x, rowY);
    doc.setFont('helvetica', 'normal');
    doc.text(infoFields[i][1], x + 110, rowY);
  }
  y += Math.ceil(infoFields.length / 2) * 15 + 12;

  // ── Assignment ─────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('CURRENT ASSIGNMENT', marginX, y);
  y += 16;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Officer: ${assignedOfficer || 'Unassigned'}`, marginX, y); y += 14;
  doc.text(`Unit: ${assignedUnit || 'Unassigned'}`, marginX, y); y += 18;

  // ── Service Status ─────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('SERVICE & COMPLIANCE STATUS', marginX, y);
  y += 16;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const serviceFields: [string, string][] = [
    ['Last Service Date', vehicle.last_service_date || '-'],
    ['Next Service Due', vehicle.next_service_due || '-'],
    ['Insurance Expiry', vehicle.insurance_expiry || '-'],
    ['Registration Expiry', vehicle.registration_expiry || '-'],
  ];
  for (const [label, value] of serviceFields) {
    doc.setFont('helvetica', 'bold');
    doc.text(label + ':', marginX, y);
    doc.setFont('helvetica', 'normal');
    doc.text(value, marginX + 130, y);
    y += 14;
  }
  y += 12;

  // ── Cost Summary ───────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('COST SUMMARY (LIFETIME)', marginX, y);
  y += 4;
  doc.line(marginX, y, pageW - marginX, y);
  y += 14;

  doc.setFontSize(10);
  const costs = costTotals || {};
  const costRows: [string, string][] = [
    ['Fuel', fmtCurrency(costs.fuel)],
    ['Maintenance', fmtCurrency(costs.maintenance)],
    ['General Expenses', fmtCurrency(costs.expenses)],
    ['Loan Payments', fmtCurrency(costs.loans)],
    ['Insurance Premiums', fmtCurrency(costs.insurance)],
    ['Accessories', fmtCurrency(costs.accessories)],
    ['Utilities', fmtCurrency(costs.utilities)],
  ];

  const total = Object.values(costs).reduce((s: number, v) => s + (Number(v) || 0), 0);

  for (const [label, value] of costRows) {
    doc.setFont('helvetica', 'normal');
    doc.text(label, marginX + 10, y);
    doc.text(value, marginX + 200, y);
    y += 13;
  }
  y += 4;
  doc.setFont('helvetica', 'bold');
  doc.line(marginX + 190, y - 4, marginX + 280, y - 4);
  doc.text('TOTAL:', marginX + 10, y + 4);
  doc.text(fmtCurrency(total), marginX + 200, y + 4);
  y += 22;

  // ── Recent Maintenance ─────────────────────────────────────
  if (recentMaintenance && recentMaintenance.length > 0) {
    if (y > pageH - 120) { doc.addPage(); y = 40; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('RECENT MAINTENANCE (LAST 5)', marginX, y);
    y += 16;

    doc.setFontSize(9);
    doc.text('Date', marginX, y);
    doc.text('Type', marginX + 100, y);
    doc.text('Cost', marginX + 250, y);
    y += 12;
    doc.setFont('helvetica', 'normal');
    for (const m of recentMaintenance.slice(0, 5)) {
      doc.text(m.performed_at ? m.performed_at.slice(0, 10) : '-', marginX, y);
      doc.text((m.type || 'service').replace('_', ' '), marginX + 100, y);
      doc.text(m.cost != null ? fmtCurrency(m.cost) : '-', marginX + 250, y);
      y += 11;
    }
  }

  // ── Sign-off ───────────────────────────────────────────────
  y = pageH - 70;
  doc.setDrawColor(140);
  doc.setLineWidth(0.5);
  doc.line(marginX, y, marginX + 220, y);
  doc.line(marginX + 300, y, pageW - marginX, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text('Supervisor (signature)', marginX, y + 12);
  doc.text('Date', marginX + 300, y + 12);
  doc.setTextColor(0);

  const filename = `vehicle-summary-${vehicle.vehicle_number || 'vehicle'}-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}
