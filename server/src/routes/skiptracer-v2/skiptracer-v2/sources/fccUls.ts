// ============================================================
// Skip Tracker 3.5 — FCC ULS License Search Adapter
// ============================================================
// Searches the FCC Universal Licensing System for radio/telecom
// licenses. Free government API, no auth required.

import { BaseDataSource } from './base';
import { SearchQuery, SkipTracerSourceCategory, SourceResult, LicenseRecord } from '../types';
import { localNow } from '../../../utils/timeUtils';

const API_BASE = 'https://data.fcc.gov/api/license-view/basicSearch/getLicenses';

export default class FccUlsSource extends BaseDataSource {
  readonly name = 'fcc_uls';
  readonly displayName = 'FCC License Search';
  readonly category: SkipTracerSourceCategory = 'people';
  readonly costPerLookup = 0;

  isConfigured(): boolean {
    return true;
  }

  protected async doSearch(query: SearchQuery): Promise<SourceResult[]> {
    try {
      const name = query.name || [query.firstName, query.lastName].filter(Boolean).join(' ');
      if (!name || name.length < 2) return [];

      const url = `${API_BASE}?searchValue=${encodeURIComponent(name)}&format=json&limit=10`;
      const res = await this.fetchWithRetry(url, {
        headers: { 'Accept': 'application/json' },
      });

      if (!res.ok) {
        console.error(`[FccUlsSource] API returned ${res.status}`);
        return [];
      }

      const data = await res.json() as {
        Licenses?: {
          License?: Array<{
            licName?: string;
            frn?: string;
            callSign?: string;
            categoryDesc?: string;
            serviceDesc?: string;
            statusDesc?: string;
            expiredDate?: string;
          }>;
        };
      };

      const licenseList = data.Licenses?.License;
      if (!licenseList || licenseList.length === 0) return [];

      const licenses: LicenseRecord[] = licenseList.map(lic => ({
        source: this.name,
        type: 'other' as const,
        licenseNumber: lic.callSign || undefined,
        state: 'US',
        status: this.mapStatus(lic.statusDesc),
        expirationDate: lic.expiredDate || undefined,
        description: [lic.serviceDesc, lic.categoryDesc].filter(Boolean).join(' - ') || undefined,
      }));

      // Group unique names
      const uniqueNames = [...new Set(licenseList.map(l => l.licName).filter(Boolean))] as string[];

      return [{
        source: this.name,
        sourceType: this.category,
        confidence: 0.6,
        fetchedAt: localNow(),
        rawResultCount: licenses.length,
        licenses,
        names: uniqueNames.map(n => ({
          source: this.name,
          full: n,
        })),
      }];
    } catch (err) {
      console.error('[FccUlsSource] Search error:', err);
      return [];
    }
  }

  private mapStatus(status?: string): 'active' | 'expired' | 'suspended' | 'revoked' | 'unknown' {
    if (!status) return 'unknown';
    const lower = status.toLowerCase();
    if (lower.includes('active')) return 'active';
    if (lower.includes('expired') || lower.includes('terminated') || lower.includes('cancelled')) return 'expired';
    if (lower.includes('suspended')) return 'suspended';
    if (lower.includes('revoked')) return 'revoked';
    return 'unknown';
  }
}
