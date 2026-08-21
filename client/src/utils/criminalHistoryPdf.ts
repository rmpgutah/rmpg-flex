// ═══════════════════════════════════════════════════════════════
// Criminal History Report — court-ready PDF for the subject's full
// record (incidents + citations + field interviews + warrants).
// Used for discovery packages, defense reviews, and supervisor
// briefings. Same Arial + RMPG-gold + signature-block idiom as
// shiftReportPdf / clearedSummaryPdf / fiCardPdf.
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import { drawNavyBanner } from './pdfStandaloneHeader';
import { registerArialFont } from './pdf/fonts/registerArial';
import { parseTimestamp } from './dateUtils';
import { openPdfBlob } from './openPdfDocument';

const TEXT_DARK = '#1a1a1a';
const TEXT_MUTED = '#555555';
const BORDER = '#9a9a9a';
const ROW_ALT = '#f4f4f0';
const ALERT_BG = '#fef1f0';
const ALERT_BORDER = '#b91c1c';

const MT_TZ = 'America/Denver';

export type CriminalHistoryEntryType = 'incident' | 'citation' | 'field_interview' | 'warrant' | 'trespass';

export interface CriminalHistorySubject {
  id?: string | number;
  first_name?: string;
  last_name?: string;
  middle_name?: string;
  date_of_birth?: string;
  sex?: string;
  race?: string;
  drivers_license?: string;
  dl_state?: string;
  address?: string;
  caution_flags?: string;
  has_active_warrants?: boolean;
  is_sex_offender?: boolean;
}

export interface CriminalHistoryEntry {
  id: string;
  type: CriminalHistoryEntryType;
  date: string;
  reference_number: string;
  description: string;
  status: string;
  officer_name?: string;
  location?: string;
}

export interface CriminalHistoryInput {
  subject: CriminalHistorySubject;
  history: CriminalHistoryEntry[];
  /** Officer pulling the report (from useAuth on the calling side). */
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

/** Public for testing. Builds the "Smith, John M" form with all parts that
 *  exist; the trailing middle initial / name is omitted when blank. */
export function formatSubjectName(s: CriminalHistorySubject): string {
  const last = (s.last_name || '').trim();
  const first = (s.first_name || '').trim();
  const middle = (s.middle_name || '').trim();
  if (!last && !first) return 'Unknown Subject';
  const lead = [last, first].filter(Boolean).join(', ');
  return middle ? `${lead} ${middle}` : lead;
}

/** Public for testing. Groups history entries by type, returning the count
 *  per category — used for the cover-page summary. */
export function summarizeHistory(history: CriminalHistoryEntry[]): Record<CriminalHistoryEntryType, number> {
  const counts: Record<CriminalHistoryEntryType, number> = {
    incident: 0, citation: 0, field_interview: 0, warrant: 0, trespass: 0,
  };
  for (const h of history) {
    if (counts[h.type] != null) counts[h.type]++;
  }
  return counts;
}

const TYPE_LABEL: Record<CriminalHistoryEntryType, string> = {
  incident: 'INCIDENT',
  citation: 'CITATION',
  field_interview: 'FIELD INTERVIEW',
  warrant: 'WARRANT',
  trespass: 'TRESPASS',
};

const ellipsize = (s: string, max: number) => s.length <= max ? s : s.slice(0, max - 1) + '…';

export function generateCriminalHistoryPdf(input: CriminalHistoryInput): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  registerArialFont(doc);

  const { subject, history, preparedBy } = input;
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  let y = 36;

  // Banner
  y = drawNavyBanner(doc, {
    title: 'CRIMINAL HISTORY REPORT',
    subtitle: 'Records Division',
    rightLine1: fmtDateTime(new Date().toISOString()),
    rightLine2: preparedBy ? `Prepared by: ${preparedBy}` : undefined,
  });

  // Active-warrants / sex-offender alert (red, only when at least one fires)
  if (subject.has_active_warrants || subject.is_sex_offender) {
    doc.setFillColor(ALERT_BG);
    doc.setDrawColor(ALERT_BORDER);
    doc.setLineWidth(0.75);
    doc.rect(M, y, W - 2 * M, 22, 'FD');
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(ALERT_BORDER);
    const flags = [
      subject.has_active_warrants ? 'ACTIVE WARRANTS' : null,
      subject.is_sex_offender ? 'REGISTERED SEX OFFENDER' : null,
    ].filter(Boolean).join('  ·  ');
    doc.text(`SUBJECT FLAGS: ${flags}  —  EXERCISE CAUTION`, M + 10, y + 15);
    y += 30;
    doc.setLineWidth(0.5);
  }

  // ── Subject block ──
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('SUBJECT', M, y);
  y += 4;
  doc.setDrawColor(BORDER);
  doc.line(M, y, W - M, y);
  y += 12;
  doc.setFont('Arial', 'normal');
  doc.setFontSize(9);

  const subjectFields: Array<[string, string]> = [
    ['Name', formatSubjectName(subject)],
    ['Record ID', subject.id != null ? String(subject.id) : '—'],
    ['DOB', fmtDate(subject.date_of_birth)],
    ['Sex / Race', [subject.sex, subject.race].filter(Boolean).join(' / ') || '—'],
    ['Drivers License', [subject.drivers_license, subject.dl_state ? `(${subject.dl_state})` : ''].filter(Boolean).join(' ') || '—'],
    ['Address', subject.address || '—'],
  ];
  const colW = (W - 2 * M) / 2;
  for (let i = 0; i < subjectFields.length; i += 2) {
    const [lbl1, val1] = subjectFields[i];
    const [lbl2, val2] = subjectFields[i + 1] ?? ['', ''];
    doc.setTextColor(TEXT_MUTED);
    doc.text(lbl1.toUpperCase(), M, y);
    if (lbl2) doc.text(lbl2.toUpperCase(), M + colW, y);
    doc.setTextColor(TEXT_DARK);
    doc.text(val1, M, y + 11);
    if (val2) doc.text(val2, M + colW, y + 11);
    y += 24;
  }

  // Caution flags row
  const cautionFlags = (subject.caution_flags || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (cautionFlags.length > 0) {
    doc.setTextColor(TEXT_MUTED);
    doc.text('CAUTION FLAGS', M, y);
    doc.setTextColor(ALERT_BORDER);
    doc.text(cautionFlags.join(' · '), M + 110, y);
    y += 14;
  }

  // ── Summary tiles ──
  y += 6;
  const counts = summarizeHistory(history);
  const tiles: Array<{ label: string; value: number }> = [
    { label: 'TOTAL',         value: history.length },
    { label: 'INCIDENTS',     value: counts.incident },
    { label: 'CITATIONS',     value: counts.citation },
    { label: 'FIs',           value: counts.field_interview },
    { label: 'WARRANTS',      value: counts.warrant },
  ];
  const tileGap = 6;
  const tileW = (W - 2 * M - tileGap * (tiles.length - 1)) / tiles.length;
  doc.setDrawColor(BORDER);
  doc.setLineWidth(0.5);
  tiles.forEach((t, i) => {
    const x = M + i * (tileW + tileGap);
    doc.rect(x, y, tileW, 36);
    doc.setFontSize(8);
    doc.setTextColor(TEXT_MUTED);
    doc.text(t.label, x + 6, y + 11);
    doc.setFontSize(15);
    doc.setFont('Arial', 'bold');
    doc.setTextColor(TEXT_DARK);
    doc.text(String(t.value), x + 6, y + 28);
    doc.setFont('Arial', 'normal');
  });
  y += 48;

  // ── History table ──
  const newPageIfNeeded = (need: number) => {
    if (y + need > H - 70) { doc.addPage(); y = 48; }
  };
  newPageIfNeeded(40);
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('CHRONOLOGICAL HISTORY', M, y);
  y += 4;
  doc.line(M, y, W - M, y);
  y += 12;

  const cols = [
    { key: 'date',      label: 'DATE',     width: 60 },
    { key: 'type',      label: 'TYPE',     width: 80 },
    { key: 'ref',       label: 'REF #',    width: 75 },
    { key: 'desc',      label: 'DESCRIPTION', width: 240 },
    { key: 'status',    label: 'STATUS',   width: 65 },
  ] as const;

  // Table header
  doc.setFillColor('#e6e6e6');
  doc.rect(M, y, W - 2 * M, 14, 'F');
  doc.setFontSize(7.5);
  doc.setFont('Arial', 'bold');
  doc.setTextColor(TEXT_MUTED);
  {
    let x = M + 4;
    for (const c of cols) {
      doc.text(c.label, x, y + 9);
      x += c.width;
    }
  }
  y += 14;
  doc.setFont('Arial', 'normal');

  if (history.length === 0) {
    doc.setFontSize(9);
    doc.setTextColor(TEXT_MUTED);
    doc.setFont('Arial', 'italic');
    doc.text('No records on file.', M + 8, y + 14);
    doc.setFont('Arial', 'normal');
    y += 24;
  } else {
    doc.setFontSize(8);
    history.forEach((entry, i) => {
      newPageIfNeeded(13);
      if (i % 2 === 1) {
        doc.setFillColor(ROW_ALT);
        doc.rect(M, y, W - 2 * M, 13, 'F');
      }
      doc.setTextColor(TEXT_DARK);
      let x = M + 4;
      doc.text(fmtDate(entry.date), x, y + 9);
      x += cols[0].width;
      doc.text(TYPE_LABEL[entry.type] || entry.type.toUpperCase(), x, y + 9);
      x += cols[1].width;
      doc.text(ellipsize(entry.reference_number || '—', 11), x, y + 9);
      x += cols[2].width;
      doc.text(ellipsize(entry.description || '—', 50), x, y + 9);
      x += cols[3].width;
      doc.text(ellipsize(entry.status || '—', 11), x, y + 9);
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
  doc.text('Records officer signature', M, y + 38);
  if (preparedBy) doc.text(preparedBy, M, y + 49);
  doc.text('Supervisor signature / date', M + sigW + 24, y + 38);

  // Footer
  doc.setFontSize(7);
  doc.text(
    `Generated ${fmtDateTime(new Date().toISOString())}  ·  RMPG Flex Records  ·  Subject ${formatSubjectName(subject)}`,
    M, H - 18,
  );

  return doc;
}

export function openCriminalHistoryPdf(input: CriminalHistoryInput): void {
  const doc = generateCriminalHistoryPdf(input);
  const url = URL.createObjectURL(doc.output('blob'));
  openPdfBlob(url, 'Criminal History');
}
