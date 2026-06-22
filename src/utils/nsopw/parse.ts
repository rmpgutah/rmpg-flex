// ============================================================
// RMPG Flex — NSOPW federated response parser.
// ------------------------------------------------------------
// Schema-tolerant — parses the documented public envelope but
// tolerates field-name drift. The literal MOU response shape may
// differ slightly (NSOPW versions its envelope); the parser
// classifies each field by likely role and pulls what it finds.
// Pure function, no I/O. Unit-tested against fixture.
// ============================================================

import type {
  NsopwOffender, NsopwSearchResponse, JurisdictionCoverage, JurisdictionStatus,
} from './types';

type Bag = Record<string, unknown>;

function pickString(b: Bag, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = b[k];
    if (typeof v === 'string' && v.trim().length) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}

function pickArray(b: Bag, ...keys: string[]): unknown[] {
  for (const k of keys) {
    const v = b[k];
    if (Array.isArray(v)) return v;
  }
  return [];
}

function pickInt(b: Bag, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = b[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const n = parseInt(v, 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/**
 * Parse one offender record into RMPG canonical shape.
 * The NSOPW envelope groups fields under `OffenderDetails` / `Offender` /
 * `Provider`; we accept all three (older versions vs newer versions) plus
 * flat-field fallbacks.
 */
export function parseOffender(raw: unknown): NsopwOffender | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Bag;
  const details = (b.OffenderDetails ?? b.offenderDetails ?? b.Offender ?? b.offender ?? b) as Bag;
  const provider = (b.Provider ?? b.provider ?? b.Source ?? b.source ?? b) as Bag;

  const jurisdiction =
    pickString(provider, 'ProviderName', 'providerName', 'Jurisdiction', 'jurisdiction', 'state', 'stateAbbreviation') ?? '';
  const jurisdictionLabel =
    pickString(provider, 'ProviderLabel', 'providerLabel', 'ProviderFullName', 'providerFullName') ?? jurisdiction;

  const firstName = pickString(details, 'FirstName', 'firstName', 'GivenName') ?? '';
  const middleName = pickString(details, 'MiddleName', 'middleName');
  const lastName = pickString(details, 'LastName', 'lastName', 'Surname', 'FamilyName') ?? '';
  const suffix = pickString(details, 'Suffix', 'suffix', 'NameSuffix');
  const nsopwOffenderId =
    pickString(details, 'OffenderId', 'offenderId', 'OffenderURI', 'offenderUri',
      'PersonId', 'personId', 'RegistryId', 'registryId') ?? '';

  // Aliases — sometimes an array of strings, sometimes an array of {AliasName}.
  const rawAliases = pickArray(details, 'Aliases', 'aliases', 'AlsoKnownAs');
  const aliases: string[] = rawAliases
    .map((a) => {
      if (typeof a === 'string') return a.trim();
      if (a && typeof a === 'object') {
        const ab = a as Bag;
        return pickString(ab, 'AliasName', 'aliasName', 'name', 'Name') ?? '';
      }
      return '';
    })
    .filter((s) => s.length > 0);

  return {
    nsopwOffenderId,
    jurisdiction: (jurisdiction || '').toUpperCase().slice(0, 8),
    jurisdictionLabel,
    firstName,
    middleName,
    lastName,
    suffix,
    aliases,
    dateOfBirth: pickString(details, 'DateOfBirth', 'dateOfBirth', 'DOB', 'BirthDate'),
    sex: pickString(details, 'Sex', 'sex', 'Gender', 'gender'),
    race: pickString(details, 'Race', 'race'),
    height: pickString(details, 'Height', 'height'),
    weight: pickString(details, 'Weight', 'weight'),
    hairColor: pickString(details, 'HairColor', 'hairColor', 'Hair'),
    eyeColor: pickString(details, 'EyeColor', 'eyeColor', 'Eyes'),
    scarsMarks: pickString(details, 'ScarsMarks', 'scarsMarks', 'Marks'),
    address: pickString(details, 'Address1', 'Address', 'address', 'StreetAddress'),
    city: pickString(details, 'City', 'city'),
    state: pickString(details, 'State', 'state', 'StateAbbreviation'),
    zip: pickString(details, 'Zip', 'zip', 'PostalCode', 'ZipCode'),
    offense: pickString(details, 'Offense', 'offense', 'CrimeDescription', 'CrimeDetails',
      'OffenseDescription'),
    riskLevel: pickString(details, 'RiskLevel', 'riskLevel', 'Tier', 'tier'),
    tier: deriveTier(pickString(details, 'Tier', 'tier', 'RiskLevel', 'riskLevel')),
    registrationStatus: pickString(details, 'RegistrationStatus', 'registrationStatus',
      'Status', 'status'),
    complianceStatus: pickString(details, 'ComplianceStatus', 'complianceStatus'),
    photoUrl: pickString(details, 'ImageUrl', 'imageUrl', 'PhotoUrl', 'photoUrl', 'ImageURI'),
    detailUrl: pickString(details, 'DetailsUrl', 'detailsUrl', 'OffenderUri', 'offenderUri',
      'OffenderURI', 'JurisdictionUrl'),
    raw,
  };
}

/**
 * Derive a normalized 1/2/3 tier from a free-form jurisdiction label.
 * 'Tier 3', 'Level 3', 'SVP', 'Sexually Violent Predator', 'High' → 3
 * 'Tier 2', 'Level 2', 'Moderate', 'Medium' → 2
 * 'Tier 1', 'Level 1', 'Low' → 1
 * Anything else → null (don't guess).
 */
export function deriveTier(label: string | null): number | null {
  if (!label) return null;
  const s = label.toLowerCase();
  if (/\b(tier|level)\s*(3|iii)\b/.test(s) || /\bsvp\b/.test(s) ||
      /sexually\s*violent/.test(s) || /\bhigh\b/.test(s)) return 3;
  if (/\b(tier|level)\s*(2|ii)\b/.test(s) || /\bmoderate\b/.test(s) ||
      /\bmedium\b/.test(s)) return 2;
  if (/\b(tier|level)\s*(1|i)\b/.test(s) || /\blow\b/.test(s)) return 1;
  return null;
}

/**
 * Parse a full NSOPW federated search response.
 * The MOU envelope wraps offenders under `Offenders` / `Results` / `Records`;
 * jurisdiction status comes from `SearchResponse.SearchResponseJurisdiction`
 * (older) or `Jurisdictions` / `Coverage` (newer). We accept either.
 */
export function parseSearchResponse(raw: unknown): NsopwSearchResponse {
  if (!raw || typeof raw !== 'object') {
    return { offenders: [], jurisdictionCoverage: {}, raw };
  }
  const env = raw as Bag;
  const inner = (env.SearchResponse ?? env.searchResponse ?? env) as Bag;

  const rawOffenders =
    pickArray(inner, 'Offenders', 'offenders', 'Results', 'results',
      'Records', 'records', 'Items', 'items');
  const offenders: NsopwOffender[] = [];
  for (const r of rawOffenders) {
    const o = parseOffender(r);
    if (o && (o.lastName || o.firstName)) offenders.push(o);
  }

  const jurisdictionCoverage: JurisdictionCoverage = {};
  const jurArray = pickArray(inner, 'SearchResponseJurisdiction', 'searchResponseJurisdiction',
    'Jurisdictions', 'jurisdictions', 'Coverage', 'coverage');
  for (const j of jurArray) {
    if (!j || typeof j !== 'object') continue;
    const jb = j as Bag;
    const code = (pickString(jb, 'Jurisdiction', 'jurisdiction', 'Code', 'code',
      'ProviderName', 'providerName') ?? '').toUpperCase().slice(0, 8);
    if (!code) continue;
    const status = pickString(jb, 'Status', 'status', 'SearchStatusType', 'searchStatusType');
    jurisdictionCoverage[code] = toStatus(status);
  }

  return { offenders, jurisdictionCoverage, raw };
}

function toStatus(s: string | null): JurisdictionStatus {
  if (!s) return 'no_data';
  const v = s.toLowerCase();
  if (v.includes('ok') || v.includes('success')) return 'ok';
  if (v.includes('timeout') || v.includes('timed')) return 'timeout';
  if (v.includes('error') || v.includes('fail')) return 'error';
  return 'no_data';
}
