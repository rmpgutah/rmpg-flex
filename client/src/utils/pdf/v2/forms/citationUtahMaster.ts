// ============================================================
// citationUtahMaster — State of Utah Uniform Citation
// ============================================================
// Faithful reproduction of the official
//   "UNIFORM CITATION OR INFORMATION AND SUMMONS TO APPEAR"
// (form rev 10/13 — the layout Utah courts receive from the
// e-filing pipeline). Field order, label wording, the box grid,
// and the statutory paragraphs are transcribed from the filed
// form rather than paraphrased: a justice court clerk reads
// these copies against the paper original, so "close enough"
// wording is a rejection risk.
//
// Block order, top to bottom, matching the printed form:
//   1. Title bar + CASE NO. / CITATION / ORI
//   2. STATE OF UTAH / COUNTY OF / CITY OF caption + issuing agency
//   3. Defendant name + address
//   4. Driver license block
//   5. Physical descriptors
//   6. Vehicle / vessel
//   7. Commercial vehicle
//   8. "THE ABOVE NAMED DEFENDANT IS CHARGED WITH" offense table
//   9. Incident line (location / mile post / direction / posted)
//  10. "GIVEN NOTICE TO APPEAR" + the 5-to-14-day summons warning
//  11. Certification + officer / complainant / prosecuting agency
//  12. Court disposition strip (plea, disposition, fine, jail, DLD)
//  13. Payment line + READ CAREFULLY
//
// Per-zone identity (plaintiff name, agency ID label) is resolved
// from the citation's `agency_court_zones` row at API serialization
// time and passed in via zone_* fields, falling back to the
// workspace default when unset.
//
// The multi-copy bottom strip is rendered by the wrapper in
// utahMasterRenderer.ts from data.__copyKind — the official form
// is a 4-part NCR set and the copy designation is part of it
// ("ISSUING AGENCY COPY" on the filed sample).

import type { FixedLayoutSection, FixedField, FormSchema } from '../engine/types';

export type CitationCopyKind = 'court' | 'agency' | 'defendant' | 'file';

export interface CitationUtahViolation {
  statute_citation: string;
  description: string;
  offense_class: string;          // 'Infraction' | 'Class C Misd.' | etc.
  fine_amount: number;
  /** U = Utah Code, CO = County ordinance, CY = City ordinance. */
  code_type?: string | null;
  /** Severity as printed in the form's SEVERITY column (e.g. 'MB', 'I'). */
  severity?: string | null;
  /** Court-use columns — populated post-adjudication. */
  final_charge?: string | null;
  plea?: string | null;
  disposition?: string | null;
}

export interface CitationUtahData {
  // ── Metadata ──
  citation_number?: string | null;
  case_number?: string | null;
  type?: string | null;                       // 'traffic' | 'criminal' | 'parking' | 'warning'
  status?: string | null;

  // ── Issuing identity (resolved server-side from agency_court_zones) ──
  zone_plaintiff_name?: string | null;
  zone_agency_id_label?: string | null;
  zone_include_court_caption?: boolean | null;
  ori?: string | null;
  issuing_agency?: string | null;
  prosecuting_agency?: string | null;
  caption_county?: string | null;
  caption_city?: string | null;
  agency_phone?: string | null;
  agency_address?: string | null;

  // ── Court ──
  court_name?: string | null;
  court_address?: string | null;
  court_phone?: string | null;
  court_date?: string | null;
  court_time?: string | null;
  court_room?: string | null;
  appearance_required?: boolean | null;

  // ── Defendant ──
  person_name?: string | null;                // combined 'Last, First Middle'
  person_first?: string | null;
  person_last?: string | null;
  person_middle?: string | null;
  person_dob?: string | null;
  person_address?: string | null;
  person_city?: string | null;
  person_state?: string | null;
  person_zip?: string | null;
  person_phone?: string | null;

  // ── Driver license ──
  person_dl?: string | null;
  dl_state?: string | null;
  person_dl_state?: string | null;            // legacy alias for dl_state
  dl_expires?: string | null;
  dl_restriction?: string | null;
  cdl_presented?: boolean | null;
  motorcycle_endorsed?: boolean | null;
  picture_id?: boolean | null;
  birth_place?: string | null;
  ssn?: string | null;

  // ── Physical descriptors ──
  person_sex?: string | null;
  person_race?: string | null;
  person_height?: string | null;
  person_weight?: string | null;
  person_eyes?: string | null;
  person_hair?: string | null;

  // ── Vehicle / vessel ──
  vehicle_plate?: string | null;
  vehicle_state?: string | null;
  vehicle_plate_expires?: string | null;
  vehicle_year?: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_type?: string | null;
  vehicle_color?: string | null;
  vehicle_vin?: string | null;

  // ── Commercial vehicle ──
  commercial_vehicle?: boolean | null;
  hazmat?: boolean | null;
  occupants_16_plus?: boolean | null;
  gvwr?: string | null;
  company_unit?: string | null;
  company_city_state?: string | null;
  actual_weight?: string | null;
  weight_limit?: string | null;

  // ── Incident ──
  violation_date?: string | null;
  violation_time?: string | null;
  location?: string | null;
  incident_city?: string | null;
  incident_county?: string | null;
  mile_post?: string | null;
  direction_of_travel?: string | null;
  interstate?: boolean | null;
  military?: boolean | null;
  accident_related?: boolean | null;

  // ── Offenses (flat fallback for the single-violation case) ──
  statute_citation?: string | null;
  violation_description?: string | null;
  offense_level?: string | null;
  fine_amount?: number | null;
  violations?: CitationUtahViolation[];

  // ── Speed / BAC ──
  speed_recorded?: number | string | null;
  speed_limit?: number | string | null;
  radar_type?: string | null;
  bac_level?: number | string | null;

  // ── Notes ──
  notes?: string | null;

  // ── Officer / complainant ──
  issuing_officer_name?: string | null;
  badge_number?: string | null;
  officer_id_number?: string | null;
  complainant?: string | null;
  complainant_phone?: string | null;
  signature_image?: string | null;
  signature_date?: string | null;

  // ── Defendant signature ──
  defendant_signature_image?: string | null;
  defendant_signed_at?: string | null;
  defendant_refused?: boolean | null;

  // ── Court disposition strip (post-adjudication) ──
  plea?: string | null;                       // 'guilty' | 'not_guilty' | 'no_contest'
  final_charge?: string | null;
  disposition?: string | null;                // 'dismissed' | 'diversion' | 'plea_in_abeyance' | 'declination'
  fine_imposed?: number | string | null;
  fine_suspended?: number | string | null;
  jail_days?: number | string | null;
  jail_suspended?: number | string | null;
  conviction_date?: string | null;
  date_sent_to_dld?: string | null;
  docket_number?: string | null;
  judge_name?: string | null;
  felony_death?: boolean | null;
  felony_serious_bodily?: boolean | null;

  // ── Multi-copy variant (set by the renderer wrapper per page) ──
  __copyKind?: CitationCopyKind;
}

// ── Helpers ─────────────────────────────────────────────────

const str = (v: unknown): string => (v == null ? '' : String(v));
const has = (v: unknown): boolean => {
  if (v == null) return false;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  return s !== '' && s !== 'none' && s !== 'n/a' && s !== '0' && s !== '0.00';
};
const fmtFine = (v: number | string | null | undefined): string => {
  if (v == null || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : '';
};

function isWarning(d: CitationUtahData): boolean { return d.type === 'warning'; }

/** The summons/appearance machinery is meaningless on a warning. */
function showSummons(d: CitationUtahData): boolean { return !isWarning(d); }

/** Format the defendant's name into "LAST, FIRST MIDDLE". */
function fmtDefendantName(d: CitationUtahData): string {
  if (d.person_name && d.person_name.trim()) return d.person_name.trim();
  const last = (d.person_last ?? '').trim();
  const fm = [d.person_first, d.person_middle].filter((x) => x && x.trim()).join(' ');
  if (last && fm) return `${last}, ${fm}`;
  return last || fm;
}

/**
 * The official form prints Last / First / Middle in three separate boxes,
 * but most of the RMS captures a single "Last, First Middle" string. Split
 * it on demand so a citation entered the normal way still fills all three
 * boxes instead of cramming the whole name into "Last".
 */
function splitPersonName(d: CitationUtahData): { last: string; first: string; middle: string } {
  const raw = str(d.person_name).trim();
  const [lastPart = '', restPart = ''] = raw.includes(',')
    ? [raw.slice(0, raw.indexOf(',')), raw.slice(raw.indexOf(',') + 1)]
    : [raw, ''];
  const rest = restPart.trim().split(/\s+/).filter(Boolean);
  return {
    last: lastPart.trim(),
    first: rest[0] ?? '',
    middle: rest.slice(1).join(' '),
  };
}

/** Last name, falling back to the leading segment of a combined name. */
function fmtLast(d: CitationUtahData): string {
  return has(d.person_last) ? str(d.person_last) : splitPersonName(d).last;
}

function fmtFirst(d: CitationUtahData): string {
  return has(d.person_first) ? str(d.person_first) : splitPersonName(d).first;
}

function fmtMiddle(d: CitationUtahData): string {
  return has(d.person_middle) ? str(d.person_middle) : splitPersonName(d).middle;
}

// ── Statutory text ──────────────────────────────────────────
// Transcribed verbatim from the filed form. These are legal
// notices, not UI copy — do not reword, trim, or "clarify" them.

const SUMMONS_WARNING =
  'Not less than (5) five nor more than (14) fourteen days after the issuance of this citation, or as '
  + 'directed by the court. IF YOU FAIL TO APPEAR THE COURT MAY ISSUE A WARRANT FOR YOUR ARREST. You may '
  + 'be eligible for deferred prosecution under UCA 77-2-4.2. For more information visit '
  + 'utcourts.gov/deferredtraffic';

const NOT_AN_INFORMATION =
  'This citation is not an information and will not be used as an information without your consent. If an '
  + 'information is filed you will be provided a copy by the court. You MUST appear in court on or before the '
  + 'time set in this citation or as directed by the court. IF YOU FAIL TO APPEAR, THE COURT MAY ISSUE A '
  + 'WARRANT FOR YOUR ARREST.';

const CERTIFICATION =
  'I certify that a copy of this summons and citation was given to the defendant according to law on the '
  + 'above date and I know or believe and so allege that the above named defendant did commit the offense '
  + 'herein set forth contrary to law. I further certify that the court to which the defendant has been '
  + 'directed to appear is the proper court pursuant to section 77-7-21, U.C.A.';

const PAYMENT_LINE = 'Payment may be submitted online at: https://www.utcourts.gov/epayments';

// ── Layout constants ────────────────────────────────────────
// (0, 0) = top-left of the section. Letter page, 10mm margins.

const W = 195.9;              // usable content width
const ROW = 5.6;              // boxed grid row height
const LBL = 5.5;              // in-box label font size
const VAL = 8.5;              // value font size
const TINY = 6;               // statutory paragraph font size

/**
 * A "LABEL  YES [] NO []" triple, as the official form prints every
 * boolean. A tri-state: NULL leaves both boxes empty (the officer
 * never answered), which is distinct from an explicit "No".
 */
function ynPair(
  x: number, y: number, label: string,
  read: (d: CitationUtahData) => boolean | null | undefined,
  path?: string,
  visibleIf?: (d: CitationUtahData) => boolean,
): FixedField<CitationUtahData>[] {
  // drawLabel truncates to splitTextToSize(label, w - 0.5)[0], so a box that
  // is even slightly narrow silently drops characters — "MOTORCYCLE" rendered
  // as "MOTORCYCL". Uppercase Helvetica at LBL runs ~1.4mm/char.
  const labelW = Math.max(16, label.length * 1.5);
  const fields: FixedField<CitationUtahData>[] = [
    { x, y: y + 1.2, w: labelW, h: 3.6, style: 'label', label, fontSize: LBL, visibleIf },
    {
      x: x + labelW, y: y + 1.2, w: 8, h: 3.6, style: 'checkbox', label: 'YES', fontSize: LBL,
      accessor: (d) => read(d) === true, visibleIf,
    },
    {
      x: x + labelW + 11, y: y + 1.2, w: 8, h: 3.6, style: 'checkbox', label: 'NO', fontSize: LBL,
      accessor: (d) => read(d) === false, visibleIf,
    },
  ];
  if (path) {
    // Sidecar carrier for the RAW tri-state. Extraction walks fields with a
    // `path`, so pathing the YES box instead would round-trip null as `false`
    // — re-rendering an unanswered question as an explicit "NO". This field
    // draws nothing: drawLabel returns early when `label` is undefined.
    fields.push({
      x: 0, y: 0, w: 0, h: 0, style: 'label', path,
      accessor: (d) => { const v = read(d); return v == null ? null : v; },
    });
  }
  return fields;
}

/** A labelled grid cell — the form's basic unit. */
function cell(
  x: number, y: number, w: number, label: string,
  accessor: (d: CitationUtahData) => string,
  path?: string,
  opts: { h?: number; align?: 'left' | 'center' | 'right'; bold?: boolean; fontSize?: number } = {},
): FixedField<CitationUtahData> {
  return {
    x, y, w, h: opts.h ?? ROW, style: 'box', label, accessor, path,
    fontSize: opts.fontSize ?? VAL, align: opts.align, bold: opts.bold,
  };
}

// ── Master form fixed-layout fields ─────────────────────────
//
// Built with a running `y` cursor so the blocks stay self-consistent
// when one of them changes height. FORM_CONTENT_HEIGHT below is the
// measured end of that cursor and is asserted by the unit test — the
// copy strip is page-anchored at (pageHeight - 25mm), so content that
// grows past it would silently collide.

function buildMasterFields(): FixedField<CitationUtahData>[] {
  const f: FixedField<CitationUtahData>[] = [];
  let y = 0;

  // ── 1. Title bar + CASE NO. / CITATION ──────────────────
  f.push(
    { x: 0, y, w: 129, h: 9.5, style: 'rect', bold: true },
    {
      x: 1, y: y + 1, w: 127, h: 4, style: 'label', align: 'center', bold: true, fontSize: 8,
      label: 'UNIFORM CITATION OR INFORMATION',
    },
    {
      x: 1, y: y + 5, w: 127, h: 4, style: 'label', align: 'center', bold: true, fontSize: 8,
      label: 'AND SUMMONS TO APPEAR',
    },
    cell(129, y, 33, 'CASE NO.', (d) => str(d.case_number), 'case_number', { h: 9.5 }),
    cell(162, y, 33.9, 'CITATION', (d) => str(d.citation_number), 'citation_number', { h: 9.5, bold: true }),
  );
  y += 9.5;

  // ── 2. Issuing identity + caption ───────────────────────
  f.push(
    cell(0, y, 45, 'ORI', (d) => str(d.ori ?? d.zone_agency_id_label), 'ori'),
    cell(45, y, 80, 'ISSUING AGENCY', (d) => str(d.issuing_agency), 'issuing_agency'),
    cell(125, y, 70.9, 'PROSECUTING AGENCY', (d) => str(d.prosecuting_agency), 'prosecuting_agency'),
  );
  y += ROW;
  f.push(
    {
      x: 0, y, w: 45, h: ROW, style: 'box', label: 'PLAINTIFF', bold: true, fontSize: VAL,
      accessor: (d) => (d.zone_plaintiff_name ?? 'STATE OF UTAH').toUpperCase(),
    },
    cell(45, y, 80, 'COUNTY OF', (d) => str(d.caption_county), 'caption_county'),
    cell(125, y, 70.9, 'CITY OF', (d) => str(d.caption_city), 'caption_city'),
  );
  y += ROW + 1;

  // ── 3. Defendant ────────────────────────────────────────
  f.push(
    cell(0, y, 60, 'NAME (LAST)', fmtLast, 'person_last'),
    cell(60, y, 50, '(FIRST)', fmtFirst, 'person_first'),
    cell(110, y, 35, '(MIDDLE)', fmtMiddle, 'person_middle'),
    cell(145, y, 50.9, 'DOB', (d) => str(d.person_dob), 'person_dob'),
  );
  y += ROW;
  f.push(
    cell(0, y, 90, 'ADDRESS', (d) => str(d.person_address), 'person_address'),
    cell(90, y, 50, '(CITY)', (d) => str(d.person_city), 'person_city'),
    cell(140, y, 15, '(STATE)', (d) => str(d.person_state), 'person_state', { align: 'center' }),
    cell(155, y, 40.9, '(ZIP)', (d) => str(d.person_zip), 'person_zip'),
  );
  y += ROW;

  // ── 4. Driver license ───────────────────────────────────
  f.push(
    cell(0, y, 48, 'DRIVER LICENSE', (d) => str(d.person_dl), 'person_dl'),
    cell(48, y, 14, 'STATE', (d) => str(d.dl_state ?? d.person_dl_state), 'dl_state', { align: 'center' }),
    cell(62, y, 26, 'EXPIRES', (d) => str(d.dl_expires), 'dl_expires'),
    cell(88, y, 26, 'RESTRICTION', (d) => str(d.dl_restriction), 'dl_restriction'),
    cell(114, y, 45, 'BIRTH PLACE', (d) => str(d.birth_place), 'birth_place'),
    cell(159, y, 36.9, 'SOCIAL SEC. #', (d) => str(d.ssn), 'ssn'),
  );
  y += ROW;

  // ── 5. Physical descriptors ─────────────────────────────
  f.push(
    cell(0, y, 22, 'GENDER', (d) => str(d.person_sex), 'person_sex', { align: 'center' }),
    cell(22, y, 22, 'RACE CODE', (d) => str(d.person_race), 'person_race', { align: 'center' }),
    cell(44, y, 22, 'HEIGHT', (d) => str(d.person_height), 'person_height', { align: 'center' }),
    cell(66, y, 22, 'WEIGHT', (d) => str(d.person_weight), 'person_weight', { align: 'center' }),
    cell(88, y, 24, 'EYES', (d) => str(d.person_eyes), 'person_eyes', { align: 'center' }),
    cell(112, y, 24, 'HAIR', (d) => str(d.person_hair), 'person_hair', { align: 'center' }),
    cell(136, y, 59.9, 'TELEPHONE', (d) => str(d.person_phone), 'person_phone'),
  );
  y += ROW;
  f.push(
    ...ynPair(0, y, 'CDL PRESENTED', (d) => d.cdl_presented, 'cdl_presented'),
    ...ynPair(68, y, 'MOTORCYCLE', (d) => d.motorcycle_endorsed, 'motorcycle_endorsed'),
    ...ynPair(130, y, 'PICTURE ID', (d) => d.picture_id, 'picture_id'),
  );
  y += 6;

  // ── 6. Vehicle / vessel ─────────────────────────────────
  f.push(
    cell(0, y, 42, 'VEHICLE/VESSEL LICENSE', (d) => str(d.vehicle_plate), 'vehicle_plate'),
    cell(42, y, 13, 'STATE', (d) => str(d.vehicle_state), 'vehicle_state', { align: 'center' }),
    cell(55, y, 24, 'EXPIRES', (d) => str(d.vehicle_plate_expires), 'vehicle_plate_expires'),
    cell(79, y, 34, 'VEHICLE MAKE', (d) => str(d.vehicle_make), 'vehicle_make'),
    cell(113, y, 34, 'VEHICLE MODEL', (d) => str(d.vehicle_model), 'vehicle_model'),
    cell(147, y, 24, 'VEHICLE TYPE', (d) => str(d.vehicle_type), 'vehicle_type'),
    cell(171, y, 12, 'YEAR', (d) => str(d.vehicle_year), 'vehicle_year', { align: 'center' }),
    cell(183, y, 12.9, 'COLOR', (d) => str(d.vehicle_color), 'vehicle_color', { align: 'center' }),
  );
  y += ROW;
  f.push(
    cell(0, y, 100, 'VIN', (d) => str(d.vehicle_vin), 'vehicle_vin'),
    ...ynPair(104, y, 'ACCIDENT', (d) => d.accident_related, 'accident_related'),
    ...ynPair(150, y, 'INTERSTATE', (d) => d.interstate, 'interstate'),
  );
  y += ROW + 1;

  // ── 7. Commercial vehicle ───────────────────────────────
  // Always printed: the official form carries this block on every
  // citation, and a fixed layout has no reflow to reclaim the space.
  f.push(
    ...ynPair(0, y, 'COMMERCIAL VEH.', (d) => d.commercial_vehicle, 'commercial_vehicle'),
    ...ynPair(62, y, 'HAZMAT', (d) => d.hazmat, 'hazmat'),
    ...ynPair(112, y, '16+ OCCUPANTS', (d) => d.occupants_16_plus, 'occupants_16_plus'),
  );
  y += 6;
  f.push(
    cell(0, y, 30, 'GVWR', (d) => str(d.gvwr), 'gvwr'),
    cell(30, y, 55, 'COMPANY/UNIT #', (d) => str(d.company_unit), 'company_unit'),
    cell(85, y, 45, 'CITY/STATE', (d) => str(d.company_city_state), 'company_city_state'),
    cell(130, y, 32, 'ACTUAL WEIGHT', (d) => str(d.actual_weight), 'actual_weight'),
    cell(162, y, 33.9, 'WEIGHT LIMIT', (d) => str(d.weight_limit), 'weight_limit'),
  );
  y += ROW + 1;

  // ── 8. Offense table ────────────────────────────────────
  f.push({
    x: 0, y, w: W, h: 4, style: 'label', bold: true, fontSize: 7.5,
    label: 'THE ABOVE NAMED DEFENDANT IS CHARGED WITH',
  });
  y += 4;
  const COLS: [number, number, string][] = [
    [0, 12, 'COUNT'], [12, 72, 'VIOLATION'], [84, 30, 'CODE'], [114, 18, 'U / CO / CY'],
    [132, 18, 'SEVERITY'], [150, 24, 'FINAL CHARGE'], [174, 21.9, 'PLEA/FINDING'],
  ];
  for (const [x, w, label] of COLS) {
    f.push({ x, y, w, h: 5, style: 'box', label, fontSize: LBL, align: 'center' });
  }
  y += 5;
  const offenseTop = y;
  for (let i = 0; i < 4; i++) {
    const rowY = offenseTop + i * ROW;
    const pick = <K extends keyof CitationUtahViolation>(d: CitationUtahData, key: K): string => {
      const v = d.violations?.[i];
      if (v) return str(v[key]);
      return '';
    };
    // Row 1 falls back to the flat single-violation columns on `citations`;
    // rows 2-4 only render when a multi-violation array supplies them.
    const shown = (d: CitationUtahData) => i === 0 || (d.violations?.length ?? 0) > i;
    f.push(
      { x: 0, y: rowY, w: 12, h: ROW, style: 'box', label: String(i + 1), align: 'center', fontSize: VAL },
      {
        x: 12, y: rowY, w: 72, h: ROW, style: 'box', fontSize: VAL, visibleIf: shown,
        accessor: (d) => pick(d, 'description') || (i === 0 ? str(d.violation_description) : ''),
        path: i === 0 ? 'violation_description' : undefined,
      },
      {
        x: 84, y: rowY, w: 30, h: ROW, style: 'box', fontSize: VAL, visibleIf: shown,
        accessor: (d) => pick(d, 'statute_citation') || (i === 0 ? str(d.statute_citation) : ''),
        path: i === 0 ? 'statute_citation' : undefined,
      },
      {
        x: 114, y: rowY, w: 18, h: ROW, style: 'box', fontSize: VAL, align: 'center', visibleIf: shown,
        accessor: (d) => pick(d, 'code_type'),
      },
      {
        x: 132, y: rowY, w: 18, h: ROW, style: 'box', fontSize: VAL, align: 'center', visibleIf: shown,
        accessor: (d) => pick(d, 'severity') || (i === 0 ? str(d.offense_level) : ''),
        path: i === 0 ? 'offense_level' : undefined,
      },
      {
        x: 150, y: rowY, w: 24, h: ROW, style: 'box', fontSize: VAL, visibleIf: shown,
        accessor: (d) => pick(d, 'final_charge') || (i === 0 ? str(d.final_charge) : ''),
        path: i === 0 ? 'final_charge' : undefined,
      },
      {
        x: 174, y: rowY, w: 21.9, h: ROW, style: 'box', fontSize: VAL, align: 'center', visibleIf: shown,
        accessor: (d) => pick(d, 'plea') || (i === 0 ? str(d.plea) : ''),
        path: i === 0 ? 'plea' : undefined,
      },
    );
  }
  y = offenseTop + 4 * ROW + 1;

  // ── 9. Incident ─────────────────────────────────────────
  f.push(
    cell(0, y, 78, 'LOCATION', (d) => str(d.location), 'location'),
    cell(78, y, 28, 'DATE', (d) => str(d.violation_date), 'violation_date'),
    cell(106, y, 20, 'TIME', (d) => str(d.violation_time), 'violation_time', { align: 'center' }),
    cell(126, y, 24, 'MILE POST', (d) => str(d.mile_post), 'mile_post', { align: 'center' }),
    cell(150, y, 24, 'DIRECTION OF', (d) => str(d.direction_of_travel), 'direction_of_travel', { align: 'center' }),
    cell(174, y, 21.9, 'POSTED', (d) => str(d.speed_limit), 'speed_limit', { align: 'center' }),
  );
  y += ROW;
  f.push(
    cell(0, y, 45, 'CITY', (d) => str(d.incident_city), 'incident_city'),
    cell(45, y, 40, 'COUNTY', (d) => str(d.incident_county), 'incident_county'),
    cell(85, y, 28, 'ALCOHOL BAC', (d) => str(d.bac_level), 'bac_level', { align: 'center' }),
    cell(113, y, 26, 'SPEED', (d) => str(d.speed_recorded), 'speed_recorded', { align: 'center' }),
    cell(139, y, 28, 'RADAR/LIDAR', (d) => str(d.radar_type), 'radar_type'),
    {
      x: 167, y, w: 28.9, h: ROW, style: 'box', label: 'TOTAL FINE', align: 'right', bold: true, fontSize: VAL,
      accessor: (d) => {
        const fromViolations = (d.violations ?? []).reduce((s, v) => s + (Number(v.fine_amount) || 0), 0);
        const total = fromViolations > 0 ? fromViolations : Number(d.fine_amount) || 0;
        return total > 0 ? fmtFine(total) : '';
      },
    },
  );
  y += ROW;
  f.push(...ynPair(0, y, 'MILITARY', (d) => d.military, 'military'));
  y += 6.5;

  // ── 10. Notice to appear ────────────────────────────────
  f.push({
    x: 0, y, w: W, h: 4, style: 'label', bold: true, fontSize: 7.5,
    label: 'THE DEFENDANT IS GIVEN NOTICE TO APPEAR', visibleIf: showSummons,
  });
  y += 4;
  f.push(
    cell(0, y, 100, 'MUST APPEAR IN:', (d) => str(d.court_name), 'court_name'),
    cell(100, y, 45, 'PHONE #', (d) => str(d.court_phone), 'court_phone'),
    cell(145, y, 50.9, 'ROOM', (d) => str(d.court_room), 'court_room'),
  );
  y += ROW;
  f.push(
    cell(0, y, 125, 'LOCATED AT', (d) => str(d.court_address), 'court_address'),
    cell(125, y, 40, 'DATE', (d) => str(d.court_date), 'court_date'),
    cell(165, y, 30.9, 'TIME', (d) => str(d.court_time), 'court_time', { align: 'center' }),
  );
  y += ROW;
  f.push({
    x: 0, y, w: W, h: 9, style: 'paragraph', label: SUMMONS_WARNING,
    fontSize: TINY, lineHeight: 2.4, visibleIf: showSummons,
  });
  y += 9.5;

  // ── 11. Certification + officer ─────────────────────────
  f.push({
    x: 0, y, w: W, h: 8, style: 'paragraph', label: NOT_AN_INFORMATION,
    fontSize: TINY, lineHeight: 2.4, visibleIf: showSummons,
  });
  y += 8.5;
  f.push({
    x: 0, y, w: W, h: 8, style: 'paragraph', label: CERTIFICATION, fontSize: TINY, lineHeight: 2.4,
  });
  y += 8.5;
  f.push(
    cell(0, y, 60, 'OFFICER', (d) => str(d.issuing_officer_name), 'issuing_officer_name'),
    cell(60, y, 25, 'ID#', (d) => str(d.officer_id_number ?? d.badge_number), 'officer_id_number'),
    cell(85, y, 50, 'COMPLAINANT', (d) => str(d.complainant), 'complainant'),
    cell(135, y, 60.9, 'TELEPHONE NUMBER', (d) => str(d.complainant_phone ?? d.agency_phone), 'complainant_phone'),
  );
  y += ROW;
  f.push(
    {
      x: 0, y, w: 90, h: 7, style: 'signature', label: 'Signature of Officer',
      accessor: (d) => ({ image: d.signature_image ?? undefined }), path: 'signature_image',
    },
    cell(92, y, 40, 'DATE', (d) => str(d.signature_date ?? d.violation_date), 'signature_date'),
    {
      x: 134, y, w: 61.9, h: 7, style: 'signature', label: 'Signature of Defendant',
      accessor: (d) => (d.defendant_refused ? '' : { image: d.defendant_signature_image ?? undefined }),
      path: 'defendant_signature_image', visibleIf: showSummons,
    },
  );
  y += 8;

  // ── 12. Court disposition strip ─────────────────────────
  f.push(
    { x: 0, y, w: W, h: 30, style: 'rect' },
    { x: 1, y: y + 0.5, w: 60, h: 4, style: 'label', label: 'COURT USE ONLY', bold: true, fontSize: 7 },
  );
  const dispTop = y + 4.5;
  f.push(
    { x: 2, y: dispTop, w: 24, h: 3.6, style: 'label', label: 'PLEA/FINDING', fontSize: LBL, bold: true },
    { x: 28, y: dispTop, w: 8, h: 3.6, style: 'checkbox', label: 'Guilty', fontSize: LBL, accessor: (d) => d.plea === 'guilty' },
    { x: 50, y: dispTop, w: 8, h: 3.6, style: 'checkbox', label: 'Not Guilty', fontSize: LBL, accessor: (d) => d.plea === 'not_guilty' },
    { x: 80, y: dispTop, w: 8, h: 3.6, style: 'checkbox', label: 'No Contest', fontSize: LBL, accessor: (d) => d.plea === 'no_contest' },
    { x: 116, y: dispTop, w: 14, h: 3.6, style: 'label', label: 'FELONY', fontSize: LBL, bold: true },
    { x: 132, y: dispTop, w: 8, h: 3.6, style: 'checkbox', label: 'Death', fontSize: LBL, accessor: (d) => !!d.felony_death, path: 'felony_death' },
    { x: 158, y: dispTop, w: 8, h: 3.6, style: 'checkbox', label: 'Serious Bodily', fontSize: LBL, accessor: (d) => !!d.felony_serious_bodily, path: 'felony_serious_bodily' },
  );
  const dispRow2 = dispTop + 5;
  f.push(
    { x: 2, y: dispRow2, w: 24, h: 3.6, style: 'label', label: 'DISPOSITION', fontSize: LBL, bold: true },
    { x: 28, y: dispRow2, w: 8, h: 3.6, style: 'checkbox', label: 'Dismissed', fontSize: LBL, accessor: (d) => d.disposition === 'dismissed' },
    { x: 56, y: dispRow2, w: 8, h: 3.6, style: 'checkbox', label: 'Diversion', fontSize: LBL, accessor: (d) => d.disposition === 'diversion' },
    { x: 84, y: dispRow2, w: 8, h: 3.6, style: 'checkbox', label: 'Plea in Abeyance', fontSize: LBL, accessor: (d) => d.disposition === 'plea_in_abeyance' },
    { x: 130, y: dispRow2, w: 8, h: 3.6, style: 'checkbox', label: 'Declination', fontSize: LBL, accessor: (d) => d.disposition === 'declination' },
  );
  const dispRow3 = dispRow2 + 5;
  f.push(
    cell(2, dispRow3, 34, 'FINE', (d) => fmtFine(d.fine_imposed), 'fine_imposed', { h: 5.6, align: 'right' }),
    cell(36, dispRow3, 34, 'SUSPENDED', (d) => fmtFine(d.fine_suspended), 'fine_suspended', { h: 5.6, align: 'right' }),
    cell(70, dispRow3, 34, 'JAIL (DAYS)', (d) => str(d.jail_days), 'jail_days', { h: 5.6, align: 'right' }),
    cell(104, dispRow3, 34, 'SUSPENDED', (d) => str(d.jail_suspended), 'jail_suspended', { h: 5.6, align: 'right' }),
    cell(138, dispRow3, 55.9, 'DOCKET', (d) => str(d.docket_number), 'docket_number', { h: 5.6 }),
  );
  const dispRow4 = dispRow3 + 6;
  f.push(
    cell(2, dispRow4, 50, 'DATE OF CONVICTION/FORFEITURE', (d) => str(d.conviction_date), 'conviction_date', { h: 5.6, fontSize: 7 }),
    cell(52, dispRow4, 40, 'DATE SENT TO DLD', (d) => str(d.date_sent_to_dld), 'date_sent_to_dld', { h: 5.6, fontSize: 7 }),
    cell(92, dispRow4, 101.9, 'SIGNATURE OF JUDGE OR COURT CLERK', (d) => str(d.judge_name), 'judge_name', { h: 5.6, fontSize: 7 }),
  );
  y += 31;

  // ── 13. Payment + READ CAREFULLY ────────────────────────
  f.push(
    { x: 0, y, w: 35, h: 4, style: 'label', label: 'READ CAREFULLY', bold: true, fontSize: 7 },
    { x: 36, y, w: 159.9, h: 4, style: 'paragraph', label: PAYMENT_LINE, fontSize: TINY, lineHeight: 2.4 },
  );
  y += 5;

  return f;
}

const MASTER_FIELDS = buildMasterFields();

/**
 * Height of the form content, DERIVED from the built fields rather than
 * hand-maintained — a hardcoded constant drifts the moment a block grows
 * and the overflow is invisible until someone reads a printed copy.
 *
 * The copy-designation strip is page-anchored at (pageHeight - 25mm), so
 * the unit test asserts this still clears it.
 */
export const FORM_CONTENT_HEIGHT = Math.ceil(
  MASTER_FIELDS.reduce((max, f) => Math.max(max, f.y + f.h), 0),
);

// Copy-strip labels — rendered by the multi-copy wrapper at the bottom
// of each page. Wording matches the designations printed on the official
// 4-part set (the filed sample carries "ISSUING AGENCY COPY").
export const COPY_STRIP_LABELS: Record<CitationCopyKind, string> = {
  court: 'COURT COPY',
  agency: 'ISSUING AGENCY COPY',
  defendant: 'DEFENDANT COPY',
  file: 'OFFICER FILE COPY',
};

// ── Form schema ────────────────────────────────────────────

export const citationUtahMasterSchema: FormSchema<CitationUtahData> = {
  meta: {
    formNumber: 'UT-UNIFORM-CITATION',
    title: 'UNIFORM CITATION OR INFORMATION AND SUMMONS TO APPEAR',
    revision: '10/13',
  },
  header: {
    kind: 'default',
    formId: 'citation-utah-master',
    caseNumberAccessor: (d) => d.citation_number ?? undefined,
    caseLabel: 'CITATION',
  },
  sections: [
    {
      kind: 'fixed-layout',
      height: FORM_CONTENT_HEIGHT,
      fields: MASTER_FIELDS,
    } as FixedLayoutSection<CitationUtahData>,
  ],
  footer: {
    kind: 'default',
    showRevision: true,
    showPageNumbers: true,
  },
};

/**
 * Extract the canonical data bag for the sidecar. Round-trip contract:
 * re-render(extractSidecar(pdf).data) produces the same canonical bytes.
 *
 * The bottom-strip copyKind is NOT included — it's a per-page render
 * detail, not part of the citation's canonical data.
 */
export function citationUtahMasterCanonicalData(d: CitationUtahData): Record<string, unknown> {
  const bag: Record<string, unknown> = {};
  for (const section of citationUtahMasterSchema.sections) {
    if (typeof section === 'function') continue;
    if ((section as FixedLayoutSection<CitationUtahData>).kind !== 'fixed-layout') continue;
    const fixed = section as FixedLayoutSection<CitationUtahData>;
    for (const f of fixed.fields) {
      if (!f.path || !f.accessor) continue;
      const raw = f.accessor(d);
      if (raw && typeof raw === 'object' && 'image' in raw) {
        // Signature fields carry {image}; store the data URL only.
        if (raw.image != null) bag[f.path] = raw.image;
      } else if (raw != null && raw !== '') {
        bag[f.path] = raw;
      }
    }
  }
  if (Array.isArray(d.violations) && d.violations.length > 0) {
    bag.violations = d.violations;
  }
  return bag;
}
