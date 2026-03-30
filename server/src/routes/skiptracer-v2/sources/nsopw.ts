// ============================================================
// Skip Tracker 3.5 — NSOPW National Sex Offender Registry Adapter
// ============================================================
// Searches the National Sex Offender Public Website (NSOPW)
// API for registered sex offenders by name.
// Target: https://www.nsopw.gov/
// Free public registry — no API key required.

import { BaseDataSource } from './base';
import { SearchQuery, SourceCategory, SourceResult, SexOffenderRecord } from '../types';
import { localNow } from '../../../utils/timeUtils';

const NSOPW_SEARCH_URL = 'https://www.nsopw.gov/api/Search';
const NSOPW_BASE = 'https://www.nsopw.gov';
const USER_AGENT = 'RMPG-Flex/1.0 (Law Enforcement Skip Trace)';

export default class NsopwSource extends BaseDataSource {
  readonly name = 'nsopw';
  readonly displayName = 'National Sex Offender Registry';
  readonly category: SourceCategory = 'registry';
  readonly costPerLookup = 0;

  protected maxRequestsPerMinute = 5;

  protected async doSearch(query: SearchQuery): Promise<SourceResult[]> {
    try {
      const firstName = query.firstName || '';
      const lastName = query.lastName || '';

      // If only full name provided, try to split it
      let first = firstName;
      let last = lastName;
      if (!first && !last && query.name) {
        const parts = query.name.trim().split(/\s+/);
        if (parts.length >= 2) {
          first = parts[0];
          last = parts.slice(1).join(' ');
        } else {
          last = parts[0];
        }
      }

      if (!last || last.length < 2) return [];

      // Try the NSOPW API endpoint with JSON POST
      const searchPayload = {
        firstName: first,
        lastName: last,
        city: query.city || '',
        state: query.state || '',
        zip: query.zip || '',
      };

      const res = await this.fetchWithRetry(NSOPW_SEARCH_URL, {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Origin': NSOPW_BASE,
          'Referer': `${NSOPW_BASE}/Search`,
        },
        body: JSON.stringify(searchPayload),
      });

      if (!res.ok) {
        // The API may not accept direct requests — try HTML scraping fallback
        console.warn(`[NsopwSource] API returned ${res.status}, trying HTML fallback`);
        return await this.searchHtmlFallback(first, last);
      }

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('json')) {
        console.warn('[NsopwSource] API returned non-JSON response, trying HTML fallback');
        return await this.searchHtmlFallback(first, last);
      }

      const data = await res.json() as any;

      // Parse API response — structure may vary
      const offenders = Array.isArray(data) ? data : (data.offenders || data.results || []);

      if (!Array.isArray(offenders) || offenders.length === 0) {
        return [];
      }

      const sexOffenderRecords: SexOffenderRecord[] = offenders.slice(0, 25).map((o: any) => ({
        source: this.name,
        name: [o.firstName, o.lastName].filter(Boolean).join(' ') || o.name || 'Unknown',
        registryState: o.state || o.jurisdiction || 'Unknown',
        tier: o.tier || o.riskLevel || undefined,
        offenses: Array.isArray(o.offenses)
          ? o.offenses.map((off: any) => typeof off === 'string' ? off : off.description || off.offense || '')
          : o.offense ? [o.offense] : undefined,
        registrationDate: o.registrationDate || o.dateRegistered || undefined,
        address: o.address || [o.street, o.city, o.state, o.zip].filter(Boolean).join(', ') || undefined,
        photoUrl: o.photoUrl || o.imageUrl || o.photo || undefined,
        status: this.mapStatus(o.status || o.complianceStatus),
        verified: true,
      }));

      return [{
        source: this.name,
        sourceType: 'scraper' as any,
        confidence: 0.8,
        fetchedAt: localNow(),
        rawResultCount: sexOffenderRecords.length,
        sexOffenderRecords,
      }];
    } catch (err) {
      console.warn('[NsopwSource] Search failed:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  private async searchHtmlFallback(firstName: string, lastName: string): Promise<SourceResult[]> {
    try {
      // Try to search via the HTML form
      const searchUrl = `${NSOPW_BASE}/Search`;
      const formBody = new URLSearchParams();
      formBody.set('FirstName', firstName);
      formBody.set('LastName', lastName);

      const res = await this.fetchWithRetry(searchUrl, {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'text/html',
          'Referer': searchUrl,
        },
        body: formBody.toString(),
      });

      if (!res.ok) {
        console.warn(`[NsopwSource] HTML fallback returned ${res.status}`);
        return [];
      }

      const html = await res.text();
      const records = this.parseHtmlResults(html);

      if (records.length === 0) return [];

      return [{
        source: this.name,
        sourceType: 'scraper' as any,
        confidence: 0.8,
        fetchedAt: localNow(),
        rawResultCount: records.length,
        sexOffenderRecords: records,
      }];
    } catch (err) {
      console.warn('[NsopwSource] HTML fallback failed:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  private parseHtmlResults(html: string): SexOffenderRecord[] {
    const records: SexOffenderRecord[] = [];

    try {
      // Look for offender cards or table rows
      const cardRegex = /<div[^>]*class="[^"]*offender[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
      let cardMatch: RegExpExecArray | null;

      while ((cardMatch = cardRegex.exec(html)) !== null) {
        const card = cardMatch[1];
        const nameMatch = card.match(/class="[^"]*name[^"]*"[^>]*>([\s\S]*?)<\//i);
        const stateMatch = card.match(/(?:jurisdiction|state)[^>]*>([\s\S]*?)<\//i);

        if (nameMatch) {
          records.push({
            source: this.name,
            name: this.stripHtml(nameMatch[1]).trim(),
            registryState: stateMatch ? this.stripHtml(stateMatch[1]).trim() : 'Unknown',
            verified: true,
          });
        }
      }

      // Also try table-based results
      if (records.length === 0) {
        const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
        let rowMatch: RegExpExecArray | null;

        while ((rowMatch = rowRegex.exec(html)) !== null) {
          const row = rowMatch[1];
          const cells: string[] = [];
          const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
          let cellMatch: RegExpExecArray | null;
          while ((cellMatch = cellRegex.exec(row)) !== null) {
            cells.push(this.stripHtml(cellMatch[1]).trim());
          }

          if (cells.length < 2) continue;

          // Look for a name-like cell (at least two words, no numbers)
          const nameCell = cells.find(c => /^[A-Z][a-z]+\s+[A-Z]/i.test(c) && c.length < 60);
          if (!nameCell) continue;

          records.push({
            source: this.name,
            name: nameCell,
            registryState: cells.find(c => /^[A-Z]{2}$/.test(c.trim())) || 'Unknown',
            verified: true,
          });
        }
      }
    } catch (err) {
      console.warn('[NsopwSource] HTML parsing error:', err instanceof Error ? err.message : err);
    }

    return records.slice(0, 25);
  }

  private mapStatus(status: string | undefined): SexOffenderRecord['status'] {
    if (!status) return 'unknown';
    const lower = status.toLowerCase();
    if (lower.includes('compliant') && !lower.includes('non')) return 'compliant';
    if (lower.includes('non-compliant') || lower.includes('noncompliant')) return 'non-compliant';
    if (lower.includes('abscond')) return 'absconded';
    return 'unknown';
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
