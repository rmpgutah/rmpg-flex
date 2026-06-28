/**
 * Zuercher/CentralSquare public-warrant PDF parser.
 *
 * Supports two layouts, detected automatically from the PDF header:
 *
 *  McKenzie ND (8-column):
 *    Date Issued | Warrant Number | OCA # | Last, First Name | Charges | Bond | Extradition | Status
 *    Columns are whitespace-separated on a single flat string after unpdf extraction.
 *    Record anchor: "MM/DD/YY Wxx-##### digits " at the start of each row.
 *
 *  Codington SD (4-column):
 *    Last, First Name | Charges | Bond | Date Issued
 *    No warrant number field; records are delimited by the trailing date.
 *
 * Both layouts are supported by other Zuercher-platform counties
 * (Harrison OH, Tuscarawas OH, etc.) with the same column sets.
 *
 * Robustness contract: never throw; return [] on empty/unrecognised input.
 * A valid row requires at minimum a non-empty name.
 */

import type { RawWarrantHit } from '../types';
import { cleanName, normalizeDate, normalizeBond } from '../normalize';
import { deriveWarrantId } from './socrata';
import {
  detectZuercherLayout,
  splitMcKenzieRecords,
  splitCodingtonRecords,
  type ZuercherRawRecord,
} from './pdfTable';

// ---------------------------------------------------------------------------
// Name parsing helpers
// ---------------------------------------------------------------------------

/** Split "LAST, FIRST MIDDLE" (or "Last, First Middle") into parts. */
function parseName(raw: string): {
  last_name: string | null;
  first_name: string | null;
  middle_name: string | null;
  full_name: string;
} {
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  if (!trimmed) return { last_name: null, first_name: null, middle_name: null, full_name: '' };

  const commaIdx = trimmed.indexOf(',');
  if (commaIdx === -1) {
    return { last_name: cleanName(trimmed), first_name: null, middle_name: null, full_name: cleanName(trimmed) };
  }

  const last = cleanName(trimmed.slice(0, commaIdx).trim()) || null;
  const rest = trimmed.slice(commaIdx + 1).trim();
  const parts = rest ? rest.split(/\s+/) : [];
  const first = parts.length > 0 ? cleanName(parts[0]) : null;
  const middle = parts.length > 1 ? cleanName(parts.slice(1).join(' ')) : null;

  const fullParts = [last, [first, middle].filter(Boolean).join(' ')].filter(Boolean);
  const full_name = cleanName(fullParts.join(', '));

  return { last_name: last, first_name: first, middle_name: middle, full_name };
}

// ---------------------------------------------------------------------------
// Date normalization — extends normalizeDate to handle 2-digit years
// ---------------------------------------------------------------------------

/** Normalise a Zuercher date string.  The PDF uses M/D/YY (2-digit year) format
 *  in some counties (McKenzie ND).  `normalizeDate` from ../normalize only handles
 *  4-digit years, so we expand 2-digit years to 4-digit before delegating. */
function parseZuercherDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  // Expand M/D/YY → M/D/20YY (Zuercher warrant dates are always modern)
  const twoDigit = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(s);
  if (twoDigit) {
    return normalizeDate(`${twoDigit[1]}/${twoDigit[2]}/20${twoDigit[3]}`);
  }
  return normalizeDate(s);
}

// ---------------------------------------------------------------------------
// Bond normalization
// ---------------------------------------------------------------------------

/** Normalize Zuercher-style bond strings.
 *  "No Bond", "Bond", "Bond set", "Hold without", "PR", "PTA..." → null.
 *  Numeric amounts with optional parenthesized qualifiers → dollar number.
 *  Always returns null (never undefined) so callers can assign bail_amount: null. */
function parseBond(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim();
  // Text-only values that mean "no fixed amount"
  if (/^(?:No Bond|Bond(?: set(?:\s+at:)?)?|Hold without|PR|PTA|Other)/i.test(s)) return null;
  return normalizeBond(s) ?? null;
}

// ---------------------------------------------------------------------------
// Core mapping: ZuercherRawRecord → RawWarrantHit
// ---------------------------------------------------------------------------

function mapRecord(rec: ZuercherRawRecord, sourceKey: string, state: string): RawWarrantHit | null {
  const { last_name, first_name, middle_name, full_name } = parseName(rec.name_raw);
  if (!full_name) return null;

  const issue_date = parseZuercherDate(rec.date) ?? undefined;
  const bail_amount = parseBond(rec.bond_raw);  // null means "no fixed amount"
  const charge_description = rec.charges_raw?.trim() || undefined;

  // Warrant ID: prefer the explicit warrant number (McKenzie), else derive from name+date
  const warrant_id = rec.warrant_number?.trim()
    || deriveWarrantId([full_name, rec.oca_number, issue_date ?? rec.date]);

  return {
    source_key: sourceKey,
    warrant_id,
    first_name,
    middle_name,
    last_name,
    full_name,
    state,
    charge_description,
    bail_amount,
    issue_date,
    case_number: rec.oca_number?.trim() || undefined,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a Zuercher/CentralSquare warrant-list PDF text (extracted via unpdf)
 * into `RawWarrantHit` records.
 *
 * @param text       Full extracted text from the PDF (single flat string).
 * @param sourceKey  Source key for the output records (e.g. "pdf-zuercher-mckenzie-nd").
 * @param state      Two-letter state code (e.g. "ND", "SD", "OH").
 */
export function parseZuercherPdf(text: string, sourceKey: string, state: string): RawWarrantHit[] {
  if (!text || typeof text !== 'string') return [];

  const layout = detectZuercherLayout(text);
  if (!layout) return [];

  const rawRecords = layout === 'mckenzie'
    ? splitMcKenzieRecords(text)
    : splitCodingtonRecords(text);

  const hits: RawWarrantHit[] = [];
  const seen = new Set<string>();

  for (const rec of rawRecords) {
    try {
      const hit = mapRecord(rec, sourceKey, state);
      if (!hit) continue;
      if (seen.has(hit.warrant_id)) continue;
      seen.add(hit.warrant_id);
      hits.push(hit);
    } catch {
      // Skip malformed individual records; never abort the whole parse.
      continue;
    }
  }

  return hits;
}
