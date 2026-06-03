// ============================================================
// citation — populated v2 schema (mirrors citationBlank.ts)
// ============================================================
// Each labeled field carries a `path` matching the citations
// table column name. The sidecar embed walks the schema and
// captures `{path: accessor(data)}` for every field whose `path`
// is set, so extraction returns a system-keyed bag (not a
// label-keyed bag — labels can be reworded without breaking
// extraction). Fields without `path` are display-only (e.g.
// computed totals, signatures rendered from images).
//
// Keep section titles, column counts, and field order identical
// to citationBlank.ts so the printed forms look the same — the
// blank is just this schema with empty accessors.

import type { FormSchema, LabeledField, NarrativeField, SignatureField } from '../engine/types';
import { renderViolations } from './citationViolations';

export interface CitationViolation {
  statute_citation: string;
  description: string;
  offense_level: 'Infraction' | 'Misdemeanor' | 'Felony';
  fine_amount: number;
}

export interface CitationData {
  citation_number?: string | null;
  type?: string | null;
  status?: string | null;
  violation_date?: string | null;
  violation_time?: string | null;
  offense_level?: string | null;
  location?: string | null;
  person_name?: string | null;
  person_dob?: string | null;
  person_dl?: string | null;
  person_address?: string | null;
  vehicle_plate?: string | null;
  vehicle_state?: string | null;
  vehicle_description?: string | null;
  // Spillman Flex traffic/vehicle detail fields — captured on the citation
  // form but previously absent from this schema, so the engine silently
  // dropped them from the printed PDF (they only appeared via the legacy
  // generator). Now rendered below.
  vehicle_vin?: string | null;
  vehicle_year?: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_color?: string | null;
  speed_recorded?: number | string | null;
  speed_limit?: number | string | null;
  radar_type?: string | null;
  bac_level?: number | string | null;
  is_warning?: boolean | null;
  school_zone?: boolean | null;
  construction_zone?: boolean | null;
  accident_related?: boolean | null;
  dui_related?: boolean | null;
  commercial_vehicle?: boolean | null;
  bond_amount?: number | string | null;
  bond_type?: string | null;
  statute_citation?: string | null;
  fine_amount?: number | null;
  violation_description?: string | null;
  court_date?: string | null;
  court_name?: string | null;
  court_address?: string | null;
  court_time?: string | null;
  court_room?: string | null;
  appearance_required?: boolean | null;
  notes?: string | null;
  issuing_officer_name?: string | null;
  badge_number?: string | null;
  signature_image?: string | null;
  signature_date?: string | null;
  /** Optional multi-violation array. When present, replaces the single-
   *  violation flat fields in the rendered VIOLATIONS section. When
   *  empty/missing, renderer falls back to flat fields. */
  violations?: CitationViolation[];
}

const str = (v: unknown): string => (v == null ? '' : String(v));
const fineFmt = (v: number | null | undefined | string): string => {
  if (v == null) return '';
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : ''; // sentinel string → blank, never $NaN
};
// snake_case / SNAKE_CASE / kebab-case → Title Case for enum-like values
// (type='criminal' → 'Criminal', offense_level='second_degree_felony' →
// 'Second Degree Felony'). Leaves values that are already mixed-case alone.
const enumFmt = (v: unknown): string => {
  const s = str(v).trim();
  if (!s) return '';
  return s
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
};
// Non-empty check that treats sentinel strings ("None"/"N/A") and the literal
// "0"/0 as absent, so conditional sections don't render for blank/sentinel data
// ([[project-sentinel-none-strings]]). Booleans pass through as-is.
const has = (v: unknown): boolean => {
  if (v == null) return false;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  return s !== '' && s !== 'none' && s !== 'n/a' && s !== '0' && s !== '0.00';
};
const mphFmt = (v: unknown): string => (has(v) ? `${Number(v)} MPH` : '');
const pctFmt = (v: unknown): string => (has(v) ? `${Number(v)}%` : '');
const yesNo = (v: unknown): string => (v ? 'Yes' : 'No');

function lf(
  label: string,
  path: keyof CitationData,
  fmt: (d: CitationData) => string = (d) => str(d[path]),
): LabeledField<CitationData> {
  return { kind: 'labeled', label, accessor: fmt, path: path as string, editable: true };
}

const notesField: NarrativeField<CitationData> = {
  kind: 'narrative',
  // Empty string — section header "OFFICER NOTES" already labels this block.
  // Primitives still advances the label-row height (4mm) so spacing stays
  // consistent with other narrative sections.
  label: '',
  accessor: (d) => d.notes ?? '',
  minLines: 3,
  editable: true,
  path: 'notes',
};

const officerSignature: SignatureField<CitationData> = {
  kind: 'signature',
  label: 'Issuing Officer',
  accessor: (d) => {
    const name = (d.issuing_officer_name ?? '').trim();
    const badge = (d.badge_number ?? '').toString().trim();
    const printedName = badge
      ? (name ? `${name}  ·  Badge #${badge}` : `Badge #${badge}`)
      : name;
    return {
      image: d.signature_image ?? undefined,
      printedName,
      date: d.signature_date ?? d.violation_date ?? '',
    };
  },
  editable: false,
};

export const citationSchema: FormSchema<CitationData> = {
  meta: {
    formNumber: 'PS-209',
    title: 'CITATION',
    revision: '2026-04',
  },
  header: {
    kind: 'default',
    formId: 'citation',
    caseNumberAccessor: (d) => d.citation_number ?? undefined,
  },
  sections: [
    // Citation metadata + timing combined into one 2-col section to save
    // ~25mm of vertical space (one section header + redundant rows). Pair
    // shape: Citation# alone, Type+Status, Date+Time, Offense Level alone.
    {
      kind: 'section', title: 'CITATION DETAILS', columns: 2,
      fields: [
        lf('Citation Number', 'citation_number'),
        lf('Type', 'type', (d) => enumFmt(d.type)),
        lf('Status', 'status', (d) => enumFmt(d.status)),
        lf('Violation Date', 'violation_date'),
        lf('Violation Time', 'violation_time'),
        lf('Offense Level', 'offense_level', (d) => enumFmt(d.offense_level)),
      ],
    },
    {
      kind: 'section', title: 'LOCATION', columns: 1,
      fields: [lf('Address', 'location')],
    },
    {
      kind: 'section', title: 'SUBJECT', columns: 1,
      fields: [
        lf('Full Name', 'person_name'),
        lf('Date of Birth', 'person_dob'),
        lf('DL Number', 'person_dl'),
        lf('Address', 'person_address'),
      ],
    },
    {
      kind: 'section', title: 'VEHICLE INFORMATION', columns: 2,
      // Year+Make, Model+Color, Plate+State across three 2-col rows; VIN and
      // free-text description each take their own full-width row.
      fields: [
        lf('Year', 'vehicle_year'),
        lf('Make', 'vehicle_make'),
        lf('Model', 'vehicle_model'),
        lf('Color', 'vehicle_color'),
        lf('License Plate', 'vehicle_plate'),
        lf('State', 'vehicle_state'),
        lf('VIN', 'vehicle_vin'),
        lf('Vehicle Description', 'vehicle_description'),
      ],
    },
    // TRAFFIC DETAILS — only rendered when radar/speed/BAC enforcement data is
    // present, so non-traffic citations stay compact (mirrors the legacy
    // generator's conditional section + keeps the form to one page). visibleIf
    // (not a function section) so the fields still round-trip via the sidecar.
    {
      kind: 'section', title: 'TRAFFIC DETAILS', columns: 2,
      visibleIf: (d) => has(d.speed_recorded) || has(d.speed_limit) || has(d.radar_type) || has(d.bac_level),
      fields: [
        lf('Speed Recorded', 'speed_recorded', (d) => mphFmt(d.speed_recorded)),
        lf('Speed Limit', 'speed_limit', (d) => mphFmt(d.speed_limit)),
        {
          kind: 'labeled', label: 'Over Limit', editable: false,
          accessor: (d) => (has(d.speed_recorded) && has(d.speed_limit)
            ? `${Number(d.speed_recorded) - Number(d.speed_limit)} MPH` : ''),
        },
        lf('Radar Type', 'radar_type'),
        lf('BAC Level', 'bac_level', (d) => pctFmt(d.bac_level)),
      ],
    },
    // CONDITIONS & FLAGS — Is-Warning plus a compact line of only the flags that
    // are set (rather than a Yes/No row per flag). Hidden when nothing is set.
    {
      kind: 'section', title: 'CONDITIONS & FLAGS', columns: 2,
      visibleIf: (d) => !!(d.is_warning || d.school_zone || d.construction_zone || d.dui_related || d.accident_related || d.commercial_vehicle),
      fields: [
        lf('Is Warning', 'is_warning', (d) => yesNo(d.is_warning)),
        {
          kind: 'labeled', label: 'Flags', editable: false,
          accessor: (d) => [
            d.school_zone && 'School Zone',
            d.construction_zone && 'Construction Zone',
            d.dui_related && 'DUI Related',
            d.accident_related && 'Accident Related',
            d.commercial_vehicle && 'Commercial Vehicle',
          ].filter(Boolean).join(', ') || '—',
        },
      ],
    },
    // VIOLATIONS — multi-violation aware. Callback emits its own header.
    (ctx, data) => {
      const violations = (data as CitationData).violations ?? [];
      if (violations.length > 0) {
        renderViolations(ctx.primitives, ctx.layout, violations);
      } else {
        // Back-compat: render flat single-violation fields.
        ctx.section('VIOLATIONS', (inner) => {
          inner.labeledField(lf('Statute / Code', 'statute_citation'), data);
          inner.labeledField(lf('Offense Level', 'offense_level', (d) => enumFmt(d.offense_level)), data);
          inner.labeledField(
            lf('Fine Amount', 'fine_amount', (d) => fineFmt(d.fine_amount ?? null)),
            data,
          );
          inner.labeledField(lf('Violation Description', 'violation_description'), data);
        });
      }
    },
    // Court info collapsed into one 2-col section: Date+Name, Time+Room,
    // Appearance Required alone, then Address full-width. Saves a redundant
    // 'COURT ADDRESS' section.
    {
      kind: 'section', title: 'COURT', columns: 2,
      fields: [
        lf('Court Date', 'court_date'),
        lf('Court Name', 'court_name'),
        lf('Court Time', 'court_time'),
        lf('Court Room', 'court_room'),
        lf('Appearance Required', 'appearance_required', (d) => yesNo(d.appearance_required)),
        lf('Court Address', 'court_address'),
      ],
    },
    // BOND — only when a bond amount/type is set (mirrors the legacy Bond &
    // Disposition section, scoped to the fields the citation form captures).
    {
      kind: 'section', title: 'BOND', columns: 2,
      visibleIf: (d) => has(d.bond_amount) || has(d.bond_type),
      fields: [
        lf('Bond Amount', 'bond_amount', (d) => fineFmt(d.bond_amount ?? null)),
        lf('Bond Type', 'bond_type', (d) => enumFmt(d.bond_type)),
      ],
    },
    // ISSUING OFFICER section removed — officer name + badge already
    // appear inside the SIGNATURES block ("Printed name: ..."). Keeping
    // both produced redundant text and pushed content onto a 2nd page.
    {
      kind: 'section', title: 'OFFICER NOTES', columns: 1,
      fields: [notesField],
    },
    {
      kind: 'section', title: 'SIGNATURES', columns: 1,
      // Subject Acknowledgment removed — violator signs on the right
      // panel of every page (Page 1 Violator Copy 'X ___' line).
      fields: [officerSignature],
    },
  ],
};

/**
 * Extract the canonical data bag from a CitationData input. Keys
 * match the schema's `path` annotations — this is the shape that
 * gets sidecar-embedded AND the shape extraction returns. Round-
 * trip parity = re-render(extractSidecar(pdf).data) produces the
 * same canonical bytes.
 */
export function citationCanonicalData(d: CitationData): Record<string, unknown> {
  const bag: Record<string, unknown> = {};
  for (const section of citationSchema.sections) {
    if (typeof section === 'function') continue;
    for (const f of section.fields) {
      if ('path' in f && f.path) {
        // Use the raw accessor for narrative + labeled; signatures
        // are display-only (no path), already excluded.
        if (f.kind === 'labeled' || f.kind === 'narrative') {
          bag[f.path] = (f.accessor as (d: CitationData) => unknown)(d);
        }
      }
    }
  }
  if (Array.isArray(d.violations) && d.violations.length > 0) {
    bag.violations = d.violations;
  }
  return bag;
}
