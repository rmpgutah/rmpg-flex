import type { Bindings } from '../../types';
import type { NormalizedCandidate } from './types';

// Utah DOC public REST gateway. No auth / no captcha at the API layer
// (the website's reCAPTCHA is frontend-only). Verified 2026-06-15.
const UDC_BASE = 'https://api.utah.gov/udc/v1/public/rest';
const TIMEOUT_MS = 15_000;

export interface UdcCustodyRow {
  offender_number: number;
  offender_name: string;
  date_of_birth: string;
  location: string;
  housing_facility: string;
  release_date_and_type: string;
  case_manager_name: string;
  case_manager_email: string;
  detail_json: string;
}

/** Split UDC "LAST, FIRST MIDDLE" into parts (for name scoring). */
export function splitUdcName(name: string | null | undefined): { last: string; first: string; middle: string } {
  const s = (name ?? '').trim();
  if (!s) return { last: '', first: '', middle: '' };
  const comma = s.indexOf(',');
  if (comma < 0) return { last: s, first: '', middle: '' };
  const last = s.slice(0, comma).trim();
  const given = s.slice(comma + 1).trim().split(/\s+/).filter(Boolean);
  return { last, first: given[0] ?? '', middle: given.slice(1).join(' ') };
}

/** Map a name-search list row → NormalizedCandidate. */
export function mapUdcListResult(raw: Record<string, unknown>): NormalizedCandidate {
  const num = String(raw.offenderNumber ?? '');
  const name = String(raw.offenderName ?? 'unknown');
  const dob = raw.dateOfBirth ? String(raw.dateOfBirth) : null;
  return {
    sourceKey: 'utah-doc',
    externalId: num,
    displayName: name,
    summary: 'Utah DOC — current supervision',
    country: 'US',
    listType: 'utah-doc',
    dob,
    nationalities: ['US'],
    raw,
  };
}

/** Flatten the detail wrapper {results:{...}} → a udc_custody row, or null. */
export function mapUdcDetail(raw: Record<string, unknown>): UdcCustodyRow | null {
  const r = (raw?.results ?? {}) as Record<string, unknown>;
  const offenderNumber = Number(r.offenderNumber);
  if (!Number.isFinite(offenderNumber) || offenderNumber <= 0) return null;
  return {
    offender_number: offenderNumber,
    offender_name: String(r.offenderName ?? ''),
    date_of_birth: String(r.dateOfBirth ?? ''),
    location: String(r.location ?? ''),
    housing_facility: String(r.housingFacility ?? ''),
    release_date_and_type: String(r.releaseDateAndType ?? ''),
    case_manager_name: String(r.caseManagerName ?? ''),
    case_manager_email: String(r.caseManagerEmail ?? ''),
    detail_json: JSON.stringify(raw),
  };
}

async function getJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
    if (!resp.ok) throw new Error(`UDC HTTP ${resp.status}`);
    return await resp.json();
  } finally { clearTimeout(t); }
}

/** Live name search → candidate list (max 100). */
export async function udcSearchByName(_env: Bindings, first: string, last: string): Promise<NormalizedCandidate[]> {
  const f = encodeURIComponent((first ?? '').trim());
  const l = encodeURIComponent((last ?? '').trim());
  if (!l && !f) return [];
  const json = (await getJson(`${UDC_BASE}/offenders/name?first=${f}&last=${l}&index=0&pageCount=100`)) as { results?: unknown[] };
  const list = Array.isArray(json?.results) ? json.results : [];
  return list.map((r) => mapUdcListResult(r as Record<string, unknown>));
}

/** Live detail fetch by offender number → udc_custody row, or null. */
export async function udcGetDetail(_env: Bindings, offenderNumber: number | string): Promise<UdcCustodyRow | null> {
  const json = (await getJson(`${UDC_BASE}/offenders/${encodeURIComponent(String(offenderNumber))}`)) as Record<string, unknown>;
  return mapUdcDetail(json);
}
