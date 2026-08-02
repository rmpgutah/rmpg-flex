// client/src/utils/assessorFormPatch.ts
//
// Client-side "apply parcel to form" for records that do not exist yet.
//
// ── Why this exists ──────────────────────────────────────────────────────
// POST /assessor/apply writes onto a saved businesses/properties ROW, so it
// needs a record_id. When an operator is CREATING a record, there is no row
// yet — and both form modals handled that with a bare `if (!recordId) return;`
// while the panel still rendered an enabled Apply button. Clicking it did
// nothing at all: no request, no error, no toast. Reported as "Cannot apply
// changes", and indistinguishable from a broken backend.
//
// Filling the form is the genuinely useful behaviour here — the operator is
// entering a new property and wants the assessor data in the fields, which
// then persists on save through the normal create path.
//
// ── Never-clobber ────────────────────────────────────────────────────────
// Mirrors applyParcelToRecord() in src/utils/sl-assessor/autofill.ts: a field
// the operator has already typed is NEVER overwritten, and the skipped list
// is returned so the UI can report it exactly as the server path does. This
// is authoritative law-enforcement data being merged with operator entry —
// the operator wins, always.

/** Shape of GET /assessor/parcel/:parcel_no → { parcel }. Only the fields
 *  the property/business forms actually bind are declared. */
export interface AssessorParcelDetail {
  parcel_number: string | null;
  owner_of_record: string | null;
  owner_type: string | null;
  owner_mailing_address: string | null;
  situs_address: string | null;
  situs_city: string | null;
  situs_zip: string | null;
  year_built: number | null;
  land_sqft: number | null;
  market_value_total: number | null;
  legal_description: string | null;
  tax_district: string | null;
  sales?: Array<{ sale_date: string | null; sale_price: number | null }>;
}

/**
 * Form fields an assessor parcel can populate, mapped to where the value
 * comes from. Kept in the same order as AUTOFILL_FIELDS on the server so the
 * two lists can be diffed by eye.
 */
const FORM_MAPPING: Array<{
  field: string;
  pick: (p: AssessorParcelDetail) => unknown;
}> = [
  { field: 'parcel_number',         pick: (p) => p.parcel_number },
  { field: 'owner_of_record',       pick: (p) => p.owner_of_record },
  { field: 'owner_type',            pick: (p) => p.owner_type },
  { field: 'owner_mailing_address', pick: (p) => p.owner_mailing_address },
  { field: 'year_built',            pick: (p) => p.year_built },
  { field: 'total_market_value',    pick: (p) => p.market_value_total },
  { field: 'land_sqft',             pick: (p) => p.land_sqft },
  { field: 'last_sale_date',        pick: (p) => p.sales?.[0]?.sale_date ?? null },
  { field: 'last_sale_price',       pick: (p) => p.sales?.[0]?.sale_price ?? null },
  { field: 'legal_description',     pick: (p) => p.legal_description },
  { field: 'tax_district',          pick: (p) => p.tax_district },
  // Address parts are offered too, since on a NEW record they are usually
  // still blank and the county's form is the authority on the situs.
  { field: 'city',                  pick: (p) => p.situs_city },
  { field: 'zip',                   pick: (p) => p.situs_zip },
];

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

export interface FormPatchResult {
  /** Fields to merge into form state. Values are strings — form inputs are
   *  controlled and a number would make React warn about a changed input. */
  patch: Record<string, string>;
  /** Fields the operator had already filled, left untouched. */
  skipped: string[];
}

/**
 * Build the never-clobber patch for an unsaved record's form.
 *
 * `current` is the live form state. Any field already carrying a value is
 * reported in `skipped` rather than overwritten.
 */
export function buildAssessorFormPatch(
  parcel: AssessorParcelDetail,
  current: Record<string, unknown>,
): FormPatchResult {
  const patch: Record<string, string> = {};
  const skipped: string[] = [];

  for (const { field, pick } of FORM_MAPPING) {
    const incoming = pick(parcel);
    if (isEmpty(incoming)) continue;
    if (!isEmpty(current[field])) { skipped.push(field); continue; }
    patch[field] = String(incoming);
  }
  return { patch, skipped };
}
