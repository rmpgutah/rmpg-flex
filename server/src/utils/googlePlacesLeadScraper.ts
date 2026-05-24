/**
 * Mapbox Places Lead Scraper
 *
 * Uses the Mapbox Geocoding API (forward geocoding) to find businesses in Utah
 * that are potential clients for RMPG's process serving, repo security,
 * and skip tracing services. Searches multiple business categories
 * and extracts available contact info (address, coordinates).
 *
 * Uses the MAPBOX_ACCESS_TOKEN configured via Admin or env var.
 * Cost: Free tier includes 100,000 requests/month.
 */
import {
  sleep, upsertLead, registerScraper,
  getSourceConfig, type ScrapeResult,
} from './leadScraperBase';
import { resolveMapboxAccessToken } from './configEncryption';

const SOURCE_KEY = 'google_places';
const REQUEST_DELAY_MS = 300;

// Search queries and their RMPG service mappings
const SEARCH_QUERIES = [
  { query: 'collection agency', location: 'Utah', service: 'process_serving,skip_tracing', industry: 'Debt Collection', bizType: 'Collection Agency' },
  { query: 'debt collector', location: 'Utah', service: 'process_serving,skip_tracing', industry: 'Debt Collection', bizType: 'Collection Agency' },
  { query: 'civil litigation attorney', location: 'Salt Lake City, Utah', service: 'process_serving', industry: 'Civil Litigation', bizType: 'Law Firm' },
  { query: 'collections attorney', location: 'Utah', service: 'process_serving,skip_tracing', industry: 'Collections Law', bizType: 'Law Firm' },
  { query: 'property management company', location: 'Salt Lake City, Utah', service: 'repo_security,process_serving', industry: 'Property Management', bizType: 'Property Management' },
  { query: 'property management company', location: 'Provo, Utah', service: 'repo_security,process_serving', industry: 'Property Management', bizType: 'Property Management' },
  { query: 'property management company', location: 'Ogden, Utah', service: 'repo_security,process_serving', industry: 'Property Management', bizType: 'Property Management' },
  { query: 'bail bonds', location: 'Utah', service: 'skip_tracing', industry: 'Bail Bonds', bizType: 'Bail Bond Agency' },
  { query: 'eviction attorney', location: 'Utah', service: 'repo_security,process_serving', industry: 'Eviction Law', bizType: 'Law Firm' },
  { query: 'landlord tenant attorney', location: 'Utah', service: 'repo_security,process_serving', industry: 'Landlord-Tenant Law', bizType: 'Law Firm' },
];

interface MapboxFeature {
  id: string;
  text: string;
  place_name: string;
  center: [number, number]; // [lng, lat]
  properties?: {
    foursquare?: string;
    landmark?: boolean;
    category?: string;
  };
  context?: Array<{
    id: string;
    text: string;
    short_code?: string;
  }>;
}

interface MapboxGeocodeResponse {
  type: string;
  features: MapboxFeature[];
}

/**
 * Parse address components from a Mapbox place_name string.
 * Typical format: "123 Main St, Salt Lake City, Utah 84101, United States"
 */
function parseAddress(placeName: string): { street: string; city: string; state: string; zip: string } {
  const parts = placeName.split(',').map(s => s.trim());
  const street = parts[0] || '';
  const city = parts[1] || '';
  // "Utah 84101" or "UT 84101"
  const stateZip = (parts[2] || '').trim();
  const stateMatch = stateZip.match(/^([\w\s]+?)\s+(\d{5}(?:-\d{4})?)/);
  const stateRaw = stateMatch?.[1] || 'UT';
  // Normalize full state names to abbreviations
  const stateAbbr: Record<string, string> = { utah: 'UT', 'Utah': 'UT' };
  const state = stateAbbr[stateRaw] || stateRaw.slice(0, 2).toUpperCase();
  const zip = stateMatch?.[2] || '';
  return { street, city, state, zip };
}

export async function scrapeMapboxPlaces(): Promise<ScrapeResult> {
  const startTime = Date.now();
  let totalFound = 0, totalImported = 0, totalSkipped = 0;
  let lastError: string | undefined;
  const seen = new Set<string>(); // track feature IDs across queries

  const accessToken = resolveMapboxAccessToken();
  if (!accessToken) {
    return {
      source_key: SOURCE_KEY,
      status: 'error',
      records_found: 0,
      records_imported: 0,
      records_skipped: 0,
      error_message: 'Mapbox access token not configured (set via Admin → Integrations or MAPBOX_ACCESS_TOKEN env var)',
      duration_ms: Date.now() - startTime,
    };
  }

  const config = getSourceConfig(SOURCE_KEY);
  const extraConfig = config?.extra_config ? JSON.parse(config.extra_config) : {};
  const queries = extraConfig.search_queries || SEARCH_QUERIES;
  const limitPerQuery = extraConfig.limit_per_query || 10; // Mapbox max is 10 per request

  try {
    for (const q of queries) {
      try {
        console.log(`[MapboxPlaces] Searching: "${q.query}" near ${q.location}`);
        await sleep(REQUEST_DELAY_MS);

        const searchText = encodeURIComponent(q.query + ' ' + q.location);
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${searchText}.json?access_token=${accessToken}&country=us&limit=${limitPerQuery}&types=poi`;

        const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) {
          console.warn(`[MapboxPlaces] HTTP ${res.status} for "${q.query}"`);
          continue;
        }

        const data: MapboxGeocodeResponse = await res.json();
        const features = data.features || [];
        console.log(`[MapboxPlaces] ${features.length} results for "${q.query}"`);
        totalFound += features.length;

        for (const feat of features) {
          if (seen.has(feat.id)) {
            totalSkipped++;
            continue;
          }
          seen.add(feat.id);

          try {
            const [lng, lat] = feat.center || [0, 0];
            const addr = parseAddress(feat.place_name || '');

            const result = upsertLead({
              source: SOURCE_KEY,
              source_id: feat.id,
              source_url: `https://www.google.com/maps/place/?q=place_id:${feat.id}`,
              business_name: feat.text,
              contact_phone: undefined,
              address: addr.street || undefined,
              city: addr.city || undefined,
              state: addr.state || 'UT',
              zip: addr.zip || undefined,
              latitude: lat || undefined,
              longitude: lng || undefined,
              industry: q.industry,
              business_type: q.bizType,
              service_interest: q.service,
              notes: undefined,
            });

            if (result.inserted) totalImported++;
            else totalSkipped++;
          } catch (err: any) {
            totalSkipped++;
            console.warn(`[MapboxPlaces] Failed to process ${feat.id}: ${err.message}`);
          }
        }
      } catch (err: any) {
        lastError = `${q.query}: ${err.message}`;
        console.error(`[MapboxPlaces] Error searching "${q.query}": ${err.message}`);
      }
    }
  } catch (err: any) {
    lastError = err.message;
    console.error(`[MapboxPlaces] Fatal error: ${err.message}`);
  }

  const durationMs = Date.now() - startTime;
  const status = lastError && totalImported === 0 ? 'error' : totalImported > 0 ? 'success' : 'partial';

  console.log(`[MapboxPlaces] Complete: found=${totalFound} imported=${totalImported} skipped=${totalSkipped} (${durationMs}ms)`);

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

registerScraper(SOURCE_KEY, scrapeMapboxPlaces);
