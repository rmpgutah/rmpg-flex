// ============================================================
// Skip Tracker 3.5 — US Marshals Most Wanted Adapter
// ============================================================
// Searches the US Marshals Service fugitives API. No auth required.
// Free public API returning fugitive records.

import { BaseDataSource } from './base';
import { SearchQuery, SkipTracerSourceCategory, SourceResult, WatchlistFlag } from '../types';
import { localNow } from '../../../utils/timeUtils';

const API_URL = 'https://www.usmarshals.gov/doj/api/fugitives';

export default class UsMarshalsSource extends BaseDataSource {
  readonly name = 'us_marshals';
  readonly displayName = 'US Marshals Most Wanted';
  readonly category: SkipTracerSourceCategory = 'registry';
  readonly costPerLookup = 0;

  protected maxRequestsPerMinute = 5;

  isConfigured(): boolean {
    return true;
  }

  isEnabled(): boolean {
    return true;
  }

  protected async doSearch(query: SearchQuery): Promise<SourceResult[]> {
    try {
      const name = query.name || [query.firstName, query.lastName].filter(Boolean).join(' ');
      if (!name || name.length < 2) return [];

      const url = `${API_URL}?name=${encodeURIComponent(name)}&pageSize=10`;
      const res = await this.fetchWithRetry(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'RMPG-Flex/1.0 (Law Enforcement Skip Trace)',
        },
      });

      if (!res.ok) {
        console.warn(`[UsMarshalsSource] API returned ${res.status}`);
        return [];
      }

      const data = await res.json() as {
        fugitives?: Array<{
          name?: string;
          firstName?: string;
          lastName?: string;
          aliases?: string[];
          description?: string;
          details?: string;
          charges?: string;
          photo?: string;
          photoUrl?: string;
          dateOfBirth?: string;
          race?: string;
          sex?: string;
          weight?: string;
          height?: string;
          hairColor?: string;
          eyeColor?: string;
          reward?: string;
          dateAdded?: string;
          lastKnownLocation?: string;
        }>;
        results?: Array<{
          name?: string;
          firstName?: string;
          lastName?: string;
          aliases?: string[];
          description?: string;
          details?: string;
          charges?: string;
          photo?: string;
          photoUrl?: string;
          dateOfBirth?: string;
          dateAdded?: string;
        }>;
      };

      // The API may return data in either "fugitives" or "results" array
      const items = data.fugitives || data.results || [];
      if (items.length === 0) return [];

      return items.map(item => {
        const displayName = item.name || [item.firstName, item.lastName].filter(Boolean).join(' ') || 'Unknown';

        const flags: WatchlistFlag[] = [{
          source: this.name,
          listName: 'US Marshals Most Wanted',
          matchType: 'partial',
          matchScore: 0.5,
          category: 'Fugitive',
          details: item.charges || item.description || item.details || undefined,
          dateAdded: item.dateAdded || undefined,
        }];

        const result: SourceResult = {
          source: this.name,
          sourceType: this.category,
          confidence: 0.5,
          fetchedAt: localNow(),
          rawResultCount: 1,
          watchlistFlags: flags,
        };

        // Name
        result.names = [{
          source: this.name,
          full: displayName,
          first: item.firstName || undefined,
          last: item.lastName || undefined,
        }];

        // Aliases
        if (item.aliases && item.aliases.length > 0) {
          const aliasNames = item.aliases.map(alias => ({
            source: this.name,
            full: alias,
          }));
          result.names = [...result.names, ...aliasNames];
        }

        // Date of birth
        if (item.dateOfBirth) {
          result.dobs = [{
            source: this.name,
            dob: item.dateOfBirth,
          }];
        }

        // Photo
        const photoUrl = item.photo || item.photoUrl;
        if (photoUrl) {
          result.photos = [{
            source: this.name,
            url: photoUrl,
            description: 'US Marshals fugitive photo',
          }];
        }

        return result;
      });
    } catch (err) {
      console.error('[UsMarshalsSource] Search error:', err instanceof Error ? err.message : err);
      return [];
    }
  }
}
