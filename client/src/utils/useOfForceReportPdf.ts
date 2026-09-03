// ═══════════════════════════════════════════════════════════════
// Use-of-Force Report — court / IA / state-DOJ chain-of-custody PDF.
//
// Use-of-force reports are simultaneously a court record, an
// internal-affairs review document, and a Utah POST state-DOJ
// reporting source. The in-app /use-of-force detail panel showed
// every field but had no print path before this util — IA leads
// were rebuilding the narrative from screenshots.
//
// Same idiom as the prior court PDFs (evidenceItem, shiftReport,
// bodycamVideoCustody, fiCard, equipmentCustody): Arial + RMPG-gold
// banner, agency strap, red "FORCE INCIDENT" alert when injuries
// are present, signature block for reporting officer + reviewing
// supervisor. Mountain Time everywhere.
//
// Linked footage (BWC + dashcam) is included as a separate block
// because the videos themselves are the primary evidence — this
// PDF is the printed companion that says "these clips were tied to
// this report at submission".
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import { registerArialFont } from './pdf/fonts/registerArial';
import { parseTimestamp } from './dateUtils';
import { toDisplayLabel } from './formatters';
import { openPdfBlob } from './openPdfDocument';
import { drawNavyBanner } from './pdfStandaloneHeader';

const TEXT_DARK = '#1a1a1a';
const TEXT_MUTED = '#555555';
const BORDER = '#9a9a9a';
const ROW_ALT = '#f4f4f0';
const ALERT_BG = '#fef1f0';
const ALERT_BORDER = '#b91c1c';

const MT_TZ = 'America/Denver';

/** Server-side shape returned by GET /use-of-force/:id. Mirrors
 *  UofReport in UseOfForcePage.tsx but the PDF is independent of the
 *  page-state shape (so the printable can be regenerated server-side
 *  later without dragging in the React types). */
export interface UofReportForPdf {
  id?: number | string;
  incident_id?: number | null;
  officer_id?: number | null;
  subject_person_id?: number | null;
  force_type?: string;
  force_level?: string | null;
  justification?: string | null;
  subject_injuries?: string | null;
  officer_injuries?: string | null;
  de_escalation_attempted?: number | boolean;
  de_escalation_details?: string | null;
  weapons_used?: string | null;
  body_camera_active?: number | boolean;
  witness_officers?: string | null;
  narrative?: string | null;
  status?: string;
  reviewed_by?: number | null;
  reviewed_at?: string | null;
  review_notes?: string | null;
  created_at?: string;
  updated_at?: string;
  // Joined display fields
  officer_name?: string | null;
  officer_badge?: string | null;
  subject_first_name?: string | null;
  subject_last_name?: string | null;
  subject_dob?: string | null;
  incident_number?: string | null;
  incident_type?: string | null;
  reviewer_name?: string | null;
}

/** Shape of a linked footage clip — both BWC and FlexCam normalised to a
 *  printable summary. The page fetches /use-of-force/:id/footage which
 *  returns { flexcam: [...], bodycam: [...] } and the page maps both
 *  feeds into this single linkable rendering. */
export interface LinkedFootageEntry {
  kind: 'bwc' | 'dashcam';
  id?: number | string;
  title?: string | null;
  recorded_at?: string | null;
  duration_seconds?: number | null;
  classification?: string | null;
  evidence_locked?: number | boolean | null;
  evidence_number?: string | null;
}

export interface UofReportPdfInput {
  report: UofReportForPdf;
  linkedFootage?: LinkedFootageEntry[];
  /** Person who clicked Print — surfaces in agency strap + custodian sig. */
  preparedBy?: string;
}

// ── Public helpers (unit-tested) ─────────────────────────────────

/** Format an ISO/SQLite date as "Jun 12, 2026" in Mountain Time. */
export function fmtDate(input: string | undefined | null): string {
  if (!input) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: MT_TZ, year: 'numeric', month: 'short', day: 'numeric',
    }).format(parseTimestamp(input));
  } catch { return String(input); }
}

/** Format an ISO/SQLite date+time as "Jun 12, 2026, 14:23 MT". */
export function fmtDateTime(input: string | undefined | null): string {
  if (!input) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: MT_TZ, year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(parseTimestamp(input)) + ' MT';
  } catch { return String(input); }
}

/** Format a video duration in seconds as "HH:MM:SS". */
export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** "Any injury reported?" — drives the red alert banner. Trims whitespace and
 *  treats "none"/"n/a"/"-" as no injury so the alert only fires when there's
 *  actually something to read. */
export function hasInjuries(report: UofReportForPdf): boolean {
  const isNothing = (s: string | null | undefined): boolean => {
    if (!s) return true;
    const t = s.trim().toLowerCase();
    return t === '' || t === 'none' || t === 'n/a' || t === '-' || t === '—';
  };
  return !(isNothing(report.subject_injuries) && isNothing(report.officer_injuries));
}

/** Lethal-force gate — drives a separate red banner. `firearm` is the
 *  primary trigger; the report has a `force_level` Life-Threatening tier
 *  that's also lethal. */
export function isLethalForce(report: UofReportForPdf): boolean {
  if ((report.force_type || '').toLowerCase() === 'firearm') return true;
  return /life[-\s]?threatening/i.test(String(report.force_level || ''));
}

/** Stringify witness_officers — server stores a JSON array string OR a
 *  comma-separated string; both come back as `witness_officers: string`.
 *  Empty input → '—'. */
export function fmtWitnesses(raw: string | null | undefined): string {
  if (!raw) return '—';
  const trimmed = raw.trim();
  if (!trimmed) return '—';
  // JSON array?
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) {
        const names = arr.map((x) => String(x).trim()).filter(Boolean);
        return names.length ? names.join(', ') : '—';
      }
    } catch { /* fall through */ }
  }
  return trimmed;
}

/** Subject display name + DOB chip for the demographics block. */
export function fmtSubject(report: UofReportForPdf): string {
  const name = [report.subject_first_name, report.subject_last_name].filter(Boolean).join(' ').trim();
  if (!name) return '—';
  return report.subject_dob ? `${name} (DOB ${fmtDate(report.subject_dob)})` : name;
}

const ellipsize = (s: string, max: number) => s.length <= max ? s : s.slice(0, max - 1) + '…';

// ── PDF generator ────────────────────────────────────────────────

export function generateUseOfForceReportPdf(input: UofReportPdfInput): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  registerArialFont(doc);

  const { report, linkedFootage = [], preparedBy } = input;
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  let y = 36;

  // Banner — navy strap with report id + force type.
  const headerLabel = `UoF-${report.id ?? '?'} — ${toDisplayLabel(report.force_type).toUpperCase()}`;
  y = drawNavyBanner(doc, {
    title: `USE OF FORCE REPORT — ${ellipsize(headerLabel, 50)}`,
    subtitle: 'Use of Force / Internal Affairs',
    rightLine1: fmtDateTime(new Date().toISOString()),
    rightLine2: preparedBy ? `Prepared by: ${preparedBy}` : undefined,
  });

  // ── Alerts: lethal-force + injuries (stacked, both can fire). ──
  if (isLethalForce(report)) {
    doc.setFillColor(ALERT_BG);
    doc.setDrawColor(ALERT_BORDER);
    doc.setLineWidth(0.75);
    doc.rect(M, y, W - 2 * M, 22, 'FD');
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(ALERT_BORDER);
    doc.text('LETHAL FORCE — mandatory state-DOJ notification + IA review', M + 10, y + 15);
    y += 30;
  }
  if (hasInjuries(report)) {
    doc.setFillColor(ALERT_BG);
    doc.setDrawColor(ALERT_BORDER);
    doc.setLineWidth(0.75);
    doc.rect(M, y, W - 2 * M, 22, 'FD');
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(ALERT_BORDER);
    doc.text('INJURIES REPORTED — medical follow-up + photo documentation required', M + 10, y + 15);
    y += 30;
  }
  doc.setLineWidth(0.5);

  // ── Incident block ──
  const sectionHeader = (label: string) => {
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(TEXT_DARK);
    doc.text(label, M, y);
    y += 4;
    doc.setDrawColor(BORDER);
    doc.line(M, y, W - M, y);
    y += 12;
    doc.setFont('Arial', 'normal');
    doc.setFontSize(9);
  };

  const newPageIfNeeded = (need: number) => {
    if (y + need > H - 80) { doc.addPage(); y = 48; }
  };

  const twoColRow = (lbl1: string, val1: string, lbl2: string, val2: string) => {
    const colW = (W - 2 * M) / 2;
    doc.setTextColor(TEXT_MUTED);
    doc.text(lbl1.toUpperCase(), M, y);
    if (lbl2) doc.text(lbl2.toUpperCase(), M + colW, y);
    doc.setTextColor(TEXT_DARK);
    doc.text(ellipsize(val1, 60), M, y + 11);
    if (val2) doc.text(ellipsize(val2, 60), M + colW, y + 11);
    y += 24;
  };

  sectionHeader('INCIDENT');
  twoColRow(
    'Report ID', `UoF-${report.id ?? '?'}`,
    'Status', toDisplayLabel(report.status),
  );
  twoColRow(
    'Submitted', fmtDateTime(report.created_at),
    'Last Updated', fmtDateTime(report.updated_at),
  );
  twoColRow(
    'Linked Incident', report.incident_number || '—',
    'Incident Type', toDisplayLabel(report.incident_type),
  );

  // ── Reporting officer + subject demographics ──
  newPageIfNeeded(60);
  sectionHeader('REPORTING OFFICER & SUBJECT');
  twoColRow(
    'Reporting Officer', report.officer_name || '—',
    'Badge', report.officer_badge || '—',
  );
  twoColRow(
    'Subject', fmtSubject(report),
    'Subject DOB', fmtDate(report.subject_dob),
  );

  // ── Force details ──
  newPageIfNeeded(80);
  sectionHeader('FORCE DETAILS');
  twoColRow(
    'Force Type', toDisplayLabel(report.force_type),
    'Force Level', report.force_level || '—',
  );
  twoColRow(
    'Weapons Used', report.weapons_used || 'None',
    'Body Camera', report.body_camera_active ? 'Active' : 'Inactive',
  );
  twoColRow(
    'De-Escalation', report.de_escalation_attempted ? 'Attempted' : 'Not attempted',
    'Witness Officers', fmtWitnesses(report.witness_officers),
  );

  // ── Justification ──
  if (report.justification && report.justification.trim()) {
    newPageIfNeeded(40);
    sectionHeader('JUSTIFICATION');
    doc.setTextColor(TEXT_DARK);
    const lines = doc.splitTextToSize(report.justification, W - 2 * M);
    for (const line of lines) {
      newPageIfNeeded(12);
      doc.text(line, M, y);
      y += 11;
    }
    y += 6;
  }

  // ── De-escalation details ──
  if (report.de_escalation_attempted && report.de_escalation_details && report.de_escalation_details.trim()) {
    newPageIfNeeded(40);
    sectionHeader('DE-ESCALATION DETAILS');
    doc.setTextColor(TEXT_DARK);
    const lines = doc.splitTextToSize(report.de_escalation_details, W - 2 * M);
    for (const line of lines) {
      newPageIfNeeded(12);
      doc.text(line, M, y);
      y += 11;
    }
    y += 6;
  }

  // ── Injuries ──
  if (hasInjuries(report)) {
    newPageIfNeeded(40);
    sectionHeader('INJURIES');
    if (report.subject_injuries && report.subject_injuries.trim()) {
      doc.setTextColor(TEXT_MUTED);
      doc.text('SUBJECT INJURIES', M, y);
      y += 11;
      doc.setTextColor(TEXT_DARK);
      const lines = doc.splitTextToSize(report.subject_injuries, W - 2 * M);
      for (const line of lines) { newPageIfNeeded(12); doc.text(line, M, y); y += 11; }
      y += 4;
    }
    if (report.officer_injuries && report.officer_injuries.trim()) {
      doc.setTextColor(TEXT_MUTED);
      doc.text('OFFICER INJURIES', M, y);
      y += 11;
      doc.setTextColor(TEXT_DARK);
      const lines = doc.splitTextToSize(report.officer_injuries, W - 2 * M);
      for (const line of lines) { newPageIfNeeded(12); doc.text(line, M, y); y += 11; }
      y += 4;
    }
    y += 4;
  }

  // ── Narrative ──
  if (report.narrative && report.narrative.trim()) {
    newPageIfNeeded(40);
    sectionHeader('NARRATIVE');
    doc.setTextColor(TEXT_DARK);
    const lines = doc.splitTextToSize(report.narrative, W - 2 * M);
    for (const line of lines) {
      newPageIfNeeded(12);
      doc.text(line, M, y);
      y += 11;
    }
    y += 6;
  }

  // ── Linked footage (BWC + dashcam) ──
  if (linkedFootage.length > 0) {
    newPageIfNeeded(50);
    sectionHeader('LINKED FOOTAGE');
    const cols = [
      { label: 'KIND',     width: 60 },
      { label: 'ID',       width: 60 },
      { label: 'RECORDED', width: 130 },
      { label: 'DURATION', width: 70 },
      { label: 'STATUS',   width: 90 },
      { label: 'EVIDENCE', width: 110 },
    ] as const;
    doc.setFillColor('#e6e6e6');
    doc.rect(M, y, W - 2 * M, 14, 'F');
    doc.setFontSize(7.5);
    doc.setFont('Arial', 'bold');
    doc.setTextColor(TEXT_MUTED);
    let x = M + 4;
    for (const c of cols) { doc.text(c.label, x, y + 9); x += c.width; }
    y += 14;
    doc.setFont('Arial', 'normal');
    doc.setFontSize(8);
    linkedFootage.forEach((entry, i) => {
      newPageIfNeeded(13);
      if (i % 2 === 1) {
        doc.setFillColor(ROW_ALT);
        doc.rect(M, y, W - 2 * M, 13, 'F');
      }
      doc.setTextColor(TEXT_DARK);
      let cx = M + 4;
      doc.text(entry.kind === 'bwc' ? 'BWC' : 'DASHCAM', cx, y + 9); cx += cols[0].width;
      doc.text(String(entry.id ?? '—'), cx, y + 9); cx += cols[1].width;
      doc.text(fmtDateTime(entry.recorded_at), cx, y + 9); cx += cols[2].width;
      doc.text(fmtDuration(entry.duration_seconds), cx, y + 9); cx += cols[3].width;
      doc.text(ellipsize(toDisplayLabel(entry.classification), 14), cx, y + 9); cx += cols[4].width;
      const evLabel = entry.evidence_locked
        ? `LOCKED ${entry.evidence_number ? `(${entry.evidence_number})` : ''}`
        : '—';
      doc.text(ellipsize(evLabel, 18), cx, y + 9);
      doc.setDrawColor(BORDER);
      doc.setLineWidth(0.25);
      doc.line(M, y + 13, W - M, y + 13);
      y += 13;
    });
    y += 6;
  }

  // ── Supervisor review block ──
  if (report.reviewed_by || report.reviewer_name || report.reviewed_at) {
    newPageIfNeeded(40);
    sectionHeader('SUPERVISOR REVIEW');
    twoColRow(
      'Reviewer', report.reviewer_name || '—',
      'Reviewed At', fmtDateTime(report.reviewed_at),
    );
    if (report.review_notes && report.review_notes.trim()) {
      doc.setTextColor(TEXT_MUTED);
      doc.text('NOTES', M, y);
      y += 11;
      doc.setTextColor(TEXT_DARK);
      const lines = doc.splitTextToSize(report.review_notes, W - 2 * M);
      for (const line of lines) { newPageIfNeeded(12); doc.text(line, M, y); y += 11; }
      y += 4;
    }
  }

  // ── Signature block ──
  newPageIfNeeded(80);
  y += 14;
  doc.setDrawColor(BORDER);
  doc.setLineWidth(0.5);
  const sigW = (W - 2 * M - 24) / 2;
  doc.line(M, y + 28, M + sigW, y + 28);
  doc.line(M + sigW + 24, y + 28, W - M, y + 28);
  doc.setFontSize(8);
  doc.setTextColor(TEXT_MUTED);
  doc.text('Reporting officer signature / date', M, y + 38);
  if (report.officer_name) doc.text(report.officer_name, M, y + 49);
  doc.text('Reviewing supervisor signature / date', M + sigW + 24, y + 38);
  if (report.reviewer_name) doc.text(report.reviewer_name, M + sigW + 24, y + 49);

  // Footer.
  doc.setFontSize(7);
  doc.text(
    `Generated ${fmtDateTime(new Date().toISOString())}  ·  RMPG Flex Use-of-Force Report  ·  UoF-${report.id ?? '?'}`,
    M, H - 18,
  );

  return doc;
}

export function openUseOfForceReportPdf(input: UofReportPdfInput): void {
  const doc = generateUseOfForceReportPdf(input);
  const url = URL.createObjectURL(doc.output('blob'));
  openPdfBlob(url, 'Use of Force Report');
}
