// ═══════════════════════════════════════════════════════════════
// Fleet Damage Report PDF — individual or multi-damage report
//
// Layout (portrait letter, 1–N pages):
//   Header            — title, vehicle identifier
//   Per damage entry  — date, type, severity, location, description,
//                       repair status, costs, insurance info
//   Summary           — total estimated vs actual repair costs
//   Sign-off          — reviewer signature line
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import type { FleetVehicle } from '../../../types';

interface DamageRecord {
  id?: number | string;
  damage_date: string;
  damage_type: string;
  location_on_vehicle?: string;
  severity?: string;
  description: string;
  repair_estimate?: number;
  repair_cost?: number;
  repair_status?: string;
  insurance_claim_number?: string;
  reported_by_name?: string;
  reported_at?: string;
}

interface Args {
  vehicle: FleetVehicle;
  damages: DamageRecord[];
}

export function generateFleetDamageReportPdf({ vehicle, damages }: Args): void {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const marginX = 40;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = 40;

  const fmtCurrency = (n: number | null | undefined) =>
    n == null ? '-' : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const vehicleLabel = `#${vehicle.vehicle_number} - ${[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')}`;

  // ── Header ────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('RMPG FLEX - DAMAGE REPORT', marginX, y);
  y += 22;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(`Vehicle: ${vehicleLabel}`, marginX, y); y += 14;
  doc.text(`Total Reports: ${damages.length}`, marginX, y); y += 14;
  doc.text(`Generated: ${new Date().toLocaleString()}`, marginX, y); y += 20;

  doc.setDrawColor(180);
  doc.line(marginX, y, pageW - marginX, y);
  y += 16;

  // ── Summary totals ─────────────────────────────────────────
  const totalEstimate = damages.reduce((s, d) => s + (d.repair_estimate || 0), 0);
  const totalActual = damages.reduce((s, d) => s + (d.repair_cost || 0), 0);
  const severityCounts: Record<string, number> = {};
  for (const d of damages) {
    const sev = d.severity || 'unknown';
    severityCounts[sev] = (severityCounts[sev] || 0) + 1;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('SUMMARY', marginX, y); y += 16;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Total Estimated Repairs: ${fmtCurrency(totalEstimate)}`, marginX, y); y += 13;
  doc.text(`Total Actual Repairs: ${fmtCurrency(totalActual)}`, marginX, y); y += 13;
  doc.text(`Severity Breakdown: ${Object.entries(severityCounts).map(([s, c]) => `${s}(${c})`).join(', ')}`, marginX, y); y += 20;

  // ── Individual Damage Entries ──────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('DAMAGE ENTRIES', marginX, y);
  y += 4;
  doc.line(marginX, y, pageW - marginX, y);
  y += 14;

  for (let i = 0; i < damages.length; i++) {
    const d = damages[i];
    if (y > pageH - 120) { doc.addPage(); y = 40; }

    // Entry header with severity coloring
    const severityColors: Record<string, [number, number, number]> = {
      minor: [34, 150, 80],
      moderate: [200, 140, 0],
      major: [220, 100, 0],
      totaled: [200, 50, 50],
    };
    const [sr, sg, sb] = severityColors[d.severity || ''] || [80, 80, 80];

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(`#${i + 1}`, marginX, y);
    doc.setTextColor(sr, sg, sb);
    doc.text(`[${(d.severity || 'unknown').toUpperCase()}]`, marginX + 25, y);
    doc.setTextColor(0);
    doc.text(`${d.damage_type || 'Damage'} - ${d.damage_date ? d.damage_date.slice(0, 10) : 'undated'}`, marginX + 90, y);
    y += 14;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const fields: [string, string][] = [
      ['Location', d.location_on_vehicle || '-'],
      ['Repair Status', (d.repair_status || '-').replace('_', ' ')],
      ['Estimate', fmtCurrency(d.repair_estimate)],
      ['Actual Cost', fmtCurrency(d.repair_cost)],
    ];
    if (d.insurance_claim_number) {
      fields.push(['Insurance Claim', d.insurance_claim_number]);
    }
    if (d.reported_by_name) {
      fields.push(['Reported By', d.reported_by_name]);
    }

    for (const [label, value] of fields) {
      doc.setFont('helvetica', 'bold');
      doc.text(`${label}:`, marginX + 10, y);
      doc.setFont('helvetica', 'normal');
      doc.text(value, marginX + 100, y);
      y += 12;
    }

    // Description
    if (d.description) {
      doc.setFont('helvetica', 'bold');
      doc.text('Description:', marginX + 10, y); y += 11;
      doc.setFont('helvetica', 'normal');
      const wrapped = doc.splitTextToSize(d.description, pageW - marginX * 2 - 20);
      doc.text(wrapped, marginX + 10, y);
      y += wrapped.length * 10 + 4;
    }

    y += 10;
    doc.setDrawColor(220);
    doc.line(marginX + 20, y, pageW - marginX - 20, y);
    y += 12;
  }

  // ── Sign-off ───────────────────────────────────────────────
  if (y > pageH - 70) { doc.addPage(); y = pageH - 90; }
  const signY = pageH - 70;
  doc.setDrawColor(140);
  doc.setLineWidth(0.5);
  doc.line(marginX, signY, marginX + 220, signY);
  doc.line(marginX + 300, signY, pageW - marginX, signY);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text('Reviewed by (signature)', marginX, signY + 12);
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

  const filename = `damage-report-${vehicle.vehicle_number || 'vehicle'}-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}
