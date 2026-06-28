// ============================================================
// Skip Tracker 3.5 — Utah Courts XChange Adapter
// ============================================================
// Searches the Utah Courts XChange public case search portal.
// Target: https://www.utcourts.gov/xchange/
// This is a form-based portal that may require CSRF tokens or
// session cookies. Currently implemented as a best-effort
// scraper that gracefully degrades if the site structure changes.

import { BaseDataSource } from './base';
import { SearchQuery, SkipTracerSourceCategory, SourceResult, CourtRecord } from '../types';
import { localNow } from '../../../utils/timeUtils';

const XCHANGE_BASE = 'https://www.utcourts.gov/xchange/';
const USER_AGENT = 'RMPG-Flex/1.0 (Law Enforcement Skip Trace)';

export default class UtahCourtsSource extends BaseDataSource {
  readonly name = 'utah_courts';
  readonly displayName = 'Utah Courts (XChange)';
  readonly category: SkipTracerSourceCategory = 'court';
  readonly costPerLookup = 0;

  protected maxRequestsPerMinute = 5;

  protected async doSearch(query: SearchQuery): Promise<SourceResult[]> {
    try {
      const lastName = query.lastName || '';
      if (!lastName || lastName.length < 2) return [];

      const firstName = query.firstName || '';

      // Step 1: Fetch the search page to get any session cookies / CSRF tokens
      const pageRes = await this.fetchWithRetry(XCHANGE_BASE, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html',
        },
      });

      if (!pageRes.ok) {
        console.warn(`[UtahCourtsSource] Search page returned ${pageRes.status}`);
        return [];
      }

      const pageHtml = await pageRes.text();

      // Try to extract CSRF token or hidden form fields
      const tokenMatch = pageHtml.match(/name="(?:csrf|_token|__RequestVerificationToken)"[^>]*value="([^"]+)"/i);
      const csrfToken = tokenMatch?.[1] || '';

      // Extract cookies from the response
      const setCookies = pageRes.headers.get('set-cookie') || '';

      // Step 2: Attempt a name search via form POST
      const formBody = new URLSearchParams();
      formBody.set('last', lastName);
      if (firstName) formBody.set('first', firstName);
      formBody.set('type', 'name');
      if (csrfToken) formBody.set('_token', csrfToken);

      const searchRes = await this.fetchWithRetry(XCHANGE_BASE, {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'text/html',
          'Referer': XCHANGE_BASE,
          ...(setCookies ? { 'Cookie': setCookies.split(';')[0] } : {}),
        },
        body: formBody.toString(),
      });

      if (!searchRes.ok) {
        console.warn(`[UtahCourtsSource] Search POST returned ${searchRes.status}`);
        return [];
      }

      const html = await searchRes.text();

      // Step 3: Attempt to parse case results from HTML
      const courtRecords = this.parseResults(html);

      if (courtRecords.length === 0) {
        console.warn('[UtahCourtsSource] No results parsed — site may require interactive session or structure changed');
        return [];
      }

      return [{
        source: this.name,
        sourceType: 'scraper' as any,
        confidence: 0.7,
        fetchedAt: localNow(),
        rawResultCount: courtRecords.length,
        courtRecords,
      }];
    } catch (err) {
      console.warn('[UtahCourtsSource] Search failed:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  private parseResults(html: string): CourtRecord[] {
    const records: CourtRecord[] = [];

    try {
      // Look for table rows containing case data
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

        // Skip rows with fewer than 3 cells or header rows
        if (cells.length < 3) continue;

        // Try to identify case number pattern (e.g., "201900123" or "SLC-2019-CR-00123")
        const caseNumCell = cells.find(c => /\d{4,}/.test(c) && c.length < 30);
        if (!caseNumCell) continue;

        // Map cells to record fields (order varies by site version)
        const record: CourtRecord = {
          source: this.name,
          caseNumber: caseNumCell,
          court: cells.find(c => /court|district|justice/i.test(c)) || 'Utah Court',
          state: 'UT',
        };

        // Try to detect case type
        const typeCell = cells.find(c => /criminal|civil|traffic|family|small claims/i.test(c));
        if (typeCell) {
          const typeLower = typeCell.toLowerCase();
          if (typeLower.includes('criminal')) record.caseType = 'criminal';
          else if (typeLower.includes('civil')) record.caseType = 'civil';
          else if (typeLower.includes('traffic')) record.caseType = 'traffic';
          else if (typeLower.includes('family')) record.caseType = 'family';
          else record.caseType = 'other';
        }

        // Try to detect filing date (MM/DD/YYYY or YYYY-MM-DD)
        const dateCell = cells.find(c => /\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}/.test(c));
        if (dateCell) {
          const dateMatch = dateCell.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
          if (dateMatch) {
            record.filingDate = `${dateMatch[3]}-${dateMatch[1].padStart(2, '0')}-${dateMatch[2].padStart(2, '0')}`;
          } else {
            const isoMatch = dateCell.match(/\d{4}-\d{2}-\d{2}/);
            if (isoMatch) record.filingDate = isoMatch[0];
          }
        }

        // Try to detect status
        const statusCell = cells.find(c => /open|closed|pending|disposed|active|dismissed/i.test(c));
        if (statusCell) {
          const statusLower = statusCell.toLowerCase();
          if (statusLower.includes('closed') || statusLower.includes('disposed') || statusLower.includes('dismissed')) {
            record.status = 'closed';
          } else if (statusLower.includes('open') || statusLower.includes('active')) {
            record.status = 'open';
          } else if (statusLower.includes('pending')) {
            record.status = 'pending';
          }
        }

        // Try to extract charges
        const chargeCell = cells.find(c => c.length > 10 && !c.includes('/') && !/^\d+$/.test(c) && c !== record.caseNumber);
        if (chargeCell && chargeCell !== record.court) {
          record.charges = [chargeCell];
        }

        records.push(record);
      }
    } catch (err) {
      console.warn('[UtahCourtsSource] HTML parsing error:', err instanceof Error ? err.message : err);
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
