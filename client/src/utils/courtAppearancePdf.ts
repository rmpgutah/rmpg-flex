// ============================================================
// RMPG Flex — Court Appearance Prep PDF (v1037)
// ============================================================
// Court-ready single-event PDF for an officer walking into court:
// covers the docket sheet basics (case #, courtroom, judge), the
// officer's countdown / status, the parties' contact info, judge
// preferences/notes, witnesses with confirmation state, fees,
// bail/bond, continuance history, outcome (if entered), and a
// signature line. Same Arial + RMPG-gold-banner idiom as the
// criminalHistoryPdf / fiCardPdf / evidenceCustodyPdf shipped in
// the v1024 / v1025 / v1026 court-ready series.
// ============================================================

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
const WARN_BG = '#fff8e6';
const WARN_BORDER = '#b07f00';

const MT_TZ = 'America/Denver';

/** Subset of CourtEvent the page already has loaded; anything missing
 *  prints as the em-dash placeholder so this PDF never blows up on
 *  partial data. */
export interface CourtAppearanceInput {
  id?: string | number;
  event_number: string;
  event_type: string;
  status?: string;
  event_date: string;
  event_time?: string;
  court_name?: string;
  courtroom?: string;
  judge_name?: string;
  court_case_number?: string;
  defendant_name?: string;
  prosecutor?: string | Record<string, string>;
  defense_attorney?: string;
  outcome?: string | null;
  sentence?: string | null;
  fine_amount?: string | number | null;
  notes?: string | null;
  /** Stringified JSON on the wire — parsed defensively here. */
  judge_notes?: string | null;
  bail_amount?: string | number | null;
  bond_status?: string | null;
  surety_info?: string | null;
  /** Stringified JSON arrays/objects on the wire. */
  witnesses?: string | null;
  court_fees?: string | null;
  continuance_log?: string | null;
  officers_required?: string | null;
  officer_confirmations?: string | null;
  continuance_count?: number;
  preparedBy?: string;
}

interface WitnessRow {
  name?: string;
  role?: string;
  contact_status?: string;
  phone?: string;
  email?: string;
}

function fmtDate(input?: string | null): string {
  if (!input) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: MT_TZ, year: 'numeric', month: 'short', day: 'numeric',
    }).format(parseTimestamp(input));
  } catch { return String(input); }
}

function fmtDateTime(input?: string | null): string {
  if (!input) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: MT_TZ, year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(parseTimestamp(input)) + ' MT';
  } catch { return String(input); }
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

/** Public for testing. Resolves the prosecutor display name from the
 *  page's two on-disk shapes — bare string (legacy) or `{name,phone,email}`
 *  JSON object (post-Feature-7 rollout). */
export function prosecutorDisplayName(raw: string | Record<string, string> | undefined | null): string {
  if (!raw) return '—';
  if (typeof raw === 'object') return raw.name || '—';
  const str = String(raw).trim();
  if (!str) return '—';
  if (str.startsWith('{')) {
    try { return JSON.parse(str)?.name || str; } catch { return str; }
  }
  return str;
}

/** Public for testing. Days from "today" to the event date.
 *  Mirrors the in-page `daysUntil()` countdown so the PDF and the
 *  on-screen badge can't disagree (court won't reschedule because
 *  the PDF said "tomorrow" and the screen said "today"). */
export function daysUntilEvent(eventDate: string | undefined): { text: string; isPast: boolean; isImminent: boolean } {
  if (!eventDate) return { text: '—', isPast: false, isImminent: false };
  let d: number;
  try {
    d = Math.ceil((parseTimestamp(eventDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  } catch { return { text: '—', isPast: false, isImminent: false }; }
  if (isNaN(d)) return { text: '—', isPast: false, isImminent: false };
  if (d < 0) return { text: 'PAST', isPast: true, isImminent: false };
  if (d === 0) return { text: 'TODAY', isPast: false, isImminent: true };
  if (d === 1) return { text: 'TOMORROW', isPast: false, isImminent: true };
  return { text: `${d} days`, isPast: false, isImminent: d <= 3 };
}

function ellipsize(s: string, max: number): string {
  if (!s) return '';
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

function moneyFmt(v: string | number | null | undefined): string {
  if (v == null || v === '') return '—';
  const n = typeof v === 'number' ? v : Number(v);
  if (!isFinite(n)) return '—';
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function generateCourtAppearancePdf(input: CourtAppearanceInput): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  registerArialFont(doc);

  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  let y = 36;

  const newPageIfNeeded = (needed: number) => {
    if (y + needed > H - 36) { doc.addPage(); y = 36; }
  };

  // ── Banner ──
  y = drawNavyBanner(doc, {
    title: 'COURT APPEARANCE PREP SHEET',
    subtitle: 'Court / Legal Tracker',
    rightLine1: fmtDateTime(new Date().toISOString()),
    rightLine2: input.preparedBy ? `Prepared by: ${input.preparedBy}` : undefined,
  });

  // ── Imminence banner (TODAY / TOMORROW / PAST) ──
  const countdown = daysUntilEvent(input.event_date);
  if (countdown.isPast || countdown.isImminent) {
    const bg = countdown.isPast ? ALERT_BG : WARN_BG;
    const border = countdown.isPast ? ALERT_BORDER : WARN_BORDER;
    doc.setFillColor(bg);
    doc.setDrawColor(border);
    doc.setLineWidth(0.75);
    doc.rect(M, y, W - 2 * M, 22, 'FD');
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(border);
    const label = countdown.isPast
      ? `COURT DATE HAS PASSED  —  REVIEW OUTCOME AND FOLLOW-UP`
      : `COURT DATE: ${countdown.text}  —  CONFIRM ATTENDANCE BEFORE LEAVING`;
    doc.text(label, M + 10, y + 15);
    y += 30;
    doc.setLineWidth(0.5);
  }

  // ── Event identity block ──
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('EVENT', M, y);
  y += 4;
  doc.setDrawColor(BORDER);
  doc.line(M, y, W - M, y);
  y += 12;
  doc.setFont('Arial', 'normal');
  doc.setFontSize(9);

  const eventFields: Array<[string, string]> = [
    ['Event #', input.event_number || '—'],
    ['Type', (input.event_type || '').toUpperCase() || '—'],
    ['Status', (input.status || '').toUpperCase() || '—'],
    ['Continuances', String(input.continuance_count ?? 0)],
    ['Event Date', fmtDate(input.event_date)],
    ['Time', input.event_time || '—'],
    ['Court', input.court_name || '—'],
    ['Courtroom', input.courtroom || '—'],
    ['Judge', input.judge_name || '—'],
    ['Court Case #', input.court_case_number || '—'],
  ];
  const colW = (W - 2 * M) / 2;
  for (let i = 0; i < eventFields.length; i += 2) {
    const [lbl1, val1] = eventFields[i];
    const [lbl2, val2] = eventFields[i + 1] ?? ['', ''];
    doc.setTextColor(TEXT_MUTED);
    doc.text(lbl1.toUpperCase(), M, y);
    if (lbl2) doc.text(lbl2.toUpperCase(), M + colW, y);
    doc.setTextColor(TEXT_DARK);
    doc.text(val1, M, y + 11);
    if (val2) doc.text(val2, M + colW, y + 11);
    y += 24;
  }

  // ── Parties ──
  newPageIfNeeded(110);
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('PARTIES', M, y);
  y += 4;
  doc.setDrawColor(BORDER);
  doc.line(M, y, W - M, y);
  y += 12;
  doc.setFont('Arial', 'normal');
  doc.setFontSize(9);

  const prosecutor = typeof input.prosecutor === 'string'
    ? (() => { try { return JSON.parse(input.prosecutor as string); } catch { return null; } })()
    : input.prosecutor;
  const prosecutorName = prosecutorDisplayName(input.prosecutor);
  const prosecutorContact = prosecutor && typeof prosecutor === 'object'
    ? [prosecutor.phone, prosecutor.email].filter(Boolean).join(' · ')
    : '';

  const partyFields: Array<[string, string]> = [
    ['Defendant', input.defendant_name || '—'],
    ['Defense Attorney', input.defense_attorney || '—'],
    ['Prosecutor', prosecutorName],
    ['Prosecutor Contact', prosecutorContact || '—'],
  ];
  for (let i = 0; i < partyFields.length; i += 2) {
    const [lbl1, val1] = partyFields[i];
    const [lbl2, val2] = partyFields[i + 1] ?? ['', ''];
    doc.setTextColor(TEXT_MUTED);
    doc.text(lbl1.toUpperCase(), M, y);
    if (lbl2) doc.text(lbl2.toUpperCase(), M + colW, y);
    doc.setTextColor(TEXT_DARK);
    doc.text(ellipsize(val1, 60), M, y + 11);
    if (val2) doc.text(ellipsize(val2, 60), M + colW, y + 11);
    y += 24;
  }

  // ── Bail / Bond ──
  newPageIfNeeded(80);
  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('BAIL / BOND', M, y);
  y += 4;
  doc.setDrawColor(BORDER);
  doc.line(M, y, W - M, y);
  y += 12;
  doc.setFont('Arial', 'normal');
  doc.setFontSize(9);
  const bailFields: Array<[string, string]> = [
    ['Amount', moneyFmt(input.bail_amount)],
    ['Status', toDisplayLabel(input.bond_status || '').toUpperCase() || '—'],
    ['Surety', input.surety_info || '—'],
  ];
  for (const [lbl, val] of bailFields) {
    doc.setTextColor(TEXT_MUTED);
    doc.text(lbl.toUpperCase(), M, y);
    doc.setTextColor(TEXT_DARK);
    doc.text(ellipsize(val, 90), M + 110, y);
    y += 14;
  }

  // ── Judge preferences / notes ──
  const judgeNotes = (input.judge_notes || '').trim();
  if (judgeNotes) {
    newPageIfNeeded(80);
    y += 6;
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(TEXT_DARK);
    doc.text('JUDGE PREFERENCES / COURTROOM NOTES', M, y);
    y += 4;
    doc.setDrawColor(BORDER);
    doc.line(M, y, W - M, y);
    y += 12;
    doc.setFont('Arial', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(TEXT_DARK);
    const lines = doc.splitTextToSize(judgeNotes, W - 2 * M);
    for (const line of lines) {
      newPageIfNeeded(12);
      doc.text(line, M, y);
      y += 11;
    }
  }

  // ── Witnesses ──
  const witnesses = parseJson<WitnessRow[]>(input.witnesses, []);
  if (Array.isArray(witnesses) && witnesses.length > 0) {
    newPageIfNeeded(120);
    y += 6;
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(TEXT_DARK);
    doc.text(`WITNESSES (${witnesses.length})`, M, y);
    y += 4;
    doc.setDrawColor(BORDER);
    doc.line(M, y, W - M, y);
    y += 12;

    // Header
    const witCols: Array<{ label: string; width: number }> = [
      { label: 'NAME', width: (W - 2 * M) * 0.30 },
      { label: 'ROLE', width: (W - 2 * M) * 0.20 },
      { label: 'STATUS', width: (W - 2 * M) * 0.18 },
      { label: 'CONTACT', width: (W - 2 * M) * 0.32 },
    ];
    doc.setFillColor(ROW_ALT);
    doc.rect(M, y, W - 2 * M, 14, 'F');
    doc.setFont('Arial', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(TEXT_MUTED);
    let hx = M + 4;
    for (const col of witCols) {
      doc.text(col.label, hx, y + 10);
      hx += col.width;
    }
    y += 14;

    doc.setFont('Arial', 'normal');
    doc.setFontSize(9);
    witnesses.forEach((w, idx) => {
      newPageIfNeeded(13);
      if (idx % 2 === 1) {
        doc.setFillColor(ROW_ALT);
        doc.rect(M, y, W - 2 * M, 13, 'F');
      }
      doc.setTextColor(TEXT_DARK);
      let rx = M + 4;
      doc.text(ellipsize(w.name || '—', 30), rx, y + 9);
      rx += witCols[0].width;
      doc.text(ellipsize(toDisplayLabel(w.role), 20), rx, y + 9);
      rx += witCols[1].width;
      doc.text(ellipsize(toDisplayLabel(w.contact_status), 16), rx, y + 9);
      rx += witCols[2].width;
      const contact = [w.phone, w.email].filter(Boolean).join(' · ');
      doc.text(ellipsize(contact || '—', 40), rx, y + 9);
      doc.setDrawColor(BORDER);
      doc.setLineWidth(0.25);
      doc.line(M, y + 13, W - M, y + 13);
      y += 13;
    });
  }

  // ── Court fees ──
  const fees = parseJson<{ filing_fee?: string|number; service_fee?: string|number; other_fees?: string|number; fee_notes?: string }>(
    input.court_fees, {}
  );
  const filing = Number(fees.filing_fee ?? 0) || 0;
  const service = Number(fees.service_fee ?? 0) || 0;
  const other = Number(fees.other_fees ?? 0) || 0;
  const feeTotal = filing + service + other;
  if (feeTotal > 0 || fees.fee_notes) {
    newPageIfNeeded(70);
    y += 6;
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(TEXT_DARK);
    doc.text('COURT FEES', M, y);
    y += 4;
    doc.setDrawColor(BORDER);
    doc.line(M, y, W - M, y);
    y += 12;
    doc.setFont('Arial', 'normal');
    doc.setFontSize(9);
    const feeFields: Array<[string, string]> = [
      ['Filing', moneyFmt(filing)],
      ['Service', moneyFmt(service)],
      ['Other', moneyFmt(other)],
      ['TOTAL', moneyFmt(feeTotal)],
    ];
    for (const [lbl, val] of feeFields) {
      doc.setTextColor(TEXT_MUTED);
      doc.text(lbl.toUpperCase(), M, y);
      doc.setTextColor(TEXT_DARK);
      doc.text(val, M + 110, y);
      y += 14;
    }
    if (fees.fee_notes) {
      doc.setTextColor(TEXT_MUTED);
      doc.text('NOTES', M, y);
      doc.setTextColor(TEXT_DARK);
      const lines = doc.splitTextToSize(fees.fee_notes, W - 2 * M - 110);
      for (const line of lines) {
        newPageIfNeeded(12);
        doc.text(line, M + 110, y);
        y += 11;
      }
      y += 4;
    }
  }

  // ── Continuance history ──
  const continLog = parseJson<Array<{ reason?: string; old_date?: string; new_date?: string; date?: string }>>(
    input.continuance_log, []
  );
  if (Array.isArray(continLog) && continLog.length > 0) {
    newPageIfNeeded(60);
    y += 6;
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(TEXT_DARK);
    doc.text(`CONTINUANCE HISTORY (${continLog.length})`, M, y);
    y += 4;
    doc.setDrawColor(BORDER);
    doc.line(M, y, W - M, y);
    y += 12;
    doc.setFont('Arial', 'normal');
    doc.setFontSize(9);
    continLog.forEach((entry, i) => {
      newPageIfNeeded(26);
      doc.setTextColor(TEXT_DARK);
      doc.text(`#${i + 1}: ${ellipsize(entry.reason || '—', 70)}`, M, y);
      y += 11;
      doc.setTextColor(TEXT_MUTED);
      const movement = `${entry.old_date || '—'} → ${entry.new_date || 'TBD'}    Logged ${fmtDate(entry.date)}`;
      doc.text(movement, M, y);
      y += 14;
    });
  }

  // ── Outcome ──
  if (input.outcome) {
    newPageIfNeeded(70);
    y += 6;
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(TEXT_DARK);
    doc.text('OUTCOME', M, y);
    y += 4;
    doc.setDrawColor(BORDER);
    doc.line(M, y, W - M, y);
    y += 12;
    doc.setFont('Arial', 'normal');
    doc.setFontSize(9);
    const outcomeFields: Array<[string, string]> = [
      ['Verdict', toDisplayLabel(input.outcome || '').toUpperCase()],
      ['Sentence', input.sentence || '—'],
      ['Fine', moneyFmt(input.fine_amount)],
    ];
    for (const [lbl, val] of outcomeFields) {
      doc.setTextColor(TEXT_MUTED);
      doc.text(lbl.toUpperCase(), M, y);
      doc.setTextColor(TEXT_DARK);
      doc.text(ellipsize(val, 90), M + 110, y);
      y += 14;
    }
  }

  // ── Officer notes ──
  if (input.notes) {
    newPageIfNeeded(60);
    y += 6;
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(TEXT_DARK);
    doc.text('OFFICER NOTES', M, y);
    y += 4;
    doc.setDrawColor(BORDER);
    doc.line(M, y, W - M, y);
    y += 12;
    doc.setFont('Arial', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(TEXT_DARK);
    const lines = doc.splitTextToSize(input.notes, W - 2 * M);
    for (const line of lines) {
      newPageIfNeeded(12);
      doc.text(line, M, y);
      y += 11;
    }
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
  doc.text('Officer signature / date', M, y + 38);
  if (input.preparedBy) doc.text(input.preparedBy, M, y + 49);
  doc.text('Supervisor signature / date', M + sigW + 24, y + 38);

  // Footer
  doc.setFontSize(7);
  doc.text(
    `Generated ${fmtDateTime(new Date().toISOString())}  ·  RMPG Flex Court Tracker  ·  Event ${input.event_number}`,
    M, H - 18,
  );

  return doc;
}

export function openCourtAppearancePdf(input: CourtAppearanceInput): void {
  const doc = generateCourtAppearancePdf(input);
  const url = URL.createObjectURL(doc.output('blob'));
  openPdfBlob(url, 'Court Appearance');
}
