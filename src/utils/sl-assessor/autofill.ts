// src/utils/sl-assessor/autofill.ts
// Pure: given an existing record and a Parcel, return the field patch
// to apply (only fills empty fields) plus the list of fields that were
// skipped because the user already had a value.

import type { Parcel } from './types';
import type { CamaParcel } from './camaParser';
import { PROMOTED_RECORD_FIELDS } from './camaFields';

/**
 * The 11 Assessor-mappable columns we ALTER'd onto businesses + properties.
 * `assessor_last_synced_at` and `assessor_source_url` are NOT in this list
 * because they are provenance-stamps, not autofill targets — they always
 * apply.
 */
export const AUTOFILL_FIELDS = [
  'parcel_number',
  'owner_of_record',
  'owner_type',
  'owner_mailing_address',
  'year_built',
  'total_market_value',
  'land_sqft',
  'last_sale_date',
  'last_sale_price',
  'legal_description',
  'tax_district',
  // Curated CAMA fields (mig 0221). Sourced from parcel.cama, which is
  // populated for Salt Lake County only — the other three counties leave it
  // null and these simply stay empty rather than erroring.
  ...PROMOTED_RECORD_FIELDS.map((f) => f.col),
] as const as readonly string[];

export type AutofillField = string;

export interface ApplyResult {
  patch: Partial<Record<AutofillField, unknown>> & {
    assessor_source_url: string;
    assessor_last_synced_at: string;
  };
  skipped: AutofillField[];
}

const PROMOTED_BY_COL = new Map(PROMOTED_RECORD_FIELDS.map((f) => [f.col, f]));

function pickParcelValue(parcel: Parcel, field: AutofillField): unknown {
  const promoted = PROMOTED_BY_COL.get(field);
  if (promoted) {
    const cama = parcel.cama as CamaParcel | null | undefined;
    if (!cama) return null;
    switch (promoted.source) {
      case 'residence': return cama.residence[promoted.key] ?? null;
      case 'parcel':    return cama.parcel[promoted.key] ?? null;
      case 'land0':     return cama.land_records[0]?.[promoted.key] ?? null;
      case 'root':      return (cama as any)[promoted.key] ?? null;
    }
  }
  switch (field) {
    case 'parcel_number': return parcel.parcel_number;
    case 'owner_of_record': return parcel.owner_of_record;
    case 'owner_type': return parcel.owner_type;
    case 'owner_mailing_address': return parcel.owner_mailing_address;
    case 'year_built': return parcel.year_built;
    case 'total_market_value': return parcel.market_value_total;
    case 'land_sqft': return parcel.land_sqft;
    case 'last_sale_date': return parcel.sales[0]?.sale_date ?? null;
    case 'last_sale_price': return parcel.sales[0]?.sale_price ?? null;
    case 'legal_description': return parcel.legal_description;
    case 'tax_district': return parcel.tax_district;
    default: return null;
  }
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

export function applyParcelToRecord(
  record: Record<string, unknown>,
  parcel: Parcel,
): ApplyResult {
  const patch: Record<string, unknown> = {
    assessor_source_url: parcel.source_url,
    assessor_last_synced_at: new Date().toISOString(),
  };
  const skipped: AutofillField[] = [];
  for (const f of AUTOFILL_FIELDS) {
    const incoming = pickParcelValue(parcel, f);
    if (isEmpty(incoming)) continue;
    if (!isEmpty(record[f])) { skipped.push(f); continue; }
    patch[f] = incoming;
  }
  return { patch, skipped } as ApplyResult;
}
