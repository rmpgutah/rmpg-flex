/**
 * INCODE / Tyler Technologies "WRNTLST" municipal-court warrant report parser.
 *
 * Used by many Texas municipal courts (Beaumont, Harlingen, …). Fetched with
 * `{ lines: true }` (mergePages:false). Each defendant is a block delimited by
 * dashed rules:
 *
 *   AARON, JADA RENEE  E20065835-01  B/F  8/30/1996  6-17-2019  SPEEDING …  RW   <- primary
 *   Docket No: E200658351
 *   ------------------------------------------------------------------------------
 *   ABADOM, BRANDON …  E20120666-01  B/M  1/10/1996  8-31-2023  SAFETY BELT …  CW <- primary
 *   Docket No: E201206661
 *   E20120666-03  8-31-2023  FTMFR-FAIL TO MAIN FIN RESP  CW                     <- secondary (same person)
 *   Docket No: E201206663
 *
 * The PRIMARY line carries the person identity (name, race/sex, DOB) + the first
 * warrant; SECONDARY lines carry only an additional warrant (warrant#, issued
 * date, offense) and reuse the current person's name + DOB. A "Docket No:" line
 * supplies the case number for the warrant immediately above it.
 *
 * Field cues: DOB uses SLASHES (M/D/YYYY); the Issued date uses DASHES
 * (M-D-YYYY) — so a slash-date after the warrant# marks a primary line. Race/sex
 * (e.g. "B/F", or "/" for businesses) is used only to anchor the primary line and
 * is not stored (scraped_warrants has no race/sex columns); DOB IS stored and is
 * this layout's distinguishing value.
 *
 * Robustness contract: never throw; return [] on empty/unrecognised input.
 */

import type { RawWarrantHit } from '../types';
import { cleanName, normalizeDate } from '../normalize';
import { deriveWarrantId } from './socrata';

/** A warrant number: alphanumerics/dashes, optional space, then a "-NN" count suffix. */
const WARRANT_NO = `[A-Z0-9][A-Z0-9-]*\\s*-\\d{2}`;
/** Primary line: …WARRANT#  R/S(X/X or /)  DOB(slashes)  Issued(dashes)  Offense… */
const PRIMARY = new RegExp(
  `^(.+?)\\s+(${WARRANT_NO})\\s+([A-Z]\\/[A-Z]|\\/)\\s+(\\d{1,2}\\/\\d{1,2}\\/\\d{2,4})\\s+(\\d{1,2}-\\d{1,2}-\\d{4})\\s+(.*)$`,
);
/** Secondary line: WARRANT#  Issued(dashes)  Offense…  (no R/S, no DOB). */
const SECONDARY = new RegExp(`^(${WARRANT_NO})\\s+(\\d{1,2}-\\d{1,2}-\\d{4})\\s+(.*)$`);
const DOCKET = /^Docket No:\s*(.+)$/i;
/** Page header / banner / column-header / dashed-rule lines to drop. */
const BOILERPLATE = /^(?:-{10,}|\d{1,2}\/\d{1,2}\/\d{4}\b.*WRNTLST|Active Warrants$|From \d.*to \d|Name\.{2,}.*Warrant|Page \d+( of \d+)?$)/i;

/** Normalise an INCODE issued date ("M-D-YYYY", dashes) to ISO. */
function parseIssued(raw: string): string | null {
  return normalizeDate(raw.replace(/-/g, '/'));
}

/** Normalise a DOB ("M/D/YYYY"); reject the "0/00/0000" placeholder used for businesses. */
function parseDob(raw: string): string | null {
  const iso = normalizeDate(raw);
  if (!iso || iso.startsWith('0000') || /-00(-|$)/.test(iso)) return null;
  return iso;
}

/** Strip the trailing 1-3 letter disposition code (RW/CW/AW/CP/…) off an offense. */
function cleanOffense(raw: string): string | null {
  const c = raw.replace(/\s+/g, ' ').trim().replace(/\s+[A-Z]{1,3}$/, '').trim();
  return c || null;
}

function splitName(raw: string): {
  last_name: string | null; first_name: string | null; middle_name: string | null; full_name: string;
} {
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  const commaIdx = trimmed.indexOf(',');
  if (commaIdx === -1) {
    const ln = cleanName(trimmed) || null;
    return { last_name: ln, first_name: null, middle_name: null, full_name: ln ?? '' };
  }
  const lastRaw = trimmed.slice(0, commaIdx).trim();
  const givenRaw = trimmed.slice(commaIdx + 1).trim();
  const given = givenRaw ? givenRaw.split(/\s+/) : [];
  return {
    last_name: cleanName(lastRaw) || null,
    first_name: given.length > 0 ? cleanName(given[0]) : null,
    middle_name: given.length > 1 ? cleanName(given.slice(1).join(' ')) : null,
    full_name: cleanName([lastRaw, givenRaw].filter(Boolean).join(', ')),
  };
}

interface Person { last_name: string | null; first_name: string | null; middle_name: string | null; full_name: string; dob: string | null; }

/**
 * Parse an INCODE "WRNTLST" warrant report (extracted via unpdf `{ lines: true }`)
 * into `RawWarrantHit` records — one per warrant, each carrying its person's DOB.
 *
 * @param text       Newline-preserved extracted text from the PDF.
 * @param sourceKey  Source key (e.g. "pdf-incode-beaumont-tx").
 * @param state      Two-letter state code.
 */
export function parseIncodePdf(text: string, sourceKey: string, state: string): RawWarrantHit[] {
  if (!text || typeof text !== 'string') return [];
  if (!/WRNTLST|Warrant Listing/i.test(text)) return [];

  const lines = text.split('\n').map(l => l.replace(/\s+/g, ' ').trim());

  const hits: RawWarrantHit[] = [];
  const seen = new Set<string>();
  let person: Person | null = null;     // identity for the current block
  let lastIdx = -1;                     // index in `hits` of the most recent emit (for the Docket No line)

  const emit = (warrantNo: string, issuedRaw: string, offenseRaw: string, p: Person) => {
    if (!p.full_name) { lastIdx = -1; return; }
    const warrantId = warrantNo.replace(/\s+/g, '');
    const wid = deriveWarrantId([p.full_name, p.dob, warrantId]);
    if (seen.has(wid)) { lastIdx = -1; return; }
    seen.add(wid);
    hits.push({
      source_key: sourceKey,
      warrant_id: wid,
      first_name: p.first_name,
      middle_name: p.middle_name,
      last_name: p.last_name,
      full_name: p.full_name,
      date_of_birth: p.dob,
      state,
      charge_description: cleanOffense(offenseRaw),
      issue_date: parseIssued(issuedRaw),
      warrant_type: 'Municipal',
    });
    lastIdx = hits.length - 1;
  };

  for (const line of lines) {
    if (!line) continue;
    if (BOILERPLATE.test(line)) { person = null; lastIdx = -1; continue; } // dashed rule ends a block

    const docket = DOCKET.exec(line);
    if (docket) {
      if (lastIdx >= 0) hits[lastIdx].case_number = docket[1].trim();
      continue;
    }

    const prim = PRIMARY.exec(line);
    if (prim) {
      const [, nameRaw, warrantNo, , dobRaw, issuedRaw, offenseRaw] = prim;
      const n = splitName(nameRaw);
      person = { ...n, dob: parseDob(dobRaw) };
      emit(warrantNo, issuedRaw, offenseRaw, person);
      continue;
    }

    const sec = SECONDARY.exec(line);
    if (sec && person) {
      const [, warrantNo, issuedRaw, offenseRaw] = sec;
      emit(warrantNo, issuedRaw, offenseRaw, person);
      continue;
    }
    // else: unrecognised line — ignore.
  }

  return hits;
}
