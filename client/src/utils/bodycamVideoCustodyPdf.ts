// ═══════════════════════════════════════════════════════════════
// Body-Worn Camera (BWC) Video — court-ready chain-of-custody PDF.
// BWC footage is statutory court-record material; the in-app player
// showed the metadata but there was no print path before this util.
// Same Arial + RMPG-gold + signature-block idiom as the prior court
// PDFs (shiftReportPdf, criminalHistoryPdf, fiCardPdf, evidenceItemPdf,
// offenderRegistrationCardPdf).
//
// The video file itself remains the primary evidence; this PDF
// documents the metadata + chain-of-custody timeline + viewing record
// so the operator has something they can sign and hand to a clerk.
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import { drawNavyBanner } from './pdfStandaloneHeader';
import { registerArialFont } from './pdf/fonts/registerArial';
import { parseTimestamp } from './dateUtils';
import { toDisplayLabel } from './formatters';
import { openPdfBlob } from './openPdfDocument';

const TEXT_DARK = '#1a1a1a';
const TEXT_MUTED = '#555555';
const BORDER = '#9a9a9a';
const ROW_ALT = '#f4f4f0';
const ALERT_BG = '#fef1f0';
const ALERT_BORDER = '#b91c1c';

const MT_TZ = 'America/Denver';

/** Server-side shape returned by GET /personnel/bodycam-videos/:id/custody. */
export interface BodycamCustodyEntry {
  at?: string;
  action?: string;
  by?: string;
  by_name?: string;
  notes?: string;
}

/** Minimal shape of a bodycam_videos row + joined officer/camera labels.
 *  Mirrors `BodyCamVideo` from client/src/types — duplicated here to keep
 *  the PDF generator independent of the page-state shape. */
export interface BodycamVideoForPdf {
  id?: number | string;
  title?: string;
  case_number?: string | null;
  classification?: string;
  retention_status?: string;
  recorded_at?: string;
  duration_seconds?: number | null;
  file_size?: number | null;
  mime_type?: string | null;
  officer_name?: string | null;
  camera_serial?: string | null;
  notes?: string | null;
  interaction_type?: string | null;
  uploaded_by?: string | null;
  created_at?: string;
}

export interface BodycamVideoPdfInput {
  video: BodycamVideoForPdf;
  /** Already-fetched from /personnel/bodycam-videos/:id/custody. */
  custody?: BodycamCustodyEntry[];
  /** Optional — name to embed as the PDF preparer (officer who hit Print). */
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

/** Format a file size in bytes as KB/MB/GB. */
export function fmtFileSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Pick a chain entry's actor — by_name preferred (resolved), `by` as fallback. */
export function chainEntryActor(entry: BodycamCustodyEntry): string {
  return (entry.by_name && entry.by_name.trim()) || (entry.by && String(entry.by).trim()) || '—';
}

/** "Is this an evidence hold?" — used for the alert banner. Mirrors the
 *  client EVIDENCE_HOLD_VALUES set kept on the server (legal_hold, etc.). */
export function isEvidenceHold(retention: string | undefined | null): boolean {
  if (!retention) return false;
  return /hold|preserve|court|ia/i.test(retention);
}

const ellipsize = (s: string, max: number) => s.length <= max ? s : s.slice(0, max - 1) + '…';

// ── PDF generator ────────────────────────────────────────────────

export function generateBodycamVideoCustodyPdf(input: BodycamVideoPdfInput): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  registerArialFont(doc);

  const { video, custody = [], preparedBy } = input;
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  let y = 36;

  // Banner
  const label = video.title || `BWC-${video.id ?? '?'}`;
  y = drawNavyBanner(doc, {
    title: `BWC VIDEO — ${ellipsize(label, 50)}`,
    subtitle: 'Body-Worn Camera / Evidence Custody',
    rightLine1: fmtDateTime(new Date().toISOString()),
    rightLine2: preparedBy ? `Prepared by: ${preparedBy}` : undefined,
  });

  // Evidence-hold alert (legal hold / IA hold / preserved)
  if (isEvidenceHold(video.retention_status)) {
    doc.setFillColor(ALERT_BG);
    doc.setDrawColor(ALERT_BORDER);
    doc.setLineWidth(0.75);
    doc.rect(M, y, W - 2 * M, 22, 'FD');
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(ALERT_BORDER);
    doc.text(
      `EVIDENCE HOLD — retention status "${video.retention_status}" — release before disposition`,
      M + 10, y + 15,
    );
    y += 30;
    doc.setLineWidth(0.5);
  }

  // ── Video metadata block ──
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('VIDEO', M, y);
  y += 4;
  doc.setDrawColor(BORDER);
  doc.line(M, y, W - M, y);
  y += 12;
  doc.setFont('Arial', 'normal');
  doc.setFontSize(9);

  const fields: Array<[string, string]> = [
    ['Title', video.title || '—'],
    ['Video ID', video.id != null ? `BWC-${video.id}` : '—'],
    ['Officer', video.officer_name || '—'],
    ['Camera Serial', video.camera_serial || '—'],
    ['Recorded', fmtDateTime(video.recorded_at)],
    ['Duration', fmtDuration(video.duration_seconds)],
    ['File Size', fmtFileSize(video.file_size)],
    ['Mime Type', video.mime_type || '—'],
    ['Classification', toDisplayLabel(video.classification)],
    ['Retention', toDisplayLabel(video.retention_status)],
    ['Interaction Type', toDisplayLabel(video.interaction_type ?? undefined)],
    ['Linked Case', video.case_number || '—'],
  ];
  const colW = (W - 2 * M) / 2;
  for (let i = 0; i < fields.length; i += 2) {
    const [lbl1, val1] = fields[i];
    const [lbl2, val2] = fields[i + 1] ?? ['', ''];
    doc.setTextColor(TEXT_MUTED);
    doc.text(lbl1.toUpperCase(), M, y);
    if (lbl2) doc.text(lbl2.toUpperCase(), M + colW, y);
    doc.setTextColor(TEXT_DARK);
    doc.text(ellipsize(val1, 60), M, y + 11);
    if (val2) doc.text(ellipsize(val2, 60), M + colW, y + 11);
    y += 24;
  }

  if (video.notes) {
    doc.setTextColor(TEXT_MUTED);
    doc.text('NOTES', M, y);
    y += 11;
    doc.setTextColor(TEXT_DARK);
    const lines = doc.splitTextToSize(video.notes, W - 2 * M);
    doc.text(lines, M, y);
    y += lines.length * 11 + 6;
  }

  // ── Chain-of-custody timeline ──
  const newPageIfNeeded = (need: number) => {
    if (y + need > H - 80) { doc.addPage(); y = 48; }
  };
  newPageIfNeeded(50);
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('CHAIN OF CUSTODY', M, y);
  y += 4;
  doc.line(M, y, W - M, y);
  y += 12;

  const cols = [
    { key: 'date',   label: 'DATE / TIME', width: 130 },
    { key: 'action', label: 'ACTION',      width: 140 },
    { key: 'actor',  label: 'BY',          width: 120 },
    { key: 'notes',  label: 'NOTES',       width: 130 },
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

  if (custody.length === 0) {
    doc.setFontSize(9);
    doc.setTextColor(TEXT_MUTED);
    doc.setFont('Arial', 'italic');
    doc.text('No chain-of-custody entries recorded.', M + 8, y + 14);
    doc.setFont('Arial', 'normal');
    y += 24;
  } else {
    doc.setFontSize(8);
    custody.forEach((entry, i) => {
      newPageIfNeeded(13);
      if (i % 2 === 1) {
        doc.setFillColor(ROW_ALT);
        doc.rect(M, y, W - 2 * M, 13, 'F');
      }
      doc.setTextColor(TEXT_DARK);
      let x = M + 4;
      doc.text(fmtDateTime(entry.at), x, y + 9);
      x += cols[0].width;
      doc.text(ellipsize(toDisplayLabel(entry.action), 22), x, y + 9);
      x += cols[1].width;
      doc.text(ellipsize(chainEntryActor(entry), 20), x, y + 9);
      x += cols[2].width;
      doc.text(ellipsize(entry.notes || '—', 24), x, y + 9);
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
  doc.text('Custodian signature', M, y + 38);
  if (preparedBy) doc.text(preparedBy, M, y + 49);
  doc.text('Supervisor signature / date', M + sigW + 24, y + 38);

  // Footer
  doc.setFontSize(7);
  doc.text(
    `Generated ${fmtDateTime(new Date().toISOString())}  ·  RMPG Flex BWC Custody  ·  BWC-${video.id ?? '?'}`,
    M, H - 18,
  );

  return doc;
}

export function openBodycamVideoCustodyPdf(input: BodycamVideoPdfInput): void {
  const doc = generateBodycamVideoCustodyPdf(input);
  const url = URL.createObjectURL(doc.output('blob'));
  openPdfBlob(url, 'Body Cam Video Custody');
}
