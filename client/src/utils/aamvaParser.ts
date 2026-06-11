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

/** True if a decoded string looks like an AAMVA DL/ID payload. */
export function looksLikeAamva(raw: string): boolean {
  return /ANSI |AAMVA/.test(raw) && /\bD(AQ|CS|AA|AB)/.test(raw);
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
    for (let seg of b.split(/[\n\r\x1e]+/)) {
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
        // Slice from each offset to end-of-payload rather than trusting
        // the declared length — some jurisdiction encoders emit lengths
        // short by the terminator, which would truncate trailing fields.
        // First-occurrence-wins keeps subfiles from contaminating each other.
        for (const dsg of designators) {
          addBody(raw.slice(dsg.offset), dsg.type);
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
