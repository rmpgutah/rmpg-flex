// Worker-safe Summit County Eagle Software TaxWeb client.

import { AssessorHttpError, AssessorTimeoutError } from '../parcel-lookup/types';
import type { Parcel, ParcelSummary } from '../parcel-lookup/types';
import { parseParcelList, parseParcelDetail } from './parser';

const BASE = 'https://property.summitcounty.org/eaglesoftware/taxweb';
const SEARCH_URL = `${BASE}/search.jsp`;
const TIMEOUT_MS = 12_000;

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

export interface SummitAssessorEnv { FIRECRAWL_API_KEY?: string; }

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
    if (!res.ok) throw new AssessorHttpError(res.status, `Summit County request failed: ${url}`);
    return res;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new AssessorTimeoutError(`Summit County request timed out: ${url}`);
    if (e instanceof AssessorHttpError) throw e;
    throw new AssessorHttpError(0, e?.message ?? 'Summit County request failed');
  } finally {
    clearTimeout(t);
  }
}

export async function searchByAddress(_env: SummitAssessorEnv, address: string): Promise<ParcelSummary[]> {
  // Callers may pass a full "street, city, state zip" address (needed for
  // county resolution upstream) — the county site only wants the street.
  const streetOnly = address.split(',')[0];
  const url = `${SEARCH_URL}?type=address&q=${encodeURIComponent(streetOnly)}`;
  const res = await fetchWithTimeout(url);
  const html = await res.text();
  if (html.includes('Account Number:')) {
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

export async function getParcel(_env: SummitAssessorEnv, parcelNo: string): Promise<Parcel> {
  const url = `${SEARCH_URL}?account=${encodeURIComponent(parcelNo)}`;
  const res = await fetchWithTimeout(url);
  const html = await res.text();
  const parcel = parseParcelDetail(html);
  parcel.source_url = url;
  return parcel;
}
