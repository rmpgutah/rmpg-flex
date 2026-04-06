// ============================================================
// Skip Tracker 3.5 — OpenCorporates Business Records Adapter
// ============================================================
// Searches OpenCorporates officer records for business
// associations. Free tier allows 500 requests/month.
// No auth required for basic searches.

import { BaseDataSource } from './base';
import { SearchQuery, SourceCategory, SourceResult, BusinessRecord } from '../types';
import { localNow } from '../../../utils/timeUtils';

const API_BASE = 'https://api.opencorporates.com/v0.4/officers/search';

export default class OpenCorporatesSource extends BaseDataSource {
  readonly name = 'opencorporates';
  readonly displayName = 'OpenCorporates Business Records';
  readonly category: SourceCategory = 'business';
  readonly costPerLookup = 0;

  protected maxRequestsPerMinute = 5;

  isConfigured(): boolean {
    return true;
  }

  protected async doSearch(query: SearchQuery): Promise<SourceResult[]> {
    try {
      const name = query.name || [query.firstName, query.lastName].filter(Boolean).join(' ');
      if (!name || name.length < 2) return [];

      const url = `${API_BASE}?q=${encodeURIComponent(name)}&order=score`;
      const res = await this.fetchWithRetry(url, {
        headers: { 'Accept': 'application/json' },
      });

      if (!res.ok) {
        console.error(`[OpenCorporatesSource] API returned ${res.status}`);
        return [];
      }

      const data = await res.json() as {
        results?: {
          officers?: Array<{
            officer?: {
              name?: string;
              position?: string;
              company?: {
                name?: string;
                company_number?: string;
                jurisdiction_code?: string;
              };
            };
          }>;
        };
      };

      const officers = data.results?.officers;
      if (!officers || officers.length === 0) return [];

      const businesses: BusinessRecord[] = [];
      const nameSet = new Set<string>();

      for (const entry of officers) {
        const officer = entry.officer;
        if (!officer) continue;

        if (officer.name) nameSet.add(officer.name);

        if (officer.company) {
          businesses.push({
            source: this.name,
            name: officer.company.name || 'Unknown Company',
            state: officer.company.jurisdiction_code || 'unknown',
            entityNumber: officer.company.company_number || undefined,
            role: officer.position || undefined,
            status: 'unknown',
          });
        }
      }

      if (businesses.length === 0) return [];

      return [{
        source: this.name,
        sourceType: this.category,
        confidence: 0.5,
        fetchedAt: localNow(),
        rawResultCount: businesses.length,
        businesses,
        names: [...nameSet].map(n => ({
          source: this.name,
          full: n,
        })),
      }];
    } catch (err) {
      console.error('[OpenCorporatesSource] Search error:', err);
      return [];
    }
  }
}
