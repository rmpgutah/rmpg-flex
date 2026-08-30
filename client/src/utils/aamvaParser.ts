// ============================================================
// RMPG Flex — AAMVA DL/ID barcode parser (PDF417 back-of-card)
// ============================================================
// Parses the raw text payload decoded from the PDF417 barcode on
// the back of a US/Canadian driver's license or ID card, per the
// AAMVA DL/ID Card Design Standard (versions 01–10).
//
// Output is normalised to the same field shape the DL OCR scanner
// returns (DlSearchPage `ocrResult`), so barcode scans flow through
// the existing preview → person-record → dl-record pipeline.
// ============================================================

import { localToday } from './dateUtils';

export interface AamvaResult {
  first_name: string;
  middle_name: string;
  last_name: string;
  suffix: string;
  date_of_birth: string;   // YYYY-MM-DD
  gender: string;          // Male / Female / X
  height: string;          // e.g. 5'10"
  weight: string;          // lbs
  eye_color: string;
  hair_color: string;
  address: string;
  address2: string;
  city: string;
  state: string;           // residence address state
  zip: string;
  dl_number: string;
  dl_state: string;        // issuing jurisdiction
  dl_class: string;
  dl_expiry: string;       // YYYY-MM-DD
  dl_issue_date: string;   // YYYY-MM-DD
  dl_restrictions: string;
  dl_endorsements: string;
  country: string;
  document_discriminator: string;
  is_real_id: boolean | null;
  is_organ_donor: boolean | null;
  is_veteran: boolean | null;
  under_18_until: string;
  under_21_until: string;
  aamva_version: number;
  issuer_id: string;       // 6-digit IIN
  card_type: 'DL' | 'ID' | 'UNKNOWN';
  place_of_birth: string;
  race: string;
  name_prefix: string;
  card_revision_date: string;
  dl_hazmat_expiry: string;
  non_resident_indicator: boolean | null;
  limited_duration_doc: boolean | null;
  audit_info: string;
  /** Every raw element id → value, including jurisdiction (Z*) fields. */
  raw_elements: Record<string, string>;
}

// AAMVA D.12.5 element ids we map to named fields. Anything else
// decoded from the barcode is still preserved in raw_elements.
const SEX_MAP: Record<string, string> = { '1': 'Male', '2': 'Female', '9': 'X', M: 'Male', F: 'Female', X: 'X' };

const EYE_MAP: Record<string, string> = {
  BLK: 'Black', BLU: 'Blue', BRO: 'Brown', BRN: 'Brown', GRY: 'Gray',
  GRN: 'Green', HAZ: 'Hazel', MAR: 'Maroon', PNK: 'Pink', DIC: 'Dichromatic', UNK: 'Unknown',
};

const HAIR_MAP: Record<string, string> = {
  BAL: 'Bald', BLK: 'Black', BLN: 'Blond', BRO: 'Brown', BRN: 'Brown',
  GRY: 'Gray', RED: 'Red', SDY: 'Sandy', WHI: 'White', UNK: 'Unknown',
};

const RACE_MAP: Record<string, string> = {
  AP: 'Asian or Pacific Islander', BK: 'Black', H: 'Hispanic',
  AI: 'American Indian / Alaskan Native', W: 'White', U: 'Unknown',
};

/** True if a decoded string looks like an AAMVA DL/ID payload. */
export function looksLikeAamva(raw: string): boolean {
  if (!raw) return false;
  if (!/ANSI\s|AAMVA/.test(raw)) return false;
  // Subfile bodies often glue the designator to the first element (`DLDAQ…`)
  // with no whitespace, so a `\b` word-boundary before DAQ/DCS never matches
  // even on a valid card. Accept a line/record separator *or* the DL/ID
  // designator as the prefix.
  return /(?:^|[\n\r\x1e\x1c]|DL|ID)D(AQ|CS|AA|AB)/.test(raw);
}

// ── date handling ────────────────────────────────────────────
// US (v2+): MMDDCCYY. Canada + AAMVA v1: CCYYMMDD.
function parseAamvaDate(value: string, version: number, country: string): string {
  const v = (value || '').replace(/\D/g, '');
  if (v.length !== 8) return value || '';
  let yyyy: string, mm: string, dd: string;
  if (version >= 2 && country !== 'CAN') {
    mm = v.slice(0, 2); dd = v.slice(2, 4); yyyy = v.slice(4, 8);
  } else {
    yyyy = v.slice(0, 4); mm = v.slice(4, 6); dd = v.slice(6, 8);
  }
  const mn = Number(mm), dn = Number(dd), yn = Number(yyyy);
  // If the "US" read is impossible (month > 12), the jurisdiction encoded
  // CCYYMMDD anyway — re-read in ISO order rather than emit garbage.
  if (mn > 12 && Number(v.slice(4, 6)) <= 12) {
    yyyy = v.slice(0, 4); mm = v.slice(4, 6); dd = v.slice(6, 8);
  } else if (yn < 1900 || mn < 1 || mn > 12 || dn < 1 || dn > 31) {
    return value;
  }
  return `${yyyy}-${mm}-${dd}`;
}

// ── height handling ──────────────────────────────────────────
// DAU formats: "070 in" / "070 IN", "178 cm", v1 "510" (5 ft 10 in),
// or bare inches. Normalise to `F'II"`.
function parseHeight(dau: string): string {
  const s = (dau || '').trim().toUpperCase();
  if (!s) return '';
  let totalInches: number | null = null;
  const m = s.match(/^(\d+)\s*(IN|CM)?$/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (m[2] === 'CM') totalInches = Math.round(n / 2.54);
    else if (m[2] === 'IN') totalInches = n;
    else if (m[1].length === 3 && n >= 400 && n <= 711 && n % 100 <= 11) {
      // v1 FII encoding, e.g. 510 = 5'10"
      return `${Math.floor(n / 100)}'${String(n % 100).padStart(2, '0')}"`;
    } else if (n > 100) totalInches = Math.round(n / 2.54); // bare cm
    else totalInches = n;                                    // bare inches
  }
  if (totalInches == null || totalInches <= 0) return dau;
  return `${Math.floor(totalInches / 12)}'${String(totalInches % 12).padStart(2, '0')}"`;
}

function parseWeight(lbs?: string, kg?: string): string {
  if (lbs && /\d/.test(lbs)) return String(parseInt(lbs, 10));
  if (kg && /\d/.test(kg)) return String(Math.round(parseInt(kg, 10) * 2.20462));
  return '';
}

// AAMVA pads/terminates with "NONE", "UNAVL", "UNK" filler values.
// AAMVA element IDs we will split on when a reader strips separators.
// Must NOT be every `[DZ][A-Z]{2}` — values like DCJ "AUDIT123" contain
// incidental "DIT" which is not an element.
const AAMVA_ELEMENT_IDS = new Set([
  'DAQ', 'DCS', 'DAC', 'DAD', 'DAA', 'DAB', 'DCT', 'DCU', 'DBN', 'DAF',
  'DBA', 'DBB', 'DBC', 'DBD', 'DBI',
  'DAG', 'DAH', 'DAI', 'DAJ', 'DAK', 'DAL', 'DAM', 'DAN', 'DAO', 'DAP',
  'DAU', 'DAW', 'DAX', 'DAY', 'DAZ', 'DCE',
  'DCA', 'DCB', 'DCD', 'DAR', 'DAS', 'DAT',
  'DCF', 'DCG', 'DCI', 'DCJ', 'DCL',
  'DDA', 'DDB', 'DDC', 'DDD', 'DDH', 'DDI', 'DDK', 'DDL',
  'DDE', 'DDF', 'DDG', 'DBK', 'DBM',
]);

function expandAamvaSegments(body: string, subfileType: string): string[] {
  const parts = body.split(/[\n\r\x1e]+/).map((s) => s.trim()).filter((s) => s.length >= 3);
  const out: string[] = [];
  for (const part of parts) {
    const idxs: number[] = [];
    for (let i = 0; i <= part.length - 3; i++) {
      const code = part.slice(i, i + 3);
      if (AAMVA_ELEMENT_IDS.has(code)) {
        idxs.push(i);
        i += 2;
      }
    }
    const prefixOk = idxs.length >= 2 && (idxs[0] === 0 || (!!subfileType && idxs[0] === subfileType.length));
    if (prefixOk) {
      for (let i = 0; i < idxs.length; i++) {
        const seg = part.slice(idxs[i], idxs[i + 1]);
        if (seg.length >= 3) out.push(seg);
      }
    } else {
      out.push(part);
    }
  }
  return out;
}

// AAMVA pads/terminates with "NONE", "UNAVL", "UNK" filler values.
function clean(v: string | undefined): string {
  const s = (v || '').trim();
  if (/^(NONE|UNAVL|UNAVAILABLE|UNK|UNKNOWN)$/i.test(s)) return '';
  return s;
}

function cleanZip(v: string | undefined): string {
  const s = (v || '').replace(/[^0-9-]/g, '');
  // 9-digit with zero plus-four ("841010000") → 5-digit
  if (/^\d{9}$/.test(s)) return s.endsWith('0000') ? s.slice(0, 5) : `${s.slice(0, 5)}-${s.slice(5)}`;
  return s.slice(0, 10);
}

/**
 * Parse a raw AAMVA PDF417 payload. Throws if the payload doesn't
 * contain any recognisable AAMVA data elements.
 */
export function parseAamva(raw: string): AamvaResult {
  if (!raw || !looksLikeAamva(raw)) {
    throw new Error('Not an AAMVA driver license barcode payload');
  }

  // ── header ──
  // "@\n\x1e\rANSI 636026 08 02 DL..." — IIN(6) version(2) [jurver(2) entries(2)]
  let version = 0;
  let issuerId = '';
  const ansi = raw.match(/ANSI\s?(\d{6})(\d{2})/);
  const aamvaOld = raw.match(/AAMVA(\d{6})(\d{2})/);
  if (ansi) { issuerId = ansi[1]; version = parseInt(ansi[2], 10); }
  else if (aamvaOld) { issuerId = aamvaOld[1]; version = parseInt(aamvaOld[2], 10) || 1; }

  // ── subfile bodies ──
  // Preferred: parse the subfile directory after the header — `entries`
  // designators of type(2) + offset(4) + length(4), offsets relative to
  // the start of the payload. This is exact per spec.
  const elements: Record<string, string> = {};
  let cardType: 'DL' | 'ID' | 'UNKNOWN' = 'UNKNOWN';

  const addBody = (body: string, subfileType: string) => {
    if ((subfileType === 'DL' || subfileType === 'ID') && cardType === 'UNKNOWN') {
      cardType = subfileType;
    }
    // Body may begin with its own subfile-type prefix (e.g. "DLDAQ...").
    let b = body;
    if (b.startsWith(subfileType)) b = b.slice(subfileType.length);
    for (let seg of expandAamvaSegments(b, subfileType)) {
      // A subfile's first segment carries its 2-char type prefix
      // ("ZUZUA01" = subfile ZU, element ZUA) — strip it when the bare
      // segment isn't element-shaped but the stripped one is.
      if (
        (subfileType && seg.startsWith(subfileType) && /^[DZ][A-Z]{2}/.test(seg.slice(2))) ||
        (!/^[DZ][A-Z]{2}/.test(seg) && /^(DL|ID|EN|Z[A-Z])[DZ][A-Z]{2}/.test(seg))
      ) {
        seg = seg.slice(2);
      }
      const id = seg.slice(0, 3);
      if (!/^[DZ][A-Z]{2}$/.test(id)) continue;
      // First occurrence wins (DL subfile precedes jurisdiction subfiles).
      if (!(id in elements)) elements[id] = seg.slice(3).trim();
    }
  };

  const headerRe = /(ANSI |AAMVA)(\d{6})(\d{2})(\d{2})?(\d{2})?/;
  const hm = raw.match(headerRe);
  let directoryOk = false;
  if (hm && hm.index !== undefined) {
    // v2+ (ANSI): IIN(6) ver(2) jurVer(2) entries(2). v1 (AAMVA): IIN(6) ver(2) entries(2).
    const isV1 = hm[1] === 'AAMVA';
    const entries = parseInt(isV1 ? (hm[4] || '') : (hm[5] || ''), 10);
    const dirStart = hm.index + hm[0].length - (isV1 && hm[5] ? 2 : 0);
    if (entries > 0 && entries < 20) {
      const designators: Array<{ type: string; offset: number; length: number }> = [];
      for (let i = 0; i < entries; i++) {
        const d = raw.slice(dirStart + i * 10, dirStart + (i + 1) * 10);
        const dm = d.match(/^([A-Z]{2})(\d{4})(\d{4})$/);
        if (!dm) break;
        designators.push({ type: dm[1], offset: parseInt(dm[2], 10), length: parseInt(dm[3], 10) });
      }
      if (designators.length === entries) {
        directoryOk = true;
        // Slice each subfile from its offset to the START OF THE NEXT
        // subfile (by offset order), not to its own declared length —
        // some jurisdiction encoders emit lengths short by the
        // terminator, which would truncate trailing fields. But we must
        // still stop at the next subfile's boundary: subfiles are packed
        // back-to-back with no guaranteed newline between the last field
        // of one and the header of the next, so slicing all the way to
        // end-of-payload made the last field of every non-final subfile
        // swallow every subsequent subfile's raw bytes as its own value
        // (garbled/false field data). The final subfile still reads to
        // end-of-payload. First-occurrence-wins is what actually keeps
        // subfiles from contaminating each other's *known* element ids.
        const byOffset = [...designators].sort((a, b) => a.offset - b.offset);
        for (const dsg of designators) {
          const next = byOffset.find(d => d.offset > dsg.offset);
          addBody(raw.slice(dsg.offset, next ? next.offset : undefined), dsg.type);
        }
      }
    }
  }

  // Fallback for malformed/truncated directories: locate the first
  // subfile-type marker followed by an element id and parse linearly.
  if (!directoryOk || Object.keys(elements).length === 0) {
    const start = raw.search(/(DL|ID|EN|Z[A-Z])(?=[DZ][A-Z]{2})/);
    if (start >= 0) {
      const type = raw.slice(start, start + 2);
      addBody(raw.slice(start), type);
    } else {
      // Last resort: scan every line for element-shaped content.
      for (const seg of raw.split(/[\n\r\x1e]+/)) addBody(seg, '');
    }
  }

  if (Object.keys(elements).length === 0) {
    throw new Error('Barcode decoded but no AAMVA data elements found');
  }

  const country = clean(elements.DCG) || 'USA';
  const date = (v?: string) => (v ? parseAamvaDate(v, version, country) : '');

  // ── names ──
  // v2+: DCS last / DAC first / DAD middle. v1: DAA "LAST,FIRST,MIDDLE"
  // or DAB last / DAC first / DAD middle.
  let last = clean(elements.DCS) || clean(elements.DAB);
  let first = clean(elements.DAC) || clean(elements.DCT);
  let middle = clean(elements.DAD);
  let suffix = clean(elements.DCU) || clean(elements.DBN);
  if (!last && elements.DAA) {
    const parts = elements.DAA.split(/[,$@]/).map(p => p.trim()).filter(Boolean);
    [last, first, middle = ''] = [parts[0] || '', parts[1] || '', parts[2] || ''];
    if (parts.length === 1) {
      // space-delimited "FIRST MIDDLE LAST"
      const sp = parts[0].split(/\s+/);
      first = sp[0] || ''; last = sp[sp.length - 1] || ''; middle = sp.slice(1, -1).join(' ');
    }
  }
  // DCT (v2/3) can be "FIRST MIDDLE" combined
  if (first && !middle && first.includes(' ')) {
    const sp = first.split(/\s+/);
    first = sp[0]; middle = sp.slice(1).join(' ');
  }

  const flag = (v?: string): boolean | null => (v === undefined ? null : v.trim() === '1');

  const result: AamvaResult = {
    first_name: first,
    middle_name: middle,
    last_name: last,
    suffix,
    date_of_birth: date(elements.DBB),
    gender: SEX_MAP[clean(elements.DBC)] || clean(elements.DBC),
    height: parseHeight(clean(elements.DAU)),
    weight: parseWeight(clean(elements.DAW), clean(elements.DAX)) || clean(elements.DCE),
    eye_color: EYE_MAP[clean(elements.DAY)] || clean(elements.DAY),
    hair_color: HAIR_MAP[clean(elements.DAZ)] || clean(elements.DAZ),
    address: clean(elements.DAG) || clean(elements.DAL),
    address2: clean(elements.DAH) || clean(elements.DAM),
    city: clean(elements.DAI) || clean(elements.DAN),
    state: clean(elements.DAJ) || clean(elements.DAO),
    zip: cleanZip(elements.DAK || elements.DAP),
    dl_number: clean(elements.DAQ),
    dl_state: clean(elements.DAJ) || clean(elements.DAO), // refined below
    dl_class: clean(elements.DCA) || clean(elements.DAR),
    dl_expiry: date(elements.DBA),
    dl_issue_date: date(elements.DBD),
    dl_restrictions: clean(elements.DCB) || clean(elements.DAS),
    dl_endorsements: clean(elements.DCD) || clean(elements.DAT),
    country,
    document_discriminator: clean(elements.DCF),
    place_of_birth: clean(elements.DCI),
    race: RACE_MAP[clean(elements.DCL)] || clean(elements.DCL),
    name_prefix: clean(elements.DAF),
    card_revision_date: date(elements.DDB),
    dl_hazmat_expiry: date(elements.DDC),
    non_resident_indicator: flag(elements.DBI),
    limited_duration_doc: flag(elements.DDD),
    audit_info: clean(elements.DCJ),
    is_real_id: elements.DDA !== undefined ? elements.DDA.trim() === 'F' : null,
    is_organ_donor: flag(elements.DDK),
    is_veteran: flag(elements.DDL),
    under_18_until: date(elements.DDH),
    under_21_until: date(elements.DDI),
    aamva_version: version,
    issuer_id: issuerId,
    card_type: cardType,
    raw_elements: elements,
  };

  // Issuing jurisdiction from the IIN where known; fall back to the
  // address state (true for the overwhelming majority of holders).
  const iinState = IIN_TO_STATE[issuerId];
  if (iinState) result.dl_state = iinState;

  return result;
}

// AAMVA Issuer Identification Numbers → jurisdiction code.
// Source: AAMVA IIN registry (US states + DC + common territories/provinces).
export const IIN_TO_STATE: Record<string, string> = {
  '636033': 'AL', '636059': 'AK', '636026': 'AZ', '636021': 'AR', '636014': 'CA',
  '636020': 'CO', '636006': 'CT', '636011': 'DE', '636043': 'DC', '636010': 'FL',
  '636055': 'GA', '636047': 'HI', '636050': 'ID', '636035': 'IL', '636037': 'IN',
  '636018': 'IA', '636022': 'KS', '636046': 'KY', '636007': 'LA', '636041': 'ME',
  '636003': 'MD', '636002': 'MA', '636032': 'MI', '636038': 'MN', '636051': 'MS',
  '636030': 'MO', '636008': 'MT', '636054': 'NE', '636049': 'NV', '636039': 'NH',
  '636036': 'NJ', '636009': 'NM', '636001': 'NY', '636004': 'NC', '636034': 'ND',
  '636023': 'OH', '636058': 'OK', '636029': 'OR', '636025': 'PA', '636052': 'RI',
  '636005': 'SC', '636042': 'SD', '636053': 'TN', '636015': 'TX', '636040': 'UT',
  '636024': 'VT', '636000': 'VA', '636045': 'WA', '636061': 'WV', '636031': 'WI',
  '636060': 'WY', '636019': 'GU', '636056': 'PR', '636062': 'VI', '636044': 'AS',
  // Canadian provinces (country=CAN)
  '636028': 'BC', '636012': 'ON', '636048': 'NB', '604427': 'SK', '604429': 'QC',
  '636016': 'NL', '636013': 'NS', '604426': 'PE', '604428': 'MB', '604432': 'AB',
};

// ============================================================
// Full-English readout — translates every decoded element into
// plain English for the scanner UI ("full loadout" view).
// ============================================================

/** AAMVA D.12.5 data-element dictionary (DL + ID subfile ids). */
export const ELEMENT_LABELS: Record<string, string> = {
  DAA: 'Full Name', DAB: 'Last Name', DAC: 'First Name', DAD: 'Middle Name(s)',
  DAE: 'Name Suffix', DAF: 'Name Prefix', DAG: 'Street Address',
  DAH: 'Street Address Line 2', DAI: 'City', DAJ: 'State / Jurisdiction',
  DAK: 'Postal Code', DAL: 'Residence Street Address', DAM: 'Residence Address Line 2',
  DAN: 'Residence City', DAO: 'Residence State', DAP: 'Residence Postal Code',
  DAQ: 'License / ID Number', DAR: 'License Class (legacy)',
  DAS: 'Restrictions (legacy)', DAT: 'Endorsements (legacy)',
  DAU: 'Height', DAV: 'Height (cm)', DAW: 'Weight (lbs)', DAX: 'Weight (kg)',
  DAY: 'Eye Color', DAZ: 'Hair Color',
  DBA: 'Expiration Date', DBB: 'Date of Birth', DBC: 'Sex', DBD: 'Issue Date',
  DBE: 'Issue Timestamp (legacy)', DBF: 'Number of Duplicates (legacy)',
  DBG: 'Medical Indicator (legacy)', DBH: 'Organ Donor (legacy)',
  DBI: 'Non-Resident Indicator (legacy)', DBJ: 'Unique Customer ID (legacy)',
  DBK: 'Social Security Number (legacy)', DBL: 'Date of Birth (legacy)',
  DBM: 'Social Security Number (legacy)', DBN: 'Full Name (alt)',
  DBO: 'Last Name (alt)', DBP: 'First Name (alt)', DBQ: 'Middle Name (alt)',
  DBR: 'Suffix (alt)', DBS: 'Prefix (alt)',
  DCA: 'Vehicle Class', DCB: 'Restrictions', DCD: 'Endorsements',
  DCE: 'Weight Range', DCF: 'Document Discriminator', DCG: 'Country',
  DCH: 'Federal Commercial Vehicle Codes',
  DCI: 'Place of Birth', DCJ: 'Audit Information', DCK: 'Inventory Control Number',
  DCL: 'Race / Ethnicity', DCM: 'Standard Vehicle Classification',
  DCN: 'Standard Endorsement Code', DCO: 'Standard Restriction Code',
  DCP: 'Jurisdiction Vehicle Classification Description',
  DCQ: 'Jurisdiction Endorsement Description',
  DCR: 'Jurisdiction Restriction Description',
  DCS: 'Last Name', DCT: 'First/Given Name(s)', DCU: 'Name Suffix',
  DDA: 'REAL ID Compliance', DDB: 'Card Revision Date', DDC: 'HazMat Endorsement Expiry',
  DDD: 'Limited Duration Document', DDE: 'Last Name Truncated',
  DDF: 'First Name Truncated', DDG: 'Middle Name Truncated',
  DDH: 'Under 18 Until', DDI: 'Under 21 Until', DDJ: 'Under 19 Until',
  DDK: 'Organ Donor', DDL: 'Veteran',
};

/** AAMVA standard restriction codes (CDL + common non-CDL). */
export const RESTRICTION_CODES: Record<string, string> = {
  A: 'With corrective lenses... (jurisdiction-defined A)', B: 'Corrective lenses required',
  C: 'Mechanical aid required', D: 'Prosthetic aid required',
  E: 'No manual transmission (automatic only)', F: 'Outside mirror required',
  G: 'Daylight driving only', H: 'Employment purposes only',
  I: 'Limited — other', J: 'Other (see jurisdiction)',
  K: 'CDL intrastate only', L: 'No air-brake equipped CMV',
  M: 'No Class A passenger vehicle', N: 'No Class A or B passenger vehicle',
  O: 'No tractor-trailer CMV', P: 'No passengers in CMV bus',
  V: 'Medical variance', W: 'Farm waiver',
  X: 'No cargo in tank vehicle', Z: 'No full air brake CMV',
};

/** AAMVA standard endorsement codes. */
export const ENDORSEMENT_CODES: Record<string, string> = {
  H: 'Hazardous materials', L: 'Motorcycle (some jurisdictions)',
  M: 'Motorcycle', N: 'Tank vehicle', O: 'Other (see jurisdiction)',
  P: 'Passenger transport', S: 'School bus', T: 'Double/triple trailers',
  W: 'Tow truck (some jurisdictions)', X: 'Tank vehicle + hazardous materials',
};

/** Common vehicle-class meanings (jurisdictions may vary). */
export const CLASS_CODES: Record<string, string> = {
  A: 'Class A — combination vehicles 26,001+ lbs (CDL)',
  B: 'Class B — heavy straight vehicles 26,001+ lbs (CDL)',
  C: 'Class C — small commercial / regular operator (varies by state)',
  D: 'Class D — regular operator license',
  E: 'Class E — regular operator (some states) / taxi',
  M: 'Class M — motorcycle',
};

const TRUNCATION: Record<string, string> = { T: 'Yes — truncated', N: 'No — complete', U: 'Unknown' };

export function describeCodes(value: string, dict: Record<string, string>): string {
  const v = clean(value);
  if (!v) return 'None';
  const parts = v.split(/[\s,;]+/).filter(Boolean);
  const out = parts.map(p => {
    const desc = dict[p.toUpperCase()];
    return desc ? `${p} — ${desc}` : p;
  });
  return out.join('; ');
}

// ── Plain-English helpers for stored records ──────────────────
// parseAamva keeps restrictions / endorsements / class as the raw
// AAMVA codes (B, A,F, D). For records persisted to the system —
// where officers read the value directly — translate to plain
// English ("B — Corrective lenses required"). Empty in → empty out
// (not "None"), so blank fields render as "—" rather than a literal.
// Already-translated strings (containing " — ") pass through
// unchanged, so these are safe to call on either a raw or a
// previously-described value (phone-relay round-trip).
function alreadyEnglish(v: string): boolean {
  return / — /.test(v) || /[a-z]/.test(v.replace(/\b[A-Z]\b/g, ''));
}
export function describeRestrictions(value: string): string {
  const v = clean(value);
  if (!v) return '';
  return alreadyEnglish(v) ? v : describeCodes(v, RESTRICTION_CODES);
}
export function describeEndorsements(value: string): string {
  const v = clean(value);
  if (!v) return '';
  return alreadyEnglish(v) ? v : describeCodes(v, ENDORSEMENT_CODES);
}
export function describeClass(value: string): string {
  const v = clean(value);
  if (!v) return '';
  if (alreadyEnglish(v)) return v;
  return CLASS_CODES[v.toUpperCase()] || v;
}

export interface ReadoutRow {
  code: string;     // raw AAMVA element id
  label: string;    // English field name
  value: string;    // raw value as encoded
  english: string;  // human-readable translation
}

/**
 * Build the full English "loadout" — one row per decoded element,
 * in spec order for known ids, with raw value AND translation.
 */
export function describeAamva(r: AamvaResult): ReadoutRow[] {
  const els = r.raw_elements;
  const date = (v: string) => parseAamvaDate(v, r.aamva_version, r.country) || v;
  const rows: ReadoutRow[] = [];

  const ENGLISH: Record<string, (v: string) => string> = {
    DBA: date, DBB: date, DBD: date, DDB: date, DDC: date, DDH: date, DDI: date, DDJ: date,
    DBC: v => SEX_MAP[clean(v)] || v,
    DAU: v => parseHeight(clean(v)) || v,
    DAY: v => EYE_MAP[clean(v)] || clean(v) || 'Unknown',
    DAZ: v => HAIR_MAP[clean(v)] || clean(v) || 'Unknown',
    DAW: v => (clean(v) ? `${parseInt(v, 10)} lbs` : 'Not encoded'),
    DAX: v => (clean(v) ? `${parseInt(v, 10)} kg (${Math.round(parseInt(v, 10) * 2.20462)} lbs)` : 'Not encoded'),
    DAK: v => cleanZip(v) || v,
    DCA: v => CLASS_CODES[clean(v).toUpperCase()] || clean(v) || 'Not encoded',
    DCB: v => describeCodes(v, RESTRICTION_CODES),
    DAS: v => describeCodes(v, RESTRICTION_CODES),
    DCD: v => describeCodes(v, ENDORSEMENT_CODES),
    DAT: v => describeCodes(v, ENDORSEMENT_CODES),
    DDA: v => (v.trim() === 'F' ? 'REAL ID compliant' : v.trim() === 'N' ? 'NOT REAL ID compliant' : v),
    DDD: v => (v.trim() === '1' ? 'Yes — limited duration / temporary' : 'No'),
    DDK: v => (v.trim() === '1' ? 'Yes — registered organ donor' : 'No'),
    DDL: v => (v.trim() === '1' ? 'Yes — veteran designation' : 'No'),
    DDE: v => TRUNCATION[v.trim()] || v,
    DDF: v => TRUNCATION[v.trim()] || v,
    DDG: v => TRUNCATION[v.trim()] || v,
    DCG: v => (v === 'USA' ? 'United States' : v === 'CAN' ? 'Canada' : v),
  };

  // Spec-ordered known elements first, then any extras (jurisdiction Z* etc.)
  const order = Object.keys(ELEMENT_LABELS).filter(id => id in els);
  const extras = Object.keys(els).filter(id => !(id in ELEMENT_LABELS)).sort();

  for (const id of [...order, ...extras]) {
    const value = els[id];
    const translate = ENGLISH[id];
    let english = translate ? translate(value) : clean(value);
    if (!english) english = clean(value) ? value : 'None';
    rows.push({
      code: id,
      label: ELEMENT_LABELS[id] || (id.startsWith('Z') ? `Jurisdiction Field ${id}` : `Field ${id}`),
      value,
      english,
    });
  }
  return rows;
}

// ============================================================
// Scan intelligence — derived officer-relevant alerts.
// ============================================================

export interface ScanAlert {
  level: 'danger' | 'warning' | 'info';
  code: string;
  message: string;
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

function ageOn(dobIso: string, now: Date): number | null {
  const m = dobIso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const dob = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])); // new-date-ok: local civil date from numeric Y/M/D parts, not a server string
  if (isNaN(dob.getTime())) return null;
  let age = now.getFullYear() - dob.getFullYear();
  const had = now.getMonth() > dob.getMonth() ||
    (now.getMonth() === dob.getMonth() && now.getDate() >= dob.getDate());
  if (!had) age--;
  return age;
}

/**
 * Derive officer-relevant alerts from a parsed scan: expired or
 * soon-expiring license, minor / under-21 subject, ID-only card,
 * temporary documents.
 */
export function assessAamva(r: AamvaResult, now: Date = new Date()): ScanAlert[] {
  const alerts: ScanAlert[] = [];

  // Expiration
  const expM = r.dl_expiry.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (expM) {
    const exp = new Date(Number(expM[1]), Number(expM[2]) - 1, Number(expM[3]), 23, 59, 59); // new-date-ok: local civil expiry date from numeric Y/M/D parts
    if (exp.getTime() < now.getTime()) {
      alerts.push({
        level: 'danger', code: 'EXPIRED',
        message: `LICENSE EXPIRED ${r.dl_expiry} (${daysBetween(exp, now)} days ago)`,
      });
    } else if (daysBetween(now, exp) <= 30) {
      alerts.push({
        level: 'warning', code: 'EXPIRING',
        message: `License expires soon — ${r.dl_expiry} (${daysBetween(now, exp)} days)`,
      });
    }
  }

  // Age
  const age = r.date_of_birth ? ageOn(r.date_of_birth, now) : null;
  if (age !== null) {
    if (age < 18) {
      alerts.push({ level: 'danger', code: 'MINOR', message: `SUBJECT IS A MINOR — age ${age} (DOB ${r.date_of_birth})` });
    } else if (age < 21) {
      alerts.push({ level: 'warning', code: 'UNDER_21', message: `Subject is under 21 — age ${age} (DOB ${r.date_of_birth})` });
    }
  }

  // Card / document type
  if (r.card_type === 'ID') {
    alerts.push({ level: 'info', code: 'ID_CARD', message: 'Identification card only — NOT a driver\'s license' });
  }
  if (r.raw_elements.DDD?.trim() === '1') {
    alerts.push({ level: 'warning', code: 'LIMITED_DURATION', message: 'Limited-duration / temporary document' });
  }
  if (r.is_real_id === false) {
    alerts.push({ level: 'info', code: 'NOT_REAL_ID', message: 'Not REAL ID compliant' });
  }

  return alerts;
}

// ============================================================
// Law-enforcement formatting — NCIC/NLETS-style fielded output.
// ============================================================
// Formats a parsed scan using the field tags and value conventions
// officers see on NCIC/NLETS returns (QH/QD): NAM "LAST,FIRST MIDDLE",
// dates as CCYYMMDD, height as feet+inches digits (510), 3-letter
// eye/hair codes, OLN/OLS for the license.

export interface LeField {
  tag: string;    // NCIC field tag, e.g. NAM, DOB, OLN
  label: string;  // English meaning for display
  value: string;
}

function ncicDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}${m[2]}${m[3]}` : iso;
}

function ncicHeight(display: string): string {
  // 5'10" → 510
  const m = display.match(/^(\d)'(\d{2})"$/);
  return m ? `${m[1]}${m[2]}` : display.replace(/\D/g, '');
}

function ncicSex(gender: string): string {
  if (/^male/i.test(gender)) return 'M';
  if (/^female/i.test(gender)) return 'F';
  return gender ? 'U' : '';
}

/** Build the NCIC/NLETS-style field set for a parsed scan. */
export function formatLawEnforcement(r: AamvaResult): LeField[] {
  const nam = [r.last_name, [r.first_name, r.middle_name].filter(Boolean).join(' ')]
    .filter(Boolean).join(',') + (r.suffix ? ` ${r.suffix}` : '');
  const fields: Array<[string, string, string]> = [
    ['NAM', 'Name', nam],
    ['DOB', 'Date of Birth', ncicDate(r.date_of_birth)],
    ['SEX', 'Sex', ncicSex(r.gender)],
    ['RAC', 'Race', clean(r.raw_elements.DCL)],
    ['HGT', 'Height', ncicHeight(r.height)],
    ['WGT', 'Weight', r.weight],
    ['EYE', 'Eye Color', clean(r.raw_elements.DAY).toUpperCase()],
    ['HAI', 'Hair Color', clean(r.raw_elements.DAZ).toUpperCase()],
    ['OLN', 'Operator License Number', r.dl_number],
    ['OLS', 'License State', r.dl_state],
    ['OLC', 'License Class', r.dl_class],
    ['OLT', 'Card Type', r.card_type !== 'UNKNOWN' ? r.card_type : ''],
    ['EXP', 'Expiration', ncicDate(r.dl_expiry)],
    ['ISS', 'Issue Date', ncicDate(r.dl_issue_date)],
    ['RES', 'Restrictions', r.dl_restrictions],
    ['END', 'Endorsements', r.dl_endorsements],
    ['ADR', 'Address', [r.address, r.address2].filter(Boolean).join(' ')],
    ['CTY', 'City', r.city],
    ['STA', 'State', r.state],
    ['ZIP', 'ZIP', r.zip],
    ['CTZ', 'Country', r.country],
    ['DD', 'Document Discriminator', r.document_discriminator],
    ['SOC', 'SSN (legacy element)', clean(r.raw_elements.DBK) || clean(r.raw_elements.DBM)],
  ];
  return fields
    .filter(([, , v]) => v)
    .map(([tag, label, value]) => ({ tag, label, value }));
}

/** Render the field set as a teletype-style block for copy/paste. */
export function formatLeBlock(r: AamvaResult): string {
  const fields = formatLawEnforcement(r);
  const header = `**DL SCAN ${r.dl_state || ''} ${localToday()}**`;
  return [
    header,
    ...fields.map(f => `${f.tag.padEnd(4)}/${f.value}`),
  ].join('\n');
}
