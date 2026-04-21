/**
 * Google Places API Lead Scraper
 *
 * Uses the Google Places Text Search API to find businesses in Utah
 * that are potential clients for RMPG's process serving, repo security,
 * and skip tracing services. Searches multiple business categories
 * and extracts verified contact info (phone, website, address).
 *
 * Uses the same GOOGLE_MAPS_API_KEY already configured for geocoding.
 * Cost: ~$32 per 1,000 text search requests.
 */
import {
  sleep, upsertLead, registerScraper,
  getSourceConfig, type ScrapeResult,
} from './leadScraperBase';
import { resolveGoogleMapsApiKey } from './configEncryption';

const SOURCE_KEY = 'google_places';
const REQUEST_DELAY_MS = 1_000;

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

interface PlacesResult {
  place_id: string;
  name: string;
  formatted_address?: string;
  formatted_phone_number?: string;
  international_phone_number?: string;
  website?: string;
  business_status?: string;
  geometry?: {
    location: { lat: number; lng: number };
  };
  types?: string[];
}

interface TextSearchResponse {
  results: Array<{
    place_id: string;
    name: string;
    formatted_address?: string;
    geometry?: { location: { lat: number; lng: number } };
    business_status?: string;
    types?: string[];
  }>;
  next_page_token?: string;
  status: string;
}

interface PlaceDetailResponse {
  result: PlacesResult;
  status: string;
}

/**
 * Parse address components from a Google formatted_address string.
 * Typical format: "123 Main St, Salt Lake City, UT 84101, USA"
 */
function parseAddress(formatted: string): { street: string; city: string; state: string; zip: string } {
  const parts = formatted.split(',').map(s => s.trim());
  const street = parts[0] || '';
  const city = parts[1] || '';
  // "UT 84101" or "Utah 84101"
  const stateZip = (parts[2] || '').trim();
  const stateMatch = stateZip.match(/^([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/);
  const state = stateMatch?.[1] || 'UT';
  const zip = stateMatch?.[2] || '';
  return { street, city, state, zip };
}

export async function scrapeGooglePlaces(): Promise<ScrapeResult> {
  const startTime = Date.now();
  let totalFound = 0, totalImported = 0, totalSkipped = 0;
  let lastError: string | undefined;
  const seen = new Set<string>(); // track place_ids across queries

  const apiKey = resolveGoogleMapsApiKey();
  if (!apiKey) {
    return {
      source_key: SOURCE_KEY,
      status: 'error',
      records_found: 0,
      records_imported: 0,
      records_skipped: 0,
      error_message: 'Google Maps API key not configured (set via Admin → Integrations or GOOGLE_MAPS_API_KEY env var)',
      duration_ms: Date.now() - startTime,
    };
  }

  const config = getSourceConfig(SOURCE_KEY);
  const extraConfig = config?.extra_config ? JSON.parse(config.extra_config) : {};
  const queries = extraConfig.search_queries || SEARCH_QUERIES;
  const maxPagesPerQuery = extraConfig.max_pages || 2; // Each page = 20 results, max 3 pages (60 results per query)

  try {
    for (const q of queries) {
      try {
        console.log(`[GooglePlaces] Searching: "${q.query}" near ${q.location}`);
        let nextPageToken: string | undefined;
        let page = 0;

        do {
          await sleep(REQUEST_DELAY_MS);

          // Text Search API
          let searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(q.query + ' ' + q.location)}&key=${apiKey}`;
          if (nextPageToken) {
            // Google requires 2s delay before using next_page_token
            await sleep(2_000);
            searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${nextPageToken}&key=${apiKey}`;
          }

          const res = await fetch(searchUrl, { signal: AbortSignal.timeout(15_000) });
          if (!res.ok) {
            console.warn(`[GooglePlaces] HTTP ${res.status} for "${q.query}"`);
            break;
          }

          const data: TextSearchResponse = await res.json();
          if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
            console.warn(`[GooglePlaces] API status: ${data.status} for "${q.query}"`);
            break;
          }

          const results = data.results || [];
          console.log(`[GooglePlaces] Page ${page + 1}: ${results.length} results for "${q.query}"`);
          totalFound += results.length;

          for (const place of results) {
            if (seen.has(place.place_id)) {
              totalSkipped++;
              continue;
            }
            seen.add(place.place_id);

            // Skip permanently closed businesses
            if (place.business_status === 'CLOSED_PERMANENTLY') {
              totalSkipped++;
              continue;
            }

            try {
              // Fetch place details for phone number and website
              await sleep(200); // Light delay for detail requests
              const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=formatted_phone_number,website,name,formatted_address&key=${apiKey}`;
              const detailRes = await fetch(detailUrl, { signal: AbortSignal.timeout(15_000) });
              const detailData: PlaceDetailResponse = await detailRes.json();
              const detail = detailData.result || {};

              const addr = parseAddress(detail.formatted_address || place.formatted_address || '');

              const result = upsertLead({
                source: SOURCE_KEY,
                source_id: place.place_id,
                source_url: detail.website || `https://www.google.com/maps/place/?q=place_id:${place.place_id}`,
                business_name: detail.name || place.name,
                contact_phone: detail.formatted_phone_number || undefined,
                address: addr.street || undefined,
                city: addr.city || undefined,
                state: addr.state || 'UT',
                zip: addr.zip || undefined,
                latitude: place.geometry?.location?.lat,
                longitude: place.geometry?.location?.lng,
                industry: q.industry,
                business_type: q.bizType,
                service_interest: q.service,
                notes: detail.website ? `Website: ${detail.website}` : undefined,
              });

              if (result.inserted) totalImported++;
              else totalSkipped++;
            } catch (err: any) {
              totalSkipped++;
              console.warn(`[GooglePlaces] Failed to process ${place.place_id}: ${err.message}`);
            }
          }

          nextPageToken = data.next_page_token;
          page++;
        } while (nextPageToken && page < maxPagesPerQuery);

      } catch (err: any) {
        lastError = `${q.query}: ${err.message}`;
        console.error(`[GooglePlaces] Error searching "${q.query}": ${err.message}`);
      }
    }
  } catch (err: any) {
    lastError = err.message;
    console.error(`[GooglePlaces] Fatal error: ${err.message}`);
  }

  const durationMs = Date.now() - startTime;
  const status = lastError && totalImported === 0 ? 'error' : totalImported > 0 ? 'success' : 'partial';

  console.log(`[GooglePlaces] Complete: found=${totalFound} imported=${totalImported} skipped=${totalSkipped} (${durationMs}ms)`);

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

registerScraper(SOURCE_KEY, scrapeGooglePlaces);
