// ============================================================
// Skip Tracker 3.5 — Federal Court PACER Public Case Locator
// ============================================================
// Searches the PACER Public Case Locator (free, no login)
// for federal bankruptcy, civil, and criminal case records.
// URL: https://pcl.uscourts.gov/pcl/pages/search.jsf

import { BaseDataSource } from './base';
import { SearchQuery, SourceCategory, SourceResult, CourtRecord } from '../types';
import { localNow } from '../../../utils/timeUtils';

const PCL_SEARCH_URL = 'https://pcl.uscourts.gov/pcl/pages/search.jsf';
const USER_AGENT = 'RMPG-Flex/1.0 (Law Enforcement Skip Trace)';

export default class PacerLookupSource extends BaseDataSource {
  readonly name = 'pacer_pcl';
  readonly displayName = 'Federal Court (PACER)';
  readonly category: SourceCategory = 'court';
  readonly costPerLookup = 0;

  protected maxRequestsPerMinute = 5;

  isConfigured(): boolean {
    return true;
  }

  protected async doSearch(query: SearchQuery): Promise<SourceResult[]> {
    try {
      const lastName = query.lastName || '';
      const firstName = query.firstName || '';

      // If we only have a combined name, try to split it
      let searchLast = lastName;
      let searchFirst = firstName;

      if (!searchLast && query.name) {
        const parts = query.name.trim().split(/\s+/);
        if (parts.length < 2) return [];
        searchFirst = parts[0];
        searchLast = parts[parts.length - 1];
      }

      if (!searchLast || searchLast.length < 2) return [];

      // First fetch the page to get any session/viewstate tokens (JSF pages need this)
      const pageRes = await this.fetchWithRetry(PCL_SEARCH_URL, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html',
        },
      });

      if (!pageRes.ok) {
        console.warn(`[PacerLookupSource] Initial page load returned ${pageRes.status}`);
        return [];
      }

      const pageHtml = await pageRes.text();

      // Extract JSF ViewState token
      const viewState = this.extractViewState(pageHtml);
      if (!viewState) {
        console.warn('[PacerLookupSource] Could not extract ViewState — page structure may have changed');
        return [];
      }

      // Extract cookies from response
      const cookies = pageRes.headers.get('set-cookie') || '';

      // Submit the search form
      const formData = new URLSearchParams();
      formData.set('javax.faces.partial.ajax', 'true');
      formData.set('javax.faces.ViewState', viewState);
      formData.set('lastName', searchLast);
      if (searchFirst) {
        formData.set('firstName', searchFirst);
      }
      formData.set('searchForm', 'searchForm');
      formData.set('searchForm:submitSearch', 'searchForm:submitSearch');

      const searchRes = await this.fetchWithRetry(PCL_SEARCH_URL, {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'text/html',
          'Referer': PCL_SEARCH_URL,
          'Cookie': cookies,
        },
        body: formData.toString(),
      });

      if (!searchRes.ok) {
        console.warn(`[PacerLookupSource] Search returned ${searchRes.status}`);
        return [];
      }

      const html = await searchRes.text();
      const records = this.parseResults(html);

      if (records.length === 0) return [];

      return [{
        source: this.name,
        sourceType: this.category,
        confidence: 0.6,
        fetchedAt: localNow(),
        rawResultCount: records.length,
        courtRecords: records,
      }];
    } catch (err) {
      console.error('[PacerLookupSource] Search error:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  private extractViewState(html: string): string | null {
    // JSF ViewState is typically in a hidden input
    const match = html.match(/name="javax\.faces\.ViewState"[^>]*value="([^"]+)"/);
    if (match) return match[1];

    // Try alternate format
    const altMatch = html.match(/id="javax\.faces\.ViewState"[^>]*value="([^"]+)"/);
    return altMatch ? altMatch[1] : null;
  }

  private parseResults(html: string): CourtRecord[] {
    const records: CourtRecord[] = [];

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

        if (cells.length < 3) continue;

        // Skip header rows
        if (cells.every(c => c.length === 0)) continue;
        if (cells[0].toLowerCase().includes('case number') || cells[0].toLowerCase().includes('court')) continue;

        // Try to find case number (common formats: 1:24-cv-01234, 24-12345, etc.)
        const caseNumCell = cells.find(c => /\d{1,2}[:-]\d{2}-[a-z]{2,3}-\d+|\d{2}-\d{4,}/i.test(c));
        if (!caseNumCell) continue;

        const caseNumber = caseNumCell.trim();

        // Determine court name
        const courtCell = cells.find(c =>
          /district|bankruptcy|court|division/i.test(c) && c.length > 5
        );

        // Determine case type
        let caseType: CourtRecord['caseType'] = 'other';
        const allText = cells.join(' ').toLowerCase();
        if (allText.includes('bankruptcy') || allText.includes('bk') || allText.includes('br')) {
          caseType = 'bankruptcy';
        } else if (allText.includes('criminal') || allText.includes('cr')) {
          caseType = 'criminal';
        } else if (allText.includes('civil') || allText.includes('cv')) {
          caseType = 'civil';
        }

        // Try to find filing date
        const dateCell = cells.find(c => /\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}/.test(c));
        let filingDate: string | undefined;
        if (dateCell) {
          const dateMatch = dateCell.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
          if (dateMatch) {
            filingDate = `${dateMatch[3]}-${dateMatch[1].padStart(2, '0')}-${dateMatch[2].padStart(2, '0')}`;
          } else {
            const isoMatch = dateCell.match(/\d{4}-\d{2}-\d{2}/);
            if (isoMatch) filingDate = isoMatch[0];
          }
        }

        // Try to find status
        let status: CourtRecord['status'] = 'unknown';
        if (allText.includes('closed') || allText.includes('terminated') || allText.includes('discharged')) {
          status = 'closed';
        } else if (allText.includes('open') || allText.includes('pending') || allText.includes('active')) {
          status = 'open';
        }

        // Extract party names (plaintiff/defendant)
        const partyCell = cells.find(c => c.length > 10 && /v\.|vs\.?|versus/i.test(c));
        let plaintiff: string | undefined;
        let defendant: string | undefined;
        if (partyCell) {
          const partyParts = partyCell.split(/\s+v\.?\s+|\s+vs\.?\s+|\s+versus\s+/i);
          if (partyParts.length >= 2) {
            plaintiff = partyParts[0].trim();
            defendant = partyParts[1].trim();
          }
        }

        records.push({
          source: this.name,
          caseNumber,
          court: courtCell || 'Federal Court',
          state: 'US',
          caseType,
          filingDate,
          status,
          plaintiff,
          defendant,
        });
      }
    } catch (err) {
      console.warn('[PacerLookupSource] HTML parsing error:', err instanceof Error ? err.message : err);
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
