// src/utils/serveAddressClass.ts
// ============================================================
// RMPG Flex — Serve Intake address-class resolution (spec §3.1)
// ============================================================
// BINDING OPERATOR DECISION (D-2): address class is a property of the
// LOCATION, never the recipient. A registered agent is frequently at a
// residence, and serving a residence needs residential windows
// (evenings, weekends) rather than business hours. The corporate/agent
// role continues to drive WHO may accept service — that is a separate
// concern handled in the briefing's SERVICE AUTHORITY section.
//
// Resolution order, first hit wins:
//   1. operator confirmation at review
//   2. an existing properties/businesses record
//   3. explicit packet language
//   4. the extracted address_class field
//   5. unknown
//
// UNCONFIRMED NEVER YIELDS BUSINESS TIMING. This resolver still RETURNS
// an unconfirmed `'business'` (tiers 3 and 4) because the class drives
// WHO may accept service in the briefing's SERVICE AUTHORITY section.
// The TIMING gate lives one layer down, in `selectWindows()`
// (serveAttemptWindows.ts), which requires `confirmed === true` before it
// will emit BUSINESS_DEFAULTS — so `unknown` and every unconfirmed class
// fall through to residential defaults, which are strictly wider. Being
// wrong that way costs one unnecessary attempt window; being wrong the
// other way puts a server outside a house at 10:00 on a Tuesday and the
// service fails.
//
// CONSEQUENCE FOR CALLERS: `AddressClassResult.confirmed` is NOT
// diagnostic-only. It must be threaded to planAttemptWindows /
// selectWindows as `addressClassConfirmed`, or business timing silently
// never applies.
//
// A row this pipeline auto-created is NOT independent evidence: callers
// must not set `businessRecordMatched` from a `businesses` row that
// findOrCreateBusiness inserted (marked `notes: 'Auto-created via serve
// intake'` / `business_type: 'process_service_recipient'`). Otherwise a
// corporation served through its registered agent AT THE AGENT'S HOME
// self-confirms as a business location on the second intake — exactly
// the case D-2 exists to prevent.
// ============================================================

export type AddressClass = 'residential' | 'business' | 'unknown';

export interface AddressClassInput {
  operatorOverride?: string;      // explicit choice on the review screen
  propertyRecordClass?: string;   // from an existing properties row
  businessRecordMatched?: boolean;// an existing businesses row matched this address
  instructionsText?: string;      // raw client instructions / field-sheet text
  extracted?: string;             // the model's address_class field
}

export interface AddressClassResult {
  klass: AddressClass;
  confirmed: boolean;
  source: 'operator' | 'property_record' | 'business_record' | 'packet_language' | 'extracted' | 'none';
}

const BUSINESS_LANGUAGE = /\b(business address|place of employment|commercial address|corporate address)\b/i;
const RESIDENTIAL_LANGUAGE = /\b(residence|residential address|abode|dwelling|home address)\b/i;

function coerce(raw: string | undefined): AddressClass | null {
  const s = (raw || '').trim().toLowerCase();
  if (s === 'residential' || s === 'business') return s;
  return null;
}

export function resolveAddressClass(input: AddressClassInput): AddressClassResult {
  const override = coerce(input.operatorOverride);
  if (override) return { klass: override, confirmed: true, source: 'operator' };

  const fromProperty = coerce(input.propertyRecordClass);
  if (fromProperty) return { klass: fromProperty, confirmed: true, source: 'property_record' };

  if (input.businessRecordMatched) {
    return { klass: 'business', confirmed: true, source: 'business_record' };
  }

  const text = input.instructionsText || '';
  // Residential is checked FIRST: if a string carries both signals, the
  // safe direction is residential (wider windows). See D-2.
  if (RESIDENTIAL_LANGUAGE.test(text)) {
    return { klass: 'residential', confirmed: false, source: 'packet_language' };
  }
  if (BUSINESS_LANGUAGE.test(text)) {
    return { klass: 'business', confirmed: false, source: 'packet_language' };
  }

  const fromExtract = coerce(input.extracted);
  if (fromExtract) return { klass: fromExtract, confirmed: false, source: 'extracted' };

  return { klass: 'unknown', confirmed: false, source: 'none' };
}
