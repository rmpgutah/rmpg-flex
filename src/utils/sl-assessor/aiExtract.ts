// src/utils/sl-assessor/aiExtract.ts
// Last-resort parser: when the structural HTML parser returns nothing (e.g. the
// SLCo site re-rendered its result table into a layout the regex parser doesn't
// recognise), ask Claude/OpenAI/Workers AI (via the existing callAi router) to
// extract the parcels from the raw HTML.
//
// This is NOT the primary path — it costs ~$0.01-0.03 per call. lookup.ts only
// reaches here after Firecrawl + direct fetch both came back empty.

import { callAi } from '../callAi';
import type { ParcelSummary } from './types';

interface AiEnv { DB: D1Database; AI: Ai; }

const SYSTEM = [
  'You extract Salt Lake County Assessor parcel rows from raw HTML.',
  'Return ONLY a JSON array. Each entry shape:',
  '{"parcel_number":"NN-NN-NNN-NNN","owner_of_record":string|null,"situs_address":string|null,"land_sqft":number|null,"total_market_value":number|null,"detail_url":string}',
  'Rules:',
  '- parcel_number MUST match \\d{2}-\\d{2}-\\d{3}-\\d{3}',
  '- detail_url is the relative or absolute link to the parcel detail page; if unknown use "?parcel=<parcel_number>"',
  '- Return [] if no parcels are present. Do NOT invent rows.',
  '- Do NOT include markdown fences or commentary. Reply with the JSON array and nothing else.',
].join('\n');

const PARCEL_RE = /^\d{2}-\d{2}-\d{3}-\d{3}$/;

function safeJsonParse(text: string): unknown {
  // Strip markdown fences if a model emits them despite the instruction.
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  try { return JSON.parse(cleaned); } catch { return null; }
}

function coerceParcel(raw: unknown): ParcelSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const parcel_number = typeof o.parcel_number === 'string' ? o.parcel_number.trim() : '';
  if (!PARCEL_RE.test(parcel_number)) return null;
  const detail_url = typeof o.detail_url === 'string' && o.detail_url.length > 0
    ? o.detail_url
    : `?parcel=${parcel_number}`;
  const toInt = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
    if (typeof v === 'string') {
      const n = parseInt(v.replace(/[$,]/g, ''), 10);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };
  const toStrOrNull = (v: unknown): string | null => {
    if (v == null) return null;
    const s = typeof v === 'string' ? v : String(v);
    return s.trim() || null;
  };
  return {
    parcel_number,
    owner_of_record: toStrOrNull(o.owner_of_record),
    situs_address: toStrOrNull(o.situs_address),
    land_sqft: toInt(o.land_sqft),
    total_market_value: toInt(o.total_market_value),
    detail_url,
  };
}

/**
 * Ask the AI router to extract parcel summaries from raw HTML. Returns [] on
 * any failure — this function is itself a fallback, so it MUST NOT throw.
 *
 * HTML is hard-capped so a 10 MB page doesn't blow the model's context.
 */
export async function extractParcelsViaAi(
  env: AiEnv,
  html: string,
  address: string,
): Promise<ParcelSummary[]> {
  if (!html || html.length < 100) return [];
  const trimmed = html.length > 60_000 ? html.slice(0, 60_000) : html;
  const user = [
    `Address queried: ${address}`,
    'HTML follows. Extract every parcel row found.',
    '---',
    trimmed,
  ].join('\n');
  let text = '';
  try {
    const r = await callAi(env, { system: SYSTEM, text: user, maxTokens: 1500 });
    text = r.text;
  } catch {
    return [];
  }
  const parsed = safeJsonParse(text);
  if (!Array.isArray(parsed)) return [];
  const out: ParcelSummary[] = [];
  for (const raw of parsed) {
    const p = coerceParcel(raw);
    if (p) out.push(p);
  }
  return out;
}
