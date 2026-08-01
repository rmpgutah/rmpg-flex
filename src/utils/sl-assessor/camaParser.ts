// src/utils/sl-assessor/camaParser.ts
//
// Parses the Salt Lake County Assessor's "More Details Report"
// (PubMore/detail.cfm) plus its land-record continuation page
// (PubMore/landRecord2.cfm) into the full CAMA field set defined in
// camaFields.ts.
//
// Pure functions only — no fetch, no env, no DB. The client owns retrieval;
// this module owns interpretation, so every branch is unit-testable against
// the captured fixtures in tests/fixtures/sl-assessor/.
//
// ── Why a second parser instead of extending parser.ts ───────────────────
// parser.ts targets `valuationInfoExpanded.cfm`, whose residence block is
// rendered as value-BEFORE-label <div>s and whose land block is a
// transposed <th>/<td> table. Its `pullByLabel` helper assumes
// `<td>Label</td><td>Value</td>` and structurally cannot read either. Rather
// than overload one regex helper with three incompatible layouts, each
// rendering gets a parser that matches how it is actually built.
//
// ── Source-of-truth split (verified live 2026-08-01) ─────────────────────
// Neither page alone is complete:
//
//   PubMore/detail.cfm     ALL 54 residence + 21 parcel + 21 valuation
//                          fields, values DECODED — but only land record
//                          1 of N, and its value history omits taxable value.
//   PubMore/landRecord2.cfm EVERY land record (transposed columns), values
//                          prefixed with the raw code ("R-RESIDENTIAL").
//   valuationInfoExpanded  Taxable value per history year.
//
// So a full build merges them. mergeCama() below is that merge, and it is
// deliberately additive: a later source may FILL a null but must never
// overwrite a value an earlier, richer source already provided.

import {
  SECTION_INDEX, LAND_FIELDS, CODE_SECTION_TO_SECTION, normalizeLabel,
  type CamaField, type CamaSection, type CamaType,
} from './camaFields';
import { AssessorParseError } from './types';

// ── Primitives ───────────────────────────────────────────────────────────

/** Strip tags + entities + collapse whitespace. */
export function stripTags(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#8217;|&rsquo;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Coerce a raw cell to its declared type.
 *
 * Returns null for blanks AND for the county's placeholder strings. The
 * assessor renders "not set", "UnAv." and a bare "-" for absent values;
 * without this they would land in D1 as literal text in a numeric column,
 * where SQLite's type affinity silently stores the string and every
 * downstream comparison misbehaves.
 */
export function coerce(raw: string | null | undefined, type: CamaType): string | number | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (!s || s === '-' || /^(not set|unav\.?|n\/a|none given)$/i.test(s)) return null;
  if (type === 'text') return s;
  // Strip currency, thousands separators, and stray percent signs before
  // parsing. "$          85,400" and "$ 0" both occur verbatim on the page.
  const cleaned = s.replace(/[$,%\s]/g, '');
  if (!cleaned || !/^[-+]?\d*\.?\d+$/.test(cleaned)) return null;
  const n = type === 'int' ? parseInt(cleaned, 10) : parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * The land-record continuation page prefixes decoded values with their raw
 * code: "R-RESIDENTIAL", "PL-PRIMARY-LOT", "IN-INTERIOR". The main report
 * shows the decoded half only, so strip the prefix to keep both sources
 * writing identical values into the same column.
 *
 * ⚠️ APPLY THIS ONLY TO landRecord2.cfm — never to the main report.
 *
 * There is NO shape-based rule that can tell a code prefix from a value
 * that merely starts with a short hyphenated token, because the county's
 * own vocabulary contains both. "ROW-END-TOWN" is a real, complete building
 * style; a heuristic strip turns it into "END-TOWN". So do not try to
 * detect prefixes — know which page you are parsing. The main report never
 * emits them, the continuation page always does.
 *
 * Within the continuation page the rule is unambiguous: 1-3 uppercase
 * alphanumerics, a hyphen, then a decoded label. The tail guard still
 * exists so a numeric value like a doc number "10030-5248" is left alone.
 */
export function stripCodePrefix(value: string): string {
  const m = value.match(/^([A-Z0-9]{1,3})-(.{2,})$/);
  if (!m) return value;
  if (!/^[A-Z][A-Z0-9 /-]*$/.test(m[2])) return value;
  return m[2];
}

// ── Row scanning ─────────────────────────────────────────────────────────

export interface RawRow {
  /** Section inferred from the row's newwin() code, when it has one. */
  codeSection: CamaSection | null;
  label: string;
  /** Every value cell after the label — 1 for a normal row, N for the
   *  transposed land table (one column per land record). */
  values: string[];
}

/**
 * Split an HTML fragment into label/value rows.
 *
 * Rows are matched non-greedily on `<tr>` and tolerate the county's
 * malformed markup — the page emits stray `</tr bgcolor="#F4F4F4">` closers
 * and unclosed `</td>` on several rows, which is why this splits on the
 * OPENING tags rather than requiring well-formed pairs.
 */
/** Drop the remainder of a split-on tag (its attributes + closing `>`). */
function dropTagRemainder(chunk: string): string {
  const gt = chunk.indexOf('>');
  return gt < 0 ? chunk : chunk.slice(gt + 1);
}

export function scanRows(html: string): RawRow[] {
  const out: RawRow[] = [];
  // Split on opening <tr> so an unclosed row doesn't swallow the rest.
  const chunks = html.split(/<tr\b/i).slice(1);
  for (const chunk of chunks) {
    // Cells: split on opening <td>/<th>, drop the pre-first-cell remainder.
    // dropTagRemainder is essential — splitting on the tag NAME leaves that
    // tag's own attributes at the head of the cell, so a cell would read
    // `align="right"> ROW-END-TOWN` instead of `ROW-END-TOWN`.
    const cells = chunk.split(/<t[dh]\b/i).slice(1).map((c) => stripTags(dropTagRemainder(c)));
    if (cells.length < 2) continue;
    const label = cells[0];
    if (!label) continue;
    const m = chunk.match(/newwin\('([^']*)'\s*,\s*'[^']*'\s*,\s*'([^']*)'\)/);
    const codeSection = m ? (CODE_SECTION_TO_SECTION[m[1]] ?? null) : null;
    out.push({ codeSection, label, values: cells.slice(1) });
  }
  return out;
}

/** Section header rows carry the block name in a highlighted cell. */
const SECTION_HEADERS: Array<[RegExp, CamaSection]> = [
  [/^residence record/i, 'residence'],
  [/^parcel record/i, 'parcel'],
  [/^valuation\b/i, 'valuation'],
  [/^land record/i, 'land'],
];

function headerSection(label: string): CamaSection | null {
  for (const [re, sec] of SECTION_HEADERS) if (re.test(label)) return sec;
  return null;
}

// ── Parsed shape ─────────────────────────────────────────────────────────

export type FieldMap = Record<string, string | number | null>;

export interface CamaParcel {
  parcel_number: string | null;
  owner_of_record: string | null;
  situs_address: string | null;
  latitude: number | null;
  longitude: number | null;
  legal_description: string | null;
  /** The county's own "CAMA data as it was on <date>" stamp. */
  cama_as_of: string | null;
  cama_source_variant: string;
  residence: FieldMap;
  /** parcel + valuation fields, already `par_`/`val_` prefixed. */
  parcel: FieldMap;
  land_records: FieldMap[];
  value_history: Array<Record<string, string | number | null>>;
  /** Every label/value seen, including ones no registry entry claimed —
   *  the forward-compat catch-all so a newly added county field is visible
   *  in the data before anyone edits camaFields.ts. */
  raw_data_json: Record<string, string>;
  /** Labels the page rendered that the registry does not know about.
   *  Surfaced so tests can assert the registry stays complete. */
  unmapped_labels: string[];
}

function emptyParcel(variant: string): CamaParcel {
  return {
    parcel_number: null, owner_of_record: null, situs_address: null,
    latitude: null, longitude: null, legal_description: null,
    cama_as_of: null, cama_source_variant: variant,
    residence: {}, parcel: {}, land_records: [], value_history: [],
    raw_data_json: {}, unmapped_labels: [],
  };
}

const PARCEL_NO_RE = /(\d{2}-\d{2}-\d{3}-\d{3}(?:-\d{4})?)/;
const PARCEL_NO_FLAT_RE = /\b(\d{14})\b/;

/** Normalize either rendering of the parcel id to the dashed 14-digit form. */
export function normalizeParcelNumber(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 14) {
    return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 7)}-${digits.slice(7, 10)}-${digits.slice(10)}`;
  }
  if (digits.length === 10) {
    // 10-digit ids address a BLOCK, not a parcel. Pad the encumbrance
    // suffix — the county's own detail page 200s with the search form when
    // handed 10 digits, so an un-padded id fails SILENTLY (see client.ts).
    return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 7)}-${digits.slice(7, 10)}-0000`;
  }
  return null;
}

// ── Main report parser ───────────────────────────────────────────────────

/**
 * Parse PubMore/detail.cfm.
 *
 * Throws AssessorParseError when the page is not a parcel report at all.
 * That check matters more than it looks: requesting a bad parcel id returns
 * HTTP 200 with the SEARCH FORM, so "no error" is not evidence of success.
 */
export function parseCamaDetail(html: string): CamaParcel {
  if (!html || html.length < 500) {
    throw new AssessorParseError('CAMA detail page too short', html?.slice(0, 200));
  }
  const out = emptyParcel('PubMore/detail.cfm');

  // Guard: the search-form fallback. It has no Residence Record block.
  if (!/residence record|parcel record/i.test(html)) {
    throw new AssessorParseError(
      'not a parcel detail page — the assessor returned the search form, ' +
      'which it does for an unknown or 10-digit parcel id',
      stripTags(html).slice(0, 300),
    );
  }

  const rows = scanRows(html);
  let current: CamaSection | null = null;
  let landRecord: FieldMap = {};

  for (const row of rows) {
    const hdr = headerSection(row.label);
    if (hdr) {
      // Starting the land block: flush any land record already accumulated.
      if (current === 'land' && Object.keys(landRecord).length) {
        out.land_records.push(landRecord);
        landRecord = {};
      }
      current = hdr;
      // "Parcel Record | 16311270290000" — the id rides on the header row.
      if (hdr === 'parcel' && row.values[0]) {
        out.parcel_number = normalizeParcelNumber(row.values[0]) ?? out.parcel_number;
      }
      continue;
    }

    // A row's own newwin() section beats the running header — the report
    // interleaves blocks across three table columns, so header order alone
    // mis-assigns rows once the layout wraps.
    const section = row.codeSection ?? current;
    const value = row.values[0] ?? '';
    if (row.label && value) out.raw_data_json[row.label] = value;

    // Un-sectioned summary rows.
    if (/^owner$/i.test(row.label)) { out.owner_of_record = value || null; continue; }
    if (/^address$/i.test(row.label)) { out.situs_address = value || null; continue; }
    if (/^record id$/i.test(row.label)) {
      if (Object.keys(landRecord).length) { out.land_records.push(landRecord); landRecord = {}; }
      landRecord.record_id = coerce(value, 'int');
      continue;
    }

    if (!section) continue;
    const field = SECTION_INDEX[section].get(normalizeLabel(row.label));
    if (!field) {
      // A 4-digit label is a Value History year row, parsed separately by
      // parseValueHistory(); it is not an unmapped field.
      if (row.label && !headerSection(row.label) && !/^(19|20)\d{2}$/.test(row.label.trim())) {
        out.unmapped_labels.push(`${section}:${row.label}`);
      }
      continue;
    }
    // NOT stripCodePrefix() — the main report emits fully decoded values,
    // and "ROW-END-TOWN" would be truncated to "END-TOWN" by a prefix strip.
    const coerced = coerce(value, field.type);
    if (section === 'residence') out.residence[field.col] = coerced;
    else if (section === 'land') landRecord[field.col] = coerced;
    else out.parcel[field.col] = coerced;   // parcel + valuation share the target
  }
  if (Object.keys(landRecord).length) out.land_records.push(landRecord);

  out.latitude = parseCoordinate(html, 'polyx');
  out.longitude = parseCoordinate(html, 'polyy');
  out.legal_description = parseLegalDescription(html);
  out.cama_as_of = parseCamaAsOf(html);
  out.value_history = parseValueHistory(html);

  if (!out.parcel_number) {
    const m = html.match(PARCEL_NO_RE) ?? html.match(PARCEL_NO_FLAT_RE);
    if (m) out.parcel_number = normalizeParcelNumber(m[1]);
  }
  return out;
}

/**
 * Coordinates live in `<var id="polyx" hidden="true">40.694540870</var>`.
 * Note the county's naming is inverted from the usual convention: polyx
 * holds LATITUDE and polyy holds LONGITUDE (confirmed against the parcel's
 * own Google Maps link, which emits `q=40.69454,-111.88209`). Do not
 * "correct" the mapping to x=longitude — that would place every Salt Lake
 * County parcel in the Indian Ocean.
 */
export function parseCoordinate(html: string, id: 'polyx' | 'polyy'): number | null {
  const m = html.match(new RegExp(`<var[^>]*id=["']?${id}["']?[^>]*>([^<]+)</var>`, 'i'))
    ?? html.match(new RegExp(`${id}=([-\\d.]+)`, 'i'));
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** "This page shows the assessor's CAMA data, as it was, on May 22, 2026." */
export function parseCamaAsOf(html: string): string | null {
  const m = stripTags(html).match(/as it was,?\s*on\s+([A-Z][a-z]+ \d{1,2},? \d{4})/i);
  return m ? m[1].replace(/,\s*/, ', ') : null;
}

/** The legal description sits in a plain div, not a key/value table. */
export function parseLegalDescription(html: string): string | null {
  const idx = html.search(/legal\s*desc(?:ription|ription)?/i);
  if (idx < 0) return null;
  const tail = stripTags(html.slice(idx, idx + 1200));
  const m = tail.match(/legal\s*description\s*(?:\d{2}-\d{2}-\d{3}-\d{3}-\d{4})?\s*(.+?)(?:\s*(?:click here|search again|above grade)|$)/i);
  const text = m ? m[1].trim() : null;
  return text && text.length > 3 ? text : null;
}

/**
 * Value History is a 6-column table (year, record id, land, building,
 * market/final, tax rate) — a shape no key/value helper can read, which is
 * why it was previously not captured at all.
 */
export function parseValueHistory(html: string): Array<Record<string, string | number | null>> {
  const idx = html.search(/value\s*history/i);
  if (idx < 0) return [];
  const tail = html.slice(idx);
  const out: Array<Record<string, string | number | null>> = [];
  for (const row of scanRows(tail)) {
    // A history row's label is a 4-digit tax year; everything else is
    // header chrome or a neighbouring block.
    if (!/^(19|20)\d{2}$/.test(row.label.trim())) continue;
    const v = row.values;
    out.push({
      tax_year: coerce(row.label, 'int'),
      record_id: coerce(v[0], 'int'),
      land_value: coerce(v[1], 'int'),
      building_value: coerce(v[2], 'int'),
      market_value: coerce(v[3], 'int'),
      // Column 5 is taxable value on valuationInfoExpanded and tax rate on
      // PubMore. Disambiguate by magnitude: a tax rate is a sub-1 decimal
      // (".0112070"), a taxable value is a whole dollar figure.
      ...classifyHistoryTail(v[4], v[5]),
    });
    if (out.length >= 40) break;
  }
  return out;
}

/**
 * The value-history table is malformed on the county's own page — it closes
 * with `</table></tbody>` and the "*before Board of Equalization" footnote
 * sits INSIDE the final cell. So the LAST row's last cell reads
 * "$ 171,435 * before Board of Equalization ...", which coerces to null.
 * Take the leading numeric token rather than the whole cell.
 */
function leadingNumericToken(cell: string): string | null {
  const m = cell.trim().match(/^[$\s]*(\.?\d[\d,]*(?:\.\d+)?)/);
  return m ? m[1] : null;
}

function classifyHistoryTail(a?: string, b?: string): Record<string, string | number | null> {
  const res: Record<string, string | number | null> = { taxable_value: null, tax_rate: null };
  for (const cell of [a, b]) {
    if (!cell) continue;
    const s = leadingNumericToken(cell) ?? cell.trim();
    if (!s) continue;
    if (/^\.?0*\.\d+$|^0?\.\d+$/.test(s.replace(/\s/g, ''))) res.tax_rate = s;
    else if (/\d/.test(s)) res.taxable_value = coerce(s, 'int');
  }
  return res;
}

// ── Land-record continuation page ────────────────────────────────────────

/**
 * Parse PubMore/landRecord2.cfm, which renders EVERY land record as a
 * transposed table: `<td>Label</td><td>record 1</td><td>record 2</td>…`.
 *
 * This is the page the old parser's shape could not represent — it read
 * only the first value cell, so a parcel with two land records lost one
 * with no error and no log line.
 */
export function parseLandRecords(html: string): FieldMap[] {
  if (!html || !/land record/i.test(html)) return [];
  const byLabel = new Map<string, CamaField>();
  for (const f of LAND_FIELDS) byLabel.set(normalizeLabel(f.label), f);

  const records: FieldMap[] = [];
  const ensure = (i: number): FieldMap => {
    while (records.length <= i) records.push({});
    return records[i];
  };

  for (const row of scanRows(html)) {
    const norm = normalizeLabel(row.label);
    if (norm === 'record id') {
      row.values.forEach((v, i) => { ensure(i).record_id = coerce(v, 'int'); });
      continue;
    }
    const field = byLabel.get(norm);
    if (!field) continue;
    row.values.forEach((v, i) => {
      const val = coerce(field.type === 'text' ? stripCodePrefix(v) : v, field.type);
      if (val != null) ensure(i)[field.col] = val;
    });
  }
  // Drop trailing all-empty columns — the table pads to a fixed width.
  while (records.length && Object.keys(records[records.length - 1]).length === 0) records.pop();
  return records;
}

/** Pull the landRecord2.cfm continuation URL out of the main report. */
export function extractLandRecordUrl(html: string): string | null {
  const m = html.match(/href="(landRecord2\.cfm\?[^"]+)"/i);
  return m ? m[1].replace(/&amp;/g, '&') : null;
}

// ── Merge ────────────────────────────────────────────────────────────────

/**
 * Fold a secondary source into a primary parse.
 *
 * FILL-ONLY, by the same reasoning as the CarsXE vehicle bridge: the richer
 * source wins, and a later page may only populate a field the earlier one
 * left null. Making this last-write-wins would let the code-prefixed,
 * lower-fidelity land page overwrite decoded values from the main report.
 */
export function mergeCama(primary: CamaParcel, extra: Partial<CamaParcel>): CamaParcel {
  const out: CamaParcel = { ...primary };

  for (const key of ['parcel_number', 'owner_of_record', 'situs_address',
    'legal_description', 'cama_as_of'] as const) {
    if (out[key] == null && extra[key] != null) (out as any)[key] = extra[key];
  }
  for (const key of ['latitude', 'longitude'] as const) {
    if (out[key] == null && extra[key] != null) out[key] = extra[key]!;
  }
  for (const block of ['residence', 'parcel'] as const) {
    const src = extra[block];
    if (!src) continue;
    out[block] = { ...out[block] };
    for (const [k, v] of Object.entries(src)) {
      if (out[block][k] == null && v != null) out[block][k] = v;
    }
  }
  // Land records: the continuation page is authoritative on COUNT (the main
  // report only ever shows record 1), so more records replaces fewer, and
  // the main report's decoded values are folded back in per record.
  if (extra.land_records && extra.land_records.length > out.land_records.length) {
    out.land_records = extra.land_records.map((rec, i) => {
      const prior = out.land_records[i] ?? {};
      const merged: FieldMap = { ...rec };
      for (const [k, v] of Object.entries(prior)) if (v != null) merged[k] = v;
      return merged;
    });
  }
  // Value history: fill taxable_value per year from the secondary source.
  if (extra.value_history?.length) {
    const byYear = new Map(extra.value_history.map((r) => [r.tax_year, r]));
    out.value_history = out.value_history.length
      ? out.value_history.map((r) => {
          const o = byYear.get(r.tax_year);
          if (!o) return r;
          const merged = { ...r };
          for (const [k, v] of Object.entries(o)) if (merged[k] == null && v != null) merged[k] = v;
          return merged;
        })
      : extra.value_history;
  }
  if (extra.raw_data_json) {
    out.raw_data_json = { ...extra.raw_data_json, ...out.raw_data_json };
  }
  return out;
}
