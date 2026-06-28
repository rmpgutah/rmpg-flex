// src/utils/sl-assessor/autofill.ts
// Pure: given an existing record and a Parcel, return the field patch
// to apply (only fills empty fields) plus the list of fields that were
// skipped because the user already had a value.

import type { Parcel } from './types';

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
] as const;

export type AutofillField = (typeof AUTOFILL_FIELDS)[number];

export interface ApplyResult {
  patch: Partial<Record<AutofillField, unknown>> & {
    assessor_source_url: string;
    assessor_last_synced_at: string;
  };
  skipped: AutofillField[];
}

function pickParcelValue(parcel: Parcel, field: AutofillField): unknown {
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
