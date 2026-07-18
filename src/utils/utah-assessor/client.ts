// Worker-safe Utah County Land Records client. Classic ASP form at
// AddressSearchForm.asp POSTs to itself and either shows a results table
// (multi-match) or redirects straight to PropertyForm.asp (single match).
// Detail-by-serial-number: GET PropertyForm.asp?serial_no=<n> directly,
// no session required — same shape as SL Co's valuationInfoExpanded.cfm.

import { AssessorHttpError, AssessorTimeoutError } from '../parcel-lookup/types';
import type { Parcel, ParcelSummary } from '../parcel-lookup/types';
import { parseParcelList, parseParcelDetail } from './parser';

const BASE = 'https://www.utahcounty.gov/LandRecords';
const SEARCH_URL = `${BASE}/AddressSearchForm.asp`;
const DETAIL_BASE = `${BASE}/PropertyForm.asp`;
const TIMEOUT_MS = 12_000;

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

export interface UtahAssessorEnv { FIRECRAWL_API_KEY?: string; }

interface AddressParts { number: string; direction: string; street: string; type: string; }

/** Split "100 E Center St" into the form's Number/Direction/Street/Type fields. */
export function parseUtahAddressParts(address: string): AddressParts {
  const tokens = address.toUpperCase().replace(/,.*$/, '').trim().split(/\s+/).filter(Boolean);
  let i = 0;
  const number = /^\d+$/.test(tokens[i] ?? '') ? tokens[i++] : '';
  const DIRS = new Set(['N', 'S', 'E', 'W']);
  let direction = '';
  if (DIRS.has(tokens[i] ?? '')) direction = tokens[i++];
  const rest = tokens.slice(i);
  const last = rest[rest.length - 1] ?? '';
  const TYPES = new Set(['ST', 'RD', 'DR', 'CR', 'WY', 'LN', 'AV', 'BL', 'CT', 'PK', 'PL', 'TR']);
  let type = '';
  let street = rest.join(' ');
  if (TYPES.has(last)) {
    type = last;
    street = rest.slice(0, -1).join(' ');
  }
  return { number, direction, street, type };
}

export function buildQueryUrl(address: string): string {
  return `${SEARCH_URL}?address=${encodeURIComponent(address)}`;
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html', ...(init?.headers ?? {}) },
      signal: ctl.signal,
    });
    if (!res.ok) throw new AssessorHttpError(res.status, `Utah County request failed: ${url}`);
    return res;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new AssessorTimeoutError(`Utah County request timed out: ${url}`);
    if (e instanceof AssessorHttpError) throw e;
    throw new AssessorHttpError(0, e?.message ?? 'Utah County request failed');
  } finally {
    clearTimeout(t);
  }
}

export async function searchByAddress(_env: UtahAssessorEnv, address: string): Promise<ParcelSummary[]> {
  const parts = parseUtahAddressParts(address);
  const body = new URLSearchParams({
    txtNum: parts.number, cmbDir: parts.direction || '%',
    txtName: parts.street, cmbType: parts.type || '%', cmbCity: '%',
  });
  const res = await fetchWithTimeout(SEARCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const html = await res.text();
  if (res.url.includes('PropertyForm.asp')) {
    const parcel = parseParcelDetail(html);
    parcel.source_url = res.url;
    return [{
      parcel_number: parcel.parcel_number,
      owner_of_record: parcel.owner_of_record,
      situs_address: parcel.situs_address,
      land_sqft: parcel.land_sqft,
      total_market_value: parcel.market_value_total,
      detail_url: res.url,
    }];
  }
  return parseParcelList(html);
}

export async function getParcel(_env: UtahAssessorEnv, parcelNo: string): Promise<Parcel> {
  const url = `${DETAIL_BASE}?serial_no=${encodeURIComponent(parcelNo)}`;
  const res = await fetchWithTimeout(url);
  const html = await res.text();
  const parcel = parseParcelDetail(html);
  parcel.source_url = url;
  return parcel;
}
