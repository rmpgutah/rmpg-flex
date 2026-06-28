/**
 * Texas-municipal court warrant-list PDF parser (CivicPlus DocumentCenter PDFs).
 *
 * These rosters are all-caps for BOTH names and offenses, so the flat
 * (mergePages:true) text stream gives no reliable name/offense boundary. The
 * adapter therefore fetches with `{ lines: true }` (mergePages:false), which
 * preserves pdf.js row newlines, and this parser reconstructs logical records
 * from the line structure.
 *
 * The strong, unambiguous signal per row is the structural-field group: a date +
 * balance (Killeen), a warrant-number + balance (Bell Mead), or a date + citation
 * (Taylor). Offenses never contain that group, so each match anchors one record.
 * Around each anchor:
 *   - The defendant NAME is the text before the fields, completed by pulling back
 *     preceding buffered lines until the name contains its "LAST," comma (long
 *     names wrap onto their own line ahead of the anchor line). This avoids ever
 *     mistaking an all-caps, comma-bearing OFFENSE fragment (e.g. "ALLEY, BLDG")
 *     for a defendant name.
 *   - The OFFENSE is the text after the fields on the anchor line plus any
 *     following continuation lines, minus lines pulled back into the next name.
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

/** Per-layout anchor: matches the structural field group within a line.
 *  Group 1 / 2 are the captured fields; match.index marks where the name ends. */
const ANCHOR: Record<TxLayout, RegExp> = {
  // DATE  BALANCE   (name before, offense after)
  killeen: new RegExp(`(${DATE})\\s+(${MONEY})`),
  // WARRANTNO  BALANCE  (warrant no: optional leading letter, a digit, alnum, optional " NN"; never a decimal)
  bellmead: new RegExp(`([A-Z]?\\d[A-Z0-9]*(?:\\s\\d{2})?)\\s+(${MONEY})`),
  // DATE  CITATIONNO  (offense + trailing balance follow)
  taylor: new RegExp(`(${DATE})\\s+([A-Z0-9]+)`),
};

/** Repeated page headers / banners / footers to drop entirely (full-line, anchored). */
const BOILERPLATE = /^(?:WARRANT LIST|Defendant Name\b|AS OF \d|ACTIVE WARRANT LISTING\b|[A-Z][A-Z' .\-]* MUNICIPAL COURT\s*$|Page \d+(?: of \d+)?\s*$|\d+ of \d+\s*$)/i;

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

interface RawRecord { name: string; field1: string; field2: string; offenseParts: string[]; }

function buildHit(layout: TxLayout, rec: RawRecord, sourceKey: string, state: string): RawWarrantHit | null {
  const { last_name, first_name, middle_name, full_name } = splitName(rec.name);
  if (!full_name) return null;

  const offenseRaw = rec.offenseParts.join(' ');
  let issue_date: string | null = null;
  let case_number: string | undefined;
  let bail_amount: number | null = null;
  let charge: string | null;
  let ref: string | undefined;

  if (layout === 'taylor') {
    issue_date = normalizeDate(rec.field1);
    case_number = rec.field2?.trim() || undefined;
    ref = case_number;
    const bm = TAYLOR_TRAILING_BALANCE.exec(offenseRaw);
    bail_amount = bm ? normalizeBond(bm[1]) : null;
    charge = cleanCharge(bm ? offenseRaw.slice(0, bm.index) : offenseRaw);
  } else if (layout === 'bellmead') {
    case_number = rec.field1?.replace(/\s+/g, ' ').trim() || undefined;
    ref = case_number;
    bail_amount = normalizeBond(rec.field2);
    charge = cleanCharge(offenseRaw);
  } else {
    // killeen
    issue_date = normalizeDate(rec.field1);
    bail_amount = normalizeBond(rec.field2);
    charge = cleanCharge(offenseRaw);
    ref = rec.field1; // date — id-derivation input only
  }

  // Same defendant repeats per offense; fold the charge AND balance into the id so
  // distinct warrants (same name/date/charge, different balance) stay separate while
  // true duplicate rows still collapse.
  const warrant_id = deriveWarrantId([full_name, ref, charge, bail_amount == null ? '' : String(bail_amount)]);

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
  const lines = text.split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(l => l && !BOILERPLATE.test(l));

  const records: RawRecord[] = [];
  let cur: RawRecord | null = null;
  let buffer: string[] = []; // non-anchor lines since the last anchor (offense + any wrapped next-name)

  for (const line of lines) {
    const a = anchor.exec(line);
    if (a && a.index >= 0) {
      // The name is the text before the fields, completed by pulling back buffered
      // lines until it contains its "LAST," comma (handles names that wrap above the
      // anchor line). Whatever remains in the buffer is the previous record's offense.
      const before = line.slice(0, a.index).trim();
      const nameParts = before ? [before] : [];
      while (!nameParts.join(' ').includes(',') && buffer.length > 0) {
        nameParts.unshift(buffer.pop() as string);
      }
      if (cur) { cur.offenseParts.push(...buffer); records.push(cur); }
      buffer = [];
      const name = nameParts.join(' ').replace(/\s+/g, ' ').trim();
      const head = line.slice(a.index + a[0].length).trim();
      cur = { name, field1: a[1], field2: a[2], offenseParts: head ? [head] : [] };
    } else {
      buffer.push(line); // offense continuation, or a wrapped name awaiting its anchor
    }
  }
  if (cur) { cur.offenseParts.push(...buffer); records.push(cur); }

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
