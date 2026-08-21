// ═══════════════════════════════════════════════════════════════
// Evidence Item — court-ready chain-of-custody PDF.
// Evidence + chain of custody is statutory court-record material;
// the in-app detail panel showed it but there was no print path
// before this util. Same Arial + RMPG-gold + signature-block idiom
// as the prior court PDFs (shiftReport, clearedSummary, fiCard,
// criminalHistory).
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import { drawNavyBanner } from './pdfStandaloneHeader';
import { registerArialFont } from './pdf/fonts/registerArial';
import { parseTimestamp } from './dateUtils';
import { formatEnumValue, toDisplayLabel } from './formatters';
import { openPdfBlob } from './openPdfDocument';

const TEXT_DARK = '#1a1a1a';
const TEXT_MUTED = '#555555';
const BORDER = '#9a9a9a';
const ROW_ALT = '#f4f4f0';
const ALERT_BG = '#fef1f0';
const ALERT_BORDER = '#b91c1c';

const MT_TZ = 'America/Denver';

export interface EvidenceItem {
  id?: number | string;
  evidence_number?: string;
  description?: string;
  evidence_type?: string;
  category?: string;
  status?: string;
  storage_location?: string;
  serial_number?: string;
  brand?: string;
  model?: string;
  estimated_value?: number | string;
  collected_date?: string;
  collected_by_name?: string;
  incident_number?: string;
  case_number?: string;
  disposition?: string;
  disposition_method?: string;
  disposition_date?: string;
  disposition_notes?: string;
  notes?: string;
  /** Stored as a JSON string in D1; sometimes already parsed by the page. */
  chain_of_custody?: string | ChainOfCustodyEntry[];
}

export interface ChainOfCustodyEntry {
  action?: string;
  by?: string;
  by_name?: string;
  at?: string;
  timestamp?: string;
  location?: string;
  to_location?: string;
  from_location?: string;
  notes?: string;
}

export interface EvidencePdfInput {
  item: EvidenceItem;
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

/** Public for testing. Normalises a chain of custody value (string JSON OR
 *  already-parsed array OR null/undefined) into an array. Falls back to []
 *  on parse error so a malformed JSON column never throws downstream. */
export function parseChain(value: EvidenceItem['chain_of_custody']): ChainOfCustodyEntry[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Public for testing. Pick the date string from a chain entry — entries use
 *  either `at` or `timestamp` depending on which API path wrote them. */
export function chainEntryDate(entry: ChainOfCustodyEntry): string {
  return entry.at || entry.timestamp || '';
}

/** Public for testing. Pick the actor name from a chain entry — entries use
 *  `by_name`, `by`, or sometimes leave it blank. */
export function chainEntryActor(entry: ChainOfCustodyEntry): string {
  return entry.by_name || entry.by || '—';
}

/** Public for testing. "Where is it now?" — to_location wins (most recent
 *  destination), then location, then from_location as a last fall-back. */
export function chainEntryLocation(entry: ChainOfCustodyEntry): string {
  return entry.to_location || entry.location || entry.from_location || '—';
}

const ellipsize = (s: string, max: number) => s.length <= max ? s : s.slice(0, max - 1) + '…';

export function generateEvidenceItemPdf(input: EvidencePdfInput): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  registerArialFont(doc);

  const { item, preparedBy } = input;
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  let y = 36;

  // Banner
  y = drawNavyBanner(doc, {
    title: `EVIDENCE ITEM — ${item.evidence_number || `EV-${item.id ?? '?'}`}`,
    subtitle: 'Evidence / Property Room',
    rightLine1: fmtDateTime(new Date().toISOString()),
    rightLine2: preparedBy ? `Prepared by: ${preparedBy}` : undefined,
  });

  // Disposition-pending alert
  const isOverdue = item.disposition === 'pending' && item.collected_date
    && (Date.now() - parseTimestamp(item.collected_date).getTime()) > 365 * 24 * 60 * 60 * 1000;
  if (isOverdue) {
    doc.setFillColor(ALERT_BG);
    doc.setDrawColor(ALERT_BORDER);
    doc.setLineWidth(0.75);
    doc.rect(M, y, W - 2 * M, 22, 'FD');
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(ALERT_BORDER);
    doc.text('DISPOSITION OVERDUE — item over 1 year old, still pending review', M + 10, y + 15);
    y += 30;
    doc.setLineWidth(0.5);
  }

  // ── Item block ──
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('ITEM', M, y);
  y += 4;
  doc.setDrawColor(BORDER);
  doc.line(M, y, W - M, y);
  y += 12;
  doc.setFont('Arial', 'normal');
  doc.setFontSize(9);

  const fields: Array<[string, string]> = [
    ['Description', item.description || '—'],
    ['Type / Category', [item.evidence_type, item.category].filter(Boolean).join(' / ') || '—'],
    ['Status', formatEnumValue(item.status) || '—'],
    ['Storage', item.storage_location || '—'],
    ['Serial #', item.serial_number || '—'],
    ['Brand / Model', [item.brand, item.model].filter(Boolean).join(' / ') || '—'],
    ['Est. Value', item.estimated_value != null && item.estimated_value !== '' ? `$${item.estimated_value}` : '—'],
    ['Collected', fmtDate(item.collected_date)],
    ['Collected By', item.collected_by_name || '—'],
    ['Linked Incident', item.incident_number || item.case_number || '—'],
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

  // ── Disposition block (if recorded) ──
  if (item.disposition && item.disposition !== 'pending') {
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(TEXT_DARK);
    doc.text('DISPOSITION', M, y);
    y += 4;
    doc.line(M, y, W - M, y);
    y += 12;
    doc.setFont('Arial', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(TEXT_MUTED);
    doc.text('OUTCOME', M, y);
    doc.text('METHOD', M + colW, y);
    doc.setTextColor(TEXT_DARK);
    doc.text(formatEnumValue(item.disposition), M, y + 11);
    doc.text(item.disposition_method || '—', M + colW, y + 11);
    y += 24;
    if (item.disposition_date) {
      doc.setTextColor(TEXT_MUTED);
      doc.text('DISPOSITION DATE', M, y);
      doc.setTextColor(TEXT_DARK);
      doc.text(fmtDate(item.disposition_date), M, y + 11);
      y += 24;
    }
    if (item.disposition_notes) {
      doc.setTextColor(TEXT_MUTED);
      doc.text('NOTES', M, y);
      y += 11;
      doc.setTextColor(TEXT_DARK);
      const lines = doc.splitTextToSize(item.disposition_notes, W - 2 * M);
      doc.text(lines, M, y);
      y += lines.length * 11 + 6;
    }
  }

  // ── Chain of custody timeline ──
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

  const chain = parseChain(item.chain_of_custody);
  const cols = [
    { key: 'date',     label: 'DATE / TIME', width: 100 },
    { key: 'action',   label: 'ACTION',      width: 90 },
    { key: 'actor',    label: 'BY',          width: 110 },
    { key: 'location', label: 'LOCATION',    width: 100 },
    { key: 'notes',    label: 'NOTES',       width: 120 },
  ] as const;

  // Header
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

  if (chain.length === 0) {
    doc.setFontSize(9);
    doc.setTextColor(TEXT_MUTED);
    doc.setFont('Arial', 'italic');
    doc.text('No chain-of-custody entries recorded.', M + 8, y + 14);
    doc.setFont('Arial', 'normal');
    y += 24;
  } else {
    doc.setFontSize(8);
    chain.forEach((entry, i) => {
      newPageIfNeeded(13);
      if (i % 2 === 1) {
        doc.setFillColor(ROW_ALT);
        doc.rect(M, y, W - 2 * M, 13, 'F');
      }
      doc.setTextColor(TEXT_DARK);
      let x = M + 4;
      doc.text(fmtDateTime(chainEntryDate(entry)), x, y + 9);
      x += cols[0].width;
      doc.text(toDisplayLabel(entry.action), x, y + 9);
      x += cols[1].width;
      doc.text(ellipsize(chainEntryActor(entry), 18), x, y + 9);
      x += cols[2].width;
      doc.text(ellipsize(chainEntryLocation(entry), 16), x, y + 9);
      x += cols[3].width;
      doc.text(ellipsize(entry.notes || '—', 22), x, y + 9);
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
  doc.text('Evidence custodian signature', M, y + 38);
  if (preparedBy) doc.text(preparedBy, M, y + 49);
  doc.text('Supervisor signature / date', M + sigW + 24, y + 38);

  // Footer
  doc.setFontSize(7);
  doc.text(
    `Generated ${fmtDateTime(new Date().toISOString())}  ·  RMPG Flex Evidence Room  ·  ${item.evidence_number || `EV-${item.id ?? '?'}`}`,
    M, H - 18,
  );

  return doc;
}

export function openEvidenceItemPdf(input: EvidencePdfInput): void {
  const doc = generateEvidenceItemPdf(input);
  const url = URL.createObjectURL(doc.output('blob'));
  openPdfBlob(url, 'Evidence Item');
}
