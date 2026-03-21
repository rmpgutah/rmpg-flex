// ============================================================
// Skip Tracer v2 — Utah Voter Registration Adapter
// ============================================================
// Searches Utah voter registration public records via the
// votesearch.utah.gov POST form. Free public record source.
// Returns registered address, DOB (year only), party affiliation.

import { BaseDataSource } from './base';
import { SearchQuery, SourceCategory, SourceResult, AddressRecord, SocialProfile } from '../types';
import { localNow } from '../../../utils/timeUtils';

const VOTER_SEARCH_URL = 'https://votesearch.utah.gov/voter-search/search/search-by-voter/voter-info';
const USER_AGENT = 'RMPG-Flex/1.0 (Law Enforcement Skip Trace)';

export default class UtahVoterRecordsSource extends BaseDataSource {
  readonly name = 'utah_voter';
  readonly displayName = 'Utah Voter Registration';
  readonly category: SourceCategory = 'people';
  readonly costPerLookup = 0;

  protected maxRequestsPerMinute = 5;

  isConfigured(): boolean {
    return true;
  }

  protected async doSearch(query: SearchQuery): Promise<SourceResult[]> {
    try {
      const firstName = query.firstName || '';
      const lastName = query.lastName || '';

      // If we only have a combined name, try to split it
      if (!firstName && !lastName && query.name) {
        const parts = query.name.trim().split(/\s+/);
        if (parts.length < 2) return [];
        return this.searchVoter(parts[0], parts[parts.length - 1]);
      }

      if (!lastName || lastName.length < 2) return [];

      return this.searchVoter(firstName, lastName);
    } catch (err) {
      console.error('[UtahVoterRecordsSource] Search error:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  private async searchVoter(firstName: string, lastName: string): Promise<SourceResult[]> {
    try {
      // Build form data for POST request
      const formData = new URLSearchParams();
      formData.set('firstName', firstName);
      formData.set('lastName', lastName);
      formData.set('state', 'UT');

      const res = await this.fetchWithRetry(VOTER_SEARCH_URL, {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'text/html',
          'Referer': 'https://votesearch.utah.gov/voter-search/search/search-by-voter/voter-info',
        },
        body: formData.toString(),
      });

      if (!res.ok) {
        console.warn(`[UtahVoterRecordsSource] Search returned ${res.status}`);
        return [];
      }

      const html = await res.text();
      return this.parseResults(html);
    } catch (err) {
      console.warn('[UtahVoterRecordsSource] Voter search failed:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  private parseResults(html: string): SourceResult[] {
    const results: SourceResult[] = [];

    try {
      // Parse table rows from voter search results
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

        // Skip header rows
        if (cells[0].toLowerCase() === 'name' || cells[0].toLowerCase() === 'voter') continue;
        if (cells.every(c => c.length === 0)) continue;

        const result: SourceResult = {
          source: this.name,
          sourceType: this.category,
          confidence: 0.6,
          fetchedAt: localNow(),
          rawResultCount: 1,
        };

        // Try to extract voter name
        const nameCell = cells.find(c => c.length > 3 && /[A-Za-z]/.test(c) && !/^\d+$/.test(c));
        if (nameCell) {
          const nameParts = nameCell.split(/,\s*/);
          if (nameParts.length >= 2) {
            result.names = [{
              source: this.name,
              full: `${nameParts[1].trim()} ${nameParts[0].trim()}`,
              first: nameParts[1].trim(),
              last: nameParts[0].trim(),
            }];
          } else {
            result.names = [{
              source: this.name,
              full: nameCell,
            }];
          }
        }

        // Try to extract address
        const addrCell = cells.find(c =>
          /\d+\s+\w+\s+(st|ave|blvd|dr|rd|ln|way|ct|cir|pl)/i.test(c) ||
          /\b(UT|Utah)\b/i.test(c)
        );
        if (addrCell) {
          const address = this.parseAddress(addrCell);
          if (address) {
            result.addresses = [address];
          }
        }

        // Try to extract birth year
        const birthYearCell = cells.find(c => /\b(19\d{2}|20[0-2]\d)\b/.test(c));
        if (birthYearCell) {
          const yearMatch = birthYearCell.match(/\b(19\d{2}|20[0-2]\d)\b/);
          if (yearMatch) {
            result.dobs = [{
              source: this.name,
              dob: `${yearMatch[1]}-01-01`, // Year only, use Jan 1 placeholder
            }];
          }
        }

        // Try to extract party affiliation — store as a social profile
        const partyCell = cells.find(c =>
          /\b(republican|democrat|libertarian|constitution|independent|unaffiliated|green|no party|other)\b/i.test(c)
        );
        if (partyCell) {
          const partyMatch = partyCell.match(
            /\b(republican|democrat|libertarian|constitution|independent|unaffiliated|green|no party|other)\b/i
          );
          if (partyMatch) {
            const profiles: SocialProfile[] = [{
              source: this.name,
              platform: 'Utah Voter Registration',
              displayName: partyMatch[1],
              bio: `Party affiliation: ${partyMatch[1]}`,
              verified: true,
            }];
            result.socialProfiles = profiles;
          }
        }

        // Try to extract county
        const countyCell = cells.find(c => /county/i.test(c));
        if (countyCell && result.addresses && result.addresses.length > 0) {
          result.addresses[0].county = countyCell.replace(/county/i, '').trim();
        }

        // Only include results that have at least a name
        if (result.names && result.names.length > 0) {
          results.push(result);
        }
      }
    } catch (err) {
      console.warn('[UtahVoterRecordsSource] HTML parsing error:', err instanceof Error ? err.message : err);
    }

    return results.slice(0, 20);
  }

  private parseAddress(raw: string): AddressRecord | null {
    try {
      // Try common patterns: "123 Main St, Salt Lake City, UT 84101"
      const fullMatch = raw.match(/^(.+?),\s*(.+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/);
      if (fullMatch) {
        return {
          source: this.name,
          street: fullMatch[1].trim(),
          city: fullMatch[2].trim(),
          state: fullMatch[3],
          zip: fullMatch[4],
          type: 'current',
        };
      }

      // Simpler pattern: just street with UT somewhere
      if (/\bUT\b/.test(raw)) {
        return {
          source: this.name,
          street: raw.replace(/,?\s*UT\b.*$/, '').trim(),
          city: '',
          state: 'UT',
          zip: (raw.match(/\b(\d{5})\b/) || ['', ''])[1],
          type: 'current',
        };
      }

      return null;
    } catch {
      return null;
    }
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
