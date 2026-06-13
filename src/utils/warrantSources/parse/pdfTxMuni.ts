/**
 * Texas-municipal court warrant-list PDF parser (CivicPlus DocumentCenter PDFs).
 *
 * These rosters are all-caps for BOTH names and offenses, so the flat
 * (mergePages:true) text stream gives no reliable name/offense boundary. The
 * adapter therefore fetches with `{ lines: true }` (mergePages:false), which
 * preserves pdf.js row newlines, and this parser reconstructs logical records
 * from the line structure:
 *
 *   - An "anchor line" carries the row's structural fields (a date + balance for
 *     Killeen, a warrant-number + balance for Bell Mead, a date + citation for
 *     Taylor). The defendant name is whatever precedes those fields, possibly
 *     accumulated from preceding name-only lines (long names wrap).
 *   - Offense text is whatever follows the structural fields on the anchor line,
 *     plus any subsequent continuation lines until the next anchor / name line.
 *
 * Three column layouts, auto-detected from the header line:
 *   Killeen   : Defendant Name | Warrant Date | Balance Due | Offense Description
 *   Bell Mead : Defendant Name | Warrant No   | Balance Due | Offense Description
 *   Taylor    : Defendant Name | Warrant Date | Citation No | Offense Description | Balance Due
 * Killeen/Bell Mead put Balance BEFORE the offense; Taylor puts it at the END.
 *
 * Robustness contract: never throw; return [] on empty/unrecognised input; skip
 * malformed individual records.
 */

import type { RawWarrantHit } from '../types';
import { cleanName, normalizeDate, normalizeBond } from '../normalize';
import { deriveWarrantId } from './socrata';

type TxLayout = 'killeen' | 'bellmead' | 'taylor';

const DATE = `\\d{2}\\/\\d{2}\\/\\d{4}`;
const MONEY = `[\\d,]+\\.\\d{2}`;

/** Per-layout anchor: matches the structural middle of a record within a line.
 *  Group 1 / 2 are the captured fields; match.index marks where the name ends. */
const ANCHOR: Record<TxLayout, RegExp> = {
  // DATE  BALANCE   (name before, offense after)
  killeen: new RegExp(`(${DATE})\\s+(${MONEY})`),
  // WARRANTNO  BALANCE  (warrant no: optional leading letter, a digit, alnum, optional " NN"; never a decimal)
  bellmead: new RegExp(`([A-Z]?\\d[A-Z0-9]*(?:\\s\\d{2})?)\\s+(${MONEY})`),
  // DATE  CITATIONNO  (offense + trailing balance follow)
  taylor: new RegExp(`(${DATE})\\s+([A-Z0-9]+)`),
};

/** A line that begins a new defendant: "LAST, FIRST …" (all-caps surname, comma, given). */
const NAME_START = /^[A-Z][A-Z'.\-]*(?: [A-Z][A-Z'.\-]*)*,\s+[A-Z]/;

/** Lines to drop entirely (repeated page headers / banners / page numbers). */
const BOILERPLATE = /^(?:WARRANT LIST|Defendant Name\b|[A-Z].* MUNICIPAL COURT ACTIVE WARRANT LISTING\b|Page \d+(?: of \d+)?$|\d+ of \d+$)/i;

/** Trailing balance for Taylor (0-2 decimals, optional thousands separators). */
const TAYLOR_TRAILING_BALANCE = /\s+(\d[\d,]*(?:\.\d{1,2})?)\s*$/;

function detectLayout(text: string): TxLayout | null {
  const head = text.slice(0, 600);
  if (/Warrant Date\s+Citation No/i.test(head)) return 'taylor';
  if (/Warrant No\b/i.test(head)) return 'bellmead';
  if (/Warrant Date\s+Balance Due/i.test(head)) return 'killeen';
  return null;
}

/** Split "LAST, FIRST MIDDLE" raw text into structured name fields. */
function splitName(raw: string): {
  last_name: string | null;
  first_name: string | null;
  middle_name: string | null;
  full_name: string;
} {
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  const commaIdx = trimmed.indexOf(',');
  if (commaIdx === -1) {
    const ln = cleanName(trimmed) || null;
    return { last_name: ln, first_name: null, middle_name: null, full_name: ln ?? '' };
  }
  const lastRaw = trimmed.slice(0, commaIdx).trim();
  const givenRaw = trimmed.slice(commaIdx + 1).trim();
  const givenParts = givenRaw ? givenRaw.split(/\s+/) : [];
  return {
    last_name: cleanName(lastRaw) || null,
    first_name: givenParts.length > 0 ? cleanName(givenParts[0]) : null,
    middle_name: givenParts.length > 1 ? cleanName(givenParts.slice(1).join(' ')) : null,
    full_name: cleanName([lastRaw, givenRaw].filter(s => s).join(', ')),
  };
}

function cleanCharge(raw: string): string | null {
  const c = raw.replace(/\s+/g, ' ').trim();
  return c || null;
}

interface RawRecord { name: string; field1: string; field2: string; offense: string; }

function buildHit(layout: TxLayout, rec: RawRecord, sourceKey: string, state: string): RawWarrantHit | null {
  const { last_name, first_name, middle_name, full_name } = splitName(rec.name);
  if (!full_name) return null;

  let issue_date: string | null = null;
  let case_number: string | undefined;
  let bail_amount: number | null = null;
  let charge: string | null;
  let ref: string | undefined;

  if (layout === 'taylor') {
    issue_date = normalizeDate(rec.field1);
    case_number = rec.field2?.trim() || undefined;
    ref = case_number;
    const bm = TAYLOR_TRAILING_BALANCE.exec(rec.offense);
    bail_amount = bm ? normalizeBond(bm[1]) : null;
    charge = cleanCharge(bm ? rec.offense.slice(0, bm.index) : rec.offense);
  } else if (layout === 'bellmead') {
    case_number = rec.field1?.replace(/\s+/g, ' ').trim() || undefined;
    ref = case_number;
    bail_amount = normalizeBond(rec.field2);
    charge = cleanCharge(rec.offense);
  } else {
    // killeen
    issue_date = normalizeDate(rec.field1);
    bail_amount = normalizeBond(rec.field2);
    charge = cleanCharge(rec.offense);
    ref = rec.field1; // date — id-derivation input only
  }

  // Same defendant repeats per offense, so the id must fold in the charge.
  const warrant_id = deriveWarrantId([full_name, ref, charge]);

  return {
    source_key: sourceKey,
    warrant_id,
    first_name,
    middle_name,
    last_name,
    full_name,
    state,
    charge_description: charge,
    bail_amount,
    issue_date,
    case_number,
    warrant_type: 'Municipal',
  };
}

/**
 * Parse a Texas-municipal warrant-list PDF text (extracted via unpdf with
 * `{ lines: true }`) into `RawWarrantHit` records.
 *
 * @param text       Newline-preserved extracted text from the PDF.
 * @param sourceKey  Source key for the output records (e.g. "pdf-txmuni-killeen-tx").
 * @param state      Two-letter state code (always "TX" for this family).
 */
export function parseTxMuniPdf(text: string, sourceKey: string, state: string): RawWarrantHit[] {
  if (!text || typeof text !== 'string') return [];

  const layout = detectLayout(text);
  if (!layout) return [];

  const anchor = ANCHOR[layout];
  const lines = text.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);

  const records: RawRecord[] = [];
  let pendingName = '';
  let cur: RawRecord | null = null;
  const flush = () => { if (cur) { records.push(cur); cur = null; } };

  for (const line of lines) {
    if (BOILERPLATE.test(line)) continue;

    const a = anchor.exec(line);
    if (a && a.index >= 0) {
      flush();
      const name = `${pendingName} ${line.slice(0, a.index)}`.replace(/\s+/g, ' ').trim();
      pendingName = '';
      cur = { name, field1: a[1], field2: a[2], offense: line.slice(a.index + a[0].length).trim() };
    } else if (NAME_START.test(line)) {
      // Start of a new defendant whose structural fields are on a later (wrapped) line.
      flush();
      pendingName = `${pendingName} ${line}`.replace(/\s+/g, ' ').trim();
    } else if (cur) {
      // Offense continuation line.
      cur.offense = `${cur.offense} ${line}`.trim();
    }
    // else: stray line before any record begins — ignore.
  }
  flush();

  const hits: RawWarrantHit[] = [];
  const seen = new Set<string>();
  for (const rec of records) {
    try {
      const hit = buildHit(layout, rec, sourceKey, state);
      if (!hit) continue;
      if (seen.has(hit.warrant_id)) continue;
      seen.add(hit.warrant_id);
      hits.push(hit);
    } catch {
      continue;
    }
  }
  return hits;
}
