// ============================================================
// Firecrawl Scraper — Universal config-driven lead scraper
// ============================================================
// Replaces per-source scraper modules with a single engine that
// reads scrape parameters from the `extra_config` JSON column
// on each lead_scrape_sources row where scraper_type='firecrawl'.
// ============================================================

import { getDb } from '../models/database';
import {
  registerScraper,
  upsertLead,
  getSourceConfig,
  type SourceConfig,
  type ScrapeResult,
  type LeadUpsertData,
} from './leadScraperBase';
import { firecrawlScrape, firecrawlSearch } from './firecrawlClient';
import type { FirecrawlSearchResultItem } from './firecrawlClient';

// ── Extra Config Schema ──────────────────────────────────────

interface FirecrawlExtraConfig {
  /** 'search' uses firecrawlSearch; 'scrape' uses firecrawlScrape */
  method: 'search' | 'scrape';
  /** Search query string (method: 'search') */
  search_query?: string;
  /** CSS selector to wait for before extracting (method: 'scrape') */
  wait_for?: number;
  /** JSON schema for structured extraction (method: 'scrape') */
  extract_schema?: Record<string, unknown>;
  /** Dot-path to the array of results in extracted data (e.g. 'businesses') */
  result_array_path?: string;
  /** Default field values merged into every lead from this source */
  lead_defaults?: Partial<LeadUpsertData>;
  /** Max results for search mode (default 10) */
  search_limit?: number;
}

// ── Helpers ──────────────────────────────────────────────────

function parseExtraConfig(raw: string | null): FirecrawlExtraConfig | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as FirecrawlExtraConfig;
  } catch {
    return null;
  }
}

/**
 * Resolve a dot-separated path on an object, e.g. 'data.businesses' → obj.data.businesses
 */
function resolvePath(obj: Record<string, unknown>, dotPath: string): unknown {
  let current: unknown = obj;
  for (const segment of dotPath.split('.')) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Best-effort extraction of lead fields from a generic record.
 */
function mapToLead(
  record: Record<string, unknown>,
  sourceKey: string,
  defaults?: Partial<LeadUpsertData>,
): LeadUpsertData | null {
  const name =
    (record.business_name as string) ||
    (record.name as string) ||
    (record.company as string) ||
    (record.title as string);

  if (!name) return null;

  return {
    source: sourceKey,
    source_id: (record.source_id as string) || (record.id as string) || undefined,
    source_url: (record.source_url as string) || (record.url as string) || (record.link as string) || undefined,
    business_name: name,
    industry: (record.industry as string) || undefined,
    sic_code: (record.sic_code as string) || undefined,
    business_type: (record.business_type as string) || (record.type as string) || undefined,
    contact_name: (record.contact_name as string) || (record.contact as string) || undefined,
    contact_email: (record.contact_email as string) || (record.email as string) || undefined,
    contact_phone: (record.contact_phone as string) || (record.phone as string) || undefined,
    contact_title: (record.contact_title as string) || undefined,
    address: (record.address as string) || undefined,
    city: (record.city as string) || undefined,
    state: (record.state as string) || undefined,
    zip: (record.zip as string) || (record.zipcode as string) || undefined,
    latitude: typeof record.latitude === 'number' ? record.latitude : undefined,
    longitude: typeof record.longitude === 'number' ? record.longitude : undefined,
    estimated_value: typeof record.estimated_value === 'number' ? record.estimated_value : undefined,
    permit_number: (record.permit_number as string) || undefined,
    registration_date: (record.registration_date as string) || undefined,
    license_number: (record.license_number as string) || undefined,
    project_type: (record.project_type as string) || undefined,
    property_size: (record.property_size as string) || undefined,
    notes: (record.notes as string) || (record.description as string) || undefined,
    service_interest: (record.service_interest as string) || undefined,
    ...defaults,
  };
}

/**
 * Map a Firecrawl search result item to a lead.
 */
function mapSearchResultToLead(
  item: FirecrawlSearchResultItem,
  sourceKey: string,
  defaults?: Partial<LeadUpsertData>,
): LeadUpsertData | null {
  const name = item.title;
  if (!name) return null;

  return {
    source: sourceKey,
    source_id: item.url || undefined,
    source_url: item.url || undefined,
    business_name: name,
    notes: item.description || undefined,
    ...defaults,
  };
}

// ── Scraper Factory ──────────────────────────────────────────

function createFirecrawlScraper(sourceKey: string): () => Promise<ScrapeResult> {
  return async (): Promise<ScrapeResult> => {
    const start = Date.now();
    const config = getSourceConfig(sourceKey);

    if (!config || !config.is_enabled) {
      return {
        source_key: sourceKey,
        status: 'error',
        records_found: 0,
        records_imported: 0,
        records_skipped: 0,
        error_message: 'Source not found or disabled',
        duration_ms: Date.now() - start,
      };
    }

    const extra = parseExtraConfig(config.extra_config);
    if (!extra) {
      return {
        source_key: sourceKey,
        status: 'error',
        records_found: 0,
        records_imported: 0,
        records_skipped: 0,
        error_message: 'Missing or invalid extra_config JSON',
        duration_ms: Date.now() - start,
      };
    }

    let records: LeadUpsertData[] = [];

    try {
      if (extra.method === 'search') {
        // ── Search mode ──────────────────────────────────
        if (!extra.search_query) {
          return {
            source_key: sourceKey,
            status: 'error',
            records_found: 0,
            records_imported: 0,
            records_skipped: 0,
            error_message: 'search_query is required for method=search',
            duration_ms: Date.now() - start,
          };
        }

        const result = await firecrawlSearch({
          query: extra.search_query,
          limit: extra.search_limit || 10,
          scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
        });

        if (!result.success || !result.data) {
          return {
            source_key: sourceKey,
            status: 'error',
            records_found: 0,
            records_imported: 0,
            records_skipped: 0,
            error_message: result.error || 'Search returned no data',
            duration_ms: Date.now() - start,
          };
        }

        for (const item of result.data) {
          const lead = mapSearchResultToLead(item, sourceKey, extra.lead_defaults);
          if (lead) records.push(lead);
        }
      } else {
        // ── Scrape mode ──────────────────────────────────
        if (!config.base_url) {
          return {
            source_key: sourceKey,
            status: 'error',
            records_found: 0,
            records_imported: 0,
            records_skipped: 0,
            error_message: 'base_url is required for method=scrape',
            duration_ms: Date.now() - start,
          };
        }

        const result = await firecrawlScrape({
          url: config.base_url,
          formats: extra.extract_schema ? ['markdown'] : ['markdown'],
          onlyMainContent: true,
          waitFor: extra.wait_for,
          extract: extra.extract_schema
            ? { schema: extra.extract_schema }
            : undefined,
        });

        if (!result.success || !result.data) {
          return {
            source_key: sourceKey,
            status: 'error',
            records_found: 0,
            records_imported: 0,
            records_skipped: 0,
            error_message: result.error || 'Scrape returned no data',
            duration_ms: Date.now() - start,
          };
        }

        // If structured extraction was used, pull records from the result
        if (result.data.extract && extra.result_array_path) {
          const arr = resolvePath(
            result.data.extract as Record<string, unknown>,
            extra.result_array_path,
          );
          if (Array.isArray(arr)) {
            for (const item of arr) {
              if (item && typeof item === 'object') {
                const lead = mapToLead(item as Record<string, unknown>, sourceKey, extra.lead_defaults);
                if (lead) records.push(lead);
              }
            }
          }
        } else if (result.data.extract) {
          // Single record extraction
          const lead = mapToLead(
            result.data.extract as Record<string, unknown>,
            sourceKey,
            extra.lead_defaults,
          );
          if (lead) records.push(lead);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        source_key: sourceKey,
        status: 'error',
        records_found: 0,
        records_imported: 0,
        records_skipped: 0,
        error_message: msg,
        duration_ms: Date.now() - start,
      };
    }

    // ── Upsert all discovered leads ────────────────────
    let imported = 0;
    let skipped = 0;
    for (const lead of records) {
      try {
        const { inserted } = upsertLead(lead);
        if (inserted) imported++;
        else skipped++;
      } catch {
        skipped++;
      }
    }

    return {
      source_key: sourceKey,
      status: records.length > 0 ? 'success' : 'partial',
      records_found: records.length,
      records_imported: imported,
      records_skipped: skipped,
      duration_ms: Date.now() - start,
    };
  };
}

// ── Registration ─────────────────────────────────────────────

/**
 * Query DB for all sources with scraper_type='firecrawl' and register
 * each one with the shared lead scraper scheduler.
 */
export function registerFirecrawlScrapers(): void {
  try {
    const db = getDb();
    const sources = db
      .prepare("SELECT source_key FROM lead_scrape_sources WHERE scraper_type = 'firecrawl'")
      .all() as { source_key: string }[];

    for (const { source_key } of sources) {
      registerScraper(source_key, createFirecrawlScraper(source_key));
    }

    if (sources.length > 0) {
      console.warn(`[FirecrawlScraper] Registered ${sources.length} firecrawl source(s)`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[FirecrawlScraper] Failed to register scrapers:', msg);
  }
}
