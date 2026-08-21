// ═══════════════════════════════════════════════════════════════
// ALPR Plate Capture — Court Record PDF.
// An ALPR read that participates in a pursuit, felony stop, or any
// arrest workflow becomes statutory evidence (the read time, plate,
// state, screening result, GPS, and the device that captured it are
// all material to suppression-motion review). Supervisors and the
// records custodian had no print path for a single capture before
// this — the dashcam clip PDF exists (dashcamReviewPdf.ts), but the
// stand-alone ALPR capture row did not.
//
// Same court-PDF idiom as evidenceItemPdf / dashcamReviewPdf:
// RMPG gold banner, agency strap, optional unverified-read alert
// banner, then capture/vehicle/location/screening/history blocks
// and a custodian signature line. Includes the audit history pulled
// from /api/alpr/capture/:id/history so the chain-of-review is
// embedded in the printout — no extra paperwork needed.
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import { drawNavyBanner } from './pdfStandaloneHeader';
import { registerArialFont } from './pdf/fonts/registerArial';
import { parseTimestamp } from './dateUtils';
import { openPdfBlob } from './openPdfDocument';
import { fetchImageFromUrl, type ResolvedImage } from './pdfImageHelpers';

const TEXT_DARK = '#1a1a1a';
const TEXT_MUTED = '#555555';
const BORDER = '#9a9a9a';
const ROW_ALT = '#f4f4f0';
const ALERT_BG = '#fef1f0';
const ALERT_BORDER = '#b91c1c';

const MT_TZ = 'America/Denver';

/** A single ALPR capture row — the shape returned by GET /api/alpr/capture/:id
 *  (see shapeCapture in src/routes/alpr.ts) and POST /api/alpr/capture. Only
 *  the fields the PDF needs are typed — extra fields are ignored. */
export interface PlateCaptureForPdf {
  id?: number | string;
  plate?: string | null;
  state?: string | null;
  make?: string | null;
  model?: string | null;
  color?: string | null;
  year?: number | string | null;
  vehicle_type?: string | null;
  condition?: string | null;
  damage_summary?: string | null;
  damage_observed?: boolean | number | null;
  review_status?: string | null;
  accepted?: boolean | number | null;
  plate_confidence?: number | null;
  confidence?: number | null;
  risk_score?: number | null;
  alerted?: boolean | number | null;
  source?: string | null;
  event_type?: string | null;
  device_name?: string | null;
  location_text?: string | null;
  lat?: number | null;
  lng?: number | null;
  created_at?: string | null;
  reviewed_at?: string | null;
  call_id?: number | string | null;
  incident_id?: number | string | null;
  image_url?: string | null;
  annotated_image_url?: string | null;
  /** Trust-package fields (added by shapeCapture from vehicle_capture_photos). */
  trust_score?: number | null;
  trust_basis?: string | null;
  read_count?: number | null;
  canonical_plate?: string | null;
}

export interface PlateCaptureHit {
  kind?: string;
  severity?: string;
  detail?: string;
}

export interface PlateCaptureHistoryRow {
  id?: number;
  action?: string;
  details?: string | null;
  created_at?: string;
  user_name?: string | null;
}

export interface PlateCapturePdfInput {
  capture: PlateCaptureForPdf;
  hits?: PlateCaptureHit[];
  history?: PlateCaptureHistoryRow[];
  preparedBy?: string;
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

/** Pretty-print the capture source code: dashcam → DASHCAM (ClearPath), etc. */
export function sourceLabel(source: string | undefined | null): string {
  switch ((source || '').toLowerCase()) {
    case 'dashcam': return 'DASHCAM (ClearPath)';
    case 'field': return 'FIELD CAMERA';
    case 'manual': return 'MANUAL ENTRY';
    case '': case null: case undefined: return '—';
    default: return String(source).toUpperCase();
  }
}

/** Pretty-print the review_status enum. Mirrors REVIEW_STATUS_LABELS in
 *  PlateLogPage so the PDF reads the same as the screen. */
export function reviewStatusLabel(status: string | undefined | null): string {
  switch ((status || '').toLowerCase()) {
    case 'confirmed': return 'Confirmed';
    case 'confirmed_unlinked': return 'Confirmed (record not linked)';
    case 'needs_review': return 'Needs Review';
    case 'no_plate': return 'No Plate';
    case 'rejected': return 'Rejected';
    case '': return '—';
    default: return String(status);
  }
}

/** Public for testing. The unverified-read banner fires when an officer is
 *  about to put the printout into a court file but the capture has NOT been
 *  human-verified (still held for review). A stack of single-read PDFs in
 *  discovery without verification stamps was the failure mode the v963
 *  TrustBadge audit caught — surface it loudly on the printed page too. */
export function needsVerificationAlert(c: PlateCaptureForPdf): boolean {
  const status = (c.review_status || '').toLowerCase();
  if (status === 'confirmed' || status === 'confirmed_unlinked') return false;
  // Rejected captures shouldn't be printed for court at all; if they are, the
  // banner still fires (the reader needs to know it was rejected).
  if (status === 'rejected') return true;
  if (c.accepted === true || c.accepted === 1) return false;
  return true;
}

const ellipsize = (s: string, max: number) => s.length <= max ? s : s.slice(0, max - 1) + '…';

/** Public for testing. Vehicle summary line — "RED 2019 FORD F150" or "—". */
export function vehicleSummary(c: PlateCaptureForPdf): string {
  const parts = [c.color, c.year, c.make, c.model].filter((v) => v != null && String(v).trim()).map(String);
  return parts.length ? parts.join(' ') : (c.vehicle_type || '—');
}

/** Public for testing. Human-readable trust line — "82% derived (3 reads)". */
export function trustLine(c: PlateCaptureForPdf): string {
  const score = c.trust_score ?? c.plate_confidence ?? c.confidence ?? null;
  if (score == null) return '—';
  const pct = Math.round(Number(score) * 100);
  const basis = c.trust_basis ? ` ${c.trust_basis}` : ' single read';
  const reads = c.read_count && c.read_count > 1 ? ` (${c.read_count} reads)` : '';
  return `${pct}%${basis}${reads}`;
}

export async function generatePlateCapturePdf(input: PlateCapturePdfInput): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  registerArialFont(doc);

  const { capture: cap, hits = [], history = [], preparedBy } = input;
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  let y = 36;

  // Banner
  const plateTitle = (cap.canonical_plate || cap.plate || '—').toUpperCase();
  y = drawNavyBanner(doc, {
    title: `ALPR CAPTURE — ${plateTitle}`,
    subtitle: 'Automated Plate Reader',
    rightLine1: fmtDateTime(new Date().toISOString()),
    rightLine2: preparedBy ? `Prepared by: ${preparedBy}` : undefined,
  });

  // Unverified-read alert — see needsVerificationAlert() above.
  if (needsVerificationAlert(cap)) {
    doc.setFillColor(ALERT_BG);
    doc.setDrawColor(ALERT_BORDER);
    doc.setLineWidth(0.75);
    doc.rect(M, y, W - 2 * M, 22, 'FD');
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(ALERT_BORDER);
    doc.text(
      `UNVERIFIED READ — ${reviewStatusLabel(cap.review_status).toUpperCase()}. Confirm in Plate Log before evidentiary use.`,
      M + 10, y + 15,
    );
    y += 30;
    doc.setLineWidth(0.5);
  }

  // STOLEN / watchlist hit banner — the operational reason this PDF exists.
  const crit = hits.filter((h) => (h.severity || '').toLowerCase() === 'critical');
  if (crit.length) {
    doc.setFillColor(ALERT_BG);
    doc.setDrawColor(ALERT_BORDER);
    doc.setLineWidth(0.75);
    doc.rect(M, y, W - 2 * M, 14 + crit.length * 12, 'FD');
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(ALERT_BORDER);
    doc.text('SCREENING HITS', M + 10, y + 12);
    doc.setFontSize(9);
    doc.setFont('Arial', 'normal');
    for (let i = 0; i < crit.length; i++) {
      doc.text(`• ${crit[i].detail || crit[i].kind || 'hit'}`, M + 14, y + 24 + i * 11);
    }
    y += 18 + crit.length * 12;
    doc.setLineWidth(0.5);
  }

  // ── Image (annotated > original > skip) ──
  const imgUrl = cap.annotated_image_url || cap.image_url;
  let resolvedImg: ResolvedImage | null = null;
  if (imgUrl) {
    try {
      resolvedImg = await fetchImageFromUrl(imgUrl, `capture-${cap.id ?? ''}.jpg`);
    } catch { resolvedImg = null; }
  }
  if (resolvedImg) {
    const maxImgW = (W - 2 * M) / 2;
    const maxImgH = 140;
    const aspect = resolvedImg.width / resolvedImg.height;
    let imgW = maxImgW; let imgH = imgW / aspect;
    if (imgH > maxImgH) { imgH = maxImgH; imgW = imgH * aspect; }
    try {
      doc.addImage(resolvedImg.dataUrl, resolvedImg.format, M, y, imgW, imgH);
      doc.setDrawColor(BORDER);
      doc.setLineWidth(0.25);
      doc.rect(M, y, imgW, imgH);
    } catch { /* embed failed — skip silently, the rest of the page still prints */ }
  }

  // ── Capture block (right column when image present, else full width) ──
  const captureLeft = resolvedImg ? M + (W - 2 * M) / 2 + 12 : M;
  const captureColW = resolvedImg ? (W - 2 * M) / 2 - 12 : W - 2 * M;
  let cy = y;

  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('CAPTURE', captureLeft, cy);
  cy += 4;
  doc.setDrawColor(BORDER);
  doc.line(captureLeft, cy, captureLeft + captureColW, cy);
  cy += 12;
  doc.setFont('Arial', 'normal');
  doc.setFontSize(9);

  const fields: Array<[string, string]> = [
    ['Plate', plateTitle + (cap.state ? `  ·  ${cap.state}` : '')],
    ['Vehicle', vehicleSummary(cap)],
    ['Captured', fmtDateTime(cap.created_at)],
    ['Source', sourceLabel(cap.source)],
    ['Device', cap.device_name || '—'],
    ['Trust', trustLine(cap)],
    ['Review', reviewStatusLabel(cap.review_status)],
  ];
  if (cap.condition || cap.damage_summary) {
    const dmg = [cap.condition, cap.damage_summary].filter(Boolean).join(' · ');
    fields.push(['Condition', dmg || '—']);
  }
  for (const [lbl, val] of fields) {
    doc.setTextColor(TEXT_MUTED);
    doc.text(lbl.toUpperCase(), captureLeft, cy);
    doc.setTextColor(TEXT_DARK);
    doc.text(ellipsize(val, 50), captureLeft, cy + 11);
    cy += 22;
  }

  // Advance y past whichever column is taller.
  const imgBottom = resolvedImg ? y + 140 + 6 : y;
  y = Math.max(cy + 6, imgBottom);

  // ── Linked / location block ──
  const newPageIfNeeded = (need: number) => {
    if (y + need > H - 80) { doc.addPage(); y = 48; }
  };

  newPageIfNeeded(60);
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('LOCATION & LINKED RECORDS', M, y);
  y += 4;
  doc.setDrawColor(BORDER);
  doc.line(M, y, W - M, y);
  y += 12;
  doc.setFont('Arial', 'normal');
  doc.setFontSize(9);

  const colW = (W - 2 * M) / 2;
  const locFields: Array<[string, string]> = [
    ['Location', cap.location_text || '—'],
    ['GPS', (cap.lat != null && cap.lng != null)
      ? `${Number(cap.lat).toFixed(5)}, ${Number(cap.lng).toFixed(5)}` : '—'],
    ['Call #', cap.call_id != null ? `#${cap.call_id}` : '—'],
    ['Incident #', cap.incident_id != null ? `#${cap.incident_id}` : '—'],
  ];
  for (let i = 0; i < locFields.length; i += 2) {
    const [lbl1, val1] = locFields[i];
    const [lbl2, val2] = locFields[i + 1] ?? ['', ''];
    doc.setTextColor(TEXT_MUTED);
    doc.text(lbl1.toUpperCase(), M, y);
    if (lbl2) doc.text(lbl2.toUpperCase(), M + colW, y);
    doc.setTextColor(TEXT_DARK);
    doc.text(ellipsize(val1, 60), M, y + 11);
    if (val2) doc.text(ellipsize(val2, 60), M + colW, y + 11);
    y += 24;
  }

  // ── Review history (from /api/alpr/capture/:id/history) ──
  newPageIfNeeded(50);
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('REVIEW HISTORY', M, y);
  y += 4;
  doc.line(M, y, W - M, y);
  y += 12;

  const cols = [
    { key: 'date',   label: 'WHEN',    width: 110 },
    { key: 'action', label: 'ACTION',  width: 110 },
    { key: 'by',     label: 'BY',      width: 110 },
    { key: 'notes',  label: 'NOTES',   width: 190 },
  ] as const;

  doc.setFillColor('#e6e6e6');
  doc.rect(M, y, W - 2 * M, 14, 'F');
  doc.setFontSize(7.5);
  doc.setFont('Arial', 'bold');
  doc.setTextColor(TEXT_MUTED);
  {
    let x = M + 4;
    for (const c of cols) { doc.text(c.label, x, y + 9); x += c.width; }
  }
  y += 14;
  doc.setFont('Arial', 'normal');

  if (history.length === 0) {
    doc.setFontSize(9);
    doc.setTextColor(TEXT_MUTED);
    doc.setFont('Arial', 'italic');
    doc.text('No review actions recorded.', M + 8, y + 14);
    doc.setFont('Arial', 'normal');
    y += 24;
  } else {
    doc.setFontSize(8);
    history.forEach((r, i) => {
      newPageIfNeeded(13);
      if (i % 2 === 1) {
        doc.setFillColor(ROW_ALT);
        doc.rect(M, y, W - 2 * M, 13, 'F');
      }
      doc.setTextColor(TEXT_DARK);
      let x = M + 4;
      doc.text(fmtDateTime(r.created_at), x, y + 9); x += cols[0].width;
      doc.text(ellipsize(r.action || '—', 18), x, y + 9); x += cols[1].width;
      doc.text(ellipsize(r.user_name || '—', 18), x, y + 9); x += cols[2].width;
      doc.text(ellipsize(r.details || '—', 38), x, y + 9);
      doc.setDrawColor(BORDER);
      doc.setLineWidth(0.25);
      doc.line(M, y + 13, W - M, y + 13);
      y += 13;
    });
  }

  // ── Signature block ──
  newPageIfNeeded(70);
  y += 14;
  doc.setDrawColor(BORDER);
  doc.setLineWidth(0.5);
  const sigW = (W - 2 * M - 24) / 2;
  doc.line(M, y + 28, M + sigW, y + 28);
  doc.line(M + sigW + 24, y + 28, W - M, y + 28);
  doc.setFontSize(8);
  doc.setTextColor(TEXT_MUTED);
  doc.text('Reviewing supervisor signature', M, y + 38);
  if (preparedBy) doc.text(preparedBy, M, y + 49);
  doc.text('Custodian signature / date', M + sigW + 24, y + 38);

  // Footer
  doc.setFontSize(7);
  doc.text(
    `Generated ${fmtDateTime(new Date().toISOString())}  ·  RMPG Flex Plate Log  ·  Capture #${cap.id ?? '?'}`,
    M, H - 18,
  );

  return doc;
}

export async function openPlateCapturePdf(input: PlateCapturePdfInput): Promise<void> {
  const doc = await generatePlateCapturePdf(input);
  const url = URL.createObjectURL(doc.output('blob'));
  openPdfBlob(url, 'Plate Capture');
}
