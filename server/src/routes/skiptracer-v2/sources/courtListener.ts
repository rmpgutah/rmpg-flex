// ============================================================
// Skip Tracer v2 — CourtListener Federal Courts Adapter
// ============================================================
// Searches CourtListener's REST API for federal court dockets.
// Requires a free API token from courtlistener.com.
// Rate limit: 5,000 requests/hour (~83/min), we cap at 30/min.

import { BaseDataSource } from './base';
import { SearchQuery, SourceCategory, SourceResult, CourtRecord } from '../types';
import { localNow } from '../../../utils/timeUtils';

const API_BASE = 'https://www.courtlistener.com/api/rest/v4/';

export default class CourtListenerSource extends BaseDataSource {
  readonly name = 'court_listener';
  readonly displayName = 'CourtListener Federal Courts';
  readonly category: SourceCategory = 'court';
  readonly costPerLookup = 0;

  protected maxRequestsPerMinute = 30;

  isConfigured(): boolean {
    return !!this.getDecryptedConfig('api_token');
  }

  protected async doSearch(query: SearchQuery): Promise<SourceResult[]> {
    try {
      const name = query.name || [query.firstName, query.lastName].filter(Boolean).join(' ');
      if (!name || name.length < 2) return [];

      const token = this.getDecryptedConfig('api_token');
      if (!token) return [];

      const url = `${API_BASE}dockets/?q=${encodeURIComponent(name)}&order_by=score desc&page_size=10`;
      const res = await this.fetchWithRetry(url, {
        headers: {
          'Authorization': `Token ${token}`,
          'Accept': 'application/json',
        },
      });

      if (!res.ok) {
        console.error(`[CourtListenerSource] API returned ${res.status}`);
        return [];
      }

      const data = await res.json() as {
        results?: Array<{
          docket_number?: string;
          court?: string;
          case_name?: string;
          date_filed?: string;
          date_terminated?: string;
          [key: string]: any;
        }>;
      };

      if (!data.results || data.results.length === 0) return [];

      const courtRecords: CourtRecord[] = data.results.map(docket => ({
        source: this.name,
        caseNumber: docket.docket_number || 'Unknown',
        court: docket.court || 'Federal',
        state: 'US',
        caseType: 'other' as const,
        filingDate: docket.date_filed || undefined,
        dispositionDate: docket.date_terminated || undefined,
        status: docket.date_terminated ? 'closed' as const : 'open' as const,
        defendant: name,
      }));

      return [{
        source: this.name,
        sourceType: this.category,
        confidence: 0.6,
        fetchedAt: localNow(),
        rawResultCount: courtRecords.length,
        courtRecords,
        names: [{
          source: this.name,
          full: name,
        }],
      }];
    } catch (err) {
      console.error('[CourtListenerSource] Search error:', err);
      return [];
    }
  }
}
