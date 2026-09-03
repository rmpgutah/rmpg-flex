// ═══════════════════════════════════════════════════════════════
// Email Thread Transcript — court-ready PDF generator.
// Microsoft 365 email threads on /email are admissible records of
// official correspondence — subpoenas, IA inquiries, court notices,
// records-request acknowledgments, vendor billing. Before this util
// the only export was Outlook's print-to-PDF (no agency banner, no
// signature block, no priority bar, no folder/provenance row) OR
// the Download as .eml option (raw MIME, not human-readable). Same
// Arial + RMPG-gold banner pattern as fiCardPdf / courtAppearancePdf
// / evidenceItemPdf / conversationTranscriptPdf.
//
// Renders a single thread (1..N messages) as a chronological list,
// with conversation summary block (subject / participants / folder
// / message-count / first-message / last-message), per-message body
// blocks (sender → recipient, CC list, priority + read state, word-
// wrapped body), an attachments listing (per message), and a two-
// signature block (exporting officer + supervisor). Empty thread
// renders the banner + summary block + a single "(No messages)"
// line so a court package can still reference the export.
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import { registerArialFont } from './pdf/fonts/registerArial';
import type { EmailMessage, EmailAttachment } from '../types';
import { stripHtmlForPdf } from './formatters';
import { parseTimestamp } from './dateUtils';
import { openPdfBlob } from './openPdfDocument';
import { drawNavyBanner } from './pdfStandaloneHeader';

const TEXT_DARK = '#1a1a1a';
const TEXT_MUTED = '#555555';
const BORDER = '#9a9a9a';
const ALERT_BG_HIGH = '#fef1f0';
const ALERT_BORDER_HIGH = '#b91c1c';
const ALERT_BG_LOW = '#f4f4f0';
const ALERT_BORDER_LOW = '#888888';

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

function fmtAddress(a: { email: string; name?: string }): string {
  if (!a) return '';
  if (a.name && a.name !== a.email) return `${a.name} <${a.email}>`;
  return a.email || '';
}

/** Public for testing. Word-wraps a long string into lines that fit `maxChars`
 *  per line. Preserves explicit `\n` breaks. Mirrors the helper in
 *  conversationTranscriptPdf — kept local so this util has no cross-import
 *  pull (PDF utils are imported by lazy routes; cross-imports balloon the
 *  shared chunk). */
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

/** Public for testing. Strips HTML tags + collapses whitespace, so an email
 *  body that arrived as `<div>Hello<br/>world</div>` renders readably in the
 *  PDF instead of dumping raw markup. NOT a security boundary — the body has
 *  already been sanitized in `EmailBodyFrame`; this is purely formatting. */
export function stripHtmlForText(input: string | undefined | null): string {
  return stripHtmlForPdf(input);
}

/** Public for testing. The highest importance flag across a set of messages
 *  (high > normal > low). Drives the priority banner — emails marked High
 *  importance ALWAYS surface on a court export so a reviewer can't miss the
 *  fact the thread carried an urgent flag at the time of transmission. */
export function highestImportance(messages: EmailMessage[]): 'low' | 'normal' | 'high' {
  let winner: 'low' | 'normal' | 'high' = 'normal';
  for (const m of messages) {
    if (m.importance === 'high') return 'high';
    if (m.importance === 'low' && winner === 'normal') winner = 'low';
  }
  return winner;
}

/** Public for testing. Returns the de-duplicated participant list (from +
 *  to + cc, in first-seen order). Format `Name <email>` if name is present
 *  and distinct from the address, otherwise the bare address. The PDF
 *  participant row uses this verbatim so a court reviewer can verify every
 *  recipient at a glance without paginating through individual messages. */
export function participantsOf(messages: EmailMessage[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (a: { email: string; name?: string } | { email: string; name: string }) => {
    if (!a || !a.email) return;
    const key = a.email.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(fmtAddress(a));
  };
  for (const m of messages) {
    if (m.fromAddress) push({ email: m.fromAddress, name: m.fromName });
    for (const a of m.toAddresses || []) push(a);
    for (const a of m.ccAddresses || []) push(a);
  }
  return out;
}

export interface EmailThreadPdfInput {
  /** Conversation/thread id from Microsoft Graph (or the lone message id when
   *  the export is a single message). Surfaces in the banner + footer. */
  threadId: string;
  /** Folder the messages were viewed in when the export was requested
   *  (Inbox/Sent Items/Drafts/...). Provenance, not the storage truth — Graph
   *  is the actual record. */
  folder?: string;
  /** Messages in the thread. Will be sorted oldest → newest before render so
   *  the transcript reads top-to-bottom like the on-screen thread view. */
  messages: EmailMessage[];
  /** Per-message attachment lists, keyed by message graph id. Optional —
   *  omitted attachments simply don't appear on the PDF. */
  attachmentsByMessageId?: Record<string, EmailAttachment[]>;
  /** The user who exported the transcript (for the signature block + footer). */
  exportedBy?: string;
}

export function generateEmailThreadPdf(input: EmailThreadPdfInput): jsPDF {
  const { threadId, folder, messages, attachmentsByMessageId, exportedBy } = input;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  registerArialFont(doc);

  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  let y = 36;

  const sorted = [...messages].sort((a, b) => {
    const at = a.receivedAt || a.sentAt || '';
    const bt = b.receivedAt || b.sentAt || '';
    return parseTimestamp(at).getTime() - parseTimestamp(bt).getTime();
  });

  // Subject — use the first message's subject; if the thread oscillates between
  // "Re:" prefixes the operator can still tell the conversation in the
  // participants/dates row. Empty thread = "(No Subject)".
  const subject = sorted[0]?.subject?.trim() || '(No Subject)';

  y = drawNavyBanner(doc, {
    title: 'EMAIL THREAD TRANSCRIPT',
    subtitle: 'Microsoft 365 Mailbox',
    rightLine1: `Generated ${fmtDateTime(new Date().toISOString())}`,
  });

  // Subject line (rendered prominently — court packages get filed by it)
  doc.setFont('Arial', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(TEXT_DARK);
  const subjectLines = wrapText(subject, 95);
  for (const line of subjectLines) {
    doc.text(line, M, y);
    y += 14;
  }
  y += 4;

  // Importance banner — high importance is opt-in by the sender and lives
  // on the Graph payload; the reviewer should not have to dig per-message.
  const importance = highestImportance(sorted);
  if (importance === 'high') {
    doc.setFillColor(ALERT_BG_HIGH);
    doc.setDrawColor(ALERT_BORDER_HIGH);
    doc.setLineWidth(0.75);
    doc.rect(M, y, W - 2 * M, 22, 'FD');
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(ALERT_BORDER_HIGH);
    doc.text('CONTAINS HIGH-IMPORTANCE MESSAGE', M + 10, y + 15);
    y += 30;
    doc.setLineWidth(0.5);
  } else if (importance === 'low') {
    doc.setFillColor(ALERT_BG_LOW);
    doc.setDrawColor(ALERT_BORDER_LOW);
    doc.setLineWidth(0.5);
    doc.rect(M, y, W - 2 * M, 20, 'FD');
    doc.setFont('Arial', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(ALERT_BORDER_LOW);
    doc.text('LOW-IMPORTANCE THREAD', M + 10, y + 14);
    y += 28;
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

  const participants = participantsOf(sorted);
  const firstAt = sorted[0]?.receivedAt || sorted[0]?.sentAt;
  const lastAt = sorted[sorted.length - 1]?.receivedAt || sorted[sorted.length - 1]?.sentAt;
  const unreadCount = sorted.filter((m) => !m.isRead).length;
  const flaggedCount = sorted.filter((m) => m.isFlagged).length;
  const attachmentCount = sorted.reduce(
    (n, m) => n + (attachmentsByMessageId?.[m.id]?.filter((a) => !a.isInline).length || 0),
    0,
  );

  const summaryFields: Array<[string, string]> = [
    ['Subject', subject],
    ['Folder', folder || '—'],
    ['Participants', participants.join(', ') || '—'],
    ['Messages', `${sorted.length}${unreadCount ? ` (${unreadCount} unread)` : ''}${flaggedCount ? ` · ${flaggedCount} flagged` : ''}`],
    ['Attachments', attachmentCount > 0 ? `${attachmentCount} across thread` : 'None'],
    ['First message', fmtDateTime(firstAt)],
    ['Last message', fmtDateTime(lastAt)],
    ['Thread ID', threadId || '—'],
  ];
  doc.setFont('Arial', 'normal');
  doc.setFontSize(9);
  for (const [lbl, val] of summaryFields) {
    if (y > H - 100) { doc.addPage(); y = 48; }
    doc.setTextColor(TEXT_MUTED);
    doc.text(lbl.toUpperCase(), M, y);
    doc.setTextColor(TEXT_DARK);
    const wrapped = wrapText(val, 78);
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

  if (sorted.length === 0) {
    doc.setFont('Arial', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(TEXT_MUTED);
    doc.text('(No messages)', M, y);
    y += 14;
  }

  for (let i = 0; i < sorted.length; i++) {
    const msg = sorted[i];
    // Per-message envelope (sender, recipients, date, importance, read state).
    if (y > H - 100) { doc.addPage(); y = 48; }
    doc.setFont('Arial', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(TEXT_DARK);
    const from = msg.fromName ? `${msg.fromName} <${msg.fromAddress}>` : (msg.fromAddress || 'Unknown');
    doc.text(`${i + 1}. ${from}`, M, y);
    doc.setFont('Arial', 'normal');
    doc.setTextColor(TEXT_MUTED);
    const tags: string[] = [fmtDateTime(msg.receivedAt || msg.sentAt)];
    if (msg.importance === 'high') tags.push('HIGH');
    if (msg.importance === 'low') tags.push('LOW');
    if (msg.isFlagged) tags.push('FLAGGED');
    if (!msg.isRead) tags.push('UNREAD');
    doc.text(tags.join('  ·  '), W - M, y, { align: 'right' });
    y += 12;

    // Recipients (To / CC).
    const toLine = (msg.toAddresses || []).map(fmtAddress).filter(Boolean).join(', ');
    if (toLine) {
      const wrapped = wrapText(`To: ${toLine}`, 95);
      for (const line of wrapped) {
        if (y > H - 60) { doc.addPage(); y = 48; }
        doc.text(line, M + 14, y);
        y += 11;
      }
    }
    const ccLine = (msg.ccAddresses || []).map(fmtAddress).filter(Boolean).join(', ');
    if (ccLine) {
      const wrapped = wrapText(`CC: ${ccLine}`, 95);
      for (const line of wrapped) {
        if (y > H - 60) { doc.addPage(); y = 48; }
        doc.text(line, M + 14, y);
        y += 11;
      }
    }

    // Body. Prefer the HTML body (stripped) over the preview — the preview
    // is truncated to ~255 chars by Graph.
    const bodyText = stripHtmlForText(msg.bodyHtml) || msg.bodyPreview || '';
    doc.setTextColor(TEXT_DARK);
    const lines = wrapText(bodyText || '—', 95);
    y += 2;
    for (const line of lines) {
      if (y > H - 60) { doc.addPage(); y = 48; }
      doc.text(line, M + 14, y);
      y += 11;
    }

    // Attachments for this message (filtered to non-inline — inline images
    // are part of the body, not separate evidence).
    const atts = (attachmentsByMessageId?.[msg.id] || []).filter((a) => !a.isInline);
    if (atts.length > 0) {
      if (y > H - 60) { doc.addPage(); y = 48; }
      doc.setFont('Arial', 'bold');
      doc.setTextColor(TEXT_MUTED);
      doc.text(`Attachments (${atts.length}):`, M + 14, y);
      doc.setFont('Arial', 'normal');
      doc.setTextColor(TEXT_DARK);
      y += 11;
      for (const a of atts) {
        if (y > H - 60) { doc.addPage(); y = 48; }
        const size = typeof a.size === 'number'
          ? (a.size < 1024 ? `${a.size} B` : a.size < 1048576 ? `${(a.size / 1024).toFixed(1)} KB` : `${(a.size / 1048576).toFixed(1)} MB`)
          : '';
        doc.text(`  • ${a.name || '(unnamed)'}${size ? `  (${size})` : ''}`, M + 14, y);
        y += 11;
      }
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
    `Generated ${fmtDateTime(new Date().toISOString())}  ·  RMPG Flex Email  ·  Thread #${threadId || '—'}`,
    M, H - 18,
  );

  return doc;
}

export function openEmailThreadPdf(input: EmailThreadPdfInput): void {
  const doc = generateEmailThreadPdf(input);
  const url = URL.createObjectURL(doc.output('blob'));
  openPdfBlob(url, 'Email Thread');
}
