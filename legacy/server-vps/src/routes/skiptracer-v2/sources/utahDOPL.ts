// ============================================================
// Skip Tracker 3.5 — Utah DOPL Professional Licenses Adapter
// ============================================================
// Searches the Utah Division of Professional Licensing (DOPL)
// license verification portal for professional licenses.
// Target: https://secure.utah.gov/llv/search/index.html
// Free public search — no API key required.

import { BaseDataSource } from './base';
import { SearchQuery, SkipTracerSourceCategory, SourceResult, LicenseRecord } from '../types';
import { localNow } from '../../../utils/timeUtils';

const DOPL_SEARCH_URL = 'https://secure.utah.gov/llv/search/index.html';
const DOPL_RESULTS_URL = 'https://secure.utah.gov/llv/search/results.html';
const USER_AGENT = 'RMPG-Flex/1.0 (Law Enforcement Skip Trace)';

export default class UtahDoplSource extends BaseDataSource {
  readonly name = 'utah_dopl';
  readonly displayName = 'Utah Professional Licenses';
  readonly category: SkipTracerSourceCategory = 'people';
  readonly costPerLookup = 0;

  protected maxRequestsPerMinute = 5;

  protected async doSearch(query: SearchQuery): Promise<SourceResult[]> {
    try {
      const lastName = query.lastName || '';
      if (!lastName || lastName.length < 2) {
        // Try to extract last name from full name
        if (query.name) {
          const parts = query.name.trim().split(/\s+/);
          if (parts.length >= 2) {
            return await this.searchByName(parts[0], parts.slice(1).join(' '));
          } else if (parts[0].length >= 2) {
            return await this.searchByName('', parts[0]);
          }
        }
        return [];
      }

      return await this.searchByName(query.firstName || '', lastName);
    } catch (err) {
      console.warn('[UtahDoplSource] Search failed:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  private async searchByName(firstName: string, lastName: string): Promise<SourceResult[]> {
    try {
      // Step 1: Fetch search page for session/CSRF
      const pageRes = await this.fetchWithRetry(DOPL_SEARCH_URL, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html',
        },
      });

      if (!pageRes.ok) {
        console.warn(`[UtahDoplSource] Search page returned ${pageRes.status}`);
        return [];
      }

      const pageHtml = await pageRes.text();

      // Extract any hidden form fields
      const hiddenFields: Record<string, string> = {};
      const hiddenRegex = /<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*>/gi;
      let hiddenMatch: RegExpExecArray | null;
      while ((hiddenMatch = hiddenRegex.exec(pageHtml)) !== null) {
        hiddenFields[hiddenMatch[1]] = hiddenMatch[2];
      }

      // Also check reversed order (value before name)
      const hiddenRegex2 = /<input[^>]*value="([^"]*)"[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*>/gi;
      while ((hiddenMatch = hiddenRegex2.exec(pageHtml)) !== null) {
        hiddenFields[hiddenMatch[2]] = hiddenMatch[1];
      }

      // Extract cookies
      const setCookies = pageRes.headers.get('set-cookie') || '';

      // Step 2: Submit search form
      const formBody = new URLSearchParams();
      formBody.set('lastName', lastName);
      if (firstName) formBody.set('firstName', firstName);
      formBody.set('searchType', 'name');

      // Add hidden fields
      for (const [key, value] of Object.entries(hiddenFields)) {
        formBody.set(key, value);
      }

      const searchRes = await this.fetchWithRetry(DOPL_RESULTS_URL, {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'text/html',
          'Referer': DOPL_SEARCH_URL,
          ...(setCookies ? { 'Cookie': setCookies.split(';')[0] } : {}),
        },
        body: formBody.toString(),
      });

      if (!searchRes.ok) {
        // Try GET-based search as fallback
        const getUrl = `${DOPL_RESULTS_URL}?lastName=${encodeURIComponent(lastName)}${firstName ? `&firstName=${encodeURIComponent(firstName)}` : ''}`;
        const getRes = await this.fetchWithRetry(getUrl, {
          headers: {
            'User-Agent': USER_AGENT,
            'Accept': 'text/html',
            'Referer': DOPL_SEARCH_URL,
          },
        });

        if (!getRes.ok) {
          console.warn(`[UtahDoplSource] Search returned ${searchRes.status} (POST) and ${getRes.status} (GET)`);
          return [];
        }

        const html = await getRes.text();
        return this.buildResults(html);
      }

      const html = await searchRes.text();
      return this.buildResults(html);
    } catch (err) {
      console.warn('[UtahDoplSource] Name search failed:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  private buildResults(html: string): SourceResult[] {
    const licenses = this.parseResults(html);

    if (licenses.length === 0) {
      console.warn('[UtahDoplSource] No results parsed — site structure may have changed');
      return [];
    }

    return [{
      source: this.name,
      sourceType: 'scraper' as any,
      confidence: 0.6,
      fetchedAt: localNow(),
      rawResultCount: licenses.length,
      licenses,
    }];
  }

  private parseResults(html: string): LicenseRecord[] {
    const records: LicenseRecord[] = [];

    try {
      // Look for table rows containing license data
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
        if (cells[0].toLowerCase() === 'name' || cells[0].toLowerCase() === 'license') continue;
        if (cells.every(c => c.length === 0)) continue;

        // Look for license number pattern
        const licenseNumCell = cells.find(c => /^[A-Z]*\d{4,}[-\d]*$/i.test(c.trim()));

        // Look for license type/description
        const typeCell = cells.find(c =>
          /nurse|physician|contractor|real estate|pharmacy|dental|plumb|electric|engineer|architect|account|attorney|massage|cosmetol|barber|chiro/i.test(c)
        );

        // Look for status
        const statusCell = cells.find(c =>
          /^(active|expired|suspended|revoked|inactive|current|lapsed)$/i.test(c.trim())
        );

        // Look for dates
        const dates: string[] = [];
        for (const c of cells) {
          const dateMatch = c.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
          if (dateMatch) {
            dates.push(`${dateMatch[3]}-${dateMatch[1].padStart(2, '0')}-${dateMatch[2].padStart(2, '0')}`);
          }
        }

        // Need at least a license number or type to create a record
        if (!licenseNumCell && !typeCell) continue;

        const record: LicenseRecord = {
          source: this.name,
          type: 'professional',
          state: 'UT',
        };

        if (licenseNumCell) {
          record.licenseNumber = licenseNumCell.trim();
        }

        if (typeCell) {
          record.description = typeCell;
        }

        if (statusCell) {
          const statusLower = statusCell.trim().toLowerCase();
          if (statusLower === 'active' || statusLower === 'current') record.status = 'active';
          else if (statusLower === 'expired' || statusLower === 'lapsed' || statusLower === 'inactive') record.status = 'expired';
          else if (statusLower === 'suspended') record.status = 'suspended';
          else if (statusLower === 'revoked') record.status = 'revoked';
        }

        // Assign dates (first = issue, second = expiry if available)
        if (dates.length >= 2) {
          record.issueDate = dates[0];
          record.expirationDate = dates[1];
        } else if (dates.length === 1) {
          // Single date — could be issue or expiry, default to expiry
          record.expirationDate = dates[0];
        }

        records.push(record);
      }
    } catch (err) {
      console.warn('[UtahDoplSource] HTML parsing error:', err instanceof Error ? err.message : err);
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
