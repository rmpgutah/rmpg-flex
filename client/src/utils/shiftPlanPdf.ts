// ============================================================
// RMPG Flex — Shift Plan PDF (Supervisor Schedule Print) v1053
// ============================================================
// Court-ready / shift-briefing PDF for a single Shift Plan. The
// patrol-board screen on /shift-plans renders area assignments
// with officers + units + hours. Before v1053 the only "print"
// was the admin CSV export, which is fine for spreadsheets but
// unusable as a hand-off artifact for a supervisor walking the
// briefing room.
//
// This PDF mirrors the same Arial + RMPG-gold-banner idiom as
// the v1024–v1048 court-ready series (criminalHistoryPdf,
// fiCardPdf, evidenceCustodyPdf, conversationTranscriptPdf,
// mvrReviewPdf, ...): single source of truth on the client,
// regenerates on every download click, no static artifact.
//
// Source: live data already in memory on ShiftPlansPage
// (ShiftPlan from useShiftPlanning + the coverage stats), so
// this generator is pure — no network call, no D1 read.
// ============================================================

import jsPDF from 'jspdf';
import { drawNavyBanner } from './pdfStandaloneHeader';
import { registerArialFont } from './pdf/fonts/registerArial';
import { parseTimestamp } from './dateUtils';
import { openPdfBlob } from './openPdfDocument';
import { SHIFT_TYPES, type ShiftPlan, type ShiftType } from '../hooks/useShiftPlanning';

const TEXT_DARK = '#1a1a1a';
const TEXT_MUTED = '#555555';
const BORDER = '#9a9a9a';
const ROW_ALT = '#f4f4f0';
const WARN_BG = '#fff8e6';
const WARN_BORDER = '#b07f00';

export interface ShiftPlanPdfInput {
  plan: ShiftPlan;
  stats: { assigned: number; officers: number; units: number };
  /** Optional notification banners (understaffed / OT) lifted from the
   *  page's shift-notifs feed so the supervisor sees the same warnings
   *  the on-screen panel rendered. */
  notifications?: Array<{ message?: string; severity?: string }>;
  /** Optional double-book / overlap conflicts surfaced on the page. */
  conflicts?: Array<{ officer_name?: string; shift_count?: number }>;
  /** Person on duty who printed/exported the briefing — appears in the
   *  banner so a chain-of-custody dispute can trace who handed it out. */
  preparedBy?: string;
}

function fmtDate(iso: string | undefined): string {
  if (!iso) return '—';
  try {
    const d = iso.includes('T') ? parseTimestamp(iso) : new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch { return iso; }
}

function fmtDateTime(iso: string | undefined): string {
  if (!iso) return '—';
  try {
    const d = parseTimestamp(iso);
    return d.toLocaleString('en-US', {
      timeZone: 'America/Denver',
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function ellipsize(s: string | undefined, max: number): string {
  if (!s) return '';
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

export function generateShiftPlanPdf(input: ShiftPlanPdfInput): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  registerArialFont(doc);

  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  let y = 36;

  const newPageIfNeeded = (needed: number) => {
    if (y + needed > H - 36) { doc.addPage(); y = 36; }
  };

  const shiftType = input.plan.shiftType as ShiftType;
  const shiftCfg = SHIFT_TYPES[shiftType] ?? SHIFT_TYPES.custom;

  // ── Banner ─────────────────────────────────────────────────
  y = drawNavyBanner(doc, {
    title: 'SHIFT BRIEFING — DEPLOYMENT PLAN',
    subtitle: 'Patrol Operations',
    rightLine1: fmtDateTime(new Date().toISOString()),
    rightLine2: input.preparedBy ? `Prepared by: ${input.preparedBy}` : undefined,
  });

  // ── Plan identity block ────────────────────────────────────
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('PLAN', M, y);
  y += 4;
  doc.setDrawColor(BORDER);
  doc.line(M, y, W - M, y);
  y += 12;
  doc.setFont('Arial', 'normal');
  doc.setFontSize(9);

  const planFields: Array<[string, string]> = [
    ['Plan Name', input.plan.name || '—'],
    ['Status', (input.plan.status || '').toUpperCase() || '—'],
    ['Shift Date', fmtDate(input.plan.date)],
    ['Shift Type', shiftCfg.label],
    ['Default Window', `${shiftCfg.defaultStart} – ${shiftCfg.defaultEnd}`],
    ['Last Updated', fmtDateTime(input.plan.updatedAt)],
  ];
  const colW = (W - 2 * M) / 2;
  for (let i = 0; i < planFields.length; i += 2) {
    const [lbl1, val1] = planFields[i];
    const [lbl2, val2] = planFields[i + 1] ?? ['', ''];
    doc.setTextColor(TEXT_MUTED);
    doc.text(lbl1.toUpperCase(), M, y);
    if (lbl2) doc.text(lbl2.toUpperCase(), M + colW, y);
    doc.setTextColor(TEXT_DARK);
    doc.text(val1, M, y + 11);
    if (val2) doc.text(val2, M + colW, y + 11);
    y += 24;
  }

  // ── Coverage summary ──────────────────────────────────────
  newPageIfNeeded(80);
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('COVERAGE SUMMARY', M, y);
  y += 4;
  doc.line(M, y, W - M, y);
  y += 12;

  const tile = (label: string, value: string, x: number, wpx: number) => {
    doc.setDrawColor(BORDER);
    doc.setFillColor(ROW_ALT);
    doc.rect(x, y, wpx, 36, 'FD');
    doc.setFont('Arial', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(TEXT_DARK);
    doc.text(value, x + 8, y + 19);
    doc.setFont('Arial', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(TEXT_MUTED);
    doc.text(label.toUpperCase(), x + 8, y + 31);
  };
  const tileW = (W - 2 * M - 18) / 4;
  tile('Areas Covered', String(input.stats.assigned), M, tileW);
  tile('Officers Assigned', String(input.stats.officers), M + tileW + 6, tileW);
  tile('Units Deployed', String(input.stats.units), M + 2 * (tileW + 6), tileW);
  tile('Shift Start', shiftCfg.defaultStart, M + 3 * (tileW + 6), tileW);
  y += 44;

  // ── Notifications / staffing warnings (optional) ───────────
  const warnNotifs = (input.notifications ?? []).filter(
    (n) => n.severity === 'critical' || n.severity === 'warning',
  );
  if (warnNotifs.length > 0) {
    newPageIfNeeded(40 + warnNotifs.length * 14);
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(TEXT_DARK);
    doc.text('WARNINGS', M, y);
    y += 4;
    doc.line(M, y, W - M, y);
    y += 10;
    doc.setFillColor(WARN_BG);
    doc.setDrawColor(WARN_BORDER);
    doc.setLineWidth(0.5);
    const blockH = warnNotifs.length * 14 + 8;
    doc.rect(M, y, W - 2 * M, blockH, 'FD');
    doc.setFont('Arial', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(WARN_BORDER);
    let wy = y + 12;
    for (const n of warnNotifs) {
      const tag = (n.severity || '').toUpperCase();
      doc.text(`[${tag}]  ${ellipsize(n.message, 110)}`, M + 8, wy);
      wy += 14;
    }
    y += blockH + 8;
  }

  // ── Conflicts (double-book detection) ──────────────────────
  if (input.conflicts && input.conflicts.length > 0) {
    newPageIfNeeded(40 + input.conflicts.length * 14);
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(TEXT_DARK);
    doc.text('DOUBLE-BOOK CONFLICTS', M, y);
    y += 4;
    doc.line(M, y, W - M, y);
    y += 10;
    doc.setFillColor(WARN_BG);
    doc.setDrawColor(WARN_BORDER);
    const blockH = input.conflicts.length * 14 + 8;
    doc.rect(M, y, W - 2 * M, blockH, 'FD');
    doc.setFont('Arial', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(WARN_BORDER);
    let wy = y + 12;
    for (const c of input.conflicts) {
      const name = c.officer_name || '—';
      const ct = c.shift_count != null ? String(c.shift_count) : '?';
      doc.text(`${name} — assigned to ${ct} shifts on this date`, M + 8, wy);
      wy += 14;
    }
    y += blockH + 8;
  }

  // ── Assignments table ──────────────────────────────────────
  newPageIfNeeded(40);
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text(`AREA ASSIGNMENTS (${input.plan.assignments.length})`, M, y);
  y += 4;
  doc.line(M, y, W - M, y);
  y += 14;

  if (input.plan.assignments.length === 0) {
    doc.setFont('Arial', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(TEXT_MUTED);
    doc.text('No area assignments. Use the Map page shift planning overlay to add coverage.', M, y);
    y += 16;
  } else {
    // Column layout
    const cols = [
      { hdr: 'AREA',     w: 130 },
      { hdr: 'LAYER',    w: 70 },
      { hdr: 'OFFICERS', w: 170 },
      { hdr: 'UNITS',    w: 80 },
      { hdr: 'HOURS',    w: 80 },
    ];
    const totalW = cols.reduce((s, c) => s + c.w, 0);
    const startX = M;

    // Header row
    doc.setFillColor(TEXT_DARK);
    doc.rect(startX, y, totalW, 16, 'F');
    doc.setFont('Arial', 'bold');
    doc.setFontSize(8);
    doc.setTextColor('#ffffff');
    let cx = startX + 4;
    for (const c of cols) { doc.text(c.hdr, cx, y + 11); cx += c.w; }
    y += 16;

    // Body rows
    doc.setFont('Arial', 'normal');
    doc.setFontSize(8);
    let alt = false;
    for (const a of input.plan.assignments) {
      // estimate height by officer-name wrap
      const officers = (a.officerNames && a.officerNames.length > 0)
        ? a.officerNames.join(', ')
        : '—';
      const units = (a.unitCallSigns && a.unitCallSigns.length > 0)
        ? a.unitCallSigns.join(', ')
        : '—';
      const hours = a.shiftStart && a.shiftEnd ? `${a.shiftStart}–${a.shiftEnd}` : '—';

      const officersWrapped = doc.splitTextToSize(officers, cols[2].w - 8) as string[];
      const areaWrapped = doc.splitTextToSize(a.label || '—', cols[0].w - 8) as string[];
      const rowLines = Math.max(officersWrapped.length, areaWrapped.length, 1);
      const rowH = Math.max(16, rowLines * 11 + 6);

      newPageIfNeeded(rowH + 6);

      if (alt) {
        doc.setFillColor(ROW_ALT);
        doc.rect(startX, y, totalW, rowH, 'F');
      }
      doc.setDrawColor(BORDER);
      doc.setLineWidth(0.25);
      doc.line(startX, y + rowH, startX + totalW, y + rowH);

      doc.setTextColor(TEXT_DARK);
      cx = startX + 4;
      // Area
      doc.text(areaWrapped, cx, y + 11);
      cx += cols[0].w;
      // Layer
      doc.text(ellipsize(a.layerId || '—', 14), cx, y + 11);
      cx += cols[1].w;
      // Officers (wrapped)
      doc.text(officersWrapped, cx, y + 11);
      cx += cols[2].w;
      // Units
      doc.text(ellipsize(units, 18), cx, y + 11);
      cx += cols[3].w;
      // Hours
      doc.setFont('Arial', 'normal');
      doc.text(hours, cx, y + 11);

      // Notes (subline) — render under area if present, capped width
      if (a.notes) {
        doc.setFont('Arial', 'italic');
        doc.setFontSize(7);
        doc.setTextColor(TEXT_MUTED);
        const notes = ellipsize(a.notes, 96);
        doc.text(notes, startX + 4, y + rowH - 4);
        doc.setFont('Arial', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(TEXT_DARK);
      }

      y += rowH;
      alt = !alt;
    }
    doc.setLineWidth(0.5);
  }

  // ── Signature line ─────────────────────────────────────────
  newPageIfNeeded(60);
  y += 18;
  doc.setDrawColor(TEXT_DARK);
  doc.setLineWidth(0.5);
  doc.line(M, y, M + 220, y);
  doc.line(W - M - 220, y, W - M, y);
  doc.setFont('Arial', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(TEXT_MUTED);
  doc.text('SUPERVISOR SIGNATURE', M, y + 11);
  doc.text('DATE / TIME', W - M - 220, y + 11);
  y += 24;

  // Footer
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('Arial', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(TEXT_MUTED);
    doc.text(
      `Generated ${fmtDateTime(new Date().toISOString())}  ·  Plan #${input.plan.id}`,
      M, H - 18,
    );
    doc.text(`Page ${p} of ${pages}`, W - M, H - 18, { align: 'right' });
  }

  return doc;
}

export function openShiftPlanPdf(input: ShiftPlanPdfInput): void {
  const doc = generateShiftPlanPdf(input);
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  openPdfBlob(url, 'Shift Plan');
}
