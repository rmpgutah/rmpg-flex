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
//   4. a SPECIFIC inferred location (corporate / small business /
//      government) from the service address + entity name
//   5. the extracted address_class field
//   6. unknown
//
// UNCONFIRMED GENERIC `'business'` NEVER YIELDS OFFICE-HOUR TIMING.
// That class is still returned (tiers 3 and 5) because it drives WHO
// may accept service. The TIMING gate lives in `selectWindows()`
// (serveAttemptWindows.ts). Generic unconfirmed `'business'` falls through
// to residential defaults (wider windows). Being wrong that way costs
// one unnecessary attempt window; being wrong the other way puts a
// server outside a house at 10:00 on a Tuesday and the service fails.
//
// SPECIFIC office classes (corporate / small_business / government) ARE
// allowed to select office-hour windows even when unconfirmed, because
// they are only assigned from stronger signals: operator choice, an
// independent businesses row, government keywords, or a suite/floor
// PLUS a legal entity (LLC/Inc) or recipient_type=business. A bare
// extracted "business" from "suite" language is NOT enough — that is
// the registered-agent-at-a-duplex failure mode.
//
// CONSEQUENCE FOR CALLERS: `AddressClassResult.confirmed` is NOT
// diagnostic-only for generic `'business'`. It must be threaded to
// planAttemptWindows / selectWindows as `addressClassConfirmed`.
//
// A row this pipeline auto-created is NOT independent evidence: callers
// must not set `businessRecordMatched` from a `businesses` row that
// findOrCreateBusiness inserted (marked `notes: 'Auto-created via serve
// intake'` / `business_type: 'process_service_recipient'`). Otherwise a
// corporation served through its registered agent AT THE AGENT'S HOME
// self-confirms as a business location on the second intake — exactly
// the case D-2 exists to prevent.
// ============================================================

export const ADDRESS_CLASSES = [
  'residential',
  'business',
  'corporate',
  'small_business',
  'government',
  'gated',
  'po_box',
  'unknown',
] as const;

export type AddressClass = (typeof ADDRESS_CLASSES)[number];

export interface AddressClassInput {
  operatorOverride?: string;      // explicit choice on the review screen
  propertyRecordClass?: string;   // from an existing properties row
  businessRecordMatched?: boolean;// an existing businesses row matched this address
  instructionsText?: string;      // raw client instructions / field-sheet text
  extracted?: string;             // the model's address_class field
  serviceAddress?: string | null; // street / suite line used for inference
  entityName?: string | null;     // LLC / Inc / agency name
  recipientType?: string | null;  // 'individual' | 'business'
}

export interface AddressClassResult {
  klass: AddressClass;
  confirmed: boolean;
  source: 'operator' | 'property_record' | 'business_record' | 'packet_language' | 'extracted' | 'inferred' | 'none';
}

const BUSINESS_LANGUAGE = /\b(business address|place of employment|commercial address|corporate address)\b/i;
const RESIDENTIAL_LANGUAGE = /\b(residence|residential address|abode|dwelling|home address)\b/i;

const GOVERNMENT_RE = /\b(city hall|county (?:building|courthouse|clerk|offices?)|courthouse|federal (?:building|courthouse)|u\.?s\.?\s+(?:district|bankruptcy)\s+court|capitol|municipal|department of|division of corporations|dmv|post office|irs\b|government office|town hall)\b/i;

const LEGAL_ENTITY_RE = /\b(llc|l\.l\.c\.|inc\.?|incorporated|corp\.?|corporation|ltd\.?|llp|p\.?c\.|plc)\b/i;
const RESIDENTIAL_UNIT_RE = /\b(apt\.?|apartment|unit\s*#?\s*\d+|condo|townhome|residence)\b/i;
const OFFICE_SUITE_RE = /\b(suite|ste\.?|floor|fl\.?|room)\b/i;
const SMALL_BIZ_RE = /\b(dba|d\/b\/a|shop|store|salon|restaurant|cafe|garage|market|boutique)\b/i;
const PO_BOX_RE = /\b(p\.?\s*o\.?\s*box|post office box)\b/i;
const GATED_RE = /\b(gated|hoa|guard (?:gate|house)|call box)\b/i;

export const ADDRESS_CLASS_LABELS: Record<AddressClass, string> = {
  residential: 'Residential',
  business: 'Business (generic)',
  corporate: 'Corporate / Large Business',
  small_business: 'Small Business',
  government: 'Government Office',
  gated: 'Gated / HOA',
  po_box: 'PO Box',
  unknown: 'Unknown',
};

export function addressClassLabel(klass: AddressClass | string | null | undefined): string {
  const coerced = coerceAddressClass(klass ?? undefined);
  if (coerced) return ADDRESS_CLASS_LABELS[coerced];
  return ADDRESS_CLASS_LABELS.unknown;
}

/** Office-hour location kinds that do not need the D-2 confirmation gate. */
export function isSpecificOfficeClass(klass: AddressClass): boolean {
  return klass === 'corporate' || klass === 'small_business' || klass === 'government';
}

export function coerceAddressClass(raw: string | undefined | null): AddressClass | null {
  const s = (raw || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (!s) return null;
  if ((ADDRESS_CLASSES as readonly string[]).includes(s)) return s as AddressClass;
  if (s === 'commercial') return 'small_business';
  if (s === 'office' || s === 'corporate_business' || s === 'large_business') return 'corporate';
  if (s === 'gov' || s === 'government_office' || s === 'government_offices') return 'government';
  if (s === 'hoa' || s === 'gated_/_hoa' || s === 'gated_hoa') return 'gated';
  if (s === 'pobox' || s === 'po-box') return 'po_box';
  return null;
}

export function inferAddressClass(
  address: string | null | undefined,
  extras?: { entityName?: string | null; recipientType?: string | null; instructions?: string | null },
): AddressClass {
  const addr = (address || '').trim();
  const entity = (extras?.entityName || '').trim();
  const combined = `${addr} ${entity} ${extras?.instructions || ''}`.trim();
  if (!combined) {
    return extras?.recipientType === 'business' ? 'small_business' : 'unknown';
  }

  if (PO_BOX_RE.test(combined)) return 'po_box';
  if (GOVERNMENT_RE.test(combined)) return 'government';

  // Residence signals beat office-suite language (leasing office at an apt).
  if (RESIDENTIAL_LANGUAGE.test(combined) || RESIDENTIAL_UNIT_RE.test(addr)) {
    if (GATED_RE.test(combined)) return 'gated';
    return 'residential';
  }

  if (GATED_RE.test(combined) && !OFFICE_SUITE_RE.test(addr)) return 'gated';

  const legalEntity = LEGAL_ENTITY_RE.test(entity) || LEGAL_ENTITY_RE.test(addr);
  const officeSuite = OFFICE_SUITE_RE.test(addr) && !RESIDENTIAL_UNIT_RE.test(addr);
  const recipientBiz = extras?.recipientType === 'business';

  if (officeSuite && (legalEntity || recipientBiz)) return 'corporate';
  if (legalEntity && recipientBiz) return 'corporate';
  if (SMALL_BIZ_RE.test(combined) && !legalEntity) return 'small_business';
  if (recipientBiz) return officeSuite ? 'corporate' : 'small_business';

  return 'unknown';
}

export function resolveAddressClass(input: AddressClassInput): AddressClassResult {
  const inferred = inferAddressClass(input.serviceAddress, {
    entityName: input.entityName,
    recipientType: input.recipientType,
    instructions: input.instructionsText,
  });

  const override = coerceAddressClass(input.operatorOverride);
  if (override) return { klass: override, confirmed: true, source: 'operator' };

  const fromProperty = coerceAddressClass(input.propertyRecordClass);
  if (fromProperty) return { klass: fromProperty, confirmed: true, source: 'property_record' };

  if (input.businessRecordMatched) {
    const klass = isSpecificOfficeClass(inferred) ? inferred : 'business';
    return { klass, confirmed: true, source: 'business_record' };
  }

  const text = input.instructionsText || '';
  // Residential is checked FIRST: if a string carries both signals, the
  // safe direction is residential (wider windows). See D-2.
  if (RESIDENTIAL_LANGUAGE.test(text)) {
    return { klass: 'residential', confirmed: false, source: 'packet_language' };
  }
  if (BUSINESS_LANGUAGE.test(text)) {
    if (isSpecificOfficeClass(inferred)) {
      return { klass: inferred, confirmed: false, source: 'inferred' };
    }
    return { klass: 'business', confirmed: false, source: 'packet_language' };
  }

  const fromExtract = coerceAddressClass(input.extracted);
  if (isSpecificOfficeClass(inferred) && (!fromExtract || fromExtract === 'business' || fromExtract === 'unknown')) {
    return { klass: inferred, confirmed: false, source: 'inferred' };
  }
  if (fromExtract && fromExtract !== 'unknown') {
    return { klass: fromExtract, confirmed: false, source: 'extracted' };
  }
  if (inferred !== 'unknown') {
    return { klass: inferred, confirmed: false, source: 'inferred' };
  }

  return { klass: 'unknown', confirmed: false, source: 'none' };
}
