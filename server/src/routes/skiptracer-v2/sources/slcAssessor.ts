// ============================================================
// Skip Tracer v2 — Salt Lake County Assessor Adapter
// ============================================================
// Searches Salt Lake County property records by owner name
// or address. Best-effort scraper — gracefully degrades if
// the county site structure changes.

import { BaseDataSource } from './base';
import { SearchQuery, SourceCategory, SourceResult, PropertyRecord } from '../types';
import { localNow } from '../../../utils/timeUtils';

const ASSESSOR_BASE = 'https://slco.org/assessor/new/valuationsearch.cfm';
const USER_AGENT = 'RMPG-Flex/1.0 (Law Enforcement Skip Trace)';

export default class SlcAssessorSource extends BaseDataSource {
  readonly name = 'slc_assessor';
  readonly displayName = 'SLC County Property Records';
  readonly category: SourceCategory = 'property';
  readonly costPerLookup = 0;

  protected maxRequestsPerMinute = 5;

  protected async doSearch(query: SearchQuery): Promise<SourceResult[]> {
    try {
      // Need either a name (owner search) or address
      const ownerName = query.name || [query.firstName, query.lastName].filter(Boolean).join(' ');
      const address = query.address || '';

      if ((!ownerName || ownerName.length < 2) && !address) return [];

      // Build search parameters — try owner name first, fall back to address
      const formBody = new URLSearchParams();

      if (ownerName && ownerName.length >= 2) {
        formBody.set('Owner', ownerName);
        formBody.set('searchtype', 'owner');
      } else {
        formBody.set('Address', address);
        formBody.set('searchtype', 'address');
      }

      const res = await this.fetchWithRetry(ASSESSOR_BASE, {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'text/html',
          'Referer': ASSESSOR_BASE,
        },
        body: formBody.toString(),
      });

      if (!res.ok) {
        console.warn(`[SlcAssessorSource] Search returned ${res.status}`);
        return [];
      }

      const html = await res.text();
      const propertyRecords = this.parseResults(html);

      if (propertyRecords.length === 0) {
        console.warn('[SlcAssessorSource] No results parsed — site structure may have changed');
        return [];
      }

      return [{
        source: this.name,
        sourceType: 'scraper' as any,
        confidence: 0.7,
        fetchedAt: localNow(),
        rawResultCount: propertyRecords.length,
        propertyRecords,
      }];
    } catch (err) {
      console.warn('[SlcAssessorSource] Search failed:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  private parseResults(html: string): PropertyRecord[] {
    const records: PropertyRecord[] = [];

    try {
      // Look for table rows containing property data
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

        if (cells.length < 3) continue;

        // Look for parcel ID pattern (typically numeric, 10+ digits)
        const parcelCell = cells.find(c => /^\d{5,}[-\d]*$/.test(c.replace(/\s/g, '')));

        // Look for address-like cell
        const addressCell = cells.find(c =>
          /\d+\s+\w+\s+(st|ave|blvd|dr|rd|ln|way|ct|cir|pl)/i.test(c)
        );

        // Look for owner name cell (contains comma-separated name or multi-word)
        const ownerCell = cells.find(c =>
          c.includes(',') && c.length > 5 && c.length < 80 && !/\d{5,}/.test(c)
        );

        // Look for value cell (dollar amount)
        const valueCell = cells.find(c => /\$[\d,]+/.test(c));

        // Need at least an address or parcel ID to create a record
        if (!addressCell && !parcelCell) continue;

        const record: PropertyRecord = {
          source: this.name,
          address: addressCell || '',
          city: 'Salt Lake City',
          state: 'UT',
          zip: '',
          county: 'Salt Lake',
        };

        if (parcelCell) {
          record.parcelId = parcelCell.replace(/\s/g, '');
        }

        if (ownerCell) {
          record.ownerName = ownerCell;
        }

        if (valueCell) {
          const valMatch = valueCell.match(/\$([\d,]+)/);
          if (valMatch) {
            record.assessedValue = parseInt(valMatch[1].replace(/,/g, ''), 10);
          }
        }

        // Try to extract zip from address or other cells
        const zipCell = cells.find(c => /\b\d{5}(-\d{4})?\b/.test(c));
        if (zipCell) {
          const zipMatch = zipCell.match(/\b(\d{5})(-\d{4})?\b/);
          if (zipMatch) record.zip = zipMatch[0];
        }

        // Try to detect property type from cells
        const typeCell = cells.find(c => /residential|commercial|vacant|industrial|condo/i.test(c));
        if (typeCell) {
          const typeLower = typeCell.toLowerCase();
          if (typeLower.includes('commercial')) record.propertyType = 'commercial';
          else if (typeLower.includes('industrial')) record.propertyType = 'industrial';
          else if (typeLower.includes('vacant') || typeLower.includes('land')) record.propertyType = 'land';
          else record.propertyType = 'residential';
        }

        // Try to find year built
        const yearCell = cells.find(c => /^(19|20)\d{2}$/.test(c.trim()));
        if (yearCell) {
          record.yearBuilt = parseInt(yearCell.trim(), 10);
        }

        records.push(record);
      }
    } catch (err) {
      console.warn('[SlcAssessorSource] HTML parsing error:', err instanceof Error ? err.message : err);
    }

    return records;
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
