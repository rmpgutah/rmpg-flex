// src/utils/personIntel/phase3.ts
// Phase 3: Firecrawl web search + Claude extraction of structured data points.
// Searches public web for person/vehicle intel, extracts typed RawDataPoints via LLM,
// and checks for crawl corroboration of already-known values.
import type { IntelSeed, RawDataPoint, SourceResult, RiskFlag } from './types';
import { parseJsonLoose, runResearchLLM } from '../researchEngine';
import { firecrawlSearch } from '../firecrawl';

const DATA_CATEGORIES = ['address', 'phone', 'email', 'associate', 'vehicle', 'social', 'business', 'legal', 'online'] as const;

export function buildSearchQueries(seed: IntelSeed): string[] {
  const queries: string[] = [];
  if (seed.name) {
    queries.push(`"${seed.name}" address phone contact`);
    if (seed.dob) queries.push(`"${seed.name}" born ${seed.dob.split('-')[0]} background`);
    queries.push(`"${seed.name}" arrest warrant criminal record`);
  }
  if (seed.plate) queries.push(`license plate "${seed.plate}" vehicle owner`);
  if (seed.email) queries.push(`"${seed.email}" person identity`);
  if (seed.phone) queries.push(`"${seed.phone}" owner contact`);
  return queries.slice(0, 5);
}

export function extractDataPointsFromMarkdown(text: string, source: string): RawDataPoint[] {
  const j = parseJsonLoose<any[]>(text);
  if (!Array.isArray(j)) return [];
  const pts: RawDataPoint[] = [];
  for (const item of j) {
    if (!item?.category || !item?.field || !item?.value) continue;
    if (!(DATA_CATEGORIES as readonly string[]).includes(item.category)) continue;
    pts.push({
      category: item.category,
      field: String(item.field),
      value: String(item.value).slice(0, 500),
      source,
    });
  }
  return pts;
}

const EXTRACT_SYSTEM = `You are an OSINT data extractor for law enforcement. Given web page text about a person, extract structured data points.
Return ONLY a JSON array of objects with shape: [{category, field, value}].
Categories: address, phone, email, associate, vehicle, social, business, legal, online.
Only include factual data actually present in the text. No inference. No hallucination.`;

export interface Phase3Result {
  sourceResults: SourceResult[];
  dataPoints: RawDataPoint[];
  riskFlags: RiskFlag[];
  crawlCorroboration: boolean;
}

export async function runPhase3(
  env: { DB: D1Database; AI: Ai; FIRECRAWL_API_KEY?: string },
  seed: IntelSeed,
  knownValues: string[],
): Promise<Phase3Result> {
  const sourceResults: SourceResult[] = [];
  const allPoints: RawDataPoint[] = [];
  const riskFlags: RiskFlag[] = [];

  if (!env.FIRECRAWL_API_KEY) {
    return {
      sourceResults: [{
        sourceName: 'Firecrawl',
        phase: 3,
        status: 'not_configured',
        dataPoints: [],
        connections: [],
        responseTimeMs: 0,
      }],
      dataPoints: [],
      riskFlags: [],
      crawlCorroboration: false,
    };
  }

  const queries = buildSearchQueries(seed);

  for (const query of queries) {
    const t0 = Date.now();
    try {
      const results = await firecrawlSearch(env, query, { limit: 3, scrape: true, timeoutMs: 25000 });
      for (const r of results) {
        const md = r.markdown ?? r.description ?? '';
        if (!md) continue;
        const llmOut = await runResearchLLM(env, {
          system: EXTRACT_SYSTEM,
          user: `URL: ${r.url}\n\nCONTENT:\n${md.slice(0, 3000)}\n\nExtract data points about: ${seed.name ?? seed.email ?? seed.phone ?? seed.plate}`,
          maxTokens: 800,
        });
        const pts = extractDataPointsFromMarkdown(llmOut, 'Firecrawl');
        allPoints.push(...pts);

        if (/\b(arrest|warrant|convicted|guilty|charged)\b/i.test(md)) {
          riskFlags.push('arrest_mention');
        }
      }
      sourceResults.push({
        sourceName: 'Firecrawl',
        phase: 3,
        status: 'success',
        dataPoints: allPoints.slice(-50),
        connections: [],
        responseTimeMs: Date.now() - t0,
      });
    } catch (e: any) {
      sourceResults.push({
        sourceName: 'Firecrawl',
        phase: 3,
        status: 'error',
        dataPoints: [],
        connections: [],
        responseTimeMs: Date.now() - t0,
        errorMessage: String(e?.message ?? e),
      });
    }
  }

  const crawlValues = allPoints.map(p => p.value.toLowerCase());
  const crawlCorroboration = knownValues.some(v =>
    crawlValues.some(cv => cv.includes(v.toLowerCase()))
  );

  return {
    sourceResults,
    dataPoints: allPoints,
    riskFlags: [...new Set(riskFlags)],
    crawlCorroboration,
  };
}
