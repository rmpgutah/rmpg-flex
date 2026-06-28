// ============================================================
// RMPG Flex — ServeManager bootstrap labeler
// ============================================================
// Turns a folder of ServeManager job packets (Information Form +
// Field Sheet + Court Docket per job) into DRAFT labeled docs under
// training/data/. It cross-sources ground truth:
//
//   • Information Form  → embedded "Imported CSV Row" JSON (the spine:
//                         names, address, plaintiff/defendant, client job #)
//   • Field Sheet       → clean rendered Address / Court block; used to
//                         CORRECT fields the CSV gets wrong (e.g. the city)
//
// It NEVER blind-trusts: every output carries "_verified": false and a
// "_review" list of conflicts/low-confidence fields. build-dataset.ts only
// emits rows for docs you've verified (flip _verified to true after eyeballing).
//
// The training INPUT (rawText) is the Information Form text — the same doc
// the live intake pipeline OCRs — so the dataset matches production input.
//
// Run:  npx tsx training/label-servemanager.ts "/path/to/ICU Investigations"
//       (PII source folder lives OUTSIDE the repo; never commit it.)
// ============================================================

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  TARGET_FIELDS,
  normalizeBirthDate,
  normalizeState,
  normalizeZip,
  normalizePhone,
  type TargetField,
} from '../src/utils/serveIntakeExtract';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, 'data');
const CORPUS = process.argv[2];
if (!CORPUS || !existsSync(CORPUS)) {
  console.error('Usage: npx tsx training/label-servemanager.ts "/path/to/corpus"');
  process.exit(1);
}

type Fields = Partial<Record<TargetField, string>>;
interface DraftDoc {
  id: string;
  rawText: string;
  expected: { documentType: string; fields: Fields };
  _verified: boolean;
  _meta: { sourceForm: string; sourceFieldSheet?: string; hasCsv: boolean };
  _review: string[];
}

function pdfText(path: string, layout = false): string {
  try {
    const args = layout ? ['-layout', path, '-'] : [path, '-'];
    return execFileSync('pdftotext', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch { return ''; }
}

// Pull a single-line CSV value: "key": "value" or "key": null. Each ServeManager
// CSV key sits on its own physical PDF line, so a per-key regex is robust to the
// right-column text that pdftotext interleaves around the JSON block.
function csvVal(text: string, key: string): string {
  const m = text.match(new RegExp(`"${key}"\\s*:\\s*(?:"([^"]*)"|null)`, 'i'));
  return m && m[1] != null ? m[1].trim() : '';
}

// Split a full name into first / middle / last, keeping suffixes with last.
// "John Q Sample" → {first:John, middle:Q, last:Sample}. "Mary Smith" → no middle.
const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'jr.', 'sr.']);
function splitName(full: string): { first: string; middle: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', middle: '', last: '' };
  if (parts.length === 1) return { first: '', middle: '', last: parts[0] };
  let suffix = '';
  if (SUFFIXES.has(parts[parts.length - 1].toLowerCase())) suffix = ' ' + parts.pop();
  const first = parts.shift() || '';
  const last = (parts.pop() || '') + suffix;
  return { first, middle: parts.join(' '), last };
}

const BIZ = /\b(LLC|L\.L\.C|Inc\.?|Incorporated|Corp\.?|Corporation|Co\.|Company|LLP|L\.L\.P|LP|PLLC|PC|Ltd\.?|Limited|Associates|Bank|N\.A\.)\b/i;

// Field Sheet "Address" line is the cleanest city/state/zip source:
// "2220 East Murray Holladay Road APT 9, Holladay, UT 84117"
function parseFieldSheetAddress(fieldSheet: string): { street: string; city: string; state: string; zip: string } | null {
  // Grab the line(s) after the "Address" label up to the recipient-name echo.
  const m = fieldSheet.match(/^Address\s*\n([^\n]+)/m) || fieldSheet.match(/\bAddress\b[^\n]*\n\s*([0-9][^\n]+)/);
  const line = (m?.[1] || '').replace(/\s{2,}.*$/, '').trim(); // drop right-column tail
  if (!line) return null;
  // …street…, City, ST 84117(-1234)
  const am = line.match(/^(.*),\s*([A-Za-z .'-]+),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/);
  if (!am) return { street: line, city: '', state: '', zip: '' };
  return { street: am[1].trim(), city: am[2].trim(), state: am[3].trim(), zip: am[4].trim() };
}

// Title-case a SHOUTED value ("SALT LAKE" → "Salt Lake", "THIRD JUDICIAL
// DISTRICT COURT, STATE OF UTAH - MATHESON" → title case) so labels match the
// few-shot style. Leaves already-mixed-case strings alone. Keeps short tokens
// like "N.A." intact by only lower-casing runs of 2+ letters we then re-cap.
function titleCase(s: string): string {
  if (!s || !/[A-Z]/.test(s) || /[a-z]/.test(s)) return s.trim(); // not all-caps → leave
  return s.toLowerCase().replace(/\b([a-z])/g, (_, c) => c.toUpperCase()).trim();
}

function parseCourt(text: string): { court: string; county: string } {
  let court = (text.match(/((?:FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH)\s+JUDICIAL\s+DISTRICT\s+COURT[^\n]*(?:\n\s*STATE OF [A-Z][^\n]*)?)/i)?.[1] || '')
    .replace(/\s{2,}/g, ' ').replace(/\s*\n\s*/g, ' ').replace(/,\s*$/, '').trim();
  court = titleCase(court);
  const county = titleCase((text.match(/\bCounty\b\s+([A-Z][A-Za-z ]+?)(?:\s{2,}|\n|$)/)?.[1] || '').trim());
  return { court, county };
}

// The Field Sheet renders the operational values cleanly (one label per line,
// value to the right). Used to fill fields the CSV is missing (non-CSV jobs)
// or to cross-check. Each value runs to end of line; we trim a right-column tail.
function parseFieldSheet(fs: string): {
  party: string; agent: string; documents: string; clientRef: string;
} {
  const grab = (label: RegExp) => (fs.match(label)?.[1] || '').replace(/\s{2,}.*$/, '').trim();
  return {
    party: grab(/Party to Serve:\s*(.+)/),
    agent: grab(/Agent for Service:\s*(.+)/),
    documents: grab(/^\s*Documents\s{2,}(.+)/m),
    clientRef: (fs.match(/Job:\s*\d+\s*(?:\n\s*)?\((\w+)\)/)?.[1] || '').trim(),
  };
}

// Court Docket / Summons / Complaint caption parser. Fills plaintiff,
// defendant, attorney, and case_number when the Information Form / CSV
// lacked them. Templates vary wildly (UT civil "Plaintiff/Defendant", CA
// family "Petitioner/Respondent", multi-defendant), so this is tolerant and
// only returns what it can read confidently — empty otherwise (→ stays flagged).
// BREAK marks the caption's structural boundary (court-identity header, the
// opposing party label, or the "vs." pivot). SKIP is right-column noise that
// pdftotext interleaves INTO the caption (jurisdiction banners, case-no/judge
// stubs); step over it without collecting, since the real party name often
// sits on the far side of such a wedged line.
// "Attorneys for …" marks the end of the caption (the attorney block sits
// just outside it) — stop collecting there so "Attorney for Plaintiff" doesn't
// prefix the party name.
const DK_BREAK = /\b(IN THE|IN AND FOR|JUDICIAL DISTRICT|DISTRICT COURT|SUPERIOR COURT|ATTORNEYS?\s+FOR)\b/i;
const DK_SKIP = /\b(GENERAL JURISDICTION|DIVISION|DEPARTMENT|TRIAL BY JURY|DAMAGES|CASE\s*NO|CIVIL\s*NO|SUMMONS|COMPLAINT|JUDGE|Hon\b|Tier|STATE OF|COUNTY|Electronically Filed|Deputy)\b/i;
const ENTITY_TAIL = /,?\s*(an individual|individually|a domestic.*|a [a-z].* (?:corporation|company|llc)|et al\.?).*$/i;
// Lines that are NOT party-name content even when wedged into the caption:
// damages amounts, e-filing stamps, case/filing numbers, timestamps, and the
// bare margin line-numbers California pleadings carry (a lone "8" / "16").
const DK_JUNK = /[$@]|filing\s*#|e-?filed|\b\d{4,}\b|\d{1,2}:\d{2}|^\d{1,3}$/i;

// First NON-EMPTY column. Caption lines are often indented (leading run of
// spaces), so the literal first split chunk is "" — take the first real one.
// A line with only right-column text returns that (so headers still match).
function leftCol(line: string): string { return (line.split(/\s{2,}/).find((c) => c.trim()) || '').trim(); }

function collectParty(lines: string[], labelIdx: number, dir: -1 | 1): string {
  const acc: string[] = [];
  for (let i = labelIdx + dir; i >= 0 && i < lines.length && Math.abs(i - labelIdx) <= 10; i += dir) {
    const l = lines[i];
    if (!l || DK_SKIP.test(l) || DK_JUNK.test(l)) continue;                    // step over blanks, right-column noise, $/filing junk
    if (DK_BREAK.test(l) || /^Plaintiffs?[,.]?$|^Defendants?[,.]?$|^v(s)?\.?$/i.test(l)) break;
    dir < 0 ? acc.unshift(l) : acc.push(l);
  }
  return titleCase(acc.join(' ').replace(/\s{2,}/g, ' ').replace(ENTITY_TAIL, '').replace(/[,\s]+$/, '').trim())
    .replace(/\bAnd\b/g, 'and');                                               // "Burgess And Steel" → "Burgess and Steel"
}

function parseDocket(raw: string): {
  plaintiff: string; defendant: string; caseNumber: string;
  attorneyName: string; attorneyBar: string; attorneyPhone: string; attorneyEmail: string;
} {
  const lines = raw.split('\n').map(leftCol);
  const pIdx = lines.findIndex((l) => /^Plaintiffs?[,.]?$/i.test(l));
  const vIdx = lines.findIndex((l, i) => i > pIdx && /^v(s)?\.?$/i.test(l));
  const dIdx = lines.findIndex((l, i) => i > Math.max(pIdx, vIdx) && /^Defendants?[,.]?$/i.test(l));
  const plaintiff = pIdx >= 0 ? collectParty(lines, pIdx, -1) : '';
  const defendant = dIdx >= 0 ? collectParty(lines, dIdx, -1) : '';

  // case number: ONLY a value directly attached to a Case/Civil No. label.
  // The loose "CA-style token anywhere" fallback was dropped — it matched
  // stray filing IDs on blank-case dockets (e.g. invented "25LE07582" where
  // CASE NO. was empty). Missing a real case# (human adds it) beats inventing one.
  const labeled = raw.match(/(?:Case|Civil)\s*(?:No\.?|Number|#)\s*\.?:?\s*([0-9][A-Za-z0-9-]{3,})/i);
  const caseNumber = (labeled?.[1] || '').trim();

  // Same-line only: name is the run of letters before the comma on the line
  // that carries "Bar # NNNNN" (prevents grabbing the prior firm-name line).
  const bar = raw.match(/^[ \t]*([A-Z][A-Za-z.'\- ]+?)\s*,?\s*\(?\s*(?:Utah\s+|State\s+|Attorney\s+)*Bar\s*#?\s*:?\s*(\d{3,6})/m);
  const phoneM = raw.match(/(?:Tel|Phone|Telephone)\s*\.?:?\s*\(?(\d{3})\)?[ .-]?(\d{3})[ .-]?(\d{4})/i);
  const emailM = raw.match(/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/);
  return {
    plaintiff, defendant, caseNumber,
    attorneyName: bar ? titleCase(bar[1]) : '',
    attorneyBar: bar ? bar[2] : '',
    attorneyPhone: phoneM ? normalizePhone(`${phoneM[1]}${phoneM[2]}${phoneM[3]}`) : '',
    attorneyEmail: emailM ? emailM[1] : '',
  };
}

const DOC_TYPE_HINTS: Array<[RegExp, string]> = [
  [/eviction|unlawful detainer/i, 'eviction'],
  [/subpoena/i, 'subpoena'],
  [/restraining|protective order/i, 'restraining_order'],
  [/summons/i, 'summons'],
  [/complaint/i, 'complaint'],
];
function guessDocType(documents: string): string {
  for (const [re, t] of DOC_TYPE_HINTS) if (re.test(documents)) return t;
  return documents ? 'court_filing' : 'other';
}

function findDoc(dir: string, kind: RegExp): string | null {
  const hit = readdirSync(dir).find((f) => f.toLowerCase().endsWith('.pdf') && kind.test(f));
  return hit ? join(dir, hit) : null;
}

function labelJob(jobDir: string): DraftDoc | null {
  const formPath = findDoc(jobDir, /information form|info sheet|information page/i);
  if (!formPath) return null;
  const id = basename(jobDir).match(/^\d+/)?.[0] || basename(jobDir);
  const formText = pdfText(formPath, true);
  const hasCsv = /Imported CSV Row/i.test(formText);
  const review: string[] = [];

  // ── Spine: CSV JSON ──────────────────────────────────────
  let name = csvVal(formText, 'recipient_name_party_to_serve');
  const csvCity = csvVal(formText, 'service_city');
  const csvStreet = csvVal(formText, 'service_address_1');
  const csvState = csvVal(formText, 'service_state');
  const csvZip = csvVal(formText, 'service_postal_code');
  let plaintiff = csvVal(formText, 'plaintiff');
  let defendant = csvVal(formText, 'defendant');
  const clientCo = csvVal(formText, 'client_company_name');
  let clientJob = csvVal(formText, 'client_job_number');
  let docTitles = csvVal(formText, 'document_titles');
  let caseNo = csvVal(formText, 'court_case_number');
  const dobRaw = csvVal(formText, 'recipient_description') || csvVal(formText, 'recipient_dob');
  const phone = csvVal(formText, 'recipient_phone');

  if (!hasCsv) review.push('no CSV row in form — fields parsed from Field Sheet; verify carefully');

  // ── Correction layer: Field Sheet (cleaner rendered values) ──
  const fsPath = findDoc(jobDir, /field sheet/i);
  const fsText = fsPath ? pdfText(fsPath, true) : '';
  const fsAddr = fsText ? parseFieldSheetAddress(fsText) : null;
  const fsParsed = fsText ? parseFieldSheet(fsText) : null;

  // Fill from the Field Sheet whatever the CSV lacked — rescues the non-CSV jobs.
  let agent = '';
  if (fsParsed) {
    if (!name && fsParsed.party) name = fsParsed.party;
    if (!docTitles && fsParsed.documents) docTitles = fsParsed.documents;
    if (!clientJob && fsParsed.clientRef) clientJob = fsParsed.clientRef;
    agent = fsParsed.agent;
  }

  // ── Court Docket: fill parties / attorney / case number the CSV lacked ──
  const dkPath = findDoc(jobDir, /court docket|summons|complaint/i);
  const dkText = dkPath ? pdfText(dkPath, true) : '';
  const dk = dkText ? parseDocket(dkText) : null;
  let attorneyName = '', attorneyBar = '', attorneyPhone = '', attorneyEmail = '';
  if (dk) {
    if (!plaintiff && dk.plaintiff) plaintiff = dk.plaintiff;
    if (!defendant && dk.defendant) defendant = dk.defendant;
    if (!caseNo && dk.caseNumber) caseNo = dk.caseNumber;
    attorneyName = dk.attorneyName;
    attorneyBar = dk.attorneyBar;
    attorneyPhone = dk.attorneyPhone;
    attorneyEmail = dk.attorneyEmail;
  }

  if (!name) review.push('recipient name empty');
  if (!plaintiff || !defendant) review.push('plaintiff/defendant still empty after docket parse — verify');

  // City: prefer Field Sheet (it carries the real municipality); flag if it
  // disagrees with the CSV so you can confirm the fix.
  let city = csvCity, state = csvState, zip = csvZip, street = csvStreet;
  if (fsAddr?.city) {
    if (csvCity && fsAddr.city.toLowerCase() !== csvCity.toLowerCase()) {
      review.push(`city conflict: CSV="${csvCity}" vs FieldSheet="${fsAddr.city}" → used FieldSheet`);
    }
    city = fsAddr.city;
    if (fsAddr.state) state = fsAddr.state;
    if (fsAddr.zip) zip = fsAddr.zip;
    if (fsAddr.street) street = fsAddr.street;
  }

  // Court + county: CSV usually null → parse from form/field-sheet rendered text.
  const courtFrom = parseCourt(formText + '\n' + fsText);

  // ── Business vs person ───────────────────────────────────
  const isBiz = BIZ.test(name) && !/,?\s+(an individual)/i.test(name);
  const nm = splitName(name);

  const dob = dobRaw ? (normalizeBirthDate(dobRaw) || '') : '';
  if (dobRaw && !dob) review.push(`DOB "${dobRaw}" did not parse to a date`);

  const fields: Fields = {
    recipient_type: isBiz ? 'business' : 'person',
    recipient_first_name: isBiz ? '' : nm.first,
    recipient_middle_name: isBiz ? '' : nm.middle,
    recipient_last_name: isBiz ? '' : nm.last,
    recipient_business_name: isBiz ? name : '',
    registered_agent_name: isBiz ? agent : '',
    recipient_dob: dob,
    recipient_address: street,
    recipient_city: city,
    recipient_state: state ? normalizeState(state) : '',
    recipient_zip: zip ? normalizeZip(zip) : '',
    recipient_phone: phone ? normalizePhone(phone) : '',
    plaintiff,
    defendant,
    case_number: caseNo,                       // often "" (pre-filing) — correct
    court_name: courtFrom.court,
    jurisdiction: courtFrom.county,
    recipient_county: courtFrom.county,
    document_type: guessDocType(docTitles),
    documents_to_serve: docTitles,
    attorney_name: attorneyName,
    attorney_bar_number: attorneyBar,
    attorney_phone: attorneyPhone,
    attorney_email: attorneyEmail,
    client_name: clientCo,
    job_number: id,
    client_reference: clientJob,
    server_name: 'ICU Investigations, LLC',
  };
  // Ensure every target field exists (empty = correctly-absent label).
  for (const f of TARGET_FIELDS) if (!(f in fields)) fields[f] = '';

  return {
    id,
    rawText: formText,
    expected: { documentType: fields.document_type || 'other', fields },
    _verified: false,
    _meta: { sourceForm: basename(formPath), sourceFieldSheet: fsPath ? basename(fsPath) : undefined, hasCsv },
    _review: review,
  };
}

function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  const entries = readdirSync(CORPUS).map((e) => join(CORPUS, e)).filter((p) => statSync(p).isDirectory());
  let written = 0, skipped = 0, flagged = 0;
  for (const dir of entries) {
    const draft = labelJob(dir);
    if (!draft) { skipped++; continue; }
    const out = join(DATA_DIR, `${draft.id}.json`);
    // Never clobber a human-verified label.
    if (existsSync(out)) {
      try { if (JSON.parse(readFileSync(out, 'utf8'))._verified) { skipped++; continue; } } catch { /* re-write */ }
    }
    writeFileSync(out, JSON.stringify(draft, null, 2) + '\n');
    written++;
    if (draft._review.length) flagged++;
  }
  console.log(`Labeled ${written} jobs → training/data/  (${flagged} have _review flags, ${skipped} skipped).`);
  console.log('Next: eyeball the flagged ones, fix fields, set "_verified": true, then run build-dataset.ts.');
}

main();
