// src/utils/sl-assessor/client.ts
// Worker-safe Salt Lake County Assessor client. Uses Firecrawl /v1/scrape to
// render query.cfm (handles ColdFusion session + mild bot protection) and
// hands the resulting HTML to the pure parser.
//
// All network IO funnels through here so the route handler stays thin and
// the parser stays pure.

import { AssessorConfigError, AssessorHttpError, AssessorTimeoutError } from './types';
import type { Parcel, ParcelSummary } from './types';
import { parseParcelList, parseParcelDetail } from './parser';

const FC_SCRAPE = 'https://api.firecrawl.dev/v1/scrape';
const ASSESSOR_BASE = 'https://apps.saltlakecounty.gov/assessor/new/query.cfm';
const DEFAULT_TIMEOUT_MS = 25_000;

export interface AssessorEnv { FIRECRAWL_API_KEY?: string; }

export function buildQueryUrl(address: string): string {
  return `${ASSESSOR_BASE}?address=${encodeURIComponent(address)}`;
}

function buildParcelUrl(parcelNo: string): string {
  return `${ASSESSOR_BASE}?parcel=${encodeURIComponent(parcelNo)}`;
}

async function scrapeHtml(env: AssessorEnv, url: string): Promise<string> {
  if (!env.FIRECRAWL_API_KEY) throw new AssessorConfigError();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(FC_SCRAPE, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url, formats: ['html'] }),
      signal: ctl.signal,
    });
    if (!res.ok) throw new AssessorHttpError(res.status, await res.text().catch(() => ''));
    const json = await res.json() as any;
    const html = json?.data?.html ?? '';
    if (typeof html !== 'string' || !html) {
      throw new AssessorHttpError(res.status, 'Firecrawl returned no html');
    }
    return html;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new AssessorTimeoutError(`scrape timed out: ${url}`);
    if (e instanceof AssessorHttpError) throw e;
    throw new AssessorHttpError(0, e?.message ?? 'scrape failed');
  } finally {
    clearTimeout(t);
  }
}

export async function searchByAddress(env: AssessorEnv, address: string): Promise<ParcelSummary[]> {
  const url = buildQueryUrl(address);
  const html = await scrapeHtml(env, url);
  return parseParcelList(html);
}

export async function getParcel(env: AssessorEnv, parcelNo: string): Promise<Parcel> {
  const url = buildParcelUrl(parcelNo);
  const html = await scrapeHtml(env, url);
  const parcel = parseParcelDetail(html);
  parcel.source_url = url;
  return parcel;
}
