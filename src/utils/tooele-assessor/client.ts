// Worker-safe Tooele County Recorder e-recording client.

import { AssessorHttpError, AssessorTimeoutError } from '../parcel-lookup/types';
import type { Parcel, ParcelSummary } from '../parcel-lookup/types';
import { parseParcelList, parseParcelDetail } from './parser';

const BASE = 'https://erecording.tooeleco.gov/eaglesoftware/web';
const TIMEOUT_MS = 12_000;

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

export interface TooeleRecorderEnv { FIRECRAWL_API_KEY?: string; }

export function buildQueryUrl(address: string): string {
  return `${BASE}/?address=${encodeURIComponent(address)}`;
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
    if (!res.ok) throw new AssessorHttpError(res.status, `Tooele County Recorder request failed: ${url}`);
    return res;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new AssessorTimeoutError(`Tooele County Recorder request timed out: ${url}`);
    if (e instanceof AssessorHttpError) throw e;
    throw new AssessorHttpError(0, e?.message ?? 'Tooele County Recorder request failed');
  } finally {
    clearTimeout(t);
  }
}

export async function searchByAddress(_env: TooeleRecorderEnv, address: string): Promise<ParcelSummary[]> {
  const url = `${BASE}/search?address=${encodeURIComponent(address)}`;
  const res = await fetchWithTimeout(url);
  const html = await res.text();
  if (html.includes('Parcel Number:')) {
    const parcel = parseParcelDetail(html);
    parcel.source_url = res.url;
    return [{
      parcel_number: parcel.parcel_number,
      owner_of_record: parcel.owner_of_record,
      situs_address: parcel.situs_address,
      land_sqft: null,
      total_market_value: null,
      detail_url: res.url,
      recorded_document_url: parcel.recorded_document_url,
      recorded_document_type: parcel.recorded_document_type,
    }];
  }
  return parseParcelList(html);
}

export async function getParcel(_env: TooeleRecorderEnv, parcelNo: string): Promise<Parcel> {
  const url = `${BASE}/document?parcel=${encodeURIComponent(parcelNo)}`;
  const res = await fetchWithTimeout(url);
  const html = await res.text();
  const parcel = parseParcelDetail(html);
  parcel.source_url = url;
  return parcel;
}
