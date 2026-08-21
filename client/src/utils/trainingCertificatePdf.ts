// ═══════════════════════════════════════════════════════════════
// Training Certificate / Qualification Record PDF.
//
// Training records (POST certification, firearms qualification, defensive
// tactics, first-aid, legal updates) are court-record-adjacent: defense
// counsel routinely subpoenas an officer's training jacket to challenge
// credibility, use-of-force, or arrest authority. The supervisor side of
// the Training Management page (/training) previously had no print path,
// so a deposition request had to be filled by hand-typing a Word doc
// against a spreadsheet — exactly the failure mode dashcamReviewPdf
// (v1043), evidenceItemPdf, and courtAppearancePdf were designed to
// prevent.
//
// Same RMPG-gold banner + signature-block idiom as the other court PDFs
// (dashcamReviewPdf, evidenceItemPdf, courtAppearancePdf). Manual jsPDF
// layout, Arial-only (project rule). Pure helpers are unit-tested; the
// PDF assembly is integration. No D1 columns are queried — every value
// comes from the row already on the page, so a deep-linked clip prints
// the same artifact regardless of pagination state.
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import { registerArialFont } from './pdf/fonts/registerArial';
import { parseTimestamp } from './dateUtils';
import { toDisplayLabel, stripHtmlForPdf } from './formatters';
import { openPdfBlob } from './openPdfDocument';
import { drawNavyBanner } from './pdfStandaloneHeader';

const RMPG_GOLD = '#d4a017';
const TEXT_DARK = '#1a1a1a';
const TEXT_MUTED = '#555555';
const BORDER = '#9a9a9a';
const ROW_ALT = '#f4f4f0';
const ALERT_BG = '#fef1f0';
const ALERT_BORDER = '#b91c1c';
const WARN_BG = '#fff6db';

const MT_TZ = 'America/Denver';

export interface TrainingRecordForPdf {
  id?: number | string;
  officer_id?: string | number;
  officer_name?: string;
  officer_badge?: string;
  course_name?: string;
  category?: string;
  provider?: string;
  completed_date?: string | null;
  expiry_date?: string | null;
  score?: number | null;
  hours?: number | null;
  certificate_number?: string;
  status?: string;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

export interface TrainingRequirementForPdf {
  id?: number | string;
  course_name?: string;
  category?: string;
  required_for_roles?: string[] | string;
  renewal_period_months?: number;
  minimum_hours?: number;
  is_mandatory?: boolean | number;
  description?: string;
}

export interface TrainingCertificatePdfInput {
  record: TrainingRecordForPdf;
  /** Optional matching requirement row — used to print the minimum-hours
   *  and renewal cadence and to flag a sub-minimum hours record. */
  requirement?: TrainingRequirementForPdf | null;
  preparedBy?: string;
}

function fmtDate(input: string | undefined | null): string {
  if (!input) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: MT_TZ, year: 'numeric', month: 'short', day: 'numeric',
    }).format(parseTimestamp(input));
  } catch { return String(input); }
}

function fmtDateTime(input: string | undefined | null): string {
  if (!input) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: MT_TZ, year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(parseTimestamp(input)) + ' MT';
  } catch { return String(input); }
}

/** Public for testing. Pretty-print a training category code for the PDF. */
export function prettyCategory(category: string | undefined | null): string {
  if (!category) return '—';
  return toDisplayLabel(category).toUpperCase();
}

/** Public for testing. Pretty-print a status code for the PDF. */
export function prettyStatus(status: string | undefined | null): string {
  if (!status) return '—';
  return toDisplayLabel(status).toUpperCase();
}

/** Public for testing. Format a numeric score as "92 / 100" or em-dash. */
export function formatScore(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(Number(score))) return '—';
  return `${score} / 100`;
}

/** Public for testing. Format the renewal cadence as a human string. */
export function formatRenewal(months: number | null | undefined): string {
  if (months == null || !Number.isFinite(Number(months)) || months <= 0) return 'No renewal';
  if (months === 12) return 'Annually';
  if (months === 6) return 'Every 6 months';
  if (months === 24) return 'Every 2 years';
  if (months === 36) return 'Every 3 years';
  if (months % 12 === 0) return `Every ${months / 12} years`;
  return `Every ${months} months`;
}

/** Public for testing. Compute the days-until-expiry classification. Returns
 *  'expired' if the expiry date is in the past, 'critical' if it expires
 *  within 30 days, 'warning' if within 60 days, 'ok' otherwise, and 'none'
 *  if the record has no expiry date or status is in_progress/scheduled. */
export function expiryStatus(
  record: { expiry_date?: string | null; status?: string },
  now: Date = new Date(),
): 'none' | 'expired' | 'critical' | 'warning' | 'ok' {
  if (!record.expiry_date) return 'none';
  // A scheduled record has no real expiry to act on — it hasn't been completed yet.
  if (record.status === 'scheduled' || record.status === 'in_progress') return 'none';
  let exp: Date;
  try { exp = parseTimestamp(record.expiry_date); } catch { return 'none'; }
  const ms = exp.getTime() - now.getTime();
  const days = Math.ceil(ms / 86_400_000);
  if (days < 0) return 'expired';
  if (days <= 30) return 'critical';
  if (days <= 60) return 'warning';
  return 'ok';
}

/** Public for testing. True when a court-discovery printout would be
 *  embarrassing because the record lacks a certificate number or
 *  completion date for a status that claims completion. Defense
 *  counsel can challenge "completed" rows without any documentary
 *  artifact (cert #, completion date) — surface the gap before the
 *  printout leaves the building. */
export function needsAuditAlert(record: TrainingRecordForPdf): boolean {
  const s = (record.status || '').toLowerCase();
  if (s !== 'completed') return false;
  if (record.certificate_number && record.certificate_number.trim()) return false;
  if (record.completed_date && record.completed_date.trim()) return false;
  return true;
}

/** Public for testing. True when a "completed" record's hours are below
 *  the requirement's minimum_hours. Surfaced as a yellow warn banner. */
export function isSubMinimumHours(
  record: TrainingRecordForPdf,
  requirement: TrainingRequirementForPdf | null | undefined,
): boolean {
  if (!requirement) return false;
  if ((record.status || '').toLowerCase() !== 'completed') return false;
  const min = Number(requirement.minimum_hours || 0);
  if (!min) return false;
  const hrs = Number(record.hours || 0);
  return hrs > 0 && hrs < min;
}

const ellipsize = (s: string, max: number) => s.length <= max ? s : s.slice(0, max - 1) + '…';

function rolesAsList(roles: string[] | string | undefined): string[] {
  if (!roles) return [];
  if (Array.isArray(roles)) return roles;
  try {
    const parsed = JSON.parse(roles);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

export function generateTrainingCertificatePdf(input: TrainingCertificatePdfInput): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  registerArialFont(doc);

  const { record, requirement = null, preparedBy } = input;
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  let y = 36;

  // ── Banner ─────────────────────────────────────────────
  y = drawNavyBanner(doc, {
    title: `TRAINING CERTIFICATE — ${record.certificate_number || record.course_name || `Record #${record.id ?? '?'}`}`,
    subtitle: 'Officer Training & Qualification Record',
    rightLine1: fmtDateTime(new Date().toISOString()),
    rightLine2: preparedBy ? `Prepared by: ${preparedBy}` : undefined,
  });

  // ── Audit alert — completed but no cert or completion date ──
  if (needsAuditAlert(record)) {
    doc.setFillColor(ALERT_BG);
    doc.setDrawColor(ALERT_BORDER);
    doc.setLineWidth(0.75);
    doc.rect(M, y, W - 2 * M, 22, 'FD');
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(ALERT_BORDER);
    doc.text(
      'COMPLETED record missing certificate # AND completion date — fill before discovery release.',
      M + 10, y + 15,
    );
    y += 30;
    doc.setLineWidth(0.5);
  }

  // ── Sub-minimum hours warn ─────────────────────────────
  if (isSubMinimumHours(record, requirement)) {
    doc.setFillColor(WARN_BG);
    doc.setDrawColor(RMPG_GOLD);
    doc.setLineWidth(0.5);
    doc.rect(M, y, W - 2 * M, 18, 'FD');
    doc.setFont('Arial', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(TEXT_DARK);
    doc.text(
      `SUB-MINIMUM HOURS — ${record.hours || 0}h logged vs ${requirement?.minimum_hours}h required.`,
      M + 10, y + 12,
    );
    y += 24;
  }

  // ── Expiry urgency banner ──────────────────────────────
  const status = expiryStatus(record);
  if (status === 'expired' || status === 'critical') {
    const bgColor = status === 'expired' ? ALERT_BG : '#fff1d6';
    const borderColor = status === 'expired' ? ALERT_BORDER : RMPG_GOLD;
    const textColor = status === 'expired' ? ALERT_BORDER : TEXT_DARK;
    doc.setFillColor(bgColor);
    doc.setDrawColor(borderColor);
    doc.setLineWidth(0.5);
    doc.rect(M, y, W - 2 * M, 18, 'FD');
    doc.setFont('Arial', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(textColor);
    const msg = status === 'expired'
      ? `CERTIFICATION EXPIRED — ${fmtDate(record.expiry_date)} (renewal overdue).`
      : `EXPIRING SOON — ${fmtDate(record.expiry_date)} (within 30 days).`;
    doc.text(msg, M + 10, y + 12);
    y += 24;
  }

  // ── Officer block ──────────────────────────────────────
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('OFFICER', M, y);
  y += 4;
  doc.setDrawColor(BORDER);
  doc.line(M, y, W - M, y);
  y += 12;
  doc.setFont('Arial', 'normal');
  doc.setFontSize(9);

  const colW = (W - 2 * M) / 2;
  const officerFields: Array<[string, string]> = [
    ['Officer', record.officer_name || '—'],
    ['Badge #', record.officer_badge || '—'],
  ];
  for (let i = 0; i < officerFields.length; i += 2) {
    const [lbl1, val1] = officerFields[i];
    const [lbl2, val2] = officerFields[i + 1] ?? ['', ''];
    doc.setTextColor(TEXT_MUTED);
    doc.text(lbl1.toUpperCase(), M, y);
    if (lbl2) doc.text(lbl2.toUpperCase(), M + colW, y);
    doc.setTextColor(TEXT_DARK);
    doc.text(ellipsize(val1, 60), M, y + 11);
    if (val2) doc.text(ellipsize(val2, 60), M + colW, y + 11);
    y += 24;
  }

  // ── Course block ───────────────────────────────────────
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('COURSE', M, y);
  y += 4;
  doc.line(M, y, W - M, y);
  y += 12;
  doc.setFont('Arial', 'normal');
  doc.setFontSize(9);

  const courseFields: Array<[string, string]> = [
    ['Course Name', record.course_name || '—'],
    ['Category', prettyCategory(record.category)],
    ['Provider', record.provider || '—'],
    ['Status', prettyStatus(record.status)],
  ];
  for (let i = 0; i < courseFields.length; i += 2) {
    const [lbl1, val1] = courseFields[i];
    const [lbl2, val2] = courseFields[i + 1] ?? ['', ''];
    doc.setTextColor(TEXT_MUTED);
    doc.text(lbl1.toUpperCase(), M, y);
    if (lbl2) doc.text(lbl2.toUpperCase(), M + colW, y);
    doc.setTextColor(TEXT_DARK);
    doc.text(ellipsize(val1, 60), M, y + 11);
    if (val2) doc.text(ellipsize(val2, 60), M + colW, y + 11);
    y += 24;
  }

  // ── Documentation block ────────────────────────────────
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('DOCUMENTATION', M, y);
  y += 4;
  doc.line(M, y, W - M, y);
  y += 12;
  doc.setFont('Arial', 'normal');
  doc.setFontSize(9);

  const docFields: Array<[string, string]> = [
    ['Completed', fmtDate(record.completed_date)],
    ['Expires', fmtDate(record.expiry_date)],
    ['Hours Logged', record.hours != null ? `${record.hours}h` : '—'],
    ['Score', formatScore(record.score)],
    ['Certificate #', record.certificate_number || '—'],
    ['Record ID', String(record.id ?? '—')],
  ];
  for (let i = 0; i < docFields.length; i += 2) {
    const [lbl1, val1] = docFields[i];
    const [lbl2, val2] = docFields[i + 1] ?? ['', ''];
    doc.setTextColor(TEXT_MUTED);
    doc.text(lbl1.toUpperCase(), M, y);
    if (lbl2) doc.text(lbl2.toUpperCase(), M + colW, y);
    doc.setTextColor(TEXT_DARK);
    doc.text(ellipsize(val1, 60), M, y + 11);
    if (val2) doc.text(ellipsize(val2, 60), M + colW, y + 11);
    y += 24;
  }

  // ── Requirement block (only if matched) ────────────────
  if (requirement) {
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(TEXT_DARK);
    doc.text('REGULATORY REQUIREMENT', M, y);
    y += 4;
    doc.line(M, y, W - M, y);
    y += 12;
    doc.setFont('Arial', 'normal');
    doc.setFontSize(9);

    const roles = rolesAsList(requirement.required_for_roles);
    const reqFields: Array<[string, string]> = [
      ['Minimum Hours', requirement.minimum_hours != null ? `${requirement.minimum_hours}h` : '—'],
      ['Renewal Cadence', formatRenewal(requirement.renewal_period_months)],
      ['Required For', roles.length > 0 ? roles.map(r => toDisplayLabel(r)).join(', ') : '—'],
      ['Mandatory', requirement.is_mandatory ? 'YES' : 'No'],
    ];
    for (let i = 0; i < reqFields.length; i += 2) {
      const [lbl1, val1] = reqFields[i];
      const [lbl2, val2] = reqFields[i + 1] ?? ['', ''];
      doc.setTextColor(TEXT_MUTED);
      doc.text(lbl1.toUpperCase(), M, y);
      if (lbl2) doc.text(lbl2.toUpperCase(), M + colW, y);
      doc.setTextColor(TEXT_DARK);
      doc.text(ellipsize(val1, 60), M, y + 11);
      if (val2) doc.text(ellipsize(val2, 60), M + colW, y + 11);
      y += 24;
    }

    if (requirement.description && requirement.description.trim()) {
      doc.setTextColor(TEXT_MUTED);
      doc.text('DESCRIPTION', M, y);
      y += 11;
      doc.setTextColor(TEXT_DARK);
      const lines = doc.splitTextToSize(requirement.description, W - 2 * M);
      doc.text(lines, M, y);
      y += lines.length * 11 + 8;
    }
  }

  // ── Notes ──────────────────────────────────────────────
  const newPageIfNeeded = (need: number) => {
    if (y + need > H - 80) { doc.addPage(); y = 48; }
  };
  if (record.notes && record.notes.trim()) {
    newPageIfNeeded(40);
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(TEXT_DARK);
    doc.text('NOTES', M, y);
    y += 4;
    doc.line(M, y, W - M, y);
    y += 12;
    doc.setFont('Arial', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(TEXT_DARK);
    // Strip basic HTML tags that RichTextArea may have inserted
    const plain = stripHtmlForPdf(record.notes);
    const lines = doc.splitTextToSize(plain || '—', W - 2 * M);
    doc.text(lines, M, y);
    y += lines.length * 11 + 6;
  }

  // ── Provenance / audit timestamps ──────────────────────
  if (record.created_at || record.updated_at) {
    newPageIfNeeded(30);
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(TEXT_DARK);
    doc.text('PROVENANCE', M, y);
    y += 4;
    doc.line(M, y, W - M, y);
    y += 12;
    doc.setFont('Arial', 'normal');
    doc.setFontSize(9);
    const provFields: Array<[string, string]> = [
      ['Record Created', fmtDateTime(record.created_at)],
      ['Last Updated', fmtDateTime(record.updated_at)],
    ];
    for (const [lbl, val] of provFields) {
      doc.setTextColor(TEXT_MUTED);
      doc.text(lbl.toUpperCase(), M, y);
      doc.setTextColor(TEXT_DARK);
      doc.text(val, M + 130, y);
      y += 13;
    }
    y += 4;
  }

  // ── Row-alt provenance separator ───────────────────────
  // (Reserved — unused at present but matches the dashcam layout idiom.)
  void ROW_ALT;

  // ── Signature block ────────────────────────────────────
  newPageIfNeeded(70);
  y += 14;
  doc.setDrawColor(BORDER);
  doc.setLineWidth(0.5);
  const sigW = (W - 2 * M - 24) / 2;
  doc.line(M, y + 28, M + sigW, y + 28);
  doc.line(M + sigW + 24, y + 28, W - M, y + 28);
  doc.setFontSize(8);
  doc.setTextColor(TEXT_MUTED);
  doc.text('Officer signature / date', M, y + 38);
  doc.text('Training officer or custodian signature / date', M + sigW + 24, y + 38);
  if (preparedBy) doc.text(preparedBy, M + sigW + 24, y + 49);

  // ── Footer ─────────────────────────────────────────────
  doc.setFontSize(7);
  doc.text(
    `Generated ${fmtDateTime(new Date().toISOString())}  ·  RMPG Flex Training Management  ·  ${record.course_name || `Record #${record.id ?? '?'}`}`,
    M, H - 18,
  );

  return doc;
}

export function openTrainingCertificatePdf(input: TrainingCertificatePdfInput): void {
  const doc = generateTrainingCertificatePdf(input);
  const url = URL.createObjectURL(doc.output('blob'));
  openPdfBlob(url, 'Training Certificate');
}
