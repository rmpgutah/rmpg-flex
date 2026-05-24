/**
 * Utah Courts XCHANGE — Civil Filing Scraper
 *
 * Scrapes recent civil filings from the Utah Courts XCHANGE system to
 * identify the busiest filing attorneys/firms. Attorneys who file many
 * debt collection, eviction, and civil cases are prime leads for RMPG's
 * process serving, repo security, and skip tracing services.
 *
 * Unlike other scrapers, this one aggregates case counts per attorney
 * and only imports those meeting a minimum filing threshold.
 */
import {
  fetchWithTimeout, sleep, upsertLead, registerScraper,
  getSourceConfig, type ScrapeResult,
} from './leadScraperBase';
import { createHash } from 'crypto';

const SOURCE_KEY = 'ut_courts';
const BASE_URL = 'https://xchange.utcourts.gov';
const REQUEST_DELAY_MS = 3_000;

const CASE_TYPES = [
  { type: 'Debt Collection', service: 'process_serving,skip_tracing' },
  { type: 'Eviction', service: 'repo_security,process_serving' },
  { type: 'Small Claims', service: 'process_serving' },
  { type: 'Civil', service: 'process_serving' },
];

interface FilingAttorney {
  barNumber?: string;
  name: string;
  firm?: string;
  city?: string;
  phone?: string;
  email?: string;
}

interface AttorneyAgg {
  attorney: FilingAttorney;
  caseCount: number;
  caseTypes: Set<string>;
  services: Set<string>;
}

/**
 * Parse case listing HTML and extract the filing attorney info from each case.
 */
function parseFilingAttorneys(html: string): FilingAttorney[] {
  const attorneys: FilingAttorney[] = [];

  // Split into case blocks
  const blocks = html.split(/(?=<(?:tr|div)[^>]*(?:case|filing|result|row))/i);

  for (const block of blocks) {
    // Skip blocks that don't look like case records
    if (!block.match(/(?:case|filing|docket)/i)) continue;

    // Extract attorney info — typically in a "Plaintiff Attorney" or "Filing Attorney" section
    const attyName = block.match(/(?:Attorney|Counsel|Filed\s+By)[:\s]*([^<\n]{3,60})/i)?.[1]?.trim();
    if (!attyName || /pro\s*se|self[\s\-]?represented|unknown/i.test(attyName)) continue;

    const barNum = block.match(/(?:Bar\s*(?:#|No\.?|Number)?:?\s*)(\d{4,8})/i)?.[1];
    const firm = block.match(/(?:Firm|Law\s+(?:Office|Group|Firm))[:\s]*([^<\n]{3,80})/i)?.[1]?.trim();
    const city = block.match(/(?:City|Location)[:\s]*([^<\n,]{2,40})/i)?.[1]?.trim();
    const phone = block.match(/(\(\d{3}\)\s*\d{3}[\-\.]\d{4}|\d{3}[\-\.]\d{3}[\-\.]\d{4})/)?.[1];
    const email = block.match(/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/)?.[1];

    attorneys.push({
      barNumber: barNum || undefined,
      name: attyName.replace(/&amp;/g, '&').trim(),
      firm: firm ? firm.replace(/&amp;/g, '&').trim() : undefined,
      city: city || undefined,
      phone: phone || undefined,
      email: email || undefined,
    });
  }

  return attorneys;
}

/**
 * Create a stable dedup key for an attorney.
 * Prefers bar number; falls back to SHA-256 of firm_name + city.
 */
function attorneyKey(atty: FilingAttorney): string {
  if (atty.barNumber) return `bar:${atty.barNumber}`;
  const input = `${(atty.firm || atty.name).toLowerCase()}|${(atty.city || '').toLowerCase()}`;
  return `hash:${createHash('sha256').update(input).digest('hex').slice(0, 16)}`;
}

export async function scrapeUtCourts(): Promise<ScrapeResult> {
  const startTime = Date.now();
  let totalFound = 0, totalImported = 0, totalSkipped = 0;
  let lastError: string | undefined;

  const config = getSourceConfig(SOURCE_KEY);
  const extraConfig = config?.extra_config ? JSON.parse(config.extra_config) : {};
  const daysBack = extraConfig.days_back || 30;
  const minCases = extraConfig.min_cases || 3;

  // Aggregate: key -> attorney data + case count
  const aggMap = new Map<string, AttorneyAgg>();

  try {
    for (const caseType of CASE_TYPES) {
      try {
        console.log(`[UtCourts] Searching case type: ${caseType.type}`);
        await sleep(REQUEST_DELAY_MS);

        const searchUrl = `${BASE_URL}/CaseSearch?type=${encodeURIComponent(caseType.type)}&days=${daysBack}`;
        const res = await fetchWithTimeout(searchUrl);

        if (!res.ok) {
          console.warn(`[UtCourts] HTTP ${res.status} for ${caseType.type}`);
          continue;
        }

        const html = await res.text();
        const attorneys = parseFilingAttorneys(html);
        console.log(`[UtCourts] Found ${attorneys.length} attorney filings for ${caseType.type}`);
        totalFound += attorneys.length;

        for (const atty of attorneys) {
          const key = attorneyKey(atty);
          const existing = aggMap.get(key);

          if (existing) {
            existing.caseCount++;
            existing.caseTypes.add(caseType.type);
            caseType.service.split(',').forEach(s => existing.services.add(s));
            // Prefer more complete data
            if (!existing.attorney.email && atty.email) existing.attorney.email = atty.email;
            if (!existing.attorney.phone && atty.phone) existing.attorney.phone = atty.phone;
            if (!existing.attorney.firm && atty.firm) existing.attorney.firm = atty.firm;
            if (!existing.attorney.barNumber && atty.barNumber) existing.attorney.barNumber = atty.barNumber;
          } else {
            const services = new Set<string>();
            caseType.service.split(',').forEach(s => services.add(s));
            aggMap.set(key, {
              attorney: { ...atty },
              caseCount: 1,
              caseTypes: new Set([caseType.type]),
              services,
            });
          }
        }
      } catch (err: any) {
        lastError = `${caseType.type}: ${err.message}`;
        console.error(`[UtCourts] Error scraping ${caseType.type}: ${err.message}`);
      }
    }

    // Filter to attorneys with enough cases and upsert as leads
    console.log(`[UtCourts] Aggregated ${aggMap.size} unique attorneys, filtering to min ${minCases} cases`);

    for (const [key, agg] of aggMap) {
      if (agg.caseCount < minCases) {
        totalSkipped++;
        continue;
      }

      try {
        const sourceId = agg.attorney.barNumber || key.replace('hash:', '');
        const result = upsertLead({
          source: SOURCE_KEY,
          source_id: sourceId,
          source_url: `${BASE_URL}/CaseSearch`,
          business_name: agg.attorney.firm || agg.attorney.name,
          contact_name: agg.attorney.name,
          contact_email: agg.attorney.email,
          contact_phone: agg.attorney.phone,
          city: agg.attorney.city,
          state: 'UT',
          industry: Array.from(agg.caseTypes).join(', '),
          business_type: 'Law Firm',
          estimated_value: agg.caseCount * 100, // Proxy: more filings = more work potential
          service_interest: Array.from(agg.services).join(','),
          notes: `${agg.caseCount} filings in last ${daysBack} days (${Array.from(agg.caseTypes).join(', ')})`,
        });

        if (result.inserted) totalImported++;
        else totalSkipped++;
      } catch (err: any) {
        totalSkipped++;
        console.warn(`[UtCourts] Failed to upsert ${key}: ${err.message}`);
      }
    }
  } catch (err: any) {
    lastError = err.message;
    console.error(`[UtCourts] Fatal error: ${err.message}`);
  }

  const durationMs = Date.now() - startTime;
  const status = lastError && totalImported === 0 ? 'error' : totalImported > 0 ? 'success' : 'partial';

  console.log(`[UtCourts] Complete: found=${totalFound} imported=${totalImported} skipped=${totalSkipped} (${durationMs}ms)`);

  return {
    source_key: SOURCE_KEY,
    status,
    records_found: totalFound,
    records_imported: totalImported,
    records_skipped: totalSkipped,
    error_message: lastError,
    duration_ms: durationMs,
  };
}

registerScraper(SOURCE_KEY, scrapeUtCourts);
