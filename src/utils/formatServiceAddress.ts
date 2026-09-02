/**
 * Address of service as a conventional three-line postal block:
 *
 *     123 Apple Cherry Lane
 *     South Bend, UT 84950
 *     King County, USA
 *
 * NOT a comma-joined single string left to wrap wherever the column
 * runs out. On the 2026-07-27 service that produced
 * "1240 EAST 2100 SOUTH, SALT LAKE CITY, UT, 84106" breaking mid-city —
 * circled with "2 lines" — and it put a comma between the state and the
 * ZIP, which no postal or court address block does.
 *
 * Mirrors client/src/utils/formatServiceAddress.ts. Keep the two in lockstep.
 */

const US_STATE_NAME_TO_ABBR: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY', 'district of columbia': 'DC',
};

const US_ABBR = new Set(Object.values(US_STATE_NAME_TO_ABBR));

const STREET_KEEP_UPPER = new Set([
  'NE', 'NW', 'SE', 'SW', 'N', 'S', 'E', 'W',
  'US', 'USA', 'PO', 'DC', 'APT', 'STE', 'UNIT',
]);

const ZIP_RE = /^\d{5}(?:-\d{4})?$/;
const ST_ZIP_RE = /^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/;
const NAME_ZIP_RE = /^([A-Za-z][A-Za-z .]+?)\s+(\d{5}(?:-\d{4})?)$/;

export interface ServiceAddressParts {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  county?: string | null;
  country?: string | null;
}

interface ParsedAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
  county: string;
  country: string;
}

function clean(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeState(raw: string): string {
  const t = clean(raw);
  if (!t) return '';
  if (t.length === 2 && US_ABBR.has(t.toUpperCase())) return t.toUpperCase();
  const fromName = US_STATE_NAME_TO_ABBR[t.toLowerCase()];
  return fromName || t;
}

function normalizeCountry(raw: string): string {
  const t = clean(raw).replace(/\./g, '');
  if (!t) return '';
  if (/^(united states( of america)?|usa|us)$/i.test(t)) return 'USA';
  if (/^(canada|ca)$/i.test(t)) return 'Canada';
  return t;
}

function isCountryToken(raw: string): boolean {
  const t = clean(raw).replace(/\./g, '');
  return /^(united states( of america)?|usa|us|canada|ca)$/i.test(t);
}

function formatCounty(raw: string): string {
  let t = clean(raw).replace(/,+$/, '');
  if (!t) return '';
  t = t.replace(/\s+county$/i, '').trim();
  if (!t || isCountryToken(t) || ZIP_RE.test(t)) return '';
  return `${titleCaseWords(t)} County`;
}

function titleCaseWords(raw: string): string {
  const source = /[a-z]/.test(raw) ? raw : raw.toLowerCase();
  return source.replace(/\b([A-Za-z0-9]+)\b/g, (word) => {
    const upper = word.toUpperCase();
    if (ZIP_RE.test(word)) return word;
    if (word.length <= 3 && STREET_KEEP_UPPER.has(upper)) return upper;
    if (US_ABBR.has(upper) && word.length === 2) return upper;
    if (upper === 'USA' || upper === 'US') return 'USA';
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
}

function parseLocality(line: string): { city: string; state: string; zip: string } {
  let s = clean(line);
  if (!s) return { city: '', state: '', zip: '' };

  // A single "UT 84123" / "Utah 84123" / "Ampsterdam 84950" token is a
  // state+ZIP, not a city. Comma-joined locality lines fall through.
  if (!s.includes(',')) {
    const onlyStZip = s.match(ST_ZIP_RE);
    if (onlyStZip) return { city: '', state: normalizeState(onlyStZip[1]), zip: onlyStZip[2] };
    const onlyNameZip = s.match(NAME_ZIP_RE);
    if (onlyNameZip) return { city: '', state: normalizeState(onlyNameZip[1]), zip: onlyNameZip[2] };
  }

  let zip = '';
  const zipM = s.match(/,?\s*(\d{5}(?:-\d{4})?)\s*$/);
  if (zipM && zipM.index != null) {
    zip = zipM[1];
    s = s.slice(0, zipM.index).trim().replace(/,+$/, '').trim();
  }

  const bits = s.split(',').map(clean).filter(Boolean);
  if (bits.length === 0) return { city: '', state: '', zip };

  const last = bits[bits.length - 1];
  const stZip = last.match(ST_ZIP_RE);
  if (stZip) {
    return { city: bits.slice(0, -1).join(', '), state: normalizeState(stZip[1]), zip: zip || stZip[2] };
  }
  const nameZip = last.match(NAME_ZIP_RE);
  if (nameZip) {
    return { city: bits.slice(0, -1).join(', '), state: normalizeState(nameZip[1]), zip: zip || nameZip[2] };
  }
  if (last.length === 2 && US_ABBR.has(last.toUpperCase())) {
    return { city: bits.slice(0, -1).join(', '), state: last.toUpperCase(), zip };
  }
  if (US_STATE_NAME_TO_ABBR[last.toLowerCase()]) {
    return { city: bits.slice(0, -1).join(', '), state: US_STATE_NAME_TO_ABBR[last.toLowerCase()], zip };
  }
  if (bits.length >= 2) {
    return { city: bits.slice(0, -1).join(', '), state: last, zip };
  }
  return { city: last, state: '', zip };
}

function consumeFromEnd(tokens: string[]): ParsedAddress {
  const out: ParsedAddress = { street: '', city: '', state: '', zip: '', county: '', country: '' };
  let rest = tokens.map(clean).filter(Boolean);

  if (rest.length && isCountryToken(rest[rest.length - 1])) {
    out.country = normalizeCountry(rest.pop() as string);
  }

  if (rest.length && /\bcounty$/i.test(rest[rest.length - 1])) {
    out.county = formatCounty(rest.pop() as string);
  }

  if (rest.length) {
    const last = rest[rest.length - 1];
    const loc = parseLocality(last);
    if (loc.state || loc.zip || (loc.city && rest.length >= 2)) {
      rest.pop();
      out.city = loc.city;
      out.state = loc.state;
      out.zip = loc.zip;
      if (!out.state && rest.length) {
        const maybeState = rest[rest.length - 1];
        if (maybeState.length === 2 || US_STATE_NAME_TO_ABBR[maybeState.toLowerCase()]) {
          out.state = normalizeState(rest.pop() as string);
        }
      }
      if (!out.city && rest.length) out.city = rest.pop() as string;
    } else if (rest.length >= 2 && ZIP_RE.test(last)) {
      out.zip = rest.pop() as string;
      const maybeState = rest[rest.length - 1];
      if (maybeState && (maybeState.length === 2 || US_STATE_NAME_TO_ABBR[maybeState.toLowerCase()])) {
        out.state = normalizeState(rest.pop() as string);
      }
      if (rest.length) out.city = rest.pop() as string;
    }
  }

  out.street = rest.join(', ');
  return out;
}

function parseBlock(raw: string): ParsedAddress {
  const lines = raw.split(/\r?\n/).map(clean).filter(Boolean);
  if (lines.length >= 2) {
    const street = lines[0];
    const loc = parseLocality(lines[1]);
    let county = '';
    let country = '';
    if (lines[2]) {
      const third = consumeFromEnd(lines[2].split(','));
      county = third.county || formatCounty(third.street || third.city);
      country = third.country;
      if (!country && isCountryToken(lines[2])) country = normalizeCountry(lines[2]);
    }
    return { street, city: loc.city, state: loc.state, zip: loc.zip, county, country };
  }
  return consumeFromEnd(raw.split(','));
}

function fill(base: ParsedAddress, extra: ParsedAddress): ParsedAddress {
  return {
    street: base.street || extra.street,
    city: base.city || extra.city,
    state: base.state || extra.state,
    zip: base.zip || extra.zip,
    county: base.county || extra.county,
    country: base.country || extra.country,
  };
}

function looksLikeBlock(s: string): boolean {
  return /\n/.test(s) || /,\s*(united states|usa|us)\s*$/i.test(s) || /\b\d{5}(?:-\d{4})?\b/.test(s);
}

/**
 * Street on line one; city, state and ZIP together on line two (comma
 * after the city only, never between state and ZIP); county and country
 * on line three when known. USA is implied for a US-state locality.
 */
export function formatServiceAddress(parts: ServiceAddressParts): string {
  const structured: ParsedAddress = {
    street: '',
    city: clean(parts.city),
    state: normalizeState(parts.state ?? ''),
    zip: clean(parts.zip),
    county: formatCounty(parts.county ?? ''),
    country: normalizeCountry(parts.country ?? ''),
  };

  const raw = (parts.address ?? '').trim();
  let parsed: ParsedAddress = { street: '', city: '', state: '', zip: '', county: '', country: '' };
  if (raw) {
    if (looksLikeBlock(raw) || !structured.city) {
      parsed = parseBlock(raw);
    } else {
      parsed.street = clean(raw.replace(/\n/g, ', '));
    }
  }

  // Structured city/state/zip win when the caller actually has them, so a
  // one-line blob stuffed into `address` cannot fight a real city field.
  // Street still comes from the blob — but if that blob already repeats
  // the locality, strip the duplicated tail.
  const merged = fill(structured, parsed);
  if (!merged.street) merged.street = parsed.street;

  if (merged.street && merged.city) {
    const dup = merged.street.split(',').map(clean);
    const cityIdx = dup.findIndex((t) => t.toLowerCase() === merged.city.toLowerCase());
    if (cityIdx > 0) merged.street = dup.slice(0, cityIdx).join(', ');
  }

  const street = titleCaseWords(merged.street);
  const city = titleCaseWords(merged.city);
  const state = normalizeState(merged.state);
  const zip = merged.zip;
  const locality = [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');

  let county = merged.county;
  let country = merged.country;
  if (!country && state && US_ABBR.has(state)) country = 'USA';

  const region = [county, country].filter(Boolean).join(', ');
  return [street, locality, region].filter(Boolean).join('\n');
}

/** Flatten a formatted block for use inside a sentence. */
export function flattenServiceAddress(block: string): string {
  return formatServiceAddress({ address: block }).split('\n').filter(Boolean).join(', ');
}
