// ============================================================
// Skip Tracker 3.5 — Utah UCC Filings Adapter
// ============================================================
// Searches Utah Uniform Commercial Code filings via the
// Division of Corporations portal at secure.utah.gov.
// Search by debtor or secured party name. Free public records.

import { BaseDataSource } from './base';
import { SearchQuery, SourceCategory, SourceResult, BusinessRecord } from '../types';
import { localNow } from '../../../utils/timeUtils';

const UCC_SEARCH_URL = 'https://secure.utah.gov/bes/action/ucc/search';
const USER_AGENT = 'RMPG-Flex/1.0 (Law Enforcement Skip Trace)';

export default class UccFilingsSource extends BaseDataSource {
  readonly name = 'utah_ucc';
  readonly displayName = 'Utah UCC Filings';
  readonly category: SourceCategory = 'business';
  readonly costPerLookup = 0;

  protected maxRequestsPerMinute = 5;

  isConfigured(): boolean {
    return true;
  }

  protected async doSearch(query: SearchQuery): Promise<SourceResult[]> {
    try {
      const searchName = query.name || [query.firstName, query.lastName].filter(Boolean).join(' ');
      if (!searchName || searchName.length < 2) return [];

      // Search by debtor name first
      const debtorResults = await this.searchUcc(searchName, 'debtor');

      // Also search by secured party name
      const securedResults = await this.searchUcc(searchName, 'securedParty');

      const allBusinesses = [
        ...debtorResults,
        ...securedResults,
      ];

      if (allBusinesses.length === 0) return [];

      return [{
        source: this.name,
        sourceType: this.category,
        confidence: 0.5,
        fetchedAt: localNow(),
        rawResultCount: allBusinesses.length,
        businesses: allBusinesses,
      }];
    } catch (err) {
      console.error('[UccFilingsSource] Search error:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  private async searchUcc(name: string, searchType: 'debtor' | 'securedParty'): Promise<BusinessRecord[]> {
    try {
      const params = new URLSearchParams();
      params.set(searchType === 'debtor' ? 'debtorName' : 'securedPartyName', name);
      params.set('type', 'Contains');

      const url = `${UCC_SEARCH_URL}?${params.toString()}`;

      const res = await this.fetchWithRetry(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html',
          'Referer': 'https://secure.utah.gov/bes/',
        },
      });

      if (!res.ok) {
        console.warn(`[UccFilingsSource] ${searchType} search returned ${res.status}`);
        return [];
      }

      const html = await res.text();
      return this.parseResults(html, searchType);
    } catch (err) {
      console.warn(`[UccFilingsSource] ${searchType} search failed:`, err instanceof Error ? err.message : err);
      return [];
    }
  }

  private parseResults(html: string, searchType: string): BusinessRecord[] {
    const records: BusinessRecord[] = [];

    try {
      const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let rowMatch: RegExpExecArray | null;

      while ((rowMatch = rowRegex.exec(html)) !== null) {
        const row = rowMatch[1];

        // Extract cell contents
        const cells: string[] = [];
        const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let cellMatch: RegExpExecArray | null;
        while ((cellMatch = cellRegex.exec(row)) !== null) {
          cells.push(this.stripHtml(cellMatch[1]).trim());
        }

        if (cells.length < 2) continue;

        // Skip header rows
        if (cells.every(c => c.length === 0)) continue;
        if (cells[0].toLowerCase().includes('filing') && cells[0].toLowerCase().includes('number')) continue;
        if (cells[0].toLowerCase() === 'debtor' || cells[0].toLowerCase() === 'secured party') continue;

        // Try to find a filing number (typically numeric, 8-15 digits)
        const filingNumCell = cells.find(c => /^\d{6,15}[-\d]*$/.test(c.trim()));

        // Try to find entity/debtor/secured party name
        const nameCell = cells.find(c => c.length > 2 && c.length < 150 && !/^\d+$/.test(c.trim()));
        if (!nameCell) continue;

        const record: BusinessRecord = {
          source: this.name,
          name: nameCell,
          type: 'UCC Filing',
          state: 'UT',
          role: searchType === 'debtor' ? 'Debtor' : 'Secured Party',
        };

        if (filingNumCell) {
          record.entityNumber = filingNumCell.trim();
        }

        // Try to detect status
        const statusCell = cells.find(c =>
          /active|lapsed|terminated|amended|continued/i.test(c)
        );
        if (statusCell) {
          const statusLower = statusCell.toLowerCase();
          if (statusLower.includes('active') || statusLower.includes('continued')) {
            record.status = 'active';
          } else if (statusLower.includes('lapsed') || statusLower.includes('terminated')) {
            record.status = 'inactive';
          }
        }

        // Try to find filing date
        const dateCell = cells.find(c => /\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}/.test(c));
        if (dateCell) {
          const dateMatch = dateCell.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
          if (dateMatch) {
            record.registrationDate = `${dateMatch[3]}-${dateMatch[1].padStart(2, '0')}-${dateMatch[2].padStart(2, '0')}`;
          } else {
            const isoMatch = dateCell.match(/\d{4}-\d{2}-\d{2}/);
            if (isoMatch) record.registrationDate = isoMatch[0];
          }
        }

        // Try to extract address from cells
        const addrCell = cells.find(c =>
          /\d+\s+\w+\s+(st|ave|blvd|dr|rd|ln|way|ct|cir|pl)/i.test(c) ||
          /\b(UT|Utah)\b/i.test(c)
        );
        if (addrCell) {
          record.address = addrCell;
        }

        records.push(record);
      }
    } catch (err) {
      console.warn('[UccFilingsSource] HTML parsing error:', err instanceof Error ? err.message : err);
    }

    return records.slice(0, 25);
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');
  }
}
