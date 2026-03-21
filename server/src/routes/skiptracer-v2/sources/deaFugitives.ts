// ============================================================
// Skip Tracer v2 — DEA Most Wanted Fugitives Adapter
// ============================================================
// Scrapes the DEA's fugitives page for JSON-LD or structured
// data. No auth required. Free public source.

import { BaseDataSource } from './base';
import { SearchQuery, SourceCategory, SourceResult, WatchlistFlag } from '../types';
import { localNow } from '../../../utils/timeUtils';

const DEA_URL = 'https://www.dea.gov/fugitives';
const USER_AGENT = 'RMPG-Flex/1.0 (Law Enforcement Skip Trace)';

export default class DeaFugitivesSource extends BaseDataSource {
  readonly name = 'dea_fugitives';
  readonly displayName = 'DEA Most Wanted Fugitives';
  readonly category: SourceCategory = 'registry';
  readonly costPerLookup = 0;

  protected maxRequestsPerMinute = 3;

  isConfigured(): boolean {
    return true;
  }

  isEnabled(): boolean {
    return true;
  }

  protected async doSearch(query: SearchQuery): Promise<SourceResult[]> {
    try {
      const name = query.name || [query.firstName, query.lastName].filter(Boolean).join(' ');
      if (!name || name.length < 2) return [];

      const res = await this.fetchWithRetry(DEA_URL, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html',
        },
      });

      if (!res.ok) {
        console.warn(`[DeaFugitivesSource] Page returned ${res.status}`);
        return [];
      }

      const html = await res.text();

      // Try to extract JSON-LD structured data first
      const jsonLdResults = this.parseJsonLd(html, name);
      if (jsonLdResults.length > 0) return jsonLdResults;

      // Fall back to HTML scraping
      return this.parseHtml(html, name);
    } catch (err) {
      console.error('[DeaFugitivesSource] Search error:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  // ============================================================
  // JSON-LD parsing
  // ============================================================

  private parseJsonLd(html: string, searchName: string): SourceResult[] {
    try {
      const jsonLdRegex = /<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
      const searchLower = searchName.toLowerCase();
      const results: SourceResult[] = [];
      let match: RegExpExecArray | null;

      while ((match = jsonLdRegex.exec(html)) !== null) {
        try {
          const data = JSON.parse(match[1]);
          const items = Array.isArray(data) ? data : data['@graph'] || [data];

          for (const item of items) {
            if (item['@type'] !== 'Person') continue;

            const fullName = item.name || '';
            if (!fullName.toLowerCase().includes(searchLower) &&
                !searchLower.includes(fullName.toLowerCase())) continue;

            const flags: WatchlistFlag[] = [{
              source: this.name,
              listName: 'DEA Most Wanted Fugitives',
              matchType: 'partial',
              matchScore: 0.5,
              category: 'Drug Enforcement',
              details: item.description || undefined,
            }];

            const result: SourceResult = {
              source: this.name,
              sourceType: this.category,
              confidence: 0.5,
              fetchedAt: localNow(),
              rawResultCount: 1,
              watchlistFlags: flags,
              names: [{
                source: this.name,
                full: fullName,
              }],
            };

            results.push(result);
          }
        } catch {
          // Malformed JSON-LD block, skip
        }
      }

      return results;
    } catch {
      return [];
    }
  }

  // ============================================================
  // HTML scraping fallback
  // ============================================================

  private parseHtml(html: string, searchName: string): SourceResult[] {
    const results: SourceResult[] = [];
    const searchLower = searchName.toLowerCase();

    try {
      // Look for fugitive entries — DEA typically uses cards or list items
      // with names in heading tags or strong tags
      const nameRegex = /<(?:h[2-4]|strong|a)[^>]*class="[^"]*(?:title|name|fugitive)[^"]*"[^>]*>([\s\S]*?)<\/(?:h[2-4]|strong|a)>/gi;
      let nameMatch: RegExpExecArray | null;

      while ((nameMatch = nameRegex.exec(html)) !== null) {
        const rawName = this.stripHtml(nameMatch[1]).trim();
        if (!rawName || rawName.length < 3) continue;

        // Check if this name matches the search
        if (!rawName.toLowerCase().includes(searchLower) &&
            !searchLower.includes(rawName.toLowerCase())) continue;

        const flags: WatchlistFlag[] = [{
          source: this.name,
          listName: 'DEA Most Wanted Fugitives',
          matchType: 'partial',
          matchScore: 0.5,
          category: 'Drug Enforcement',
        }];

        results.push({
          source: this.name,
          sourceType: this.category,
          confidence: 0.5,
          fetchedAt: localNow(),
          rawResultCount: 1,
          watchlistFlags: flags,
          names: [{
            source: this.name,
            full: rawName,
          }],
        });
      }

      // Also try generic approach: look for name-like text near "fugitive"
      if (results.length === 0) {
        const genericRegex = /<(?:div|li|article)[^>]*>([\s\S]*?)<\/(?:div|li|article)>/gi;
        let blockMatch: RegExpExecArray | null;

        while ((blockMatch = genericRegex.exec(html)) !== null) {
          const block = blockMatch[1];
          const blockText = this.stripHtml(block).trim();

          if (blockText.toLowerCase().includes(searchLower) && blockText.length < 500) {
            const lines = blockText.split(/\n/).map(l => l.trim()).filter(l => l.length > 2 && l.length < 80);
            const nameLine = lines.find(l => l.toLowerCase().includes(searchLower));

            if (nameLine) {
              results.push({
                source: this.name,
                sourceType: this.category,
                confidence: 0.5,
                fetchedAt: localNow(),
                rawResultCount: 1,
                watchlistFlags: [{
                  source: this.name,
                  listName: 'DEA Most Wanted Fugitives',
                  matchType: 'partial',
                  matchScore: 0.4,
                  category: 'Drug Enforcement',
                }],
                names: [{
                  source: this.name,
                  full: nameLine,
                }],
              });
              break;
            }
          }
        }
      }
    } catch (err) {
      console.warn('[DeaFugitivesSource] HTML parsing error:', err instanceof Error ? err.message : err);
    }

    return results.slice(0, 10);
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
