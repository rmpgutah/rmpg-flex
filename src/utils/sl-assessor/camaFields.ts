// src/utils/sl-assessor/camaFields.ts
//
// SINGLE SOURCE OF TRUTH for the Salt Lake County CAMA field set.
//
// The parser, the D1 schema (migration 0221 + the db.ts boot reconciler), and
// the API response shape are all derived from the tables below. Adding a field
// to the county's report means adding ONE entry here — never editing three
// files that then drift apart.
//
// ── Where this came from ──────────────────────────────────────────────────
// Captured live on 2026-08-01 from the richest of the county's four detail
// renderings, for parcel 16-31-127-029-0000:
//
//   https://apps.saltlakecounty.gov/assessor/new/PubMore/detail.cfm
//     ?parcel_id=16311270290000
//
// Verbatim fixture: tests/fixtures/sl-assessor/pubmore-detail.html
//
// ⚠️ USE PubMore/detail.cfm, NOT valuationInfoExpanded.cfm. The four variants
// are NOT equivalent, and the difference is not cosmetic:
//
//   PubMore/detail.cfm          139 rows, values DECODED  ("ROW-END-TOWN")
//   detailNew.cfm                ~95 rows, values as CODES ("RE")
//   valuationInfoExpanded.cfm    ~95 rows, values as CODES, residence block
//                                rendered as value-before-label <div>s
//   Query/valuationinfoPrint.cfm  reduced print view
//
// The expanded page also OMITS ~45 fields entirely (Foundation, Msnry Trim,
// RCN/RCNLD, Percent Good, MLS Number, B of E, GreenBelt, Driveway, Std Lot
// Sz, the whole Cost/Sel valuation block).
//
// ⚠️ THE COUNTY'S OWN FIELD CODES ARE NOT UNIQUE — do not key on them.
// Each value cell carries <a href=javascript:newwin('<section>','<table>',
// '<code>')>, and `code` looks like a stable machine key, but the county
// reuses several:
//
//   heattype   → Heating, Foundation, Msnry Trim        (3 fields, 1 code)
//   finfire    → Finished Fire places, Unfinished ...   (2 fields, 1 code)
//   carportarea→ Carport Sqft., Carport Capacity        (2 fields, 1 code)
//   traffic    → Traffic, Traffic Count                 (2 fields, 1 code)
//   zone       → Zone, Water                            (2 fields, 1 code)
//
// Keying on `code` alone silently collapses 11 distinct fields into 5. The
// parser therefore keys on (section, label) and uses `code` only as a
// corroborating hint. The `code` is still recorded here because it is what
// disambiguates a row when the county rewords a LABEL.
//
// The SECTION prefix is load-bearing for a different reason: "Land Value" and
// "Sound Value" appear in BOTH the land record and the valuation block with
// different meanings, so a section-blind label match binds the wrong number.

/** Which block of the report a field belongs to. Matches the county's own
 *  first `newwin` argument: res | par | val | lnd. */
export type CamaSection = 'residence' | 'parcel' | 'valuation' | 'land';

/** How a raw cell string is coerced before it reaches D1. */
export type CamaType = 'text' | 'int' | 'real';

export interface CamaField {
  /** snake_case D1 column name (or JSON key, for the land block). */
  col: string;
  /** Verbatim label as the county renders it — the primary match key. */
  label: string;
  /** The county's `newwin` field code. NOT unique — a hint only. */
  code: string;
  type: CamaType;
}

/** D1 column type for a CamaType. */
export function sqlType(t: CamaType): string {
  return t === 'text' ? 'TEXT' : t === 'int' ? 'INTEGER' : 'REAL';
}

// ── Residence Record → parcel_residence (1:1) ────────────────────────────
// 54 fields. Split into its own table rather than widened onto
// parcel_records because parcel_records already carries 46 columns and
// D1 caps a SELECT result set at ~100 (CLAUDE.md rule #19).
export const RESIDENCE_FIELDS: CamaField[] = [
  { col: 'building_style',           label: 'Building Style',           code: 'bldstyle',        type: 'text' },
  { col: 'assessment_classification',label: 'Assessment Classification',code: 'resclass',        type: 'text' },
  { col: 'exterior_wall_type',       label: 'Exterior Wall Type',       code: 'extwall',         type: 'text' },
  { col: 'roofing',                  label: 'Roofing',                  code: 'roofing',         type: 'text' },
  { col: 'central_ac',               label: 'Central AC',               code: 'cac',             type: 'text' },
  { col: 'heating',                  label: 'Heating',                  code: 'heattype',        type: 'text' },
  { col: 'foundation',               label: 'Foundation',               code: 'heattype',        type: 'text' },
  { col: 'msnry_trim',               label: 'Msnry Trim',               code: 'heattype',        type: 'text' },
  { col: 'owner_occupied',           label: 'Owner Occupied',           code: 'owenerocc',       type: 'text' },
  { col: 'number_of_stories',        label: 'Number of Stories',        code: 'numstories',      type: 'real' },
  { col: 'total_rooms',              label: 'Total Rooms',              code: 'totrooms',        type: 'int'  },
  { col: 'bedrooms',                 label: 'Bedrooms',                 code: 'numbedrooms',     type: 'int'  },
  { col: 'full_baths',               label: 'Full Baths',               code: 'fullbaths',       type: 'int'  },
  // NOT `3_4_baths` — a leading digit is not a bare SQL identifier.
  { col: 'three_quarter_baths',      label: '3/4 Baths',                code: 'tqbths',          type: 'int'  },
  { col: 'half_baths',               label: 'Half Baths',               code: 'halfbaths',       type: 'int'  },
  { col: 'number_of_kitchens',       label: 'Number of Kitchens',       code: 'numkitchens',     type: 'int'  },
  { col: 'finished_fire_places',     label: 'Finished Fire places',     code: 'finfire',         type: 'int'  },
  { col: 'unfinished_fire_places',   label: 'Unfinished Fire places',   code: 'finfire',         type: 'int'  },
  { col: 'year_built',               label: 'Year Built',               code: 'yearbuilt',       type: 'int'  },
  { col: 'effective_year_built',     label: 'Effective Year Built',     code: 'effyb',           type: 'int'  },
  { col: 'interior_grade',           label: 'Interior Grade',           code: 'intgrd',          type: 'text' },
  { col: 'interior_condition',       label: 'Interior Condition',       code: 'intcond',         type: 'text' },
  { col: 'exterior_grade',           label: 'Exterior Grade',           code: 'extgrad',         type: 'text' },
  { col: 'exterior_condition',       label: 'Exterior Condition',       code: 'extcond',         type: 'text' },
  { col: 'overall_grade',            label: 'Overall Grade',            code: 'overallg',        type: 'text' },
  { col: 'overall_condition',        label: 'Overall Condition',        code: 'overallcond',     type: 'text' },
  { col: 'visual_appeal',            label: 'Visual Appeal',            code: 'visual_app',      type: 'text' },
  { col: 'maintenance',              label: 'Maintenance',              code: 'maintenace',      type: 'text' },
  { col: 'conformity',               label: 'Conformity',               code: 'comformity',      type: 'text' },
  { col: 'livability',               label: 'Livability',               code: 'livability',      type: 'text' },
  { col: 'primary_kitchen_quality',  label: 'Primary Kitchen Quality',  code: 'prikitqual',      type: 'text' },
  { col: 'primary_bath_quality',     label: 'Primary Bath Quality',     code: 'pribathq',        type: 'text' },
  { col: 'main_floor_area',          label: 'Main Floor Area',          code: 'mainarea',        type: 'int'  },
  { col: 'upper_floor_area',         label: 'Upper Floor Area',         code: 'uperarea',        type: 'int'  },
  { col: 'finished_attic_area',      label: 'Finished Attic Area',      code: 'finattic',        type: 'int'  },
  { col: 'above_grade_area',         label: 'Above Grade Area',         code: 'abovegrade',      type: 'int'  },
  { col: 'basement_area',            label: 'Basement Area',            code: 'basementarea',    type: 'int'  },
  { col: 'finished_basement_area',   label: 'Finished Basement Area',   code: 'finbasearea',     type: 'int'  },
  { col: 'finished_basement_grade',  label: 'Finished Basement Grade',  code: 'finbasegrade',    type: 'text' },
  { col: 'carport_sqft',             label: 'Carport Sqft.',            code: 'carportarea',     type: 'int'  },
  { col: 'carport_capacity',         label: 'Carport Capacity',         code: 'carportarea',     type: 'int'  },
  { col: 'attached_garage_sqft',     label: 'Attached Garage Sqft.',    code: 'attachedgarea',   type: 'int'  },
  { col: 'builtin_garage_sqft',      label: 'Builtin Garage Sqft.',     code: 'bltingrarea',     type: 'int'  },
  { col: 'basement_garage_sqft',     label: 'Basement Garage Sqft.',    code: 'basegrarea',      type: 'int'  },
  { col: 'unfinished_area',          label: 'Unfinished Area',          code: 'unfinarea',       type: 'int'  },
  // Replacement Cost New / ... Less Depreciation — the cost-approach basis.
  { col: 'rcn',                      label: 'RCN',                      code: 'rcn',             type: 'int'  },
  { col: 'rcnld',                    label: 'RCNLD',                    code: 'rcnld',           type: 'int'  },
  { col: 'physical_prcnt_good',      label: 'Physical Prcnt Good',      code: 'phyPctGood',      type: 'real' },
  { col: 'economic_prcnt_good',      label: 'Economic Prcnt Good',      code: 'ecoPctGood',      type: 'real' },
  { col: 'functional_prcnt_good',    label: 'Functional Prcnt Good',    code: 'funPctGood',      type: 'real' },
  { col: 'sound_value',              label: 'Sound Value',              code: 'soundValue',      type: 'int'  },
  { col: 'misc_structure_value',     label: 'Misc Structure Value',     code: 'miscStrVal',      type: 'int'  },
  { col: 'misc_attached_structure',  label: 'Misc Attached Structure',  code: 'MiscAttStr',      type: 'text' },
  { col: 'percent_complete',         label: 'Percent Complete',         code: 'percentcomplete', type: 'int'  },
];

// ── Parcel Record → parcel_records (widened) ─────────────────────────────
// Prefixed `par_` so none of these can collide with the 46 columns
// parcel_records already has (e.g. its existing `tax_district`, which is
// populated from the summary block and predates this registry).
export const PARCEL_FIELDS: CamaField[] = [
  { col: 'par_total_acreage',        label: 'Total Acreage',        code: 'totacres',        type: 'real' },
  { col: 'par_eco_unit_acres',       label: 'Eco. Unit Acres',      code: 'econ_unit_acres', type: 'real' },
  { col: 'par_owner_occupied',       label: 'Owner Occupied',       code: 'ownerOccupied',   type: 'text' },
  { col: 'par_site_name',            label: 'Site Name',            code: 'prev_site_nm',    type: 'text' },
  { col: 'par_building_permit',      label: 'Building Permit',      code: 'buildingpermit',  type: 'text' },
  { col: 'par_tax_class_id',         label: 'Tax Class Id',         code: 'taxclassid',      type: 'text' },
  { col: 'par_property_type',        label: 'Property Type',        code: 'propertytype',    type: 'text' },
  { col: 'par_tax_district',         label: 'Tax District',         code: 'taxdistrict',     type: 'text' },
  { col: 'par_tax_district_location',label: 'Tax District Location',code: 'taxdistrictLoc',  type: 'text' },
  { col: 'par_pct_exempt',           label: '% Exempt',             code: 'percentexempt',   type: 'real' },
  { col: 'par_exempt_type',          label: 'Exempt Type',          code: 'exempttype',      type: 'text' },
  { col: 'par_b_of_e',               label: 'B of E',               code: 'Bofe',            type: 'text' },
  { col: 'par_residential_exemption',label: 'Residential Exemption',code: 'ResExmpt',        type: 'text' },
  { col: 'par_detail_year',          label: 'Detail Year',          code: 'detailyear',      type: 'int'  },
  { col: 'par_new_growth_year',      label: 'New Growth Year',      code: 'newgrowthyear',   type: 'int'  },
  { col: 'par_new_growth_pct',       label: 'New Growth Pct',       code: 'newgrowthpct',    type: 'real' },
  { col: 'par_new_growth_amount',    label: 'New Growth Amount',    code: 'newgrowthamount', type: 'int'  },
  { col: 'par_update_year',          label: 'Update Year',          code: 'updateyear',      type: 'int'  },
  { col: 'par_reinspection',         label: 'Reinspection',         code: 'reinspection',    type: 'text' },
  { col: 'par_total_associated',     label: 'Total Asscociated',    code: 'totalass',        type: 'text' },
  // No `newwin` wrapper on the page — matched by label alone.
  { col: 'par_mls_number',           label: 'MLS Number',           code: '',                type: 'text' },
];

// ── Valuation / Tax Year → parcel_records (widened) ──────────────────────
// "Land Value" and "Sound Value" also exist in the land block with different
// meanings; the `val_` prefix and the section-scoped match keep them apart.
export const VALUATION_FIELDS: CamaField[] = [
  { col: 'val_land_value',           label: 'Land Value',           code: 'landvalue',  type: 'int'  },
  { col: 'val_building_value',       label: 'Building Value',       code: 'buildvalue', type: 'int'  },
  { col: 'val_final_value',          label: 'Final Value:',         code: 'finallvalue',type: 'int'  },
  { col: 'val_taxable_value',        label: 'Taxable Value',        code: '',           type: 'int'  },
  { col: 'val_cost_land',            label: 'Cost Land',            code: '',           type: 'int'  },
  { col: 'val_rcn',                  label: 'RCN',                  code: '',           type: 'int'  },
  { col: 'val_rcnld',                label: 'RCNLD',                code: '',           type: 'int'  },
  { col: 'val_cost_total',           label: 'Cost Total',           code: '',           type: 'int'  },
  { col: 'val_cost_date',            label: 'Cost Date',            code: '',           type: 'text' },
  { col: 'val_additional_land_val',  label: 'Additional Land Val',  code: '',           type: 'int'  },
  { col: 'val_additional_bldg_val',  label: 'Additional Bldg Val',  code: '',           type: 'int'  },
  { col: 'val_inc_calc_by',          label: 'Inc Calc By',          code: '',           type: 'text' },
  { col: 'val_comp_est',             label: 'Comp Est',             code: '',           type: 'int'  },
  { col: 'val_comp_sel_date',        label: 'Comp Sel Date',        code: '',           type: 'text' },
  { col: 'val_sel_land_val',         label: 'Sel Land Val',         code: '',           type: 'int'  },
  { col: 'val_sel_bldg_val',         label: 'Sel Bldg Val',         code: '',           type: 'int'  },
  { col: 'val_sel_val',              label: 'Sel Val',              code: '',           type: 'int'  },
  { col: 'val_sel_source',           label: 'Sel Source',           code: '',           type: 'text' },
  { col: 'val_bldg_factor',          label: 'Bldg Factor',          code: '',           type: 'real' },
  // Rendered as the literal string "not set" when absent — kept TEXT rather
  // than REAL so that distinction survives instead of coercing to NULL.
  { col: 'val_tax_rate',             label: 'Tax Rate',             code: '',           type: 'text' },
  { col: 'val_economic_tot_val',     label: 'Economic Tot Val',     code: '',           type: 'int'  },
];

// ── Land Record → parcel_records.land_records_json (1:N) ─────────────────
// JSON, not columns, and not by preference: this is genuinely 1:N. The
// reference parcel has TWO land records ("1 of 2" — a PRIMARY-LOT and a
// RESIDUL-ACRE), and NO column layout can hold record 2. The pre-existing
// parser matched `<th>Acres</th><td>0.06</td><td>0.01</td>` and kept only
// the first cell, silently discarding the second record.
export const LAND_FIELDS: CamaField[] = [
  { col: 'lot_use',            label: 'Lot Use',            code: 'lotuse',       type: 'text' },
  { col: 'lot_type',           label: 'Lot Type',           code: 'lottype',      type: 'text' },
  { col: 'land_class',         label: 'Land Class',         code: 'landclass',    type: 'text' },
  { col: 'income_flag',        label: 'Income Flag',        code: 'incomeflag',   type: 'text' },
  { col: 'seasonal_use',       label: 'Seasonal use',       code: 'seasonaluse',  type: 'text' },
  { col: 'influence_type',     label: 'Influence Type',     code: 'inftype',      type: 'text' },
  { col: 'influence_effect',   label: 'Influence Effect',   code: 'infeffect',    type: 'text' },
  { col: 'l_assessment_class', label: 'L Assessment Class', code: 'lndassesscls', type: 'text' },
  { col: 'eff_front',          label: 'Eff. Front',         code: 'efffront',     type: 'real' },
  { col: 'lot_depth',          label: 'Lot Depth',          code: 'lotdepth',     type: 'real' },
  { col: 'sqr_feet',           label: 'Sqr. Feet',          code: 'sqrfeet',      type: 'int'  },
  // The county's own typo — the code really is 'arces', not 'acres'.
  { col: 'acres',              label: 'Acres',              code: 'arces',        type: 'real' },
  { col: 'sewer',              label: 'Sewer',              code: 'sewer',        type: 'text' },
  { col: 'number_lots',        label: 'Number Lots',        code: 'numblots',     type: 'int'  },
  { col: 'std_lot_sz',         label: 'Std Lot Sz',         code: 'lotsz',        type: 'real' },
  { col: 'rate_overide',       label: 'Rate Overide',       code: 'rateovr',      type: 'text' },
  { col: 'zone',               label: 'Zone',               code: 'zone',         type: 'text' },
  { col: 'water_available',    label: 'Water Available',    code: 'water',        type: 'text' },
  { col: 'off_street_park',    label: 'Off Street Park.',   code: 'offstreetp',   type: 'text' },
  { col: 'driveway_access',    label: 'Driveway Access',    code: 'driveacc',     type: 'text' },
  { col: 'driveway_type',      label: 'Driveway Type',      code: 'drivetyp',     type: 'text' },
  { col: 'lot_shape',          label: 'Lot Shape',          code: 'lotshape',     type: 'text' },
  { col: 'lot_location',       label: 'Lot Location',       code: 'lotlocation',  type: 'text' },
  { col: 'neighborhood',       label: 'Neighborhood',       code: 'nbhd',         type: 'text' },
  { col: 'nbhd_group',         label: 'Nbhd Group',         code: 'nbhdgroup',    type: 'text' },
  { col: 'nbhd_type',          label: 'Nbhd Type',          code: 'nbhdtype',     type: 'text' },
  { col: 'nbhd_effect',        label: 'Nbhd Effect',        code: 'nbhdeffect',   type: 'text' },
  { col: 'topography',         label: 'Topography',         code: 'topography',   type: 'text' },
  { col: 'traffic',            label: 'Traffic',            code: 'traffic',      type: 'text' },
  { col: 'traffic_count',      label: 'Traffic Count',      code: 'traffic',      type: 'int'  },
  { col: 'traffic_influence',  label: 'Traffic Influence',  code: 'trfinfl',      type: 'text' },
  { col: 'street_type',        label: 'Street type',        code: 'streettype',   type: 'text' },
  { col: 'street_finish',      label: 'Street Finish',      code: 'streetfinish', type: 'text' },
  { col: 'curb_gutter',        label: 'Curb Gutter',        code: 'curbgutter',   type: 'text' },
  { col: 'sidewalk',           label: 'Sidewalk',           code: 'sidewalk',     type: 'text' },
  { col: 'wooded',             label: 'Wooded',             code: 'wooded',       type: 'text' },
  { col: 'winter_use',         label: 'Winter Use',         code: 'winteruse',    type: 'text' },
  { col: 'land_view',          label: 'Land View',          code: 'landview',     type: 'text' },
  { col: 'external_neg',       label: 'External Neg.',      code: 'extneg',       type: 'text' },
  // County bug: this row reuses the 'zone' code. Label match is what saves it.
  { col: 'water',              label: 'Water',              code: 'zone',         type: 'text' },
  { col: 'privacy',            label: 'Privacy',            code: 'privacy',      type: 'text' },
  { col: 'equestrian',         label: 'Equestrian',         code: 'equestr',      type: 'text' },
  { col: 'golf',               label: 'Golf',               code: 'golf',         type: 'text' },
  { col: 'mob_lot',            label: 'Mob Lot',            code: 'moblot',       type: 'text' },
  { col: 'land_value',         label: 'Land Value',         code: 'lndvalue',     type: 'int'  },
  { col: 'sound_value',        label: 'Sound Value',        code: 'soundval',     type: 'int'  },
  { col: 'greenbelt_date',     label: 'GreenBelt Date',     code: 'gbdate',       type: 'text' },
  { col: 'greenblt_audit_dt',  label: 'GreenBlt Audit Dt',  code: 'gbaudate',     type: 'text' },
  { col: 'greenbelt_value',    label: 'GreenBelt Value',    code: 'gbvalue',      type: 'int'  },
  { col: 'greenbelt_auditor',  label: 'GreenBelt Auditor',  code: 'gbaud',        type: 'text' },
];

/** Keys of one entry in parcel_records.value_history_json. */
export const VALUE_HISTORY_KEYS = [
  'tax_year', 'record_id', 'land_value', 'building_value', 'market_value',
  'taxable_value', 'tax_rate',
] as const;

/** Every field that becomes a real D1 column on parcel_records. */
export const PARCEL_RECORD_EXTRA_FIELDS: CamaField[] = [
  ...PARCEL_FIELDS,
  ...VALUATION_FIELDS,
];

/** Columns added to parcel_records that are NOT part of a labelled section:
 *  the coordinates the page exposes via <var id="polyx"/"polyy">, and the
 *  two 1:N blocks stored as JSON. */
export const PARCEL_RECORD_STRUCTURAL_COLUMNS: Array<[string, string]> = [
  ['latitude', 'REAL'],
  ['longitude', 'REAL'],
  ['land_records_json', 'TEXT'],
  ['value_history_json', 'TEXT'],
  ['cama_as_of', 'TEXT'],       // the page's own "CAMA data as it was on <date>"
  ['cama_source_variant', 'TEXT'], // which of the 4 renderings we parsed
];

/** Look a field up by section + verbatim label. Built once at module load. */
function indexBy(fields: CamaField[]): Map<string, CamaField> {
  const m = new Map<string, CamaField>();
  for (const f of fields) m.set(normalizeLabel(f.label), f);
  return m;
}

/** Labels are compared case- and punctuation-insensitively so a county
 *  re-word like "Sqr. Feet" → "Sqr Feet" doesn't drop the field. */
export function normalizeLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9/]+/g, ' ').trim();
}

export const SECTION_FIELDS: Record<CamaSection, CamaField[]> = {
  residence: RESIDENCE_FIELDS,
  parcel: PARCEL_FIELDS,
  valuation: VALUATION_FIELDS,
  land: LAND_FIELDS,
};

export const SECTION_INDEX: Record<CamaSection, Map<string, CamaField>> = {
  residence: indexBy(RESIDENCE_FIELDS),
  parcel: indexBy(PARCEL_FIELDS),
  valuation: indexBy(VALUATION_FIELDS),
  land: indexBy(LAND_FIELDS),
};

/** The county's `newwin` section argument → our CamaSection. */
export const CODE_SECTION_TO_SECTION: Record<string, CamaSection> = {
  res: 'residence',
  par: 'parcel',
  val: 'valuation',
  lnd: 'land',
};

/** Total field count, asserted by tests so a partial edit is caught. */
export const TOTAL_CAMA_FIELDS =
  RESIDENCE_FIELDS.length + PARCEL_FIELDS.length +
  VALUATION_FIELDS.length + LAND_FIELDS.length;

// ── Curated promotion onto businesses / properties ───────────────────────
// The operational record cards keep a SMALL, deliberately chosen subset —
// the fields an officer reads at a glance on a property. Everything else
// stays in parcel_records / parcel_residence, reachable by parcel_number.
//
// ⚠️ These ALTER two already-wide operational tables. They are not in
// scripts/check-column-cap.js's watched set (which guards calls_for_service
// and persons), but the same D1 ~100-column SELECT cap applies, and list
// endpoints do select broadly from businesses/properties. Verify with
// pragma_table_info before adding more.
//
// `source` names where the value comes from in the CamaParcel, so
// autofill.ts and the migration cannot disagree.
export interface PromotedField {
  col: string;
  sql: string;
  source: 'residence' | 'parcel' | 'land0' | 'root';
  key: string;
}

export const PROMOTED_RECORD_FIELDS: PromotedField[] = [
  { col: 'assessor_bedrooms',        sql: 'INTEGER', source: 'residence', key: 'bedrooms' },
  { col: 'assessor_full_baths',      sql: 'INTEGER', source: 'residence', key: 'full_baths' },
  { col: 'assessor_stories',         sql: 'REAL',    source: 'residence', key: 'number_of_stories' },
  { col: 'assessor_above_grade_sqft',sql: 'INTEGER', source: 'residence', key: 'above_grade_area' },
  { col: 'assessor_basement_sqft',   sql: 'INTEGER', source: 'residence', key: 'basement_area' },
  { col: 'assessor_garage_sqft',     sql: 'INTEGER', source: 'residence', key: 'builtin_garage_sqft' },
  { col: 'assessor_property_type',   sql: 'TEXT',    source: 'parcel',    key: 'par_property_type' },
  { col: 'assessor_zone',            sql: 'TEXT',    source: 'land0',     key: 'zone' },
  { col: 'assessor_latitude',        sql: 'REAL',    source: 'root',      key: 'latitude' },
  { col: 'assessor_longitude',       sql: 'REAL',    source: 'root',      key: 'longitude' },
];

/** Tables that receive the promoted columns. */
export const PROMOTED_TARGET_TABLES = ['businesses', 'properties'] as const;
