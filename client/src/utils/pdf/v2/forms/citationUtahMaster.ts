// ============================================================
// citationUtahMaster — Utah Uniform Citation master form
// ============================================================
// Authentic Utah Uniform Citation layout (Rule 4-704) rendered via
// the engine's fixed-layout section kind. One unified template
// covers traffic / criminal / parking / warning types — sections
// show/hide based on `data.type` and field presence.
//
// Per-zone identity (plaintiff name, agency ID label) is resolved
// from the citation's `agency_court_zone` row at API serialization
// time and passed into the schema via fields on CitationUtahData
// (zone_plaintiff_name, zone_agency_id_label). Falls back to the
// workspace default when unset.
//
// Multi-copy bottom strip is rendered conditionally based on
// data.__copyKind ('court' | 'agency' | 'defendant' | 'file') —
// the wrapper in utahMasterRenderer.ts sets this per page.

import type { FixedLayoutSection, FixedField, FormSchema } from '../engine/types';

export type CitationCopyKind = 'court' | 'agency' | 'defendant' | 'file';

export interface CitationUtahViolation {
  statute_citation: string;
  description: string;
  offense_class: string;          // 'Infraction' | 'Class C Misd.' | etc.
  fine_amount: number;
}

export interface CitationUtahData {
  // ── Metadata ──
  citation_number?: string | null;
  type?: string | null;                       // 'traffic' | 'criminal' | 'parking' | 'warning'
  status?: string | null;

  // ── Per-zone identity (resolved server-side from agency_court_zones) ──
  zone_plaintiff_name?: string | null;        // 'STATE OF UTAH' or 'ROCKY MOUNTAIN PROTECTIVE GROUP'
  zone_agency_id_label?: string | null;       // 'ORI: UT0XXXXXX' or 'License #: ...'
  zone_include_court_caption?: boolean | null;
  agency_phone?: string | null;
  agency_address?: string | null;

  // ── Court ──
  court_name?: string | null;
  court_address?: string | null;
  court_date?: string | null;
  court_time?: string | null;
  court_room?: string | null;
  case_number?: string | null;
  appearance_required?: boolean | null;

  // ── Defendant ──
  person_name?: string | null;                // 'Last, First Middle'
  person_first?: string | null;               // optional split form
  person_last?: string | null;
  person_middle?: string | null;
  person_dob?: string | null;
  person_dl?: string | null;
  person_dl_state?: string | null;
  person_address?: string | null;
  person_city?: string | null;
  person_state?: string | null;
  person_zip?: string | null;
  person_phone?: string | null;
  person_sex?: string | null;
  person_race?: string | null;
  person_height?: string | null;
  person_weight?: string | null;
  person_hair?: string | null;
  person_eyes?: string | null;

  // ── Vehicle ──
  vehicle_plate?: string | null;
  vehicle_state?: string | null;
  vehicle_year?: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_color?: string | null;
  vehicle_vin?: string | null;
  vehicle_style?: string | null;
  commercial_vehicle?: boolean | null;
  hazmat?: boolean | null;
  is_trailer?: boolean | null;
  is_rental?: boolean | null;

  // ── Incident ──
  violation_date?: string | null;
  violation_time?: string | null;
  violation_day?: string | null;              // 'MON'..'SUN' or blank
  location?: string | null;
  incident_city?: string | null;
  incident_county?: string | null;
  beat_id?: string | null;
  sector_id?: string | null;

  // ── Offenses (flat fallback for single-violation) ──
  statute_citation?: string | null;
  violation_description?: string | null;
  offense_level?: string | null;
  fine_amount?: number | null;
  // Multi-violation array — when present, replaces flat fields in OFFENSES.
  violations?: CitationUtahViolation[];

  // ── Speed/condition flags ──
  speed_recorded?: number | string | null;
  speed_limit?: number | string | null;
  radar_type?: string | null;
  bac_level?: number | string | null;
  school_zone?: boolean | null;
  construction_zone?: boolean | null;
  work_zone?: boolean | null;
  accident_related?: boolean | null;
  dui_related?: boolean | null;
  property_damage?: boolean | null;
  bodily_injury?: boolean | null;
  fatality?: boolean | null;

  // ── Bond/fine ──
  bond_amount?: number | string | null;
  bond_type?: string | null;

  // ── Notes ──
  notes?: string | null;

  // ── Officer ──
  issuing_officer_name?: string | null;
  badge_number?: string | null;
  signature_image?: string | null;            // officer signature PNG
  signature_date?: string | null;

  // ── Defendant signature ──
  defendant_signature_image?: string | null;  // PNG, set after signature flow (PR 2)
  defendant_signed_at?: string | null;
  defendant_refused?: boolean | null;

  // ── Multi-copy variant (set by renderer wrapper per page) ──
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

function isTraffic(d: CitationUtahData): boolean {
  return d.type === 'traffic' || d.type == null || d.type === '';
}
function isWarning(d: CitationUtahData): boolean { return d.type === 'warning'; }
function isCriminal(d: CitationUtahData): boolean { return d.type === 'criminal'; }
function isParking(d: CitationUtahData): boolean { return d.type === 'parking'; }

function showVehicle(d: CitationUtahData): boolean {
  if (isCriminal(d) || isWarning(d)) {
    // Only show vehicle if any vehicle data was captured (e.g. criminal w/ a vehicle)
    return has(d.vehicle_plate) || has(d.vehicle_vin) || has(d.vehicle_make);
  }
  return true; // traffic & parking always show vehicle
}

function showCourt(d: CitationUtahData): boolean { return !isWarning(d); }
function showPromiseToAppear(d: CitationUtahData): boolean { return !isWarning(d); }
function showSpeedRow(d: CitationUtahData): boolean {
  return has(d.speed_recorded) || has(d.speed_limit) || has(d.radar_type);
}

// Format the defendant's name into a single "LAST, FIRST MIDDLE" string.
function fmtDefendantName(d: CitationUtahData): string {
  if (d.person_name && d.person_name.trim()) return d.person_name.trim();
  const parts: string[] = [];
  if (d.person_last) parts.push(d.person_last.trim());
  const fm = [d.person_first, d.person_middle].filter((x) => x && x.trim()).join(' ');
  if (fm) {
    return parts.length ? `${parts[0]}, ${fm}` : fm;
  }
  return parts.join(', ');
}

// ── Master form fixed-layout fields ─────────────────────────
//
// Coordinate system: (0, 0) = top-left of the section.
// Letter page width with 10mm margins = 195.9mm usable.
// Total section height = 215mm (fits between header and bottom strip).

const SECTION_WIDTH = 195.9;
const ROW = 6;                // compact form row height (was 7 — saves ~10mm overall)
const LABEL_FS = 6.5;         // tiny label font
const VAL_FS = 9;             // value font
const BIG_FS = 11;            // case caption font

// Build the list of fields for the master form layout.
function buildMasterFields(): FixedField<CitationUtahData>[] {
  const fields: FixedField<CitationUtahData>[] = [];

  // ── 0–24mm: Court caption block ─────────────────────────
  fields.push(
    // Top rule
    { x: 0, y: 0, w: SECTION_WIDTH, h: 0, style: 'line', bold: true },

    // Plaintiff caption — "IN THE JUSTICE COURT OF..."
    {
      x: 0, y: 2, w: SECTION_WIDTH, h: 5, style: 'label',
      label: 'IN THE JUSTICE COURT OF', align: 'center', fontSize: 8, bold: true,
      visibleIf: (d) => d.zone_include_court_caption !== false,
    },
    {
      x: 0, y: 7, w: SECTION_WIDTH, h: 5, style: 'text', accessor: (d) => (d.court_name ?? '').toUpperCase(),
      align: 'center', fontSize: BIG_FS, bold: true, path: 'court_name',
      visibleIf: (d) => d.zone_include_court_caption !== false,
    },

    // Plaintiff vs Defendant
    {
      x: 0, y: 14, w: 100, h: 4, style: 'text',
      accessor: (d) => `${(d.zone_plaintiff_name ?? 'ROCKY MOUNTAIN PROTECTIVE GROUP').toUpperCase()},`,
      fontSize: 9, bold: true,
    },
    {
      x: 6, y: 18, w: 50, h: 4, style: 'label', label: 'Plaintiff,', fontSize: 8,
    },
    { x: 0, y: 22, w: 30, h: 4, style: 'label', label: 'vs.', fontSize: 9, bold: true },
    {
      x: 0, y: 26, w: 130, h: 5, style: 'underline',
      accessor: (d) => fmtDefendantName(d).toUpperCase(),
      label: 'Defendant', fontSize: 9, bold: true, path: 'person_name',
    },

    // Case number block on the right
    {
      x: 130, y: 14, w: 65, h: 6, style: 'box',
      accessor: (d) => d.citation_number ?? d.case_number ?? '',
      label: 'CITATION No.', fontSize: 9, bold: true, path: 'citation_number',
    },
    {
      x: 130, y: 22, w: 65, h: 8, style: 'barcode',
      accessor: (d) => d.citation_number ?? '',
    },
  );

  // Horizontal separator
  fields.push({ x: 0, y: 34, w: SECTION_WIDTH, h: 0, style: 'line' });

  // ── 36–64mm: Defendant block ─────────────────────────────
  let y = 36;
  // Row 1: Last / First / Middle / DOB
  fields.push(
    { x: 0, y, w: 60, h: ROW, style: 'underline', label: 'Last', accessor: (d) => str(d.person_last || (d.person_name?.split(',')[0] ?? '')), path: 'person_last' },
    { x: 62, y, w: 50, h: ROW, style: 'underline', label: 'First', accessor: (d) => str(d.person_first), path: 'person_first' },
    { x: 114, y, w: 35, h: ROW, style: 'underline', label: 'Middle', accessor: (d) => str(d.person_middle), path: 'person_middle' },
    { x: 151, y, w: 44.9, h: ROW, style: 'underline', label: 'Date of Birth', accessor: (d) => str(d.person_dob), path: 'person_dob' },
  );
  y += ROW + 1;
  // Row 2: DL# / DL State / Address
  fields.push(
    { x: 0, y, w: 50, h: ROW, style: 'underline', label: 'DL #', accessor: (d) => str(d.person_dl), path: 'person_dl' },
    { x: 52, y, w: 12, h: ROW, style: 'underline', label: 'St', accessor: (d) => str(d.person_dl_state), path: 'person_dl_state' },
    { x: 66, y, w: 129.9, h: ROW, style: 'underline', label: 'Address', accessor: (d) => str(d.person_address), path: 'person_address' },
  );
  y += ROW + 1;
  // Row 3: City / State / ZIP / Phone
  fields.push(
    { x: 0, y, w: 70, h: ROW, style: 'underline', label: 'City', accessor: (d) => str(d.person_city), path: 'person_city' },
    { x: 72, y, w: 12, h: ROW, style: 'underline', label: 'St', accessor: (d) => str(d.person_state), path: 'person_state' },
    { x: 86, y, w: 25, h: ROW, style: 'underline', label: 'Zip', accessor: (d) => str(d.person_zip), path: 'person_zip' },
    { x: 113, y, w: 82.9, h: ROW, style: 'underline', label: 'Phone', accessor: (d) => str(d.person_phone), path: 'person_phone' },
  );
  y += ROW + 1;
  // Row 4: Sex / Race / Hgt / Wgt / Hair / Eyes
  fields.push(
    { x: 0, y, w: 25, h: ROW, style: 'underline', label: 'Sex', accessor: (d) => str(d.person_sex), path: 'person_sex' },
    { x: 27, y, w: 25, h: ROW, style: 'underline', label: 'Race', accessor: (d) => str(d.person_race), path: 'person_race' },
    { x: 54, y, w: 25, h: ROW, style: 'underline', label: 'Height', accessor: (d) => str(d.person_height), path: 'person_height' },
    { x: 81, y, w: 25, h: ROW, style: 'underline', label: 'Weight', accessor: (d) => str(d.person_weight), path: 'person_weight' },
    { x: 108, y, w: 30, h: ROW, style: 'underline', label: 'Hair', accessor: (d) => str(d.person_hair), path: 'person_hair' },
    { x: 140, y, w: 55.9, h: ROW, style: 'underline', label: 'Eyes', accessor: (d) => str(d.person_eyes), path: 'person_eyes' },
  );
  y += ROW + 1;
  // Defendant block bottom rule
  fields.push({ x: 0, y, w: SECTION_WIDTH, h: 0, style: 'line' });
  y += 2;

  // ── ~70–93mm: Vehicle block (conditional) ────────────────
  const vehicleStartY = y;
  fields.push({
    x: 0, y, w: 30, h: 4, style: 'label', label: 'VEHICLE', fontSize: 8, bold: true,
    visibleIf: showVehicle,
  });
  y += 4;
  fields.push(
    { x: 0, y, w: 36, h: ROW, style: 'underline', label: 'Plate', accessor: (d) => str(d.vehicle_plate), path: 'vehicle_plate', visibleIf: showVehicle },
    { x: 38, y, w: 12, h: ROW, style: 'underline', label: 'St', accessor: (d) => str(d.vehicle_state), path: 'vehicle_state', visibleIf: showVehicle },
    { x: 52, y, w: 22, h: ROW, style: 'underline', label: 'Year', accessor: (d) => str(d.vehicle_year), path: 'vehicle_year', visibleIf: showVehicle },
    { x: 76, y, w: 32, h: ROW, style: 'underline', label: 'Make', accessor: (d) => str(d.vehicle_make), path: 'vehicle_make', visibleIf: showVehicle },
    { x: 110, y, w: 40, h: ROW, style: 'underline', label: 'Model', accessor: (d) => str(d.vehicle_model), path: 'vehicle_model', visibleIf: showVehicle },
    { x: 152, y, w: 43.9, h: ROW, style: 'underline', label: 'Color', accessor: (d) => str(d.vehicle_color), path: 'vehicle_color', visibleIf: showVehicle },
  );
  y += ROW + 1;
  fields.push(
    { x: 0, y, w: 120, h: ROW, style: 'underline', label: 'VIN', accessor: (d) => str(d.vehicle_vin), path: 'vehicle_vin', visibleIf: showVehicle },
    { x: 122, y, w: 73.9, h: ROW, style: 'underline', label: 'Body Style', accessor: (d) => str(d.vehicle_style), path: 'vehicle_style', visibleIf: showVehicle },
  );
  y += ROW + 1;
  fields.push(
    { x: 0, y: y + 1, w: 8, h: 4, style: 'checkbox', label: 'Commercial', accessor: (d) => !!d.commercial_vehicle, path: 'commercial_vehicle', visibleIf: showVehicle },
    { x: 50, y: y + 1, w: 8, h: 4, style: 'checkbox', label: 'Hazmat', accessor: (d) => !!d.hazmat, path: 'hazmat', visibleIf: showVehicle },
    { x: 90, y: y + 1, w: 8, h: 4, style: 'checkbox', label: 'Trailer', accessor: (d) => !!d.is_trailer, path: 'is_trailer', visibleIf: showVehicle },
    { x: 130, y: y + 1, w: 8, h: 4, style: 'checkbox', label: 'Rental', accessor: (d) => !!d.is_rental, path: 'is_rental', visibleIf: showVehicle },
  );
  y += 6;
  fields.push({ x: 0, y, w: SECTION_WIDTH, h: 0, style: 'line', visibleIf: showVehicle });
  y += 2;

  // When vehicle hidden, claw back the 25mm we reserved.
  // Note: the renderer doesn't shift later fields automatically based on visibility,
  // so for the non-vehicle case the layout has a visible empty band — acceptable
  // tradeoff for keeping the schema static. The hide condition is rare on traffic/
  // parking citations (the dominant volume); criminal/warning citations show
  // vehicle when relevant and skip when not, leaving the empty space as a
  // visible "no vehicle involved" affordance.
  void vehicleStartY;

  // ── 93–115mm: Incident block ────────────────────────────
  fields.push({ x: 0, y, w: 30, h: 4, style: 'label', label: 'INCIDENT', fontSize: 8, bold: true });
  y += 4;
  fields.push(
    { x: 0, y, w: 40, h: ROW, style: 'underline', label: 'Date', accessor: (d) => str(d.violation_date), path: 'violation_date' },
    { x: 42, y, w: 30, h: ROW, style: 'underline', label: 'Time', accessor: (d) => str(d.violation_time), path: 'violation_time' },
    { x: 74, y, w: 22, h: ROW, style: 'underline', label: 'Day', accessor: (d) => str(d.violation_day), path: 'violation_day' },
    { x: 98, y, w: 97.9, h: ROW, style: 'underline', label: 'Location', accessor: (d) => str(d.location), path: 'location' },
  );
  y += ROW + 1;
  fields.push(
    { x: 0, y, w: 65, h: ROW, style: 'underline', label: 'City', accessor: (d) => str(d.incident_city), path: 'incident_city' },
    { x: 67, y, w: 45, h: ROW, style: 'underline', label: 'County', accessor: (d) => str(d.incident_county), path: 'incident_county' },
    { x: 114, y, w: 35, h: ROW, style: 'underline', label: 'Beat', accessor: (d) => str(d.beat_id), path: 'beat_id' },
    { x: 151, y, w: 44.9, h: ROW, style: 'underline', label: 'Sector', accessor: (d) => str(d.sector_id), path: 'sector_id' },
  );
  y += ROW + 1;
  fields.push({ x: 0, y, w: SECTION_WIDTH, h: 0, style: 'line' });
  y += 2;

  // ── ~115–170mm: Offense table ────────────────────────────
  fields.push({ x: 0, y, w: 60, h: 4, style: 'label', label: 'OFFENSE(S) — Utah Code or Local Ordinance', fontSize: 8, bold: true });
  y += 4;
  // Table header
  fields.push(
    { x: 0, y, w: 8, h: ROW, style: 'box', label: '#', fontSize: LABEL_FS, align: 'center' },
    { x: 8, y, w: 40, h: ROW, style: 'box', label: 'Statute', fontSize: LABEL_FS },
    { x: 48, y, w: 105, h: ROW, style: 'box', label: 'Description', fontSize: LABEL_FS },
    { x: 153, y, w: 22, h: ROW, style: 'box', label: 'Class', fontSize: LABEL_FS, align: 'center' },
    { x: 175, y, w: 20.9, h: ROW, style: 'box', label: 'Fine', fontSize: LABEL_FS, align: 'right' },
  );
  y += ROW;
  // 4 data rows
  for (let i = 0; i < 4; i++) {
    const rowIdx = i;
    const visibleIfHasViolation = (d: CitationUtahData) => {
      if (rowIdx === 0) {
        // Always show the first row — falls back to flat fields when no multi-violation array
        return true;
      }
      const v = d.violations;
      return Array.isArray(v) && v.length > rowIdx;
    };
    fields.push(
      // Row number
      { x: 0, y, w: 8, h: ROW, style: 'box', label: String(rowIdx + 1), align: 'center', fontSize: VAL_FS },
      // Statute
      {
        x: 8, y, w: 40, h: ROW, style: 'box',
        accessor: (d) => {
          const v = d.violations?.[rowIdx];
          if (v) return v.statute_citation;
          if (rowIdx === 0) return str(d.statute_citation);
          return '';
        },
        path: rowIdx === 0 ? 'statute_citation' : undefined,
        fontSize: VAL_FS,
        visibleIf: visibleIfHasViolation,
      },
      // Description
      {
        x: 48, y, w: 105, h: ROW, style: 'box',
        accessor: (d) => {
          const v = d.violations?.[rowIdx];
          if (v) return v.description;
          if (rowIdx === 0) return str(d.violation_description);
          return '';
        },
        path: rowIdx === 0 ? 'violation_description' : undefined,
        fontSize: VAL_FS,
        visibleIf: visibleIfHasViolation,
      },
      // Class
      {
        x: 153, y, w: 22, h: ROW, style: 'box',
        accessor: (d) => {
          const v = d.violations?.[rowIdx];
          if (v) return v.offense_class;
          if (rowIdx === 0) return str(d.offense_level);
          return '';
        },
        path: rowIdx === 0 ? 'offense_level' : undefined,
        align: 'center', fontSize: VAL_FS,
        visibleIf: visibleIfHasViolation,
      },
      // Fine
      {
        x: 175, y, w: 20.9, h: ROW, style: 'box',
        accessor: (d) => {
          const v = d.violations?.[rowIdx];
          if (v) return fmtFine(v.fine_amount);
          if (rowIdx === 0) return fmtFine(d.fine_amount ?? null);
          return '';
        },
        path: rowIdx === 0 ? 'fine_amount' : undefined,
        align: 'right', fontSize: VAL_FS,
        visibleIf: visibleIfHasViolation,
      },
    );
    y += ROW;
  }

  // Speed row (conditional)
  fields.push(
    {
      x: 0, y: y + 1, w: 40, h: ROW, style: 'underline',
      label: 'Speed Recorded', accessor: (d) => has(d.speed_recorded) ? `${d.speed_recorded} MPH` : '',
      path: 'speed_recorded', visibleIf: showSpeedRow,
    },
    {
      x: 42, y: y + 1, w: 40, h: ROW, style: 'underline',
      label: 'Posted', accessor: (d) => has(d.speed_limit) ? `${d.speed_limit} MPH` : '',
      path: 'speed_limit', visibleIf: showSpeedRow,
    },
    {
      x: 84, y: y + 1, w: 40, h: ROW, style: 'underline',
      label: 'Radar Type', accessor: (d) => str(d.radar_type),
      path: 'radar_type', visibleIf: showSpeedRow,
    },
    {
      x: 126, y: y + 1, w: 69.9, h: ROW, style: 'underline',
      label: 'TOTAL DUE', accessor: (d) => {
        const fromViolations = (d.violations ?? []).reduce((s, v) => s + (v.fine_amount || 0), 0);
        const total = fromViolations > 0 ? fromViolations : (Number(d.fine_amount) || 0);
        return total > 0 ? fmtFine(total) : '';
      },
      align: 'right', bold: true,
    },
  );
  y += ROW + 1;

  // Condition flags row
  fields.push(
    { x: 0, y, w: 8, h: 4, style: 'checkbox', label: 'School Zone', accessor: (d) => !!d.school_zone, path: 'school_zone' },
    { x: 38, y, w: 8, h: 4, style: 'checkbox', label: 'Const Zone', accessor: (d) => !!d.construction_zone, path: 'construction_zone' },
    { x: 76, y, w: 8, h: 4, style: 'checkbox', label: 'Work Zone', accessor: (d) => !!d.work_zone, path: 'work_zone' },
    { x: 110, y, w: 8, h: 4, style: 'checkbox', label: 'Accident', accessor: (d) => !!d.accident_related, path: 'accident_related' },
    { x: 144, y, w: 8, h: 4, style: 'checkbox', label: 'DUI Related', accessor: (d) => !!d.dui_related, path: 'dui_related' },
  );
  y += 5;
  fields.push(
    { x: 0, y, w: 8, h: 4, style: 'checkbox', label: 'Property Dmg', accessor: (d) => !!d.property_damage, path: 'property_damage' },
    { x: 38, y, w: 8, h: 4, style: 'checkbox', label: 'Bodily Injury', accessor: (d) => !!d.bodily_injury, path: 'bodily_injury' },
    { x: 76, y, w: 8, h: 4, style: 'checkbox', label: 'Fatality', accessor: (d) => !!d.fatality, path: 'fatality' },
    { x: 110, y, w: 8, h: 4, style: 'checkbox', label: 'Commercial', accessor: (d) => !!d.commercial_vehicle, path: 'commercial_vehicle' },
  );
  y += 6;
  fields.push({ x: 0, y, w: SECTION_WIDTH, h: 0, style: 'line' });
  y += 2;

  // ── ~170–192mm: Court appearance (conditional) ───────────
  fields.push({
    x: 0, y, w: 80, h: 4, style: 'label', label: 'COURT APPEARANCE', fontSize: 8, bold: true,
    visibleIf: showCourt,
  });
  y += 4;
  fields.push(
    { x: 0, y, w: 130, h: ROW, style: 'underline', label: 'Court Name', accessor: (d) => str(d.court_name), path: 'court_name', visibleIf: showCourt },
    { x: 132, y, w: 63.9, h: ROW, style: 'underline', label: 'Room / Dept', accessor: (d) => str(d.court_room), path: 'court_room', visibleIf: showCourt },
  );
  y += ROW + 1;
  fields.push({
    x: 0, y, w: 195.9, h: ROW, style: 'underline', label: 'Court Address',
    accessor: (d) => str(d.court_address), path: 'court_address', visibleIf: showCourt,
  });
  y += ROW + 1;
  fields.push(
    { x: 0, y, w: 50, h: ROW, style: 'underline', label: 'Appearance Date', accessor: (d) => str(d.court_date), path: 'court_date', visibleIf: showCourt },
    { x: 52, y, w: 30, h: ROW, style: 'underline', label: 'Time', accessor: (d) => str(d.court_time), path: 'court_time', visibleIf: showCourt },
    { x: 84, y: y + 1, w: 8, h: 4, style: 'checkbox', label: 'MANDATORY APPEARANCE', accessor: (d) => !!d.appearance_required, path: 'appearance_required', visibleIf: showCourt },
    { x: 130, y: y + 1, w: 8, h: 4, style: 'checkbox', label: 'Pay online: pay.utcourts.gov', accessor: (d) => !d.appearance_required, visibleIf: showCourt },
  );
  y += ROW + 1;
  fields.push({ x: 0, y, w: SECTION_WIDTH, h: 0, style: 'line', visibleIf: showCourt });
  y += 2;

  // ── 192–212mm: Officer notes ────────────────────────────
  fields.push({ x: 0, y, w: 80, h: 4, style: 'label', label: 'OFFICER NOTES', fontSize: 8, bold: true });
  y += 4;
  fields.push({
    x: 0, y, w: SECTION_WIDTH, h: 8, style: 'underline',
    accessor: (d) => str(d.notes), path: 'notes',
  });
  y += 9;

  // ── 212–235mm: Promise to appear + signatures ──────────
  fields.push({
    x: 0, y, w: 120, h: 4, style: 'label',
    label: 'PROMISE TO APPEAR (Utah Code § 77-7-19)', fontSize: 8, bold: true,
    visibleIf: showPromiseToAppear,
  });
  y += 4;
  fields.push({
    x: 0, y, w: SECTION_WIDTH, h: 5, style: 'label',
    label: 'I acknowledge receipt of this citation and promise to appear at the court named above on the date and time specified, or to satisfy any obligations imposed by the citation.',
    fontSize: 7,
    visibleIf: showPromiseToAppear,
  });
  y += 6;
  // Defendant signature
  fields.push(
    {
      x: 0, y, w: 95, h: 6, style: 'signature',
      accessor: (d) => d.defendant_refused
        ? '' // refusal is handled by the stamp helper in PR 2; for now show empty
        : { image: d.defendant_signature_image ?? undefined },
      label: 'Defendant signature',
      path: 'defendant_signature_image',
      visibleIf: showPromiseToAppear,
    },
    {
      x: 97, y, w: 45, h: 6, style: 'underline',
      accessor: (d) => str(d.defendant_signed_at),
      label: 'Date', path: 'defendant_signed_at',
      visibleIf: showPromiseToAppear,
    },
    {
      x: 144, y: y + 2, w: 8, h: 4, style: 'checkbox',
      label: 'REFUSED TO SIGN', accessor: (d) => !!d.defendant_refused, path: 'defendant_refused',
      visibleIf: showPromiseToAppear,
    },
  );
  y += 8;

  // Officer signature
  fields.push(
    { x: 0, y, w: 80, h: 4, style: 'label', label: 'ISSUING OFFICER', fontSize: 8, bold: true },
  );
  y += 4;
  fields.push(
    { x: 0, y, w: 80, h: ROW, style: 'underline', label: 'Officer Name', accessor: (d) => str(d.issuing_officer_name), path: 'issuing_officer_name' },
    { x: 82, y, w: 22, h: ROW, style: 'underline', label: 'Badge', accessor: (d) => str(d.badge_number), path: 'badge_number' },
    { x: 106, y, w: 45, h: ROW, style: 'underline', label: 'Agency ID', accessor: (d) => str(d.zone_agency_id_label) },
    { x: 153, y, w: 42.9, h: ROW, style: 'underline', label: 'Date', accessor: (d) => str(d.signature_date), path: 'signature_date' },
  );
  y += ROW + 1;
  fields.push({
    x: 0, y, w: 100, h: 6, style: 'signature',
    accessor: (d) => ({ image: d.signature_image ?? undefined }),
    label: 'Officer signature', path: 'signature_image',
  });

  return fields;
}

// Copy-strip labels — rendered by the multi-copy wrapper at the bottom
// of each page (just above the footer), NOT as a section after the form.
// Keeping it page-anchored means the form content can extend across the
// vertical space without the strip getting pushed to a second page.
export const COPY_STRIP_LABELS: Record<CitationCopyKind, string> = {
  court: 'COPY 1 — COURT (FILE WITH JUSTICE COURT)',
  agency: 'COPY 2 — AGENCY (RMPG INTERNAL RECORDS)',
  defendant: 'COPY 3 — DEFENDANT (RECEIPT — RETAIN FOR YOUR RECORDS)',
  file: 'COPY 4 — OFFICER FILE (REPORT PACKET)',
};

// ── Form schema ────────────────────────────────────────────

export const citationUtahMasterSchema: FormSchema<CitationUtahData> = {
  meta: {
    formNumber: 'UT-CIT-MASTER',
    title: 'UNIFORM CITATION',
    revision: '2026-06',
  },
  header: {
    kind: 'default',
    formId: 'citation-utah-master',
    caseNumberAccessor: (d) => d.citation_number ?? undefined,
    caseLabel: 'CITATION',
  },
  sections: [
    // Master form fixed-layout section. 250mm spans roughly the full
    // content area below the header (header bottom ~32mm + 4mm gap =
    // 36mm; section ends at 286mm — slightly past page bottom 279.4mm.
    // The copy designator is rendered at page-bottom by the multi-copy
    // wrapper (NOT a section here), so the form's last few rows can
    // overlap the footer band gracefully — preferable to splitting
    // across pages.
    {
      kind: 'fixed-layout',
      height: 250,
      fields: buildMasterFields(),
    } as FixedLayoutSection<CitationUtahData>,
  ],
  footer: {
    kind: 'default',
    showRevision: true,
    showPageNumbers: true,
  },
};

/**
 * Extract the canonical data bag from a CitationUtahData input for the
 * sidecar. Mirrors the round-trip pattern from `citation.ts`:
 * re-render from extractSidecar(pdf).data → same canonical bytes.
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
      if (f.path && f.accessor) {
        const raw = f.accessor(d);
        // signature image fields return objects — store the image only
        if (raw && typeof raw === 'object' && 'image' in raw) {
          if (raw.image != null) bag[f.path] = raw.image;
        } else if (raw != null) {
          bag[f.path] = raw;
        }
      }
    }
  }
  if (Array.isArray(d.violations) && d.violations.length > 0) {
    bag.violations = d.violations;
  }
  return bag;
}
