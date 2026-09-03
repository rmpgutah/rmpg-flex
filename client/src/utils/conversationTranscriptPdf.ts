// ═══════════════════════════════════════════════════════════════
// Conversation Transcript — court-ready PDF generator.
// Internal messaging threads on the Communications page are
// admissible records of officer-to-officer and dispatch-to-officer
// communication. Before this util the only export option was a
// page-wide CSV — operators preparing court packages or supervisor
// IA reviews had to screenshot the right-pane bubble view, which
// loses the full participant list, the per-message read state, and
// the priority badge. Same Arial + RMPG-gold banner pattern as
// fiCardPdf / courtAppearancePdf / evidenceItemPdf.
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import { registerArialFont } from './pdf/fonts/registerArial';
import type { Message, MessagePriority } from '../types';
import { parseTimestamp } from './dateUtils';
import { openPdfBlob } from './openPdfDocument';
import { drawNavyBanner } from './pdfStandaloneHeader';

const TEXT_DARK = '#1a1a1a';
const TEXT_MUTED = '#555555';
const BORDER = '#9a9a9a';
const ALERT_BG_EMERGENCY = '#fef1f0';
const ALERT_BORDER_EMERGENCY = '#b91c1c';
const ALERT_BG_URGENT = '#fff7ed';
const ALERT_BORDER_URGENT = '#b45309';

const MT_TZ = 'America/Denver';

function fmtDateTime(input: string | undefined | null): string {
  if (!input) return '—';
  try {
    const d = parseTimestamp(input);
    return new Intl.DateTimeFormat('en-US', {
      timeZone: MT_TZ, year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d) + ' MT';
  } catch { return String(input); }
}

/** Public for testing. Word-wraps a long string into lines that fit `maxChars`
 *  per line. Preserves explicit `\n` breaks. Used for message bodies. */
export function wrapText(input: string, maxChars: number): string[] {
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

/** Public for testing. Computes the highest priority across a set of messages.
 *  Order: emergency > urgent > normal. Matches the on-screen badge logic in
 *  CommunicationsPage so the PDF + the UI agree on which priority "wins". */
export function highestPriority(messages: Message[]): MessagePriority {
  const rank: Record<string, number> = { emergency: 3, urgent: 2, normal: 1 };
  let winner: MessagePriority = 'normal';
  for (const m of messages) {
    if ((rank[m.priority] || 0) > (rank[winner] || 0)) winner = m.priority;
  }
  return winner;
}

/** Public for testing. Returns the de-duplicated participant list (sender +
 *  recipient, in first-seen order). "All Units" is preserved verbatim for
 *  broadcast threads — the recipient there is the channel, not a person. */
export function participantsOf(messages: Message[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of messages) {
    if (m.from_user_name && !seen.has(m.from_user_name)) {
      seen.add(m.from_user_name); out.push(m.from_user_name);
    }
    if (m.to_user_name && !seen.has(m.to_user_name)) {
      seen.add(m.to_user_name); out.push(m.to_user_name);
    }
  }
  return out;
}

export interface ConversationTranscriptInput {
  threadId: string;
  subject: string;
  messages: Message[];
  /** Optional: the user who exported the transcript (for the footer). */
  exportedBy?: string;
}

export function generateConversationTranscriptPdf(input: ConversationTranscriptInput): jsPDF {
  const { threadId, subject, messages, exportedBy } = input;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  registerArialFont(doc);

  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  let y = 36;

  // Sorted oldest → newest, so the transcript reads top-to-bottom like the
  // on-screen thread.
  const sorted = [...messages].sort((a, b) =>
    parseTimestamp(a.created_at).getTime() - parseTimestamp(b.created_at).getTime()
  );

  y = drawNavyBanner(doc, {
    title: `CONVERSATION TRANSCRIPT — Thread #${threadId}`,
    subtitle: 'Communications Center',
    rightLine1: `Generated ${fmtDateTime(new Date().toISOString())}`,
  });

  // Priority banner (emergency / urgent only — informational lift, not a
  // "caution" flag like the FI active-warrant banner).
  const priority = highestPriority(sorted);
  if (priority === 'emergency' || priority === 'urgent') {
    const bg = priority === 'emergency' ? ALERT_BG_EMERGENCY : ALERT_BG_URGENT;
    const border = priority === 'emergency' ? ALERT_BORDER_EMERGENCY : ALERT_BORDER_URGENT;
    doc.setFillColor(bg);
    doc.setDrawColor(border);
    doc.setLineWidth(0.75);
    doc.rect(M, y, W - 2 * M, 22, 'FD');
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(border);
    const label = priority === 'emergency'
      ? 'CONTAINS EMERGENCY-PRIORITY MESSAGE'
      : 'CONTAINS URGENT-PRIORITY MESSAGE';
    doc.text(label, M + 10, y + 15);
    y += 30;
    doc.setLineWidth(0.5);
  }

  // ── Conversation summary block ──
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('CONVERSATION', M, y);
  y += 4;
  doc.setDrawColor(BORDER);
  doc.line(M, y, W - M, y);
  y += 12;

  const isBroadcast = sorted.length > 0 && sorted[0].is_broadcast;
  const participants = participantsOf(sorted);
  const firstAt = sorted[0]?.created_at;
  const lastAt = sorted[sorted.length - 1]?.created_at;
  const unreadCount = sorted.filter((m) => !m.is_read).length;

  const summaryFields: Array<[string, string]> = [
    ['Subject', subject || '(No Subject)'],
    ['Participants', participants.join(', ') || '—'],
    ['Channel', isBroadcast ? 'Broadcast (All Units)' : 'Direct'],
    ['Messages', `${sorted.length} (${unreadCount} unread)`],
    ['First message', fmtDateTime(firstAt)],
    ['Last message', fmtDateTime(lastAt)],
  ];
  doc.setFont('Arial', 'normal');
  doc.setFontSize(9);
  for (const [lbl, val] of summaryFields) {
    doc.setTextColor(TEXT_MUTED);
    doc.text(lbl.toUpperCase(), M, y);
    doc.setTextColor(TEXT_DARK);
    const wrapped = wrapText(val, 80);
    doc.text(wrapped[0] || '—', M + 110, y);
    y += 14;
    for (let i = 1; i < wrapped.length; i++) {
      if (y > H - 100) { doc.addPage(); y = 48; }
      doc.text(wrapped[i], M + 110, y);
      y += 12;
    }
  }
  y += 6;

  // ── Messages (chronological) ──
  if (y > H - 120) { doc.addPage(); y = 48; }
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text(`MESSAGES (${sorted.length})`, M, y);
  y += 4;
  doc.line(M, y, W - M, y);
  y += 12;

  for (let i = 0; i < sorted.length; i++) {
    const msg = sorted[i];
    // Per-message header (sender · timestamp · priority · read state)
    if (y > H - 80) { doc.addPage(); y = 48; }
    doc.setFont('Arial', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(TEXT_DARK);
    const headerLeft = `${i + 1}. ${msg.from_user_name || 'Unknown'}${msg.to_user_name ? ` → ${msg.to_user_name}` : (msg.is_broadcast ? ' → All Units' : '')}`;
    doc.text(headerLeft, M, y);
    doc.setFont('Arial', 'normal');
    doc.setTextColor(TEXT_MUTED);
    const tags: string[] = [fmtDateTime(msg.created_at)];
    if (msg.priority !== 'normal') tags.push(msg.priority.toUpperCase());
    if (!msg.is_read) tags.push('UNREAD');
    doc.text(tags.join('  ·  '), W - M, y, { align: 'right' });
    y += 12;

    // Body (word-wrapped). Indented from the header so visual hierarchy
    // matches the on-screen bubble layout.
    doc.setFont('Arial', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(TEXT_DARK);
    const lines = wrapText(msg.body || '—', 95);
    for (const line of lines) {
      if (y > H - 60) { doc.addPage(); y = 48; }
      doc.text(line, M + 14, y);
      y += 11;
    }
    y += 6;
  }

  // ── Signature block ──
  if (y > H - 100) { doc.addPage(); y = 48; }
  y += 10;
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

  // Footer
  doc.setFontSize(7);
  doc.text(
    `Generated ${fmtDateTime(new Date().toISOString())}  ·  RMPG Flex Communications  ·  Thread #${threadId}`,
    M, H - 18,
  );

  return doc;
}

export function openConversationTranscriptPdf(input: ConversationTranscriptInput): void {
  const doc = generateConversationTranscriptPdf(input);
  const url = URL.createObjectURL(doc.output('blob'));
  openPdfBlob(url, 'Conversation Transcript');
}
