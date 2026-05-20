// ═══════════════════════════════════════════════════════════════
// Fleet Inspection Report PDF — detailed checklist results
//
// Layout (portrait letter, 1–2 pages):
//   Header         — title, vehicle, inspector, date
//   Summary        — overall result badge, mileage
//   Checklist      — category groups with pass/fail/NA per item
//   Notes          — inspector notes
//   Sign-off       — signature lines
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import type { FleetVehicle, FleetInspection, InspectionItem } from '../../../types';

interface Args {
  vehicle: FleetVehicle;
  inspection: FleetInspection;
}

export function generateFleetInspectionReportPdf({ vehicle, inspection }: Args): void {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const marginX = 40;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = 40;

  const vehicleLabel = `#${vehicle.vehicle_number} - ${[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')}`;

  // ── Header ────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('RMPG FLEX - VEHICLE INSPECTION REPORT', marginX, y);
  y += 24;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(`Vehicle: ${vehicleLabel}`, marginX, y); y += 14;
  doc.text(`Inspector: ${inspection.inspector_name}`, marginX, y); y += 14;
  doc.text(`Date: ${inspection.inspection_date ? inspection.inspection_date.slice(0, 10) : '-'}`, marginX, y); y += 14;
  doc.text(`Type: ${(inspection.inspection_type || '').replace('_', ' ').toUpperCase()}`, marginX, y); y += 14;
  if (inspection.mileage) {
    doc.text(`Mileage: ${inspection.mileage.toLocaleString()}`, marginX, y); y += 14;
  }
  y += 8;

  // ── Overall Result ─────────────────────────────────────────
  const resultColors: Record<string, [number, number, number]> = {
    pass: [34, 197, 94],
    fail: [239, 68, 68],
    needs_attention: [245, 158, 11],
  };
  const [cr, cg, cb] = resultColors[inspection.overall_result] || [100, 100, 100];
  doc.setFillColor(cr, cg, cb);
  doc.rect(marginX, y, pageW - marginX * 2, 26, 'F');
  doc.setTextColor(255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(`OVERALL RESULT: ${(inspection.overall_result || 'UNKNOWN').replace('_', ' ').toUpperCase()}`, marginX + 12, y + 17);
  doc.setTextColor(0);
  y += 38;

  // ── Checklist Items ────────────────────────────────────────
  const items: InspectionItem[] = Array.isArray(inspection.items) ? inspection.items : [];
  if (items.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('INSPECTION CHECKLIST', marginX, y);
    y += 4;
    doc.setDrawColor(180);
    doc.line(marginX, y, pageW - marginX, y);
    y += 14;

    // Group by category
    const groups: Record<string, InspectionItem[]> = {};
    for (const item of items) {
      const cat = item.category || 'General';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    }

    const statusSymbol = (s: string) => {
      switch (s) {
        case 'pass': return '[PASS]';
        case 'fail': return '[FAIL]';
        case 'needs_attention': return '[ATTN]';
        case 'na': return '[N/A]';
        default: return '[?]';
      }
    };
    const statusColor = (s: string): [number, number, number] => {
      switch (s) {
        case 'pass': return [34, 150, 80];
        case 'fail': return [200, 50, 50];
        case 'needs_attention': return [200, 140, 0];
        default: return [100, 100, 100];
      }
    };

    for (const [category, catItems] of Object.entries(groups)) {
      if (y > pageH - 60) { doc.addPage(); y = 40; }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text(category.toUpperCase(), marginX, y);
      y += 13;

      doc.setFontSize(9);
      for (const item of catItems) {
        if (y > pageH - 40) { doc.addPage(); y = 40; }
        const [sr, sg, sb] = statusColor(item.status);
        doc.setTextColor(sr, sg, sb);
        doc.setFont('helvetica', 'bold');
        doc.text(statusSymbol(item.status), marginX + 8, y);
        doc.setTextColor(0);
        doc.setFont('helvetica', 'normal');
        doc.text(item.item, marginX + 48, y);
        if (item.notes) {
          doc.setTextColor(100);
          doc.text(`- ${item.notes}`, marginX + 250, y);
          doc.setTextColor(0);
        }
        y += 12;
      }
      y += 6;
    }
  } else {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text('No checklist items recorded.', marginX, y);
    y += 20;
  }

  // ── Notes ──────────────────────────────────────────────────
  if (inspection.notes) {
    if (y > pageH - 80) { doc.addPage(); y = 40; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('INSPECTOR NOTES', marginX, y); y += 14;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const wrapped = doc.splitTextToSize(inspection.notes, pageW - marginX * 2);
    doc.text(wrapped, marginX, y);
    y += wrapped.length * 12 + 10;
  }

  // ── Sign-off ───────────────────────────────────────────────
  const signY = Math.max(y + 30, pageH - 90);
  if (signY > pageH - 30) { doc.addPage(); }
  const finalY = signY > pageH - 30 ? 600 : signY;
  doc.setDrawColor(140);
  doc.setLineWidth(0.5);
  doc.line(marginX, finalY, marginX + 200, finalY);
  doc.line(marginX + 260, finalY, marginX + 400, finalY);
  doc.line(pageW - marginX - 120, finalY, pageW - marginX, finalY);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text('Inspector Signature', marginX, finalY + 12);
  doc.text('Supervisor Signature', marginX + 260, finalY + 12);
  doc.text('Date', pageW - marginX - 120, finalY + 12);
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

  const typeLabel = (inspection.inspection_type || 'inspection').replace('_', '-');
  const filename = `inspection-${typeLabel}-${vehicle.vehicle_number || 'vehicle'}-${inspection.inspection_date ? inspection.inspection_date.slice(0, 10) : 'undated'}.pdf`;
  doc.save(filename);
}
