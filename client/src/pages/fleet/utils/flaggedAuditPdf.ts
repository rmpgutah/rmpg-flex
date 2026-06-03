// ═══════════════════════════════════════════════════════════════
// Flagged-Entry Audit PDF — compliance/review artefact.
//
// Prints every flagged fuel log in scope with enough context to be
// reviewed by an auditor or internal-affairs investigator. Empty
// Reviewer Notes + Signature columns are deliberately there so the
// printed sheet can be marked up by hand, which is the whole point
// of this artefact.
//
// Layout (portrait letter, 1–N pages):
//   Header            — "Flagged Fuel Entry Audit"
//   Scope + window    — vehicle label or "Fleet-wide", date range
//   Table             — Date, Vehicle, Driver, Gal, Cost, Station, Flags, Reviewer Notes
//   Legend            — flag-code key at the bottom
//   Sign-off block    — auditor line + date, per-page
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import type { FleetFuelLog } from '../../../types';
import { parseTimestamp } from '../../../utils/dateUtils';

interface Args {
  logs: FleetFuelLog[];         // caller pre-filters to flagged rows
  scopeLabel: string;           // "#47 Explorer" or "Fleet-wide"
  dateRange: { from?: string; to?: string };
}

const FLAG_LEGEND: Record<string, string> = {
  'tank-overflow':   'Gallons > tank capacity (possible split transaction or wrong vehicle)',
  'price-spike':     'Cost/gal > $6 or > 2× the vehicle\'s 90-day average',
  'mpg-anomaly':     'Computed MPG deviates > 50% from the vehicle\'s average',
  'rapid-duplicate': 'Another fill within 30 min at a different station',
};

export function generateFlaggedAuditPdf({ logs, scopeLabel, dateRange }: Args): void {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const marginX = 36;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const contentW = pageW - marginX * 2;
  let y = 40;

  // Use ASCII '...' (three dots) instead of '…' (U+2026 horizontal-ellipsis,
  // which IS in cp1252 but stays consistent with the rest of the asciify
  // strategy in this PDF set).
  const truncate = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + '...' : s);
  const parseFlags = (raw: string | null | undefined): string[] => {
    if (!raw) return [];
    try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch { return []; }
  };
  /** Format any fuel_date variant into a clean "YYYY-MM-DD HH:MM" string —
   *  accepts the DB local-time format, ISO-8601, or HTML datetime-local. */
  const formatLogDate = (s: string | null | undefined): string => {
    if (!s) return '';
    const cleaned = s.replace(/Z$/, '').replace('T', ' ');
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(cleaned)) return cleaned.slice(0, 16);
    const d = parseTimestamp(s);
    if (isNaN(d.getTime())) return s;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  // ── Header ────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('FLAGGED FUEL ENTRY AUDIT', marginX, y); y += 20;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Scope:  ${scopeLabel}`, marginX, y); y += 13;
  // ASCII " to " — the Unicode arrow renders as garbled glyphs under jsPDF's
  // default cp1252 encoding (looks like "â '" or "!'" in viewers).
  const rangeLabel = [dateRange.from, dateRange.to].filter(Boolean).join(' to ') || '(all dates)';
  doc.text(`Period: ${rangeLabel}`, marginX, y); y += 13;
  doc.text(`Flagged entries: ${logs.length}`, marginX, y); y += 13;
  doc.text(`Generated: ${new Date().toLocaleString()}`, marginX, y); y += 18;

  doc.setDrawColor(180);
  doc.line(marginX, y, pageW - marginX, y);
  y += 14;

  // ── Table ────────────────────────────────────────────────
  // Portrait-letter content width is ~540pt. Column budget totals to that
  // figure. 2026-04-14: bumped Date 80 → 100pt so the full
  // "YYYY-MM-DD HH:MM" timestamp fits without truncation, with offsetting
  // shrinks elsewhere (Vehicle 75→70, Station 85→75, Reviewer 113→108).
  const cols = [
    { header: 'Date',           width: 100 },
    { header: 'Vehicle',        width: 70 },
    { header: 'Driver',         width: 65 },
    { header: 'Gal',            width: 32, align: 'right' as const },
    { header: 'Cost',           width: 40, align: 'right' as const },
    { header: 'Station',        width: 75 },
    { header: 'Flags',          width: 50 },
    { header: 'Reviewer Notes', width: 108 },
  ];

  const drawHeaderRow = () => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    let x = marginX;
    for (const col of cols) {
      const textX = col.align === 'right' ? x + col.width - 2 : x + 2;
      doc.text(col.header, textX, y, { align: col.align || 'left' });
      x += col.width;
    }
    y += 10;
    doc.setDrawColor(230);
    doc.line(marginX, y - 2, pageW - marginX, y - 2);
    doc.setFont('helvetica', 'normal');
  };
  drawHeaderRow();

  doc.setFontSize(8);
  for (const log of logs) {
    if (y > pageH - 80) {
      doc.addPage();
      y = 40;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('FLAGGED FUEL ENTRY AUDIT (continued)', marginX, y); y += 16;
      doc.setFontSize(8);
      drawHeaderRow();
    }
    const flags = parseFlags(log.flags as string | null | undefined);
    const flagCodes = flags.map(f => f.split(':')[0].toUpperCase()).join(' ');
    const vehicleDisplay = (log as any).vehicle_number
      ? `#${(log as any).vehicle_number}`
      : `v${log.vehicle_id}`;
    const driverDisplay = (log as any).driver_full_name || (log as any).driver_username
      || (log.driver_officer_id ? `user-${log.driver_officer_id}` : '-');

    let x = marginX;
    const cellText: Array<string> = [
      formatLogDate(log.fuel_date),  // full "YYYY-MM-DD HH:MM" — no truncation
      vehicleDisplay,
      driverDisplay,
      log.gallons != null ? log.gallons.toFixed(2) : '-',
      log.total_cost != null ? `$${log.total_cost.toFixed(2)}` : '-',
      log.station || '-',
      flagCodes,
      '', // reviewer notes — left blank for sign-off
    ];
    for (let i = 0; i < cols.length; i++) {
      const col = cols[i];
      const textX = col.align === 'right' ? x + col.width - 2 : x + 2;
      doc.text(truncate(cellText[i], Math.floor(col.width / 3.5)), textX, y, { align: col.align || 'left' });
      x += col.width;
    }

    // Thin ruled underline so auditors can hand-write in the blank column
    doc.setDrawColor(230);
    doc.line(marginX, y + 3, pageW - marginX, y + 3);
    y += 14;
  }

  y += 16;

  // ── Legend ───────────────────────────────────────────────
  if (y > pageH - 100) { doc.addPage(); y = 40; }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('FLAG LEGEND', marginX, y); y += 14;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  for (const [code, desc] of Object.entries(FLAG_LEGEND)) {
    const shortCode = code.split(':')[0].toUpperCase().slice(0, 3) + (code.split(':')[0].length > 3 ? '' : '');
    const display = code.split('-')[0].toUpperCase();
    doc.setFont('helvetica', 'bold');
    doc.text(`${display}:`, marginX, y);
    doc.setFont('helvetica', 'normal');
    doc.text(desc, marginX + 70, y);
    y += 12;
  }

  // ── Sign-off block on every page ──────────────────────────
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
    doc.text('Reviewer (signature)', marginX, signY + 10);
    doc.text('Date', marginX + 280, signY + 10);
    doc.text(`Page ${p} of ${pageCount}`, pageW - marginX, signY + 10, { align: 'right' });
    doc.setTextColor(0);
  }

  const filename = `fuel-flagged-audit-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}
