// ═══════════════════════════════════════════════════════════════
// Dial Connect call record — professional RMPG Flex PDF.
// Audio stays a separate download; this form is the official
// print/export of metadata + transcription for the CAD file.
// Same Arial + navy letterhead as conversationTranscriptPdf.
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import { registerArialFont } from './pdf/fonts/registerArial';
import { parseTimestamp } from './dateUtils';
import { openPdfDocument } from './openPdfDocument';
import { drawNavyBanner } from './pdfStandaloneHeader';

const TEXT_DARK = '#1a1a1a';
const TEXT_MUTED = '#555555';
const BORDER = '#9a9a9a';

const MT_TZ = 'America/Denver';

function fmtDateTime(input: string | undefined | null): string {
  if (!input) return '—';
  try {
    const d = parseTimestamp(input);
    return new Intl.DateTimeFormat('en-US', {
      timeZone: MT_TZ, year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(d) + ' MT';
  } catch { return String(input); }
}

export function wrapTranscriptLines(input: string, maxChars: number): string[] {
  if (!input) return [''];
  const out: string[] = [];
  for (const paragraph of input.split(/\r?\n/)) {
    if (!paragraph) { out.push(''); continue; }
    const words = paragraph.split(/\s+/);
    let line = '';
    for (const w of words) {
      if (!line) { line = w; continue; }
      if ((line + ' ' + w).length > maxChars) { out.push(line); line = w; }
      else line = line + ' ' + w;
    }
    if (line) out.push(line);
  }
  return out;
}

export function formatCallDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${m}:${String(r).padStart(2, '0')}`;
}

export interface DialConnectTranscriptSegment {
  start?: number;
  end?: number;
  speaker?: string;
  text: string;
}

export interface DialConnectCallPdfInput {
  recordingSid: string;
  callSid?: string | null;
  fromNumber?: string | null;
  toNumber?: string | null;
  direction?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  durationSeconds?: number | null;
  dispatcherName?: string | null;
  transcript?: string | null;
  segments?: DialConnectTranscriptSegment[] | null;
  hasAudio?: boolean;
  exportedBy?: string;
}

export function generateDialConnectCallPdf(input: DialConnectCallPdfInput): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  registerArialFont(doc);

  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  let y = 36;

  y = drawNavyBanner(doc, {
    title: `DIAL CONNECT CALL RECORD — ${input.recordingSid}`,
    subtitle: 'Communications Center',
    rightLine1: `Generated ${fmtDateTime(new Date().toISOString())}`,
    rightLine2: input.exportedBy || undefined,
  });

  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('CALL IDENTIFIERS', M, y);
  y += 4;
  doc.setDrawColor(BORDER);
  doc.line(M, y, W - M, y);
  y += 12;

  const direction = (input.direction || '—').replace(/_/g, ' ');
  const summaryFields: Array<[string, string]> = [
    ['Recording SID', input.recordingSid || '—'],
    ['Call SID', input.callSid || '—'],
    ['Direction', direction],
    ['From', input.fromNumber || '—'],
    ['To', input.toNumber || '—'],
    ['Dispatcher', input.dispatcherName || '—'],
    ['Started', fmtDateTime(input.startedAt)],
    ['Ended', fmtDateTime(input.endedAt)],
    ['Duration', formatCallDuration(input.durationSeconds ?? null)],
    ['Audio on file', input.hasAudio ? 'Yes — download separately from Dialer Connect' : 'No audio stored in Flex'],
  ];
  doc.setFont('Arial', 'normal');
  doc.setFontSize(9);
  for (const [lbl, val] of summaryFields) {
    if (y > H - 80) { doc.addPage(); y = 48; }
    doc.setTextColor(TEXT_MUTED);
    doc.text(lbl.toUpperCase(), M, y);
    doc.setTextColor(TEXT_DARK);
    const wrapped = wrapTranscriptLines(val, 78);
    doc.text(wrapped[0] || '—', M + 118, y);
    y += 14;
    for (let i = 1; i < wrapped.length; i++) {
      if (y > H - 80) { doc.addPage(); y = 48; }
      doc.text(wrapped[i], M + 118, y);
      y += 12;
    }
  }
  y += 8;

  if (y > H - 120) { doc.addPage(); y = 48; }
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('TRANSCRIPTION', M, y);
  y += 4;
  doc.line(M, y, W - M, y);
  y += 14;

  const segments = input.segments?.filter((s) => s.text?.trim()) ?? [];
  if (segments.length > 0) {
    for (const seg of segments) {
      if (y > H - 72) { doc.addPage(); y = 48; }
      doc.setFont('Arial', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(TEXT_DARK);
      const when = seg.start != null ? formatCallDuration(seg.start) : '';
      const who = seg.speaker || 'Speaker';
      doc.text(when ? `${who}  ·  ${when}` : who, M, y);
      y += 12;
      doc.setFont('Arial', 'normal');
      doc.setTextColor(TEXT_DARK);
      for (const line of wrapTranscriptLines(seg.text, 95)) {
        if (y > H - 60) { doc.addPage(); y = 48; }
        doc.text(line, M + 14, y);
        y += 11;
      }
      y += 6;
    }
  } else {
    const body = (input.transcript || '').trim();
    if (!body) {
      doc.setFont('Arial', 'italic');
      doc.setFontSize(9);
      doc.setTextColor(TEXT_MUTED);
      doc.text('No transcription is on file for this call.', M, y);
      y += 16;
    } else {
      doc.setFont('Arial', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(TEXT_DARK);
      for (const line of wrapTranscriptLines(body, 98)) {
        if (y > H - 60) { doc.addPage(); y = 48; }
        doc.text(line, M, y);
        y += 11;
      }
    }
  }

  if (y > H - 100) { doc.addPage(); y = 48; }
  y += 16;
  doc.setDrawColor(BORDER);
  doc.setLineWidth(0.5);
  const sigW = (W - 2 * M - 24) / 2;
  doc.line(M, y + 28, M + sigW, y + 28);
  doc.line(M + sigW + 24, y + 28, W - M, y + 28);
  doc.setFontSize(8);
  doc.setTextColor(TEXT_MUTED);
  doc.text('Exporting officer signature', M, y + 38);
  doc.text(input.exportedBy || '—', M, y + 49);
  doc.text('Supervisor signature / date', M + sigW + 24, y + 38);

  doc.setFontSize(7);
  doc.text(
    `Generated ${fmtDateTime(new Date().toISOString())}  ·  RMPG Flex Dialer Connect  ·  ${input.recordingSid}`,
    M, H - 18,
  );

  return doc;
}

export function openDialConnectCallPdf(input: DialConnectCallPdfInput): void {
  const doc = generateDialConnectCallPdf(input);
  const safe = (input.recordingSid || 'call').replace(/[^A-Za-z0-9_-]/g, '');
  openPdfDocument(doc, `DCR-${safe}-transcript.pdf`);
}
