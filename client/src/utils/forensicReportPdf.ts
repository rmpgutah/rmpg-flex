// ============================================================
// RMPG Flex — Forensic event report (PDF)
// ============================================================
// One-page evidentiary report for a dashcam AI event: annotated still, plate +
// re-ID, telemetry table, GPS-track plot, forensic verdict, and a chain-of-
// custody footer. Manual jsPDF layout, Arial-only (project rule). The pure
// summary builder is unit-tested; the PDF assembly is integration.
// ============================================================

import jsPDF from 'jspdf';
import { registerArialFont } from './pdf/fonts/registerArial';
import type { TrackStats } from './dashcamForensics';
import type { TrackPoint } from './dashcamForensics';
import { drawNavyBanner } from './pdfStandaloneHeader';

export interface ForensicReportData {
  eventType?: string | null;
  rawEventType?: string | null;
  address?: string | null;
  timestamp?: string | null;
  device?: string | null;
  unit?: string | null;
  officer?: string | null;
  lat?: number | null;
  lng?: number | null;
  plate?: string | null;
  plateConfidence?: number | null;
  vehicleTag?: string | null;
  priorCount?: number | null;
  priorDays?: number | null;
  hits?: Array<{ severity: string; detail: string }>;
  verdict?: string | null;
  stats: TrackStats;
  trackPts?: TrackPoint[];
  frameDataUrl?: string | null;   // annotated frame (JPEG/PNG data URL)
}

/** Label/value rows for the telemetry block. Pure → unit-tested. */
export function reportTelemetryRows(s: TrackStats): Array<[string, string]> {
  return [
    ['Peak speed', `${Math.round(s.maxSpeed)} mph`],
    ['Average speed', `${Math.round(s.avgSpeed)} mph`],
    ['Speed at start / end', `${Math.round(s.startSpeed)} / ${Math.round(s.endSpeed)} mph`],
    ['Distance', `${s.distanceMiles.toFixed(2)} mi`],
    ['Duration', `${s.durationSec.toFixed(0)} s`],
    ['Peak braking', `${s.maxBrakeG.toFixed(2)} g`],
    ['Peak acceleration', `${s.maxAccelG.toFixed(2)} g`],
    ['GPS samples', `${s.points}`],
  ];
}

export function reportFilename(d: ForensicReportData): string {
  const stamp = (d.timestamp || '').replace(/[^0-9]/g, '').slice(0, 14) || 'report';
  const plate = (d.plate || '').replace(/[^A-Z0-9]/gi, '');
  return `rmpg-forensic-report_${d.device || 'cam'}_${stamp}${plate ? '_' + plate : ''}.pdf`;
}

const GOLD = '#b8860b';

export function exportForensicReport(d: ForensicReportData): void {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const font = registerArialFont(doc);
  const W = doc.internal.pageSize.getWidth();
  const M = 40;
  let y = drawNavyBanner(doc, {
    title: `FORENSIC EVENT REPORT${d.device ? ` — ${d.device}` : ''}`,
    subtitle: 'Forensic Laboratory',
    rightLine1: d.timestamp || undefined,
    rightLine2: d.officer ? `Officer: ${d.officer}` : undefined,
  });

  doc.setFont(font, 'normal'); doc.setFontSize(10); doc.setTextColor(40);
  const head = [
    `Event: ${(d.rawEventType || d.eventType || '—')}`,
    `Unit: ${d.unit || d.device || '—'}`,
    `Location: ${d.address || '—'}`,
    `Time: ${d.timestamp || '—'}${d.lat != null && d.lng != null ? `   (${d.lat.toFixed(5)}, ${d.lng.toFixed(5)})` : ''}`,
  ];
  head.forEach((l) => { doc.text(l, M, y); y += 13; });
  y += 6;

  // Annotated still
  if (d.frameDataUrl) {
    try {
      const imgW = W - 2 * M, imgH = imgW * 0.5625; // 16:9
      doc.addImage(d.frameDataUrl, 'JPEG', M, y, imgW, imgH);
      doc.setDrawColor(180); doc.setLineWidth(0.5); doc.rect(M, y, imgW, imgH);
      y += imgH + 6;
      doc.setFontSize(7.5); doc.setTextColor(120);
      doc.text('Annotated AI still — vehicle/plate detections + telemetry overlay at capture instant.', M, y); y += 14;
    } catch { /* image embed failed — skip */ }
  }

  // Two columns: telemetry table (left) + plate/intel (right)
  const colY = y;
  const colW = (W - 2 * M - 16) / 2;
  doc.setFontSize(10); doc.setTextColor(20); doc.setFont(font, 'bold');
  doc.text('TELEMETRY', M, y); let ly = y + 14;
  doc.setFont(font, 'normal'); doc.setFontSize(9);
  for (const [k, v] of reportTelemetryRows(d.stats)) {
    doc.setTextColor(110); doc.text(k, M, ly);
    doc.setTextColor(20); doc.text(v, M + colW - 4, ly, { align: 'right' });
    ly += 13;
  }

  const rx = M + colW + 16;
  doc.setFont(font, 'bold'); doc.setFontSize(10); doc.setTextColor(20);
  doc.text('VEHICLE / INTEL', rx, y); let ry = y + 14;
  doc.setFont(font, 'normal'); doc.setFontSize(9);
  const intel: Array<[string, string]> = [];
  if (d.plate) intel.push(['Plate', `${d.plate}${d.plateConfidence != null ? `  (${Math.round(d.plateConfidence * 100)}%)` : ''}`]);
  if (d.vehicleTag) intel.push(['Vehicle', d.vehicleTag]);
  if (d.priorCount != null) intel.push(['Prior sightings', `${d.priorCount}${d.priorDays ? ` over ${d.priorDays} day(s)` : ''}`]);
  if (!intel.length) intel.push(['Plate', 'not read']);
  for (const [k, v] of intel) {
    doc.setTextColor(110); doc.text(k, rx, ry);
    doc.setTextColor(20); doc.text(v, rx + colW - 4, ry, { align: 'right', maxWidth: colW - 60 });
    ry += 13;
  }
  if (d.hits && d.hits.length) {
    ry += 4; doc.setTextColor(180, 20, 20); doc.setFont(font, 'bold');
    doc.text('RECORDS HIT', rx, ry); ry += 12; doc.setFont(font, 'normal'); doc.setFontSize(8.5);
    d.hits.slice(0, 4).forEach((h) => { doc.text(`• ${h.detail}`, rx, ry, { maxWidth: colW }); ry += 11; });
  }
  y = Math.max(ly, ry) + 10;

  // GPS track plot
  if (d.trackPts && d.trackPts.length > 1) {
    doc.setFont(font, 'bold'); doc.setFontSize(10); doc.setTextColor(20);
    doc.text('GPS TRACK', M, y); y += 8;
    const box = 110, bx = M, by = y;
    doc.setDrawColor(210, 210, 210); doc.setFillColor(248, 248, 248); doc.rect(bx, by, box, box, 'FD');
    const pts = d.trackPts;
    doc.setDrawColor(GOLD); doc.setLineWidth(1.4);
    for (let i = 1; i < pts.length; i++) {
      doc.line(bx + (pts[i - 1].x / 100) * box, by + (pts[i - 1].y / 100) * box, bx + (pts[i].x / 100) * box, by + (pts[i].y / 100) * box);
    }
    doc.setFillColor(34, 197, 94); doc.circle(bx + (pts[0].x / 100) * box, by + (pts[0].y / 100) * box, 2, 'F');
    doc.setFillColor(239, 68, 68); doc.circle(bx + (pts[pts.length - 1].x / 100) * box, by + (pts[pts.length - 1].y / 100) * box, 2, 'F');
    // verdict next to the plot
    if (d.verdict) {
      doc.setFont(font, 'bold'); doc.setFontSize(9); doc.setTextColor(GOLD);
      doc.text('FORENSIC VERDICT', bx + box + 14, by + 4);
      doc.setFont(font, 'normal'); doc.setFontSize(9); doc.setTextColor(40);
      doc.text(d.verdict, bx + box + 14, by + 18, { maxWidth: W - M - (bx + box + 14) });
    }
    y = by + box + 14;
  }

  // Chain-of-custody footer
  const fy = doc.internal.pageSize.getHeight() - 36;
  doc.setDrawColor(GOLD); doc.setLineWidth(0.8); doc.line(M, fy - 8, W - M, fy - 8);
  doc.setFont(font, 'normal'); doc.setFontSize(7.5); doc.setTextColor(120);
  doc.text(`Chain of custody — generated by ${d.officer || 'operator'} · ${new Date().toISOString().replace('T', ' ').replace(/\..*/, '')} UTC · source: ClearPath dashcam (on-demand stream, no archival) · RMPG Flex`, M, fy, { maxWidth: W - 2 * M });

  doc.save(reportFilename(d));
}
