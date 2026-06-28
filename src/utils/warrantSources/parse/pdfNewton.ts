/**
 * Newton County GA "Warrant Outstanding Report by Defendant's Name" PDF parser.
 *
 * Fetched with `{ lines: true }` (mergePages:false). unpdf emits this report
 * COLUMN-major: per page, a block listing every defendant name, then a block of
 * every DOB, then warrant numbers, then offenses, then date-received — each block
 * terminated by its column-header label rendered at the foot of the column:
 *
 *   <names…>  "Defendant's Name"  <DOBs…>  "Date of Birth"
 *   <warrant#s…>  "Warrant Number"  <offenses…>  "Offense"
 *   <received-dates…>  "Date Received"
 *
 * Rows are reconstructed by INDEX-aligning the columns. The name / DOB /
 * warrant# / received-date columns are one clean entry each (names un-wrap on the
 * "LAST, FIRST" comma); the OFFENSE column wraps with no per-row delimiter, so it
 * cannot be safely split and the charge is omitted (a name+DOB+warrant#+date hit
 * is still a valid match; Newton's DOB is its distinguishing value).
 *
 * Officer-safety guard: a page is emitted ONLY when its identity columns align
 * (names.length === dobs.length === warrants.length). A page whose counts
 * disagree is SKIPPED entirely rather than risk pairing a person with the wrong
 * warrant/DOB.
 *
 * Robustness contract: never throw; return [] on empty/unrecognised input.
 */

import type { RawWarrantHit } from '../types';
import { cleanName, normalizeDate } from '../normalize';
import { deriveWarrantId } from './socrata';

const DATE_LINE = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
/** A defendant-name line: "LAST, FIRST …" (the surname may itself be multi-word). */
const NAME_START = /^[A-Z][A-Z'.\- ]*,/;

interface Page { names: string[]; dobs: string[]; warrants: string[]; received: string[]; }

/** Find the index of the line that exactly equals `label` (trimmed), at/after `from`. */
function labelIdx(lines: string[], label: string, from: number): number {
  for (let i = from; i < lines.length; i++) {
    if (lines[i] === label) return i;
  }
  return -1;
}

/** Un-wrap a name column block: a new name begins at each "LAST, FIRST" line;
 *  lines without a leading surname+comma are continuations of the prior name. */
function unwrapNames(block: string[]): string[] {
  const names: string[] = [];
  let cur = '';
  for (const line of block) {
    if (NAME_START.test(line)) {
      if (cur) names.push(cur);
      cur = line;
    } else if (cur) {
      cur = `${cur} ${line}`.trim();
    }
  }
  if (cur) names.push(cur);
  return names;
}

/** Parse one page chunk into aligned columns, or null if its labels/counts don't line up. */
function parsePage(chunk: string): Page | null {
  const lines = chunk.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);

  const defIdx = labelIdx(lines, "Defendant's Name", 0);
  const dobIdx = labelIdx(lines, 'Date of Birth', defIdx + 1);
  const warIdx = labelIdx(lines, 'Warrant Number', dobIdx + 1);
  const offIdx = labelIdx(lines, 'Offense', warIdx + 1);
  // The received-date column header merges with the trailing "Issuing Officer"
  // column header into one line ("Date Received Issuing Officer"), so match its prefix.
  const recIdx = offIdx < 0 ? -1 : lines.findIndex((l, i) => i > offIdx && l.startsWith('Date Received'));
  if (defIdx < 1 || dobIdx < 0 || warIdx < 0 || offIdx < 0) return null;

  // Names: from the first "LAST, FIRST" line (skips the report/page preamble) to the label.
  let nameStart = 0;
  while (nameStart < defIdx && !NAME_START.test(lines[nameStart])) nameStart++;
  const names = unwrapNames(lines.slice(nameStart, defIdx));
  const dobs = lines.slice(defIdx + 1, dobIdx).filter(l => DATE_LINE.test(l));
  const warrants = lines.slice(dobIdx + 1, warIdx);
  const received = recIdx > offIdx ? lines.slice(offIdx + 1, recIdx).filter(l => DATE_LINE.test(l)) : [];

  // Identity-column alignment guard — skip the page if they disagree.
  if (names.length === 0 || names.length !== dobs.length || names.length !== warrants.length) {
    return null;
  }
  return { names, dobs, warrants, received };
}

/** Split "LAST, FIRST MIDDLE" into structured name fields. */
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

/**
 * Parse a Newton County GA warrant report (extracted via unpdf `{ lines: true }`)
 * into `RawWarrantHit` records.
 *
 * @param text       Newline-preserved extracted text from the PDF.
 * @param sourceKey  Source key for the output records (e.g. "pdf-newton-ga").
 * @param state      Two-letter state code (always "GA" for this source).
 */
export function parseNewtonPdf(text: string, sourceKey: string, state: string): RawWarrantHit[] {
  if (!text || typeof text !== 'string') return [];
  if (!/Defendant's Name/.test(text) || !/Date of Birth/.test(text)) return [];

  // One chunk per page (the "Page N of M" markers delimit pages; chunk[0] is the
  // report preamble before page 1).
  const chunks = text.split(/Page \d+ of \d+/);

  const hits: RawWarrantHit[] = [];
  const seen = new Set<string>();

  for (const chunk of chunks) {
    let page: Page | null;
    try { page = parsePage(chunk); } catch { page = null; }
    if (!page) continue;

    for (let i = 0; i < page.names.length; i++) {
      try {
        const { last_name, first_name, middle_name, full_name } = splitName(page.names[i]);
        if (!full_name) continue;
        const date_of_birth = normalizeDate(page.dobs[i]);
        if (!date_of_birth) continue; // an aligned row must carry a valid DOB
        const warrantNo = page.warrants[i]?.trim() || undefined;
        const issue_date = page.received.length === page.names.length
          ? normalizeDate(page.received[i])
          : null;
        const warrant_id = deriveWarrantId([full_name, date_of_birth, warrantNo]);
        if (seen.has(warrant_id)) continue;
        seen.add(warrant_id);
        hits.push({
          source_key: sourceKey,
          warrant_id,
          first_name,
          middle_name,
          last_name,
          full_name,
          date_of_birth,
          state,
          case_number: warrantNo,
          issue_date,
        });
      } catch {
        continue;
      }
    }
  }

  return hits;
}
