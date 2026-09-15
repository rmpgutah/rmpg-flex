// ============================================================
// UniformCitationFields — officer inputs for the official
// State of Utah Uniform Citation fields
// ============================================================
// These are the boxes the state form prints that the RMS's original
// citation form never captured: the driver-license block, physical
// descriptors, commercial-vehicle weights, and the roadway detail
// (mile post / direction / posted). They persist to `citations_ext`
// (migration 0291) — kept off `citations` itself, which is already
// at 72 of D1's hard 100-column limit.
//
// Lives in its own component rather than inline in CitationsPage
// (2k lines already) so the official form's field set is readable
// as one unit and can be diffed against the paper original.

import { CreditCard, Gauge, Truck, User } from 'lucide-react';

/**
 * Tri-state. The form prints YES [] NO [] and an unanswered question
 * leaves BOTH boxes empty, so "not asked" must stay distinct from an
 * explicit No — defaulting to false would assert a fact on a court
 * document that nobody stated.
 */
export type TriState = boolean | null;

export interface UniformCitationFormFields {
  // Driver license
  dl_state: string;
  dl_expires: string;
  dl_restriction: string;
  cdl_presented: TriState;
  motorcycle_endorsed: TriState;
  picture_id: TriState;
  birth_place: string;
  ssn: string;
  // Address split
  person_city: string;
  person_state: string;
  person_zip: string;
  person_phone: string;
  // Physical descriptors
  person_sex: string;
  person_race: string;
  person_height: string;
  person_weight: string;
  person_eyes: string;
  person_hair: string;
  // Vehicle
  vehicle_plate_expires: string;
  vehicle_type: string;
  // Commercial
  gvwr: string;
  occupants_16_plus: TriState;
  company_unit: string;
  company_city_state: string;
  actual_weight: string;
  weight_limit: string;
  // Roadway / incident
  mile_post: string;
  direction_of_travel: string;
  incident_city: string;
  incident_county: string;
  interstate: TriState;
  military: TriState;
  // Court / agency
  court_phone: string;
  ori: string;
  issuing_agency: string;
  prosecuting_agency: string;
  caption_county: string;
  caption_city: string;
  officer_id_number: string;
  complainant: string;
  complainant_phone: string;
}

export const EMPTY_UNIFORM_FIELDS: UniformCitationFormFields = {
  dl_state: 'UT', dl_expires: '', dl_restriction: '',
  cdl_presented: null, motorcycle_endorsed: null, picture_id: null,
  birth_place: '', ssn: '',
  person_city: '', person_state: 'UT', person_zip: '', person_phone: '',
  person_sex: '', person_race: '', person_height: '', person_weight: '',
  person_eyes: '', person_hair: '',
  vehicle_plate_expires: '', vehicle_type: '',
  gvwr: '', occupants_16_plus: null, company_unit: '', company_city_state: '',
  actual_weight: '', weight_limit: '',
  mile_post: '', direction_of_travel: '', incident_city: '', incident_county: '',
  interstate: null, military: null,
  court_phone: '', ori: '', issuing_agency: '', prosecuting_agency: '',
  caption_county: '', caption_city: '', officer_id_number: '',
  complainant: '', complainant_phone: '',
};

const TRI_STATE_KEYS = [
  'cdl_presented', 'motorcycle_endorsed', 'picture_id', 'occupants_16_plus',
  'interstate', 'military',
] as const satisfies readonly (keyof UniformCitationFormFields)[];

/**
 * Rehydrate the official-form fields from an API citation record. Values
 * arrive merged from `citations_ext`, where the tri-state booleans are
 * stored as 1 / 0 / NULL — NULL must come back as null, not false, or
 * editing an existing citation would silently convert every unanswered
 * question into an explicit "No".
 */
export function uniformFieldsFromRecord(row: Record<string, unknown>): UniformCitationFormFields {
  const out = { ...EMPTY_UNIFORM_FIELDS };
  for (const key of Object.keys(EMPTY_UNIFORM_FIELDS) as (keyof UniformCitationFormFields)[]) {
    const raw = row[key];
    if (raw === undefined) continue;
    if ((TRI_STATE_KEYS as readonly string[]).includes(key)) {
      (out[key] as TriState) = raw === null || raw === '' ? null : Boolean(Number(raw)) || raw === true;
      continue;
    }
    (out[key] as string) = raw == null ? '' : String(raw);
  }
  return out;
}

const HEADING = 'text-[10px] uppercase tracking-widest text-[color:var(--panel-header-color)] font-bold mb-2 flex items-center gap-1.5';
const INPUT = 'input-dark w-full py-2 text-xs min-h-[36px]';

const DIRECTIONS = ['', 'NB', 'SB', 'EB', 'WB'];

interface Props {
  values: UniformCitationFormFields;
  onChange: <K extends keyof UniformCitationFormFields>(
    key: K, value: UniformCitationFormFields[K],
  ) => void;
  /** Hide the vehicle/commercial blocks on citation types with no vehicle. */
  showVehicle?: boolean;
}

function Text({
  id, label, value, onChange, placeholder, mono, maxLength,
}: {
  id: string; label: string; value: string; placeholder?: string;
  mono?: boolean; maxLength?: number;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="field-label">{label}</label>
      <input
        id={id} type="text" value={value} placeholder={placeholder} maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        className={`${INPUT}${mono ? ' font-mono' : ''}`}
      />
    </div>
  );
}

function YesNo({
  id, label, value, onChange,
}: { id: string; label: string; value: TriState; onChange: (v: TriState) => void }) {
  return (
    <div>
      <label htmlFor={id} className="field-label">{label}</label>
      <select
        id={id}
        className={INPUT}
        value={value === null ? '' : value ? 'yes' : 'no'}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === '' ? null : v === 'yes');
        }}
      >
        {/* Blank is the default and means "not asked" — it prints as an
            empty YES/NO pair, matching an unfilled box on the paper form. */}
        <option value="">—</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </div>
  );
}

export default function UniformCitationFields({ values, onChange, showVehicle = true }: Props) {
  const v = values;
  return (
    <>
      <section>
        <h3 className={HEADING}><CreditCard size={12} /> Driver License</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Text id="uc-dl-state" label="DL State" value={v.dl_state} maxLength={2} mono
            onChange={(x) => onChange('dl_state', x.toUpperCase())} />
          <Text id="uc-dl-expires" label="Expires" value={v.dl_expires} placeholder="MM/YYYY"
            onChange={(x) => onChange('dl_expires', x)} />
          <Text id="uc-dl-restriction" label="Restriction" value={v.dl_restriction}
            onChange={(x) => onChange('dl_restriction', x)} />
          <Text id="uc-birth-place" label="Birth Place" value={v.birth_place}
            onChange={(x) => onChange('birth_place', x)} />
          <YesNo id="uc-cdl" label="CDL Presented" value={v.cdl_presented}
            onChange={(x) => onChange('cdl_presented', x)} />
          <YesNo id="uc-motorcycle" label="Motorcycle" value={v.motorcycle_endorsed}
            onChange={(x) => onChange('motorcycle_endorsed', x)} />
          <YesNo id="uc-picture-id" label="Picture ID" value={v.picture_id}
            onChange={(x) => onChange('picture_id', x)} />
          <Text id="uc-ssn" label="Social Sec. #" value={v.ssn} mono placeholder="optional"
            onChange={(x) => onChange('ssn', x)} />
        </div>
      </section>

      <section>
        <h3 className={HEADING}><User size={12} /> Descriptors &amp; Address</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Text id="uc-sex" label="Gender" value={v.person_sex} maxLength={1}
            onChange={(x) => onChange('person_sex', x.toUpperCase())} />
          <Text id="uc-race" label="Race Code" value={v.person_race} maxLength={2}
            onChange={(x) => onChange('person_race', x.toUpperCase())} />
          <Text id="uc-height" label="Height" value={v.person_height} placeholder="511"
            onChange={(x) => onChange('person_height', x)} />
          <Text id="uc-weight" label="Weight" value={v.person_weight} placeholder="185"
            onChange={(x) => onChange('person_weight', x)} />
          <Text id="uc-eyes" label="Eyes" value={v.person_eyes} maxLength={3}
            onChange={(x) => onChange('person_eyes', x.toUpperCase())} />
          <Text id="uc-hair" label="Hair" value={v.person_hair} maxLength={3}
            onChange={(x) => onChange('person_hair', x.toUpperCase())} />
          <Text id="uc-city" label="City" value={v.person_city}
            onChange={(x) => onChange('person_city', x)} />
          <Text id="uc-state" label="State" value={v.person_state} maxLength={2} mono
            onChange={(x) => onChange('person_state', x.toUpperCase())} />
          <Text id="uc-zip" label="Zip" value={v.person_zip} mono
            onChange={(x) => onChange('person_zip', x)} />
          <Text id="uc-phone" label="Telephone" value={v.person_phone}
            onChange={(x) => onChange('person_phone', x)} />
        </div>
      </section>

      {showVehicle && (
        <section>
          <h3 className={HEADING}><Truck size={12} /> Vehicle &amp; Commercial</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Text id="uc-plate-expires" label="Plate Expires" value={v.vehicle_plate_expires}
              placeholder="MM/YYYY" onChange={(x) => onChange('vehicle_plate_expires', x)} />
            <Text id="uc-vehicle-type" label="Vehicle Type" value={v.vehicle_type}
              onChange={(x) => onChange('vehicle_type', x)} />
            <Text id="uc-gvwr" label="GVWR" value={v.gvwr}
              onChange={(x) => onChange('gvwr', x)} />
            <YesNo id="uc-occupants" label="16+ Occupants" value={v.occupants_16_plus}
              onChange={(x) => onChange('occupants_16_plus', x)} />
            <Text id="uc-company-unit" label="Company / Unit #" value={v.company_unit}
              onChange={(x) => onChange('company_unit', x)} />
            <Text id="uc-company-city" label="Company City/State" value={v.company_city_state}
              onChange={(x) => onChange('company_city_state', x)} />
            <Text id="uc-actual-weight" label="Actual Weight" value={v.actual_weight}
              onChange={(x) => onChange('actual_weight', x)} />
            <Text id="uc-weight-limit" label="Weight Limit" value={v.weight_limit}
              onChange={(x) => onChange('weight_limit', x)} />
          </div>
        </section>
      )}

      <section>
        <h3 className={HEADING}><Gauge size={12} /> Roadway &amp; Filing</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Text id="uc-mile-post" label="Mile Post" value={v.mile_post}
            onChange={(x) => onChange('mile_post', x)} />
          <div>
            <label htmlFor="uc-direction" className="field-label">Direction Of</label>
            <select
              id="uc-direction" className={INPUT} value={v.direction_of_travel}
              onChange={(e) => onChange('direction_of_travel', e.target.value)}
            >
              {DIRECTIONS.map((d) => <option key={d || 'none'} value={d}>{d || '—'}</option>)}
            </select>
          </div>
          <Text id="uc-incident-city" label="Incident City" value={v.incident_city}
            onChange={(x) => onChange('incident_city', x)} />
          <Text id="uc-incident-county" label="Incident County" value={v.incident_county}
            onChange={(x) => onChange('incident_county', x)} />
          <YesNo id="uc-interstate" label="Interstate" value={v.interstate}
            onChange={(x) => onChange('interstate', x)} />
          <YesNo id="uc-military" label="Military" value={v.military}
            onChange={(x) => onChange('military', x)} />
          <Text id="uc-court-phone" label="Court Phone #" value={v.court_phone}
            onChange={(x) => onChange('court_phone', x)} />
          <Text id="uc-ori" label="ORI" value={v.ori} mono
            onChange={(x) => onChange('ori', x.toUpperCase())} />
          <Text id="uc-issuing-agency" label="Issuing Agency" value={v.issuing_agency}
            onChange={(x) => onChange('issuing_agency', x)} />
          <Text id="uc-prosecuting-agency" label="Prosecuting Agency" value={v.prosecuting_agency}
            onChange={(x) => onChange('prosecuting_agency', x)} />
          <Text id="uc-caption-county" label="County Of" value={v.caption_county}
            onChange={(x) => onChange('caption_county', x)} />
          <Text id="uc-caption-city" label="City Of" value={v.caption_city}
            onChange={(x) => onChange('caption_city', x)} />
          <Text id="uc-officer-id" label="Officer ID #" value={v.officer_id_number} mono
            onChange={(x) => onChange('officer_id_number', x)} />
          <Text id="uc-complainant" label="Complainant" value={v.complainant}
            onChange={(x) => onChange('complainant', x)} />
          <Text id="uc-complainant-phone" label="Complainant Phone" value={v.complainant_phone}
            onChange={(x) => onChange('complainant_phone', x)} />
        </div>
      </section>
    </>
  );
}
