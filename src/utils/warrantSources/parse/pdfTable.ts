/**
 * Generic helper for parsing Zuercher/CentralSquare public-warrant PDFs.
 *
 * `unpdf` with mergePages:true collapses all page text into a single flat
 * string.  These reports are two-level:
 *   1. A one-line preamble/header per page (stripped away).
 *   2. A sequence of data records whose field delimiters are implicit (whitespace)
 *      rather than character-aligned columns.
 *
 * Parsing strategy: strip repeated page-header boilerplate, then hand the
 * clean body to the caller via two utilities:
 *
 *  - `splitMcKenzieRecords`  — McKenzie ND (8-column) layout.
 *    Anchor: each record starts with "MM/DD/YY Wxx-##### digits ".
 *    Fields per record: date, warrant#, OCA#, body(name + charges + bond + extr + status).
 *
 *  - `splitCodingtonRecords` — Codington SD (4-column) layout.
 *    Anchor: each record ends with "MM/DD/YY " followed by the next name.
 *    Fields per record: body(name + charges + bond), date.
 *
 * Both return plain `ZuercherRecord` objects that `pdfZuercher.ts` maps to
 * `RawWarrantHit`s.
 */

export interface ZuercherRawRecord {
  /** Raw date string from the PDF (M/D/YY or M/D/YYYY). */
  date: string;
  /** Warrant number (McKenzie only; undefined for Codington). */
  warrant_number?: string;
  /** OCA / incident number (McKenzie only). */
  oca_number?: string;
  /** Raw name string as extracted — "LAST, FIRST" or "Last, First". */
  name_raw: string;
  /** Raw charge description text. */
  charges_raw: string | null;
  /** Raw bond string before normalization. */
  bond_raw: string | null;
  /** Extradition scope text (McKenzie only). */
  extradition?: string;
}

// ---------------------------------------------------------------------------
// McKenzie ND — 8-column layout
// ---------------------------------------------------------------------------

/** Page-header pattern for the McKenzie layout.
 *  Page 1:  "Page N of N Active Warrants Printed on Month DD, YYYY Date Issued..."
 *  Page 2+: "Page N of N Date Issued Warrant Number OCA # Last, First Name Charges Bond Extradition Status" */
const MCKENZIE_PAGE_HDR = /Page \d+ of \d+ (?:Active Warrants )?(?:Printed on [A-Za-z]+ \d+, \d+ )?Date Issued Warrant Number OCA # Last, First Name Charges Bond Extradition Status /g;

/** Extradition + status at end of a McKenzie body string. Extradition scope varies
 *  by county: "<State> Only" / "<State>," for in-state-only, and the full
 *  "Continental United States" (and bare "Continental United") for nationwide
 *  pickup on the out-of-state Zuercher counties (Tuscarawas/Harrison OH, etc.). */
const MCKENZIE_EXTR_STATUS = /\s+([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)? Only|[A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)?,|Continental United States|Continental United|Surrounding States|Nationwide|Statewide|Special)\s+(Active|Inactive|Recalled|Cleared)\s*$/;

/** Bond value just before the extradition phrase.
 *  Covers: numeric amounts, "No Bond", "Bond", "Bond set [at:]", "Hold without", "PR", "Other".
 *  Word boundaries on the bare-word variants so a charge ending in "…Bond" isn't truncated. */
const MCKENZIE_BOND = /(?:[\d][\d,]*(?:\.\d{1,2})?(?:\s*\([A-Za-z][^)]*\))?|\bNo Bond\b|Bond set(?: at:)?|\bBond\b|Hold without|\bPR\b|PTA[^\s]*|\bOther\b)\s*$/i;

/** The charge-code prefix that separates the name from the charge text (e.g. "12.1-", "39-", "5-01-"). */
const CHARGE_CODE_START = /\s+(?=\d[\d.-]{2,}[- ])/;

function parseMcKenzieBody(body: string): Pick<ZuercherRawRecord, 'name_raw' | 'charges_raw' | 'bond_raw' | 'extradition'> {
  const esm = MCKENZIE_EXTR_STATUS.exec(body);
  if (!esm) {
    // No extradition+status tail recognised. unpdf collapses the PDF to one flat,
    // single-space string, so there's no reliable name/charge delimiter without the
    // tail anchor — emitting the whole blob as a name would corrupt the record (an
    // officer-safety hazard). Return an empty name so splitMcKenzieRecords drops it.
    return { name_raw: '', charges_raw: null, bond_raw: null };
  }
  const extradition = esm[1]?.trim();
  const beforeExtr = body.slice(0, esm.index).trim();

  // Find bond at end of beforeExtr
  const bm = MCKENZIE_BOND.exec(beforeExtr);
  const bond_raw = bm ? bm[0].trim() : null;
  const nameCharges = bm ? beforeExtr.slice(0, bm.index).trim() : beforeExtr;

  // Split name from charges: name ends at the first charge-code token
  const nm = CHARGE_CODE_START.exec(nameCharges);
  let name_raw: string;
  let charges_raw: string | null;
  if (nm) {
    name_raw = nameCharges.slice(0, nm.index).trim();
    charges_raw = nameCharges.slice(nm.index).trim() || null;
  } else {
    name_raw = nameCharges;
    charges_raw = null;
  }

  return { name_raw, charges_raw, bond_raw, extradition };
}

/** Split a McKenzie-layout text into raw warrant records. */
export function splitMcKenzieRecords(text: string): ZuercherRawRecord[] {
  const clean = text.replace(MCKENZIE_PAGE_HDR, '').replace(/Total Records:\s*\d+\s*$/, '').trim();

  // Split on record-start anchors using a capturing split so we recover the groups
  const anchorRe = /(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(W\d{2,4}-\d+)\s+(\d+)\s+/g;
  const anchorParts = clean.split(anchorRe);
  // anchorParts layout: [pre, date, warrant, oca, body, date, warrant, oca, body, ...]
  // Each record occupies 4 elements starting at index 1.

  const records: ZuercherRawRecord[] = [];
  let i = 1;
  while (i + 3 < anchorParts.length) {
    const date = anchorParts[i] ?? '';
    const warrant_number = anchorParts[i + 1] ?? '';
    const oca_number = anchorParts[i + 2] ?? '';
    const body = (anchorParts[i + 3] ?? '').trim();
    i += 4;

    if (!body) continue;
    const parsed = parseMcKenzieBody(body);
    if (!parsed.name_raw) continue;

    records.push({ date, warrant_number, oca_number, ...parsed });
  }
  return records;
}

// ---------------------------------------------------------------------------
// Codington SD — 4-column layout (Last, First Name | Charges | Bond | Date Issued)
// ---------------------------------------------------------------------------

/** Page-header pattern for the Codington layout. */
const CODINGTON_PAGE_HDR = /Page \d+ of \d+ (?:Warrants )?(?:Printed on [A-Za-z]+ \d+, \d+ )?Last, First Name Charges Bond Date Issued /g;

/** Record split point: a date followed by the start of the next name.
 *  Codington names always start with an uppercase letter followed by a lowercase
 *  letter or hyphen (title-case "Smith," or hyphenated "Al-Baidhani,"). */
const CODINGTON_RECORD_SPLIT = /(\d{2}\/\d{2}\/\d{2,4})\s+(?=[A-Z][a-zA-Z])/g;

/** Bond value at end of a Codington body (before the date which is already stripped). */
const CODINGTON_BOND = /(?:[\d][\d,]*(?:\.\d{1,2})?(?:\s*\([A-Za-z/][^)]*\))?|No Bond|PR|Hold without|Other)\s*$/i;

function parseCodingtonBody(body: string): Pick<ZuercherRawRecord, 'name_raw' | 'charges_raw' | 'bond_raw'> {
  const bm = CODINGTON_BOND.exec(body);
  const bond_raw = bm ? bm[0].trim() : null;
  const nameCharges = bm ? body.slice(0, bm.index).trim() : body;

  const nm = CHARGE_CODE_START.exec(nameCharges);
  let name_raw: string;
  let charges_raw: string | null;
  if (nm) {
    name_raw = nameCharges.slice(0, nm.index).trim();
    charges_raw = nameCharges.slice(nm.index).trim() || null;
  } else {
    name_raw = nameCharges;
    charges_raw = null;
  }

  return { name_raw, charges_raw, bond_raw };
}

/** Split a Codington-layout text into raw warrant records. */
export function splitCodingtonRecords(text: string): ZuercherRawRecord[] {
  const clean = text.replace(CODINGTON_PAGE_HDR, '').replace(/Total Records:\s*\d+\s*$/, '').trim();

  // Split on "date followed by name start" — keeping the date via capturing group
  const splitParts = clean.split(CODINGTON_RECORD_SPLIT);
  // Layout: [body0, date0, body1, date1, body2, ..., dateN-1, bodyN]
  // body0 has no preceding date in the list (first record body comes before date0 in the raw text,
  // but the SPLIT fires at the END of each date — so body0 is the FIRST record's name+charges+bond,
  // date0 is its issue date, body1 is the second record, etc.)
  // The LAST element may be a trailing fragment with no date (should be empty or "Total Records").

  const records: ZuercherRawRecord[] = [];
  let i = 0;
  while (i < splitParts.length) {
    const body = (splitParts[i] ?? '').trim();
    const date = (splitParts[i + 1] ?? '').trim();
    i += 2;

    if (!body || !date) continue;
    const parsed = parseCodingtonBody(body);
    if (!parsed.name_raw) continue;

    records.push({ date, ...parsed });
  }
  return records;
}

// ---------------------------------------------------------------------------
// Layout detector
// ---------------------------------------------------------------------------

/** Detect which Zuercher layout a text uses based on its header tokens.
 *  Returns 'mckenzie' (8-column), 'codington' (4-column), or null (unrecognised). */
export function detectZuercherLayout(text: string): 'mckenzie' | 'codington' | null {
  const head = text.slice(0, 800);
  if (/Warrant Number\s+OCA #\s+Last, First Name/i.test(head)) return 'mckenzie';
  if (/Last, First Name\s+Charges\s+Bond\s+Date Issued/i.test(head)) return 'codington';
  return null;
}
