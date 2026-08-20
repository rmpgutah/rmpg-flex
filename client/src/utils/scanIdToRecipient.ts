// ============================================================
// RMPG Flex — AAMVA scan result → downstream payload mappers
// ============================================================
// Two consumers share one AAMVA parse (client/src/utils/aamvaParser.ts):
//   - FieldCameraPage's "Scan ID" mode posts aamvaToScanResultObj() to
//     POST /records/from-dl-scan (creates/reuses a persons record).
//   - ServeIntakePage's "Scan ID" button merges aamvaToServeOverrides()
//     into its editOverrides recipient form state.
// Extracted from DlSearchPage.processBarcodeText's resultObj builder so
// all three call sites stay in sync with one mapping.
// ============================================================

import type { AamvaResult } from './aamvaParser';
import { describeClass, describeRestrictions, describeEndorsements } from './aamvaParser';

export interface DlScanResultObj {
  first_name: string; middle_name: string; last_name: string; suffix: string;
  date_of_birth: string; gender: string; height: string; weight: string;
  eye_color: string; hair_color: string;
  address: string; address2: string; city: string; state: string; zip: string;
  dl_number: string; dl_state: string; dl_class: string;
  dl_expiry: string; dl_issue_date: string;
  dl_restrictions: string; dl_endorsements: string;
  country: string; document_discriminator: string;
  is_real_id: boolean | null; is_organ_donor: boolean | null; is_veteran: boolean | null;
  under_18_until: string; under_21_until: string;
  aamva_version: number; issuer_id: string;
  raw_elements: Record<string, string>;
}

/** Build the /records/from-dl-scan `scan` payload from a parsed AAMVA barcode. */
export function aamvaToScanResultObj(parsed: AamvaResult): DlScanResultObj {
  return {
    first_name: parsed.first_name,
    middle_name: parsed.middle_name,
    last_name: parsed.last_name,
    suffix: parsed.suffix,
    date_of_birth: parsed.date_of_birth,
    gender: parsed.gender,
    height: parsed.height,
    weight: parsed.weight,
    eye_color: parsed.eye_color,
    hair_color: parsed.hair_color,
    address: parsed.address,
    city: parsed.city,
    state: parsed.state,
    zip: parsed.zip,
    dl_number: parsed.dl_number,
    dl_state: parsed.dl_state,
    dl_class: describeClass(parsed.dl_class),
    dl_expiry: parsed.dl_expiry,
    dl_issue_date: parsed.dl_issue_date,
    dl_restrictions: describeRestrictions(parsed.dl_restrictions),
    dl_endorsements: describeEndorsements(parsed.dl_endorsements),
    country: parsed.country,
    document_discriminator: parsed.document_discriminator,
    address2: parsed.address2,
    is_real_id: parsed.is_real_id,
    is_organ_donor: parsed.is_organ_donor,
    is_veteran: parsed.is_veteran,
    under_18_until: parsed.under_18_until,
    under_21_until: parsed.under_21_until,
    aamva_version: parsed.aamva_version,
    issuer_id: parsed.issuer_id,
    raw_elements: parsed.raw_elements,
  };
}

/**
 * Map a parsed AAMVA barcode to ServeIntakePage's `editOverrides` keys.
 * Only non-empty fields are included so an existing override (or OCR
 * value) isn't blanked out by a field the barcode didn't encode.
 */
export function aamvaToServeOverrides(parsed: AamvaResult): Record<string, string> {
  const out: Record<string, string> = {};
  const set = (key: string, value: string) => { if (value.trim()) out[key] = value; };
  set('recipient_first_name', parsed.first_name);
  set('recipient_last_name', parsed.last_name);
  set('recipient_middle_name', parsed.middle_name);
  set('recipient_dob', parsed.date_of_birth);
  set('recipient_address', parsed.address);
  set('recipient_city', parsed.city);
  set('recipient_state', parsed.state);
  set('recipient_zip', parsed.zip);
  return out;
}
