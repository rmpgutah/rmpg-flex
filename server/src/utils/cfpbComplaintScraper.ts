/**
 * CFPB Consumer Complaint Database — Collection Agency Scraper
 *
 * Uses the Consumer Financial Protection Bureau's free public API to
 * identify collection agencies that have received consumer complaints
 * in Utah. Companies with complaints are confirmed active debt collectors
 * — making them high-quality leads for RMPG's process serving and skip
 * tracing services.
 *
 * API: https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/
 * Cost: Free, no auth required, no rate limits.
 */
import {
  fetchWithTimeout, sleep, upsertLead, registerScraper,
  getSourceConfig, type ScrapeResult,
} from './leadScraperBase';

const SOURCE_KEY = 'cfpb_complaints';
const API_BASE = 'https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/';
const REQUEST_DELAY_MS = 500;

interface CfpbResponse {
  hits: {
    total: { value: number };
    hits: Array<{
      _source: {
        complaint_id: number;
        company: string;
        company_response?: string;
        state?: string;
        product?: string;
        sub_product?: string;
        issue?: string;
        date_received?: string;
        date_sent_to_company?: string;
        timely?: string;
      };
    }>;
  };
  aggregations?: {
    company?: {
      buckets: Array<{
        key: string;
        doc_count: number;
      }>;
    };
  };
}

/**
 * Fetch unique collection companies from CFPB's complaint API.
 * Uses the aggregation endpoint to group complaints by company name,
 * giving us a count of complaints per company.
 */
async function fetchCollectionCompanies(
  state: string,
  products: string[],
  minComplaints: number,
): Promise<Array<{ name: string; complaintCount: number }>> {
  const companies: Array<{ name: string; complaintCount: number }> = [];

  for (const product of products) {
    await sleep(REQUEST_DELAY_MS);

    // CFPB API supports Elasticsearch-style query params
    const params = new URLSearchParams({
      'size': '0', // We only want aggregations, not individual complaints
      'product': product,
      'state': state,
      'date_received_min': getDateNMonthsAgo(12), // Last 12 months of activity
      'company_received_min': String(minComplaints),
      'no_aggs': 'false',
    });

    const url = `${API_BASE}?${params.toString()}`;
    console.log(`[CFPB] Fetching companies for product="${product}" in ${state}`);

    const res = await fetchWithTimeout(url, {}, 30_000);
    if (!res.ok) {
      console.warn(`[CFPB] HTTP ${res.status} for product="${product}"`);
      continue;
    }

    const data: CfpbResponse = await res.json();

    // If aggregations are available, use them for company names + counts
    if (data.aggregations?.company?.buckets) {
      for (const bucket of data.aggregations.company.buckets) {
        if (bucket.doc_count >= minComplaints) {
          companies.push({ name: bucket.key, complaintCount: bucket.doc_count });
        }
      }
    } else {
      // Fallback: extract unique companies from hits
      const companyMap = new Map<string, number>();
      for (const hit of data.hits.hits || []) {
        const name = hit._source.company;
        if (name) {
          companyMap.set(name, (companyMap.get(name) || 0) + 1);
        }
      }
      for (const [name, count] of companyMap) {
        if (count >= minComplaints) {
          companies.push({ name, complaintCount: count });
        }
      }
    }
  }

  // Deduplicate across products
  const deduped = new Map<string, number>();
  for (const c of companies) {
    const existing = deduped.get(c.name) || 0;
    deduped.set(c.name, existing + c.complaintCount);
  }

  return Array.from(deduped.entries()).map(([name, count]) => ({
    name,
    complaintCount: count,
  }));
}

/**
 * Fetch individual complaint records to get more detail on a company.
 * Used to find address/state info for companies.
 */
async function fetchCompanyDetails(
  companyName: string,
  state: string,
): Promise<{ latestDate?: string; responseRate?: string }> {
  try {
    const params = new URLSearchParams({
      'size': '5',
      'company': companyName,
      'state': state,
      'sort': 'created_date_desc',
    });

    const url = `${API_BASE}?${params.toString()}`;
    const res = await fetchWithTimeout(url, {}, 10_000);
    if (!res.ok) return {};

    const data: CfpbResponse = await res.json();
    const hits = data.hits.hits || [];
    if (hits.length === 0) return {};

    const latest = hits[0]._source;
    const timelyCount = hits.filter(h => h._source.timely === 'Yes').length;

    return {
      latestDate: latest.date_received,
      responseRate: `${Math.round((timelyCount / hits.length) * 100)}% timely`,
    };
  } catch {
    return {};
  }
}

function getDateNMonthsAgo(n: number): string {
  const now = new Date();
  const day = now.getDate();
  // Set day to 1 before changing month to avoid overflow (Mar 31 → Feb 31 → Mar 3)
  now.setDate(1);
  now.setMonth(now.getMonth() - n);
  // Clamp day to the target month's max days
  const maxDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  now.setDate(Math.min(day, maxDay));
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Generate a stable source_id from company name.
 */
function companySourceId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 64);
}

export async function scrapeCfpbComplaints(): Promise<ScrapeResult> {
  const startTime = Date.now();
  let totalFound = 0, totalImported = 0, totalSkipped = 0;
  let lastError: string | undefined;

  const config = getSourceConfig(SOURCE_KEY);
  const extraConfig = config?.extra_config ? JSON.parse(config.extra_config) : {};

  const state = extraConfig.state || 'UT';
  const minComplaints = extraConfig.min_complaints || 2;
  const products = extraConfig.products || [
    'Debt collection',
    'Credit reporting, credit repair services, or other personal consumer reports',
    'Payday loan, title loan, personal loan, or advance',
  ];

  try {
    console.log(`[CFPB] Searching for collection companies in ${state} with >= ${minComplaints} complaints`);

    const companies = await fetchCollectionCompanies(state, products, minComplaints);
    console.log(`[CFPB] Found ${companies.length} unique companies`);
    totalFound = companies.length;

    for (const company of companies) {
      try {
        await sleep(300);

        // Get additional detail
        const details = await fetchCompanyDetails(company.name, state);

        const sourceId = companySourceId(company.name);

        const result = upsertLead({
          source: SOURCE_KEY,
          source_id: sourceId,
          source_url: `https://www.consumerfinance.gov/data-research/consumer-complaints/search/?company=${encodeURIComponent(company.name)}&state=${state}`,
          business_name: company.name,
          state: state,
          industry: 'Debt Collection',
          business_type: 'Collection Agency',
          service_interest: 'process_serving,skip_tracing',
          estimated_value: company.complaintCount * 50, // More complaints = more active = higher value
          notes: `${company.complaintCount} CFPB complaints in last 12 months${details.latestDate ? ` (latest: ${details.latestDate})` : ''}${details.responseRate ? ` | Response: ${details.responseRate}` : ''}`,
        });

        if (result.inserted) totalImported++;
        else totalSkipped++;
      } catch (err: any) {
        totalSkipped++;
        console.warn(`[CFPB] Failed to upsert ${company.name}: ${err.message}`);
      }
    }
  } catch (err: any) {
    lastError = err.message;
    console.error(`[CFPB] Fatal error: ${err.message}`);
  }

  const durationMs = Date.now() - startTime;
  const status = lastError && totalImported === 0 ? 'error' : totalImported > 0 ? 'success' : 'partial';

  console.log(`[CFPB] Complete: found=${totalFound} imported=${totalImported} skipped=${totalSkipped} (${durationMs}ms)`);

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

registerScraper(SOURCE_KEY, scrapeCfpbComplaints);
