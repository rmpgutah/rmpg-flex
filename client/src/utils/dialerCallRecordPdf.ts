// Dial Connect call recording + transcription — court-ready PDF.
// Same Arial + navy banner idiom as conversationTranscriptPdf / evidenceItemPdf.

import jsPDF from 'jspdf';
import { registerArialFont } from './pdf/fonts/registerArial';
import { parseTimestamp } from './dateUtils';
import { openPdfBlob } from './openPdfDocument';
import { drawNavyBanner } from './pdfStandaloneHeader';
import { wrapText } from './conversationTranscriptPdf';
import { displayPhone, formatDuration, pdfFilename } from './dialerConnect';

const TEXT_DARK = '#1a1a1a';
const TEXT_MUTED = '#555555';
const BORDER = '#9a9a9a';
const ROW_ALT = '#f4f4f0';
const ALERT_BG = '#fef1f0';
const ALERT_BORDER = '#b91c1c';
const WARN_BG = '#fff6db';
const WARN_BORDER = '#b45309';

const MT_TZ = 'America/Denver';

export interface DialerRecordForPdf {
  id: number | string;
  kind: 'call' | 'voicemail';
  call_sid?: string | null;
  direction?: string | null;
  status?: string | null;
  from_number?: string | null;
  to_number?: string | null;
  from_name?: string | null;
  to_name?: string | null;
  agent_name?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  received_at?: string | null;
  duration_seconds?: number | null;
  disposition?: string | null;
  notes?: string | null;
  tags?: string | null;
  transcript?: string | null;
  transcript_status?: string | null;
  transcript_confidence?: number | null;
  urgency?: string | null;
  mailbox?: string | null;
  assigned_name?: string | null;
  call_id?: number | null;
  recording_bytes?: number | null;
  recording_r2_key?: string | null;
  recording_source_url?: string | null;
}

export interface DialerRecordPdfInput {
  record: DialerRecordForPdf;
  exportedBy?: string;
}

export function fmtMt(input: string | undefined | null): string {
  if (!input) return '—';
  try {
    const d = parseTimestamp(input);
    return new Intl.DateTimeFormat('en-US', {
      timeZone: MT_TZ, year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(d) + ' MT';
  } catch {
    return String(input);
  }
}

export function hasRecording(record: DialerRecordForPdf): boolean {
  return Boolean(record.recording_r2_key || record.recording_source_url);
}

export function generateDialerCallRecordPdf(input: DialerRecordPdfInput): jsPDF {
  const { record, exportedBy } = input;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  registerArialFont(doc);

  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  const isVm = record.kind === 'voicemail';
  const title = isVm
    ? `VOICEMAIL TRANSCRIPT — VM #${record.id}`
    : `CALL RECORDING TRANSCRIPT — CALL #${record.id}`;

  let y = drawNavyBanner(doc, {
    title,
    subtitle: 'Dial Connect · Communications Division',
    rightLine1: `Generated ${fmtMt(new Date().toISOString())}`,
    rightLine2: exportedBy || undefined,
  });

  const urgency = (record.urgency || '').toLowerCase();
  if (urgency === 'emergency' || urgency === 'urgent') {
    const bg = urgency === 'emergency' ? ALERT_BG : WARN_BG;
    const border = urgency === 'emergency' ? ALERT_BORDER : WARN_BORDER;
    doc.setFillColor(bg);
    doc.setDrawColor(border);
    doc.setLineWidth(0.75);
    doc.rect(M, y, W - 2 * M, 22, 'FD');
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(border);
    doc.text(
      urgency === 'emergency' ? 'EMERGENCY-PRIORITY VOICEMAIL' : 'URGENT-PRIORITY VOICEMAIL',
      M + 10, y + 15,
    );
    y += 30;
    doc.setLineWidth(0.5);
  }

  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text(isVm ? 'VOICEMAIL' : 'CALL', M, y);
  y += 4;
  doc.setDrawColor(BORDER);
  doc.line(M, y, W - M, y);
  y += 14;

  const when = record.started_at || record.received_at;
  const fields: Array<[string, string]> = [
    ['Record ID', String(record.id)],
    ['Call SID', record.call_sid || '—'],
    ['Direction', (record.direction || (isVm ? 'inbound' : '—')).toUpperCase()],
    ['Status', (record.status || (isVm ? 'voicemail' : '—')).toUpperCase()],
    ['From', `${displayPhone(record.from_number)}${record.from_name ? `  ·  ${record.from_name}` : ''}`],
    ['To', `${displayPhone(record.to_number)}${record.to_name ? `  ·  ${record.to_name}` : ''}`],
    ['Agent', record.agent_name || record.assigned_name || '—'],
    ['Started', fmtMt(when)],
    ['Ended', fmtMt(record.ended_at)],
    ['Duration', formatDuration(record.duration_seconds)],
    ['Disposition', record.disposition ? record.disposition.replace(/_/g, ' ').toUpperCase() : '—'],
    ['CFS link', record.call_id != null ? String(record.call_id) : '—'],
    ['Recording', hasRecording(record) ? 'On file (encrypted at rest)' : 'Not attached'],
    ['Transcript', (record.transcript_status || (record.transcript ? 'ready' : 'none')).toUpperCase()],
  ];
  if (isVm) {
    fields.splice(6, 0, ['Mailbox', record.mailbox || '—']);
    fields.splice(7, 0, ['Urgency', (record.urgency || 'normal').toUpperCase()]);
  }
  if (record.transcript_confidence != null && Number.isFinite(record.transcript_confidence)) {
    fields.push(['Confidence', `${Math.round(record.transcript_confidence * 100)}%`]);
  }

  doc.setFontSize(9);
  for (const [lbl, val] of fields) {
    if (y > H - 80) { doc.addPage(); y = 48; }
    doc.setFont('Arial', 'normal');
    doc.setTextColor(TEXT_MUTED);
    doc.text(lbl.toUpperCase(), M, y);
    doc.setTextColor(TEXT_DARK);
    const wrapped = wrapText(val, 78);
    doc.text(wrapped[0] || '—', M + 120, y);
    y += 13;
    for (let i = 1; i < wrapped.length; i++) {
      if (y > H - 80) { doc.addPage(); y = 48; }
      doc.text(wrapped[i], M + 120, y);
      y += 12;
    }
  }

  if (record.notes) {
    y += 6;
    if (y > H - 80) { doc.addPage(); y = 48; }
    doc.setFont('Arial', 'bold');
    doc.setTextColor(TEXT_DARK);
    doc.text('NOTES', M, y);
    y += 12;
    doc.setFont('Arial', 'normal');
    for (const line of wrapText(record.notes, 95)) {
      if (y > H - 60) { doc.addPage(); y = 48; }
      doc.text(line, M, y);
      y += 12;
    }
  }

  y += 10;
  if (y > H - 120) { doc.addPage(); y = 48; }
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('TRANSCRIPTION', M, y);
  y += 4;
  doc.setDrawColor(BORDER);
  doc.line(M, y, W - M, y);
  y += 14;

  const body = (record.transcript || '').trim();
  if (!body) {
    doc.setFillColor(ROW_ALT);
    doc.rect(M, y - 8, W - 2 * M, 28, 'F');
    doc.setFont('Arial', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(TEXT_MUTED);
    doc.text('No transcription on file for this recording.', M + 8, y + 10);
    y += 36;
  } else {
    doc.setFont('Arial', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(TEXT_DARK);
    for (const line of wrapText(body, 92)) {
      if (y > H - 60) { doc.addPage(); y = 48; }
      doc.text(line, M, y);
      y += 13;
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
  doc.text(exportedBy || '—', M, y + 49);
  doc.text('Supervisor signature / date', M + sigW + 24, y + 38);

  doc.setFontSize(7);
  doc.text(
    `Generated ${fmtMt(new Date().toISOString())}  ·  RMPG Flex Dial Connect  ·  ${isVm ? 'VM' : 'CALL'} #${record.id}  ·  LAW ENFORCEMENT SENSITIVE`,
    M, H - 18,
  );

  return doc;
}

export function openDialerCallRecordPdf(input: DialerRecordPdfInput): void {
  const doc = generateDialerCallRecordPdf(input);
  const url = URL.createObjectURL(doc.output('blob'));
  const name = pdfFilename(input.record.kind, input.record.id);
  openPdfBlob(url, name);
}

export function downloadDialerCallRecordPdf(input: DialerRecordPdfInput): void {
  const doc = generateDialerCallRecordPdf(input);
  doc.save(pdfFilename(input.record.kind, input.record.id));
}
