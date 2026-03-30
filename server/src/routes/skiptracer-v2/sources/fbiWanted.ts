// ============================================================
// Skip Tracker 3.5 — FBI Most Wanted Adapter
// ============================================================
// Searches the FBI's public Most Wanted API. No auth required.
// Completely free, always available.

import { BaseDataSource } from './base';
import { SearchQuery, SourceCategory, SourceResult, WatchlistFlag } from '../types';
import { localNow } from '../../../utils/timeUtils';

const API_BASE = 'https://api.fbi.gov/@wanted';

export default class FbiWantedSource extends BaseDataSource {
  readonly name = 'fbi_wanted';
  readonly displayName = 'FBI Most Wanted';
  readonly category: SourceCategory = 'registry';
  readonly costPerLookup = 0;

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

      const url = `${API_BASE}?title=${encodeURIComponent(name)}&pageSize=10`;
      const res = await this.fetchWithRetry(url, {
        headers: { 'Accept': 'application/json' },
      });

      if (!res.ok) {
        console.error(`[FbiWantedSource] API returned ${res.status}`);
        return [];
      }

      const data = await res.json() as {
        items?: Array<{
          title?: string;
          description?: string;
          images?: Array<{ original?: string }>;
          details?: string;
          warning_message?: string;
          subjects?: string[];
          aliases?: string[];
          dates_of_birth_used?: string[];
          url?: string;
        }>;
      };

      if (!data.items || data.items.length === 0) return [];

      return data.items.map(item => {
        const flags: WatchlistFlag[] = [{
          source: this.name,
          listName: 'FBI Most Wanted',
          matchType: 'partial',
          matchScore: 0.5,
          category: item.subjects?.join(', ') || undefined,
          details: item.description || item.warning_message || undefined,
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
        if (item.title) {
          result.names = [{
            source: this.name,
            full: item.title,
          }];
        }

        // Aliases
        if (item.aliases && item.aliases.length > 0) {
          const aliasNames = item.aliases.map(alias => ({
            source: this.name,
            full: alias,
          }));
          result.names = [...(result.names || []), ...aliasNames];
        }

        // Date of birth
        if (item.dates_of_birth_used && item.dates_of_birth_used.length > 0) {
          result.dobs = item.dates_of_birth_used.map(dob => ({
            source: this.name,
            dob,
          }));
        }

        // Photo
        if (item.images && item.images.length > 0 && item.images[0].original) {
          result.photos = [{
            source: this.name,
            url: item.images[0].original,
            description: 'FBI Most Wanted photo',
          }];
        }

        return result;
      });
    } catch (err) {
      console.error('[FbiWantedSource] Search error:', err);
      return [];
    }
  }
}
