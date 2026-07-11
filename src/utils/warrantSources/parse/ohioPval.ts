/**
 * Ohio DRC (Dept. of Rehabilitation & Correction) "Parole Violators at Large"
 * listing parser — appgateway.drc.ohio.gov/OffenderSearch/Search/PvalListing.
 *
 * A genuinely STATEWIDE public roster (unlike most sources in this registry,
 * which cover a single county/city): every APA-supervised offender Ohio has
 * declared a violator-at-large, browsable A-Z with server-side pagination
 * (PvalListPaging?newLtr=<L>&newPage=<n>). Each row is a plain HTML <tr>:
 *
 *   <tr>
 *     <td><a href="/OffenderSearch/Search/PvalDetails/<ID>"><img src="...ID.jpg"></a></td>
 *     <td>LAST, FIRST MIDDLE</td>
 *     <td><a href="/OffenderSearch/Search/PvalDetails/<ID>"><ID></a></td>
 *     <td>MM/DD/YYYY</td>   -- date of birth
 *     <td>MM/DD/YYYY</td>   -- date declared violator at large
 *     <td>OFFENSE, OFFENSE</td>
 *   </tr>
 *
 * Robustness contract (matches the other parsers in this directory): never
 * throw; a row that doesn't match the expected shape is skipped, not fatal.
 */

import type { RawWarrantHit } from '../types';
import { cleanName, normalizeDate } from '../normalize';
import { deriveWarrantId } from './socrata';

const ROW_RE = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
const CELL_RE = /<td[^>]*>([\s\S]*?)<\/td>/gi;
const ID_IN_HREF_RE = /PvalDetails\/(\w+)/i;
const DATE_RE = /\b\d{1,2}\/\d{1,2}\/\d{4}\b/;

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ').trim();
}

function splitName(raw: string): { last_name: string | null; first_name: string | null; middle_name: string | null; full_name: string } {
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

/** Parse one listing page's HTML into hits. Rows lacking a name+DOB are skipped. */
export function parseOhioPvalPage(html: string, sourceKey: string): RawWarrantHit[] {
  if (!html || typeof html !== 'string') return [];
  const hits: RawWarrantHit[] = [];
  const seen = new Set<string>();

  let rowMatch: RegExpExecArray | null;
  ROW_RE.lastIndex = 0;
  while ((rowMatch = ROW_RE.exec(html))) {
    try {
      const rowHtml = rowMatch[1];
      const cells: string[] = [];
      let cellMatch: RegExpExecArray | null;
      CELL_RE.lastIndex = 0;
      while ((cellMatch = CELL_RE.exec(rowHtml))) cells.push(cellMatch[1]);
      if (cells.length < 5) continue; // not a data row (e.g. header row)

      const idMatch = ID_IN_HREF_RE.exec(rowHtml);
      const offenderId = idMatch?.[1] ?? null;
      const nameCell = stripTags(cells[1]);
      if (!nameCell || !nameCell.includes(',')) continue; // header/blank row
      const dateCells = cells.map(stripTags).filter((c) => DATE_RE.test(c));
      const dob = normalizeDate(dateCells[0]);
      const valAtLargeDate = normalizeDate(dateCells[1]);
      if (!dob) continue; // an aligned data row always carries a DOB here

      const offenses = stripTags(cells[cells.length - 1]) || null;
      const { last_name, first_name, middle_name, full_name } = splitName(nameCell);
      if (!full_name) continue;

      const warrant_id = deriveWarrantId([offenderId, full_name, dob]);
      if (seen.has(warrant_id)) continue;
      seen.add(warrant_id);

      hits.push({
        source_key: sourceKey,
        warrant_id,
        first_name,
        middle_name,
        last_name,
        full_name,
        date_of_birth: dob,
        state: 'OH',
        charge_description: offenses,
        case_number: offenderId,
        issue_date: valAtLargeDate,
        warrant_type: 'PAROLE VIOLATOR AT LARGE',
        photo_url: offenderId ? `https://appgateway.drc.ohio.gov/images/pval/${offenderId}.jpg` : null,
        detail_url: offenderId ? `https://appgateway.drc.ohio.gov/OffenderSearch/Search/PvalDetails/${offenderId}` : null,
      });
    } catch {
      continue;
    }
  }
  return hits;
}

/** Extract "Page X of Y" from a listing page, or null if the marker isn't present
 *  (e.g. a single-page letter, or an unexpected page layout). */
export function parseOhioPvalPageCount(html: string): { page: number; totalPages: number } | null {
  const m = /Page\s+(\d+)\s+of\s+(\d+)/i.exec(html);
  if (!m) return null;
  const page = parseInt(m[1], 10);
  const totalPages = parseInt(m[2], 10);
  if (!Number.isFinite(page) || !Number.isFinite(totalPages)) return null;
  return { page, totalPages };
}
