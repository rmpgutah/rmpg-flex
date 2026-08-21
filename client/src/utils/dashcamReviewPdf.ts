// ═══════════════════════════════════════════════════════════════
// Dash Camera — MVR Review Card PDF.
// Mobile Video Recorder (dashcam) footage is statutory court-record
// material when classified evidence/flagged. Supervisors and custodians
// had no print path before this util — same RMPG-gold banner +
// signature-block idiom as the other court PDFs (evidenceItemPdf,
// fiCardPdf, criminalHistoryPdf, courtAppearancePdf).
//
// Unlike the evidence item PDF, dashcam_videos has no chain_of_custody
// JSON column — instead the audit trail is implicit through the
// dashcam_video_links table (call/incident/case/warrant/citation links)
// and the classification + retention_status fields. The PDF surfaces
// all three so a defense-discovery printout is self-contained.
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import { drawNavyBanner } from './pdfStandaloneHeader';
import { registerArialFont } from './pdf/fonts/registerArial';
import { parseTimestamp } from './dateUtils';
import { formatEnumValue, toDisplayLabel } from './formatters';
import { openPdfBlob } from './openPdfDocument';

const RMPG_GOLD = '#d4a017';
const TEXT_DARK = '#1a1a1a';
const TEXT_MUTED = '#555555';
const BORDER = '#9a9a9a';
const ROW_ALT = '#f4f4f0';
const ALERT_BG = '#fef1f0';
const ALERT_BORDER = '#b91c1c';

const MT_TZ = 'America/Denver';

export interface DashcamVideo {
  id?: number | string;
  title?: string;
  classification?: string;
  retention_status?: string;
  source?: string;
  case_number?: string;
  notes?: string;
  recorded_at?: string;
  created_at?: string;
  duration_seconds?: number | null;
  file_size?: number | null;
  speed_mph?: number | null;
  heading?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  address?: string;
  // Joined columns (see fleet.ts GET /dashcam-videos/:id)
  vehicle_number?: string | number;
  vehicle_year?: number | string;
  vehicle_make?: string;
  vehicle_model?: string;
  unit_call_sign?: string;
  officer_name?: string;
  officer_badge?: string;
  cpg_channel?: string;
  cpg_event_type?: string;
  cpg_device_id?: string;
}

export interface DashcamLink {
  id?: number;
  entity_type?: string;
  entity_id?: number | string;
  notes?: string;
  linked_by?: string;
  created_at?: string;
  // Call-link enrichment (see fleet.ts /dashcam-videos/:id LEFT JOIN)
  priority?: number | string;
  incident_type?: string;
  status?: string;
  disposition?: string;
}

export interface DashcamReviewPdfInput {
  video: DashcamVideo;
  links?: DashcamLink[];
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

/** Public for testing. Channel label (matches the UI: outside=FRONT, inside=REAR). */
export function channelLabel(channel: string | undefined | null): string {
  if (!channel) return '—';
  if (channel === 'outside') return 'FRONT CAM';
  if (channel === 'inside') return 'REAR CAM';
  return channel.toUpperCase();
}

/** Public for testing. Human label for the file source. */
export function sourceLabel(source: string | undefined | null): string {
  if (!source || source === 'upload') return 'Manual Upload';
  if (source === 'clearpathgps') return 'ClearPathGPS';
  return source;
}

/** Public for testing. Format seconds as h:mm:ss / m:ss. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '—';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Public for testing. Human file size. */
export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Public for testing. Pretty-print an entity-type code for the links table. */
export function prettyEntityType(entityType: string | undefined | null): string {
  if (!entityType) return '—';
  return entityType.charAt(0).toUpperCase() + entityType.slice(1);
}

/** Public for testing. True when the video is classified as court-record
 *  material (evidence / flagged / restricted) but has no case number — the
 *  banner alert fires so the supervisor knows the chain-of-evidence link
 *  is broken before the discovery printout goes out the door. */
export function needsCaseLinkAlert(video: DashcamVideo, links: DashcamLink[]): boolean {
  const c = (video.classification || '').toLowerCase();
  if (c !== 'evidence' && c !== 'flagged' && c !== 'restricted') return false;
  if (video.case_number && video.case_number.trim()) return false;
  if (links.some((l) => l.entity_type === 'case')) return false;
  return true;
}

const ellipsize = (s: string, max: number) => s.length <= max ? s : s.slice(0, max - 1) + '…';

export function generateDashcamReviewPdf(input: DashcamReviewPdfInput): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  registerArialFont(doc);

  const { video, links = [], preparedBy } = input;
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  let y = 36;

  // Banner
  y = drawNavyBanner(doc, {
    title: `MVR REVIEW — ${video.title || `Video #${video.id ?? '?'}`}`,
    subtitle: 'Mobile Video Recorder / Dash Camera',
    rightLine1: fmtDateTime(new Date().toISOString()),
    rightLine2: preparedBy ? `Prepared by: ${preparedBy}` : undefined,
  });

  // Missing-case-link alert — evidence-classified video with no case link
  // means defense discovery has a dangling artifact. Surface it loudly so
  // the supervisor either links a case or downgrades the classification
  // before the printout leaves the building.
  if (needsCaseLinkAlert(video, links)) {
    doc.setFillColor(ALERT_BG);
    doc.setDrawColor(ALERT_BORDER);
    doc.setLineWidth(0.75);
    doc.rect(M, y, W - 2 * M, 22, 'FD');
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(ALERT_BORDER);
    doc.text(
      `${(video.classification || '').toUpperCase()} CLASSIFICATION — no case linked. Link case # before discovery release.`,
      M + 10, y + 15,
    );
    y += 30;
    doc.setLineWidth(0.5);
  }

  // Retention-locked banner — show a positive indicator when the video is
  // under a litigation hold so anyone receiving the printout knows it
  // cannot be destroyed.
  const retention = (video.retention_status || '').toLowerCase();
  if (retention && retention !== 'standard' && retention !== 'normal') {
    doc.setFillColor('#fff6db');
    doc.setDrawColor(RMPG_GOLD);
    doc.setLineWidth(0.5);
    doc.rect(M, y, W - 2 * M, 18, 'FD');
    doc.setFont('Arial', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(TEXT_DARK);
    doc.text(`RETENTION HOLD — ${toDisplayLabel(retention).toUpperCase()}`, M + 10, y + 12);
    y += 24;
  }

  // ── Clip block ──
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('CLIP', M, y);
  y += 4;
  doc.setDrawColor(BORDER);
  doc.line(M, y, W - M, y);
  y += 12;
  doc.setFont('Arial', 'normal');
  doc.setFontSize(9);

  const speed = video.speed_mph != null ? `${video.speed_mph} MPH` : '—';
  const fields: Array<[string, string]> = [
    ['Title', video.title || '—'],
    ['Classification', (video.classification || '—').toString()],
    ['Camera', channelLabel(video.cpg_channel)],
    ['Event Type', formatEnumValue(video.cpg_event_type) || 'Manual'],
    ['Recorded', fmtDateTime(video.recorded_at)],
    ['Duration', formatDuration(video.duration_seconds)],
    ['File Size', formatFileSize(video.file_size)],
    ['Source', sourceLabel(video.source)],
    ['Speed at capture', speed],
    ['Address', video.address || '—'],
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

  // ── Vehicle / officer block ──
  const vehicleLine = [
    video.vehicle_number ? `#${video.vehicle_number}` : '',
    video.vehicle_year ? String(video.vehicle_year) : '',
    video.vehicle_make || '',
    video.vehicle_model || '',
  ].filter(Boolean).join(' ').trim() || '—';

  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('VEHICLE / OFFICER', M, y);
  y += 4;
  doc.line(M, y, W - M, y);
  y += 12;
  doc.setFont('Arial', 'normal');
  doc.setFontSize(9);

  const voFields: Array<[string, string]> = [
    ['Vehicle', vehicleLine],
    ['Unit Call Sign', video.unit_call_sign || '—'],
    ['Officer', video.officer_name || '—'],
    ['Badge #', video.officer_badge || '—'],
  ];
  for (let i = 0; i < voFields.length; i += 2) {
    const [lbl1, val1] = voFields[i];
    const [lbl2, val2] = voFields[i + 1] ?? ['', ''];
    doc.setTextColor(TEXT_MUTED);
    doc.text(lbl1.toUpperCase(), M, y);
    if (lbl2) doc.text(lbl2.toUpperCase(), M + colW, y);
    doc.setTextColor(TEXT_DARK);
    doc.text(ellipsize(val1, 60), M, y + 11);
    if (val2) doc.text(ellipsize(val2, 60), M + colW, y + 11);
    y += 24;
  }

  // ── Location block (only if we have GPS coords) ──
  if (video.latitude != null && video.longitude != null) {
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(TEXT_DARK);
    doc.text('LOCATION', M, y);
    y += 4;
    doc.line(M, y, W - M, y);
    y += 12;
    doc.setFont('Arial', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(TEXT_MUTED);
    doc.text('GPS', M, y);
    doc.setTextColor(TEXT_DARK);
    doc.text(`${Number(video.latitude).toFixed(5)}, ${Number(video.longitude).toFixed(5)}`, M, y + 11);
    y += 24;
    if (video.heading != null) {
      doc.setTextColor(TEXT_MUTED);
      doc.text('HEADING', M, y);
      doc.setTextColor(TEXT_DARK);
      doc.text(`${Math.round(Number(video.heading))}°`, M, y + 11);
      y += 24;
    }
  }

  // ── Linked entities timeline ──
  const newPageIfNeeded = (need: number) => {
    if (y + need > H - 80) { doc.addPage(); y = 48; }
  };
  newPageIfNeeded(50);
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('LINKED RECORDS', M, y);
  y += 4;
  doc.line(M, y, W - M, y);
  y += 12;

  const cols = [
    { key: 'date',   label: 'LINKED',  width: 100 },
    { key: 'type',   label: 'TYPE',    width: 70 },
    { key: 'id',     label: 'ID',      width: 70 },
    { key: 'by',     label: 'BY',      width: 110 },
    { key: 'notes',  label: 'NOTES',   width: 170 },
  ] as const;

  // Header row
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

  if (links.length === 0 && !video.case_number) {
    doc.setFontSize(9);
    doc.setTextColor(TEXT_MUTED);
    doc.setFont('Arial', 'italic');
    doc.text('No records linked. Use Link Case in the review station to attach.', M + 8, y + 14);
    doc.setFont('Arial', 'normal');
    y += 24;
  } else {
    doc.setFontSize(8);
    // Synthesize a legacy case_number row when only the column is populated.
    const rows: Array<{ date: string; type: string; id: string; by: string; notes: string }> = [];
    if (video.case_number) {
      rows.push({
        date: fmtDate(video.recorded_at),
        type: 'Case (legacy)',
        id: video.case_number,
        by: '—',
        notes: 'case_number column',
      });
    }
    for (const l of links) {
      rows.push({
        date: fmtDateTime(l.created_at),
        type: prettyEntityType(l.entity_type),
        id: String(l.entity_id ?? '—'),
        by: l.linked_by || '—',
        notes: l.notes || (l.incident_type ? `${l.incident_type}${l.priority ? ` · P${l.priority}` : ''}` : '—'),
      });
    }
    rows.forEach((r, i) => {
      newPageIfNeeded(13);
      if (i % 2 === 1) {
        doc.setFillColor(ROW_ALT);
        doc.rect(M, y, W - 2 * M, 13, 'F');
      }
      doc.setTextColor(TEXT_DARK);
      let x = M + 4;
      doc.text(r.date, x, y + 9); x += cols[0].width;
      doc.text(r.type, x, y + 9); x += cols[1].width;
      doc.text(ellipsize(r.id, 14), x, y + 9); x += cols[2].width;
      doc.text(ellipsize(r.by, 18), x, y + 9); x += cols[3].width;
      doc.text(ellipsize(r.notes, 32), x, y + 9);
      doc.setDrawColor(BORDER);
      doc.setLineWidth(0.25);
      doc.line(M, y + 13, W - M, y + 13);
      y += 13;
    });
  }

  // ── Notes ──
  if (video.notes && video.notes.trim()) {
    newPageIfNeeded(40);
    y += 8;
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
    const lines = doc.splitTextToSize(video.notes, W - 2 * M);
    doc.text(lines, M, y);
    y += lines.length * 11 + 6;
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
    `Generated ${fmtDateTime(new Date().toISOString())}  ·  RMPG Flex MVR Review Station  ·  ${video.title || `Video #${video.id ?? '?'}`}`,
    M, H - 18,
  );

  return doc;
}

export function openDashcamReviewPdf(input: DashcamReviewPdfInput): void {
  const doc = generateDashcamReviewPdf(input);
  const url = URL.createObjectURL(doc.output('blob'));
  openPdfBlob(url, 'Dashcam Review');
}
