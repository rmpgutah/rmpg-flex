// ═══════════════════════════════════════════════════════════════
// Jail Booking Sheet — court-ready intake / chain-of-custody PDF.
//
// An inmate booking sheet IS the chain-of-custody artifact for
// a person in jail custody: it links arresting agency, charges,
// housing assignment, and the booking officer onto a single
// signable page. Defense counsel pulls this during discovery to
// challenge the booking process, prove a missing rights advisory,
// or attack the chain that brought the person from arrest to cell.
//
// Same Arial + RMPG-gold + signature-block idiom as equipment
// custody / evidence custody / training certificate. Two output
// shapes share most of the helpers:
//   - openJailBookingSheetPdf({ inmate, charges, preparedBy }) —
//     single inmate, full detail (the "BK-26-0042" packet).
//   - openJailRosterSnapshotPdf({ rows, scope, preparedBy }) —
//     shift-handoff roster (one row per housed inmate, no PII
//     beyond name/booking#/cell/status — same fields the relief
//     supervisor reads off the jail door).
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import { drawNavyBanner } from './pdfStandaloneHeader';
import { registerArialFont } from './pdf/fonts/registerArial';
import { parseTimestamp } from './dateUtils';

import { formatEnumValue, toDisplayLabel, stripHtmlForPdf } from './formatters';
import { openPdfBlob } from './openPdfDocument';

const RMPG_GOLD = '#d4a017';
const TEXT_DARK = '#1a1a1a';
const TEXT_MUTED = '#555555';
const BORDER = '#9a9a9a';
const ROW_ALT = '#f4f4f0';
const ALERT_BG = '#fef1f0';
const ALERT_BORDER = '#b91c1c';
const WARN_BG = '#fff7e0';
const WARN_BORDER = '#92400e';

const MT_TZ = 'America/Denver';

// Inmate shape mirrors src/routes/jail.ts SELECT * FROM inmates.
// Everything is optional because the booking flow only requires
// last/first name — every other field can land empty.
export interface InmatePdfRecord {
  id?: number | string;
  booking_number?: string;
  last_name?: string;
  first_name?: string;
  middle_name?: string;
  dob?: string;
  gender?: string;
  race?: string;
  height_inches?: number | string | null;
  weight_lbs?: number | string | null;
  hair_color?: string;
  eye_color?: string;
  skin_tone?: string;
  marks_scars_tattoos?: string;
  housing_unit?: string;
  housing_cell?: string;
  status?: string;
  booking_date?: string;
  release_date?: string;
  release_reason?: string;
  arresting_agency?: string;
  arresting_officer_id?: number | string | null;
  arresting_officer_name?: string;
  arrest_incident_id?: number | string | null;
  bail_amount?: number | string | null;
  bond_type?: string;
  notes?: string;
}

export interface InmateChargeRow {
  id?: number | string;
  charge_description?: string;
  statute_code?: string;
  offense_level?: string;
  warrant_number?: string;
  court_docket?: string;
  bond_amount?: number | string | null;
  disposition?: string;
  notes?: string;
}

export interface JailBookingSheetInput {
  inmate: InmatePdfRecord;
  /** Optional charges fetched from
   *  GET /jail/inmates/:id/charges. Empty / undefined renders
   *  "No charges recorded" — booking still has documentary value
   *  (intake biometrics, housing assignment) even pre-charging. */
  charges?: InmateChargeRow[];
  /** Person who clicked Print — surfaces in the agency strap
   *  + booking officer signature block. */
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

const ellipsize = (s: string, max: number) => s.length <= max ? s : s.slice(0, max - 1) + '…';

/** Public for testing. Format height (in inches) as "5'11"" — the
 *  representation a court clerk / booking officer expects. Falls
 *  back to the raw inches string when the value is < 12 or non-
 *  numeric so we never misrender 7-inch infants as 7'0". */
export function formatHeight(inches: number | string | null | undefined): string {
  if (inches === null || inches === undefined || inches === '') return '—';
  const n = typeof inches === 'number' ? inches : parseInt(String(inches), 10);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 12) return `${n}"`;
  const ft = Math.floor(n / 12);
  const inc = n % 12;
  return `${ft}'${inc}"`;
}

/** Public for testing. Format weight as "180 lbs" with the unit
 *  appended — the raw number alone reads ambiguously next to
 *  height feet/inches. */
export function formatWeight(lbs: number | string | null | undefined): string {
  if (lbs === null || lbs === undefined || lbs === '') return '—';
  const n = typeof lbs === 'number' ? lbs : parseInt(String(lbs), 10);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return `${n} lbs`;
}

/** Public for testing. Bail amount as a US-locale dollar string
 *  with 2 decimal places. Zero (held without bail) renders as
 *  "NO BAIL" — same idiom the court docket uses. */
export function formatBail(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const n = typeof amount === 'number' ? amount : parseFloat(String(amount));
  if (!Number.isFinite(n)) return '—';
  if (n <= 0) return 'NO BAIL';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/** Public for testing. snake_case status → uppercase label. */
export function prettyStatus(status: string | undefined | null): string {
  if (!status) return '—';
  return toDisplayLabel(status).toUpperCase();
}

/** Public for testing. The inmate is "in custody" (not yet
 *  released / transferred away) when status is one of the live
 *  housing states. Mirrors src/routes/jail.ts /stats counting. */
export function isInCustody(status: string | undefined | null): boolean {
  if (!status) return false;
  return ['booked', 'housed', 'court', 'medical'].includes(status.toLowerCase());
}

/** Public for testing. Banner copy when the booking sheet has
 *  release_date but status still reads as in-custody, or vice
 *  versa — surfaces the inconsistency to the supervisor reading
 *  the PDF rather than leaving it as a quiet schema bug. Returns
 *  null when the record is internally consistent. */
export function bookingConsistencyAlert(inmate: InmatePdfRecord): string | null {
  const inCustody = isInCustody(inmate.status);
  if (inmate.release_date && inCustody) {
    return `RELEASE DATE RECORDED BUT STATUS IS "${prettyStatus(inmate.status)}" — verify the inmate's current location before relying on this sheet.`;
  }
  if (!inmate.release_date && !inCustody && inmate.status === 'released') {
    return 'STATUS IS RELEASED BUT NO RELEASE DATE RECORDED — booking officer should backfill release_date before the sheet leaves the building.';
  }
  return null;
}

export function generateJailBookingSheetPdf(input: JailBookingSheetInput): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  registerArialFont(doc);

  const { inmate, charges, preparedBy } = input;
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  let y = 36;

  const refLabel = inmate.booking_number
    || (inmate.id ? `INMATE-${inmate.id}` : 'INMATE');
  const nameLine = [inmate.last_name, inmate.first_name].filter(Boolean).join(', ')
    + (inmate.middle_name ? ` ${inmate.middle_name}` : '');

  // Banner
  y = drawNavyBanner(doc, {
    title: `BOOKING SHEET — ${refLabel}`,
    subtitle: 'Jail Management / Booking & Intake',
    rightLine1: fmtDateTime(new Date().toISOString()),
    rightLine2: preparedBy ? `Prepared by: ${preparedBy}` : undefined,
  });

  // Subject line (name in large bold — what the supervisor sees first)
  doc.setFont('Arial', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(TEXT_DARK);
  doc.text(nameLine || '(name not recorded)', M, y);
  y += 18;

  // Consistency banner (if record contradicts itself)
  const alert = bookingConsistencyAlert(inmate);
  if (alert) {
    doc.setFillColor(WARN_BG);
    doc.setDrawColor(WARN_BORDER);
    doc.setLineWidth(0.75);
    const lines = doc.splitTextToSize(alert, W - 2 * M - 20);
    const bh = 14 + lines.length * 11;
    doc.rect(M, y, W - 2 * M, bh, 'FD');
    doc.setFont('Arial', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(WARN_BORDER);
    doc.text(lines, M + 10, y + 12);
    y += bh + 10;
    doc.setFont('Arial', 'normal');
    doc.setLineWidth(0.5);
  }

  // In-custody banner for active records — court packet recipient
  // should see at a glance whether the person is still on the
  // jail floor or has been released.
  if (isInCustody(inmate.status)) {
    doc.setFillColor(ALERT_BG);
    doc.setDrawColor(ALERT_BORDER);
    doc.setLineWidth(0.75);
    doc.rect(M, y, W - 2 * M, 22, 'FD');
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(ALERT_BORDER);
    doc.text(
      `IN CUSTODY — ${prettyStatus(inmate.status)}${inmate.housing_unit ? `  ·  UNIT ${inmate.housing_unit}` : ''}${inmate.housing_cell ? `  ·  CELL ${inmate.housing_cell}` : ''}`,
      M + 10, y + 15,
    );
    y += 30;
    doc.setLineWidth(0.5);
  }

  // ── Subject / identity block ──
  const sectionHeader = (label: string) => {
    doc.setFont('Arial', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(TEXT_DARK);
    doc.text(label, M, y);
    y += 4;
    doc.setDrawColor(BORDER);
    doc.line(M, y, W - M, y);
    y += 12;
    doc.setFont('Arial', 'normal');
    doc.setFontSize(9);
  };

  const colW = (W - 2 * M) / 2;
  const renderFields = (fields: Array<[string, string]>) => {
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
  };

  sectionHeader('SUBJECT');
  renderFields([
    ['Booking #', inmate.booking_number || '—'],
    ['Status', prettyStatus(inmate.status)],
    ['DOB', fmtDate(inmate.dob)],
    ['Gender', inmate.gender || '—'],
    ['Race', inmate.race || '—'],
    ['Skin Tone', inmate.skin_tone || '—'],
    ['Height', formatHeight(inmate.height_inches)],
    ['Weight', formatWeight(inmate.weight_lbs)],
    ['Hair', inmate.hair_color || '—'],
    ['Eyes', inmate.eye_color || '—'],
  ]);

  // Marks / scars / tattoos as a wrapped paragraph — these descriptions
  // are how booking officers re-identify an inmate after release, so
  // the field gets full width when populated.
  if (inmate.marks_scars_tattoos && inmate.marks_scars_tattoos.trim()) {
    doc.setTextColor(TEXT_MUTED);
    doc.text('MARKS / SCARS / TATTOOS', M, y);
    doc.setTextColor(TEXT_DARK);
    const lines = doc.splitTextToSize(inmate.marks_scars_tattoos.trim(), W - 2 * M);
    doc.text(lines, M, y + 11);
    y += 11 + lines.length * 11 + 6;
  }

  // ── Custody block ──
  sectionHeader('CUSTODY');
  renderFields([
    ['Booked', fmtDateTime(inmate.booking_date)],
    ['Released', fmtDateTime(inmate.release_date)],
    ['Housing Unit', inmate.housing_unit || '—'],
    ['Housing Cell', inmate.housing_cell || '—'],
    ['Arresting Agency', inmate.arresting_agency || '—'],
    ['Arresting Officer', inmate.arresting_officer_name || (inmate.arresting_officer_id ? String(inmate.arresting_officer_id) : '—')],
    ['Bail Amount', formatBail(inmate.bail_amount)],
    ['Bond Type', formatEnumValue(inmate.bond_type) || '—'],
    ['Linked Incident', inmate.arrest_incident_id ? String(inmate.arrest_incident_id) : '—'],
    ['Release Reason', inmate.release_reason || '—'],
  ]);

  // ── Notes ──
  const newPageIfNeeded = (need: number) => {
    if (y + need > H - 80) { doc.addPage(); y = 48; }
  };
  if (inmate.notes && inmate.notes.trim()) {
    newPageIfNeeded(40);
    sectionHeader('NOTES');
    const plain = stripHtmlForPdf(inmate.notes);
    const lines = doc.splitTextToSize(plain, W - 2 * M);
    doc.setTextColor(TEXT_DARK);
    doc.text(lines, M, y);
    y += lines.length * 11 + 6;
  }

  // ── Charges ──
  newPageIfNeeded(50);
  sectionHeader('CHARGES');
  const chargeRows = Array.isArray(charges) ? charges : [];
  const cols = [
    { key: 'desc',    label: 'DESCRIPTION',  width: 200 },
    { key: 'statute', label: 'STATUTE',      width: 90 },
    { key: 'level',   label: 'LEVEL',        width: 60 },
    { key: 'bond',    label: 'BOND',         width: 70 },
    { key: 'docket',  label: 'DOCKET',       width: 100 },
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

  if (chargeRows.length === 0) {
    doc.setFontSize(9);
    doc.setTextColor(TEXT_MUTED);
    doc.setFont('Arial', 'italic');
    doc.text('No charges recorded.', M + 8, y + 14);
    doc.setFont('Arial', 'normal');
    y += 24;
  } else {
    doc.setFontSize(8);
    chargeRows.forEach((entry, i) => {
      newPageIfNeeded(13);
      if (i % 2 === 1) {
        doc.setFillColor(ROW_ALT);
        doc.rect(M, y, W - 2 * M, 13, 'F');
      }
      doc.setTextColor(TEXT_DARK);
      let x = M + 4;
      doc.text(ellipsize(entry.charge_description || '—', 40), x, y + 9);
      x += cols[0].width;
      doc.text(ellipsize(entry.statute_code || '—', 18), x, y + 9);
      x += cols[1].width;
      doc.text(ellipsize(entry.offense_level || '—', 12), x, y + 9);
      x += cols[2].width;
      doc.text(formatBail(entry.bond_amount), x, y + 9);
      x += cols[3].width;
      doc.text(ellipsize(entry.court_docket || '—', 18), x, y + 9);
      doc.setDrawColor(BORDER);
      doc.setLineWidth(0.25);
      doc.line(M, y + 13, W - M, y + 13);
      y += 13;
    });
  }

  // ── Signature block ──
  newPageIfNeeded(80);
  y += 14;
  doc.setDrawColor(BORDER);
  doc.setLineWidth(0.5);
  const sigW = (W - 2 * M - 24) / 2;
  doc.line(M, y + 28, M + sigW, y + 28);
  doc.line(M + sigW + 24, y + 28, W - M, y + 28);
  doc.setFontSize(8);
  doc.setTextColor(TEXT_MUTED);
  doc.text('Booking officer signature / date', M, y + 38);
  if (preparedBy) doc.text(preparedBy, M, y + 49);
  doc.text('Inmate signature / date', M + sigW + 24, y + 38);
  if (nameLine) doc.text(nameLine, M + sigW + 24, y + 49);

  // Footer
  doc.setFontSize(7);
  doc.text(
    `Generated ${fmtDateTime(new Date().toISOString())}  ·  RMPG Flex Jail Management — Booking & Intake  ·  ${refLabel}`,
    M, H - 18,
  );

  return doc;
}

export function openJailBookingSheetPdf(input: JailBookingSheetInput): void {
  const doc = generateJailBookingSheetPdf(input);
  const url = URL.createObjectURL(doc.output('blob'));
  openPdfBlob(url, 'Jail Booking Sheet');
}

// ═══════════════════════════════════════════════════════════════
// Shift-handoff Roster Snapshot — used by the supervisor printing
// the current in-custody list off the screen before a relief crew
// shows up. Single page when ≤ ~40 rows, paginates otherwise.
// ═══════════════════════════════════════════════════════════════

export interface JailRosterSnapshotInput {
  rows: InmatePdfRecord[];
  /** Free-text describing what's in `rows` — e.g.
   *  "All in-custody inmates" / "Housed only" / "Filtered: status=booked".
   *  Renders in the agency strap so the next shift knows the scope. */
  scope?: string;
  /** Person who clicked Print — surfaces in the agency strap. */
  preparedBy?: string;
}

export function generateJailRosterSnapshotPdf(input: JailRosterSnapshotInput): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  registerArialFont(doc);

  const { rows, scope, preparedBy } = input;
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  let y = 36;

  doc.setFillColor(RMPG_GOLD);
  doc.rect(M, y, W - 2 * M, 28, 'F');
  doc.setFont('Arial', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(TEXT_DARK);
  doc.text(`JAIL ROSTER SNAPSHOT  ·  ${rows.length} inmate${rows.length === 1 ? '' : 's'}`, M + 10, y + 19);
  doc.setFontSize(9);
  doc.setFont('Arial', 'normal');
  doc.text(fmtDateTime(new Date().toISOString()), W - M - 10, y + 19, { align: 'right' });
  y += 38;

  doc.setFontSize(9);
  doc.setTextColor(TEXT_MUTED);
  doc.text(
    `Rocky Mountain Protective Group  ·  Jail Management${scope ? `  ·  ${scope}` : ''}`,
    M, y,
  );
  if (preparedBy) doc.text(`Prepared by: ${preparedBy}`, W - M, y, { align: 'right' });
  y += 16;

  // Table header
  const cols = [
    { key: 'booking', label: 'BOOKING #',  width: 80 },
    { key: 'name',    label: 'NAME',       width: 160 },
    { key: 'status',  label: 'STATUS',     width: 65 },
    { key: 'unit',    label: 'UNIT',       width: 50 },
    { key: 'cell',    label: 'CELL',       width: 50 },
    { key: 'dob',     label: 'DOB',        width: 70 },
    { key: 'booked',  label: 'BOOKED',     width: 110 },
  ] as const;

  const drawHeader = () => {
    doc.setFillColor('#e6e6e6');
    doc.rect(M, y, W - 2 * M, 14, 'F');
    doc.setFontSize(7.5);
    doc.setFont('Arial', 'bold');
    doc.setTextColor(TEXT_MUTED);
    let x = M + 4;
    for (const c of cols) { doc.text(c.label, x, y + 9); x += c.width; }
    y += 14;
    doc.setFont('Arial', 'normal');
  };
  drawHeader();

  if (rows.length === 0) {
    doc.setFontSize(9);
    doc.setFont('Arial', 'italic');
    doc.setTextColor(TEXT_MUTED);
    doc.text('No inmates in the current view.', M + 8, y + 14);
    doc.setFont('Arial', 'normal');
    y += 24;
  } else {
    doc.setFontSize(8);
    rows.forEach((r, i) => {
      if (y + 13 > H - 40) {
        doc.addPage();
        y = 48;
        drawHeader();
      }
      if (i % 2 === 1) {
        doc.setFillColor(ROW_ALT);
        doc.rect(M, y, W - 2 * M, 13, 'F');
      }
      doc.setTextColor(TEXT_DARK);
      let x = M + 4;
      const name = [r.last_name, r.first_name].filter(Boolean).join(', ')
        || '(unnamed)';
      doc.text(ellipsize(r.booking_number || '—', 14), x, y + 9); x += cols[0].width;
      doc.text(ellipsize(name, 30), x, y + 9); x += cols[1].width;
      doc.text(ellipsize(prettyStatus(r.status), 12), x, y + 9); x += cols[2].width;
      doc.text(ellipsize(r.housing_unit || '—', 8), x, y + 9); x += cols[3].width;
      doc.text(ellipsize(r.housing_cell || '—', 8), x, y + 9); x += cols[4].width;
      doc.text(ellipsize(fmtDate(r.dob), 12), x, y + 9); x += cols[5].width;
      doc.text(ellipsize(fmtDateTime(r.booking_date), 20), x, y + 9);
      doc.setDrawColor(BORDER);
      doc.setLineWidth(0.25);
      doc.line(M, y + 13, W - M, y + 13);
      y += 13;
    });
  }

  // Signature block — the relief supervisor signs to acknowledge
  // they've eyeballed every inmate in this roster snapshot.
  if (y + 70 > H - 40) { doc.addPage(); y = 48; }
  y += 14;
  doc.setDrawColor(BORDER);
  doc.setLineWidth(0.5);
  const sigW = (W - 2 * M - 24) / 2;
  doc.line(M, y + 28, M + sigW, y + 28);
  doc.line(M + sigW + 24, y + 28, W - M, y + 28);
  doc.setFontSize(8);
  doc.setTextColor(TEXT_MUTED);
  doc.text('Off-going supervisor signature / date', M, y + 38);
  if (preparedBy) doc.text(preparedBy, M, y + 49);
  doc.text('On-coming supervisor signature / date', M + sigW + 24, y + 38);

  // Footer
  doc.setFontSize(7);
  doc.text(
    `Generated ${fmtDateTime(new Date().toISOString())}  ·  RMPG Flex Jail Management — Shift Handoff  ·  ${rows.length} row${rows.length === 1 ? '' : 's'}`,
    M, H - 18,
  );

  return doc;
}

export function openJailRosterSnapshotPdf(input: JailRosterSnapshotInput): void {
  const doc = generateJailRosterSnapshotPdf(input);
  const url = URL.createObjectURL(doc.output('blob'));
  openPdfBlob(url, 'Jail Booking Sheet');
}
