// ============================================================
// Skip Tracer v2 — Utah Business Entity Search Adapter
// ============================================================
// Searches the Utah Division of Corporations & Commercial Code
// business entity database.
// Target: https://secure.utah.gov/bes/
// Free public search — no API key required.

import { BaseDataSource } from './base';
import { SearchQuery, SourceCategory, SourceResult, BusinessRecord } from '../types';
import { localNow } from '../../../utils/timeUtils';

const BES_SEARCH_URL = 'https://secure.utah.gov/bes/action/search';
const USER_AGENT = 'RMPG-Flex/1.0 (Law Enforcement Skip Trace)';

export default class UtahBusinessSource extends BaseDataSource {
  readonly name = 'utah_business';
  readonly displayName = 'Utah Business Entities';
  readonly category: SourceCategory = 'business';
  readonly costPerLookup = 0;

  protected maxRequestsPerMinute = 5;

  protected async doSearch(query: SearchQuery): Promise<SourceResult[]> {
    try {
      const searchName = query.name || [query.firstName, query.lastName].filter(Boolean).join(' ');
      if (!searchName || searchName.length < 2) return [];

      // Search by business name (which may also match officer/agent names)
      const url = `${BES_SEARCH_URL}?businessName=${encodeURIComponent(searchName)}&type=Contains`;

      const res = await this.fetchWithRetry(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html',
          'Referer': 'https://secure.utah.gov/bes/',
        },
      });

      if (!res.ok) {
        console.warn(`[UtahBusinessSource] Search returned ${res.status}`);
        return [];
      }

      const html = await res.text();
      const businesses = this.parseSearchResults(html);

      if (businesses.length === 0) {
        // Try searching by registered agent name if person name was provided
        if (query.lastName) {
          return await this.searchByAgent(searchName);
        }
        console.warn('[UtahBusinessSource] No results parsed — site structure may have changed');
        return [];
      }

      return [{
        source: this.name,
        sourceType: 'scraper' as any,
        confidence: 0.5,
        fetchedAt: localNow(),
        rawResultCount: businesses.length,
        businesses,
      }];
    } catch (err) {
      console.warn('[UtahBusinessSource] Search failed:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  private async searchByAgent(agentName: string): Promise<SourceResult[]> {
    try {
      const url = `${BES_SEARCH_URL}?registeredAgent=${encodeURIComponent(agentName)}&type=Contains`;

      const res = await this.fetchWithRetry(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html',
          'Referer': 'https://secure.utah.gov/bes/',
        },
      });

      if (!res.ok) return [];

      const html = await res.text();
      const businesses = this.parseSearchResults(html);

      if (businesses.length === 0) return [];

      // Mark agent-matched results with the agent role
      for (const biz of businesses) {
        biz.agent = agentName;
      }

      return [{
        source: this.name,
        sourceType: 'scraper' as any,
        confidence: 0.5,
        fetchedAt: localNow(),
        rawResultCount: businesses.length,
        businesses,
      }];
    } catch (err) {
      console.warn('[UtahBusinessSource] Agent search failed:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  private parseSearchResults(html: string): BusinessRecord[] {
    const records: BusinessRecord[] = [];

    try {
      // Look for table rows containing business data
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

        // Skip header rows or empty rows
        if (cells.every(c => c.length === 0)) continue;
        if (cells[0].toLowerCase() === 'entity name' || cells[0].toLowerCase() === 'name') continue;

        // Try to find entity number (numeric, usually 7-10 digits)
        const entityNumCell = cells.find(c => /^\d{5,10}[-\d]*$/.test(c.trim()));

        // Business name is typically the first or second cell
        const nameCell = cells.find(c => c.length > 2 && c.length < 120 && !/^\d+$/.test(c.trim()));
        if (!nameCell) continue;

        const record: BusinessRecord = {
          source: this.name,
          name: nameCell,
          state: 'UT',
        };

        if (entityNumCell) {
          record.entityNumber = entityNumCell.trim();
        }

        // Try to detect entity type (LLC, Corp, etc.)
        const typeCell = cells.find(c =>
          /LLC|Corporation|Corp|Inc|Partnership|LP|LLP|DBA|Non-?Profit|Trust/i.test(c)
        );
        if (typeCell) {
          record.type = typeCell.trim();
        } else {
          // Try to infer type from the business name
          const nameLower = nameCell.toLowerCase();
          if (nameLower.includes('llc')) record.type = 'LLC';
          else if (nameLower.includes('corp') || nameLower.includes('inc')) record.type = 'Corporation';
          else if (nameLower.includes('lp') || nameLower.includes('partnership')) record.type = 'Partnership';
        }

        // Try to detect status
        const statusCell = cells.find(c =>
          /active|inactive|expired|dissolved|revoked|good standing/i.test(c)
        );
        if (statusCell) {
          const statusLower = statusCell.toLowerCase();
          if (statusLower.includes('active') || statusLower.includes('good standing')) record.status = 'active';
          else if (statusLower.includes('dissolved')) record.status = 'dissolved';
          else if (statusLower.includes('inactive') || statusLower.includes('expired') || statusLower.includes('revoked')) record.status = 'inactive';
        }

        // Try to extract registration date
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

        // Extract detail link for potential agent lookup
        const linkMatch = row.match(/href="[^"]*(?:details|entity)[^"]*?(\d{5,})/i);
        if (linkMatch && !record.entityNumber) {
          record.entityNumber = linkMatch[1];
        }

        records.push(record);
      }
    } catch (err) {
      console.warn('[UtahBusinessSource] HTML parsing error:', err instanceof Error ? err.message : err);
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
