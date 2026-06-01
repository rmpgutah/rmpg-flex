// ============================================================
// RMPG Flex — Tactical Situation Report (Map → PDF)
// ============================================================
// Renders the current map picture into a branded one-/two-page
// situation report: live snapshot, force/incident posture, active
// calls + units tables, analysis intel, and any active patrol route.
// Black-on-white police-report style (matches the rest of the suite).
// ============================================================

import jsPDF from 'jspdf';
import { loadLogoDarkBase64 } from './pdfAssets';
import {
  fetchPdfBranding,
  DEFAULT_PDF_BRANDING,
  sanitizePdfText,
  finalizePoliceReport,
  hexToRgb,
} from './pdfGenerator';
import { LAYOUT } from './pdfTokens';

export interface SitRepCall {
  call_number: string;
  incident_type: string;
  priority: string;
  status: string;
  location_address: string;
}

export interface SitRepUnit {
  call_sign: string;
  officer_name: string;
  status: string;
  current_call_type?: string | null;
  current_call_location?: string | null;
}

export interface SitRepPatrolStop {
  order: number;
  callNumber: string;
  label?: string;
  legEta: string;
}

export interface MapSituationReportData {
  /** PNG data URL captured from the map canvas (null → text-only report). */
  mapImageDataUrl: string | null;
  /** Aspect ratio (w/h) of the captured canvas, for correct placement. */
  mapAspect: number;
  operator: string;
  center: { lat: number; lng: number };
  zoom: number;
  calls: SitRepCall[];
  units: SitRepUnit[];
  analysis?: {
    safetyZones?: number;
    highRisk?: number;
    predictions?: number;
    repeatAddrs?: number;
  } | null;
  patrol?: {
    unitCallSign: string;
    totalEta: string;
    totalDistance: string;
    stops: SitRepPatrolStop[];
  } | null;
}

// Priority swatch colors (match the on-screen heat scale).
const PRI_RGB: Record<string, [number, number, number]> = {
  P1: [220, 38, 38],
  P2: [245, 158, 11],
  P3: [184, 137, 58],
  P4: [122, 106, 63],
};

function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function generateMapSituationReport(data: MapSituationReportData): Promise<void> {
  const branding = await fetchPdfBranding().catch(() => DEFAULT_PDF_BRANDING);
  const logoB64 = await loadLogoDarkBase64().catch(() => null);
  const accent = hexToRgb(branding.accent_color || DEFAULT_PDF_BRANDING.accent_color);

  const doc = new jsPDF('portrait', 'mm', 'letter');
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = LAYOUT.PAGE_MARGIN;
  const contentW = pageW - margin * 2;

  const now = new Date();
  const stamp = now.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });

  // ── Header bar (black, logo + title) ──────────────────────
  let y = margin;
  doc.setFillColor(0, 0, 0);
  doc.rect(margin, y, contentW, 16, 'F');
  if (logoB64) {
    try { doc.addImage(logoB64, 'PNG', margin + 2, y + 2.5, 11, 11); } catch { /* ignore */ }
  }
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('TACTICAL SITUATION REPORT', margin + 16, y + 7);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(accent[0], accent[1], accent[2]);
  doc.text(sanitizePdfText(branding.report_header_text || 'Rocky Mountain Protective Group'), margin + 16, y + 12);
  // Right-aligned meta
  doc.setTextColor(190, 190, 190);
  doc.setFontSize(7);
  doc.text(`GENERATED  ${stamp}`, pageW - margin - 2, y + 6, { align: 'right' });
  doc.text(`OPERATOR  ${sanitizePdfText(data.operator || '—')}`, pageW - margin - 2, y + 10.5, { align: 'right' });
  y += 16 + 4;

  // ── Posture strip (counts) ────────────────────────────────
  const callsByPri: Record<string, number> = {};
  data.calls.forEach((c) => { callsByPri[c.priority] = (callsByPri[c.priority] || 0) + 1; });
  const unitsByStatus: Record<string, number> = {};
  data.units.forEach((u) => { unitsByStatus[u.status] = (unitsByStatus[u.status] || 0) + 1; });
  const available = unitsByStatus['available'] || 0;

  const cells: { label: string; value: string }[] = [
    { label: 'ACTIVE CALLS', value: String(data.calls.length) },
    { label: 'P1 / P2', value: `${callsByPri['P1'] || 0} / ${callsByPri['P2'] || 0}` },
    { label: 'UNITS', value: String(data.units.length) },
    { label: 'AVAILABLE', value: String(available) },
    { label: 'CENTER', value: `${data.center.lat.toFixed(3)}, ${data.center.lng.toFixed(3)}` },
    { label: 'ZOOM', value: data.zoom.toFixed(1) },
  ];
  const cellW = contentW / cells.length;
  doc.setDrawColor(60, 60, 60);
  doc.setLineWidth(0.3);
  cells.forEach((cell, i) => {
    const cx = margin + i * cellW;
    doc.rect(cx, y, cellW, 13);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.8);
    doc.setTextColor(120, 120, 120);
    doc.text(cell.label, cx + cellW / 2, y + 4, { align: 'center' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(20, 20, 20);
    doc.text(cell.value, cx + cellW / 2, y + 10, { align: 'center' });
  });
  y += 13 + 5;

  // ── Map snapshot ──────────────────────────────────────────
  if (data.mapImageDataUrl) {
    const aspect = data.mapAspect > 0.2 && data.mapAspect < 5 ? data.mapAspect : 1.6;
    const imgW = contentW;
    let imgH = imgW / aspect;
    const maxH = 110;
    if (imgH > maxH) imgH = maxH;
    const drawW = imgH * aspect <= contentW ? imgH * aspect : contentW;
    const offX = margin + (contentW - drawW) / 2;
    try {
      doc.addImage(data.mapImageDataUrl, 'PNG', offX, y, drawW, imgH);
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.4);
      doc.rect(offX, y, drawW, imgH);
      y += imgH + 5;
    } catch {
      // Capture failed — continue text-only.
    }
  }

  // ── Section helper ────────────────────────────────────────
  const sectionHeader = (title: string) => {
    if (y > pageH - 30) { doc.addPage(); y = margin; }
    doc.setFillColor(0, 0, 0);
    doc.rect(margin, y, contentW, 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text(title.toUpperCase(), margin + 2, y + 4.2);
    y += 6 + 1;
  };

  const ensureSpace = (need: number) => {
    if (y + need > pageH - 14) { doc.addPage(); y = margin; }
  };

  // ── Active Calls table ────────────────────────────────────
  sectionHeader(`Active Calls (${data.calls.length})`);
  if (data.calls.length === 0) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); doc.setTextColor(120, 120, 120);
    doc.text('No active calls.', margin + 2, y + 4); y += 8;
  } else {
    const cols = [
      { w: 22, label: 'CALL #' },
      { w: 16, label: 'PRI' },
      { w: 40, label: 'TYPE' },
      { w: 28, label: 'STATUS' },
      { w: contentW - 22 - 16 - 40 - 28, label: 'LOCATION' },
    ];
    // header row
    doc.setFillColor(235, 235, 235); doc.rect(margin, y, contentW, 5, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6); doc.setTextColor(60, 60, 60);
    let cx = margin;
    cols.forEach((c) => { doc.text(c.label, cx + 1.5, y + 3.4); cx += c.w; });
    y += 5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
    data.calls.slice(0, 40).forEach((call, idx) => {
      ensureSpace(6);
      if (y === margin) {
        // new page — redraw header
      }
      if (idx % 2 === 1) { doc.setFillColor(247, 247, 247); doc.rect(margin, y, contentW, 5, 'F'); }
      cx = margin;
      doc.setTextColor(20, 20, 20);
      doc.text(sanitizePdfText(call.call_number || '—'), cx + 1.5, y + 3.5); cx += cols[0].w;
      // priority chip
      const pr = PRI_RGB[call.priority] || [90, 90, 90];
      doc.setFillColor(pr[0], pr[1], pr[2]);
      doc.roundedRect(cx + 1.5, y + 1, 11, 3.2, 0.4, 0.4, 'F');
      doc.setTextColor(255, 255, 255); doc.setFontSize(5.5); doc.setFont('helvetica', 'bold');
      doc.text(call.priority || '—', cx + 7, y + 3.3, { align: 'center' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(20, 20, 20);
      cx += cols[1].w;
      doc.text(titleCase(call.incident_type || '—').slice(0, 26), cx + 1.5, y + 3.5); cx += cols[2].w;
      doc.setTextColor(90, 90, 90);
      doc.text(titleCase(call.status || '—').slice(0, 16), cx + 1.5, y + 3.5); cx += cols[3].w;
      doc.setTextColor(20, 20, 20);
      doc.text(sanitizePdfText(call.location_address || '—').slice(0, 42), cx + 1.5, y + 3.5);
      y += 5;
    });
    if (data.calls.length > 40) {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(6.5); doc.setTextColor(120, 120, 120);
      doc.text(`+ ${data.calls.length - 40} more not shown`, margin + 2, y + 3); y += 5;
    }
  }
  y += 3;

  // ── Units table ───────────────────────────────────────────
  sectionHeader(`Units On Map (${data.units.length})`);
  if (data.units.length === 0) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); doc.setTextColor(120, 120, 120);
    doc.text('No units with positions.', margin + 2, y + 4); y += 8;
  } else {
    doc.setFillColor(235, 235, 235); doc.rect(margin, y, contentW, 5, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6); doc.setTextColor(60, 60, 60);
    const uc = [22, 50, 30, contentW - 22 - 50 - 30];
    let cx = margin;
    ['UNIT', 'OFFICER', 'STATUS', 'CURRENT CALL'].forEach((h, i) => { doc.text(h, cx + 1.5, y + 3.4); cx += uc[i]; });
    y += 5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
    data.units.slice(0, 30).forEach((u, idx) => {
      ensureSpace(6);
      if (idx % 2 === 1) { doc.setFillColor(247, 247, 247); doc.rect(margin, y, contentW, 5, 'F'); }
      cx = margin;
      doc.setTextColor(20, 20, 20);
      doc.text(sanitizePdfText(u.call_sign || '—'), cx + 1.5, y + 3.5); cx += uc[0];
      doc.text(sanitizePdfText(u.officer_name || '—').slice(0, 30), cx + 1.5, y + 3.5); cx += uc[1];
      doc.setTextColor(90, 90, 90);
      doc.text(titleCase(u.status || '—'), cx + 1.5, y + 3.5); cx += uc[2];
      doc.setTextColor(20, 20, 20);
      const cur = u.current_call_type ? titleCase(u.current_call_type) : '—';
      doc.text(sanitizePdfText(cur).slice(0, 36), cx + 1.5, y + 3.5);
      y += 5;
    });
  }
  y += 3;

  // ── Analysis intel + patrol route (side notes) ────────────
  if (data.analysis) {
    sectionHeader('Analysis Intel');
    const a = data.analysis;
    const notes = [
      `Safety zones: ${a.safetyZones ?? 0}`,
      `High-risk zones: ${a.highRisk ?? 0}`,
      `Predicted hotspots: ${a.predictions ?? 0}`,
      `Repeat addresses: ${a.repeatAddrs ?? 0}`,
    ];
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(30, 30, 30);
    notes.forEach((n) => { ensureSpace(5); doc.text(`• ${n}`, margin + 2, y + 3.5); y += 4.5; });
    y += 3;
  }

  if (data.patrol && data.patrol.stops.length > 0) {
    sectionHeader(`Optimized Patrol Route — ${sanitizePdfText(data.patrol.unitCallSign)}`);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(20, 20, 20);
    doc.text(`Total: ${data.patrol.totalEta}  /  ${data.patrol.totalDistance}`, margin + 2, y + 4); y += 7;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    data.patrol.stops.forEach((s) => {
      ensureSpace(5);
      doc.setTextColor(accent[0], accent[1], accent[2]); doc.setFont('helvetica', 'bold');
      doc.text(`${s.order}.`, margin + 2, y + 3.5);
      doc.setTextColor(30, 30, 30); doc.setFont('helvetica', 'normal');
      doc.text(`${sanitizePdfText(s.callNumber)}${s.label ? '  ·  ' + sanitizePdfText(s.label) : ''}`, margin + 8, y + 3.5);
      doc.setTextColor(120, 120, 120);
      doc.text(s.legEta, pageW - margin - 2, y + 3.5, { align: 'right' });
      y += 4.6;
    });
  }

  finalizePoliceReport(doc, { watermark: 'CONFIDENTIAL' });

  const dateStr = now.toISOString().slice(0, 10);
  doc.save(`RMPG_Situation_Report_${dateStr}.pdf`);
}
