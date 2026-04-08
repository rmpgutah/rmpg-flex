// ============================================================
// Skip Tracker 3.5 — OFAC Sanctions Adapter
// ============================================================
// Searches the locally-synced OFAC SDN entries and aliases.
// Data is synced daily from treasury.gov by ofacScraper.ts.
// Always configured (local data), zero cost.

import { BaseDataSource } from './base';
import { SearchQuery, SourceCategory, SourceResult, WatchlistFlag } from '../types';
import { getDb } from '../../../models/database';
import { localNow } from '../../../utils/timeUtils';

export default class OfacSource extends BaseDataSource {
  readonly name = 'ofac';
  readonly displayName = 'OFAC Sanctions';
  readonly category: SourceCategory = 'registry';
  readonly costPerLookup = 0;

  isConfigured(): boolean {
    return true;
  }

  isEnabled(): boolean {
    return true;
  }

  protected async doSearch(query: SearchQuery): Promise<SourceResult[]> {
    try {
      const db = getDb();

      // Build search name from query
      const fullName = query.name || [query.firstName, query.lastName].filter(Boolean).join(' ');
      if (!fullName || fullName.length < 2) return [];

      const searchTerm = `%${fullName.replace(/[%_\\]/g, '\\$&')}%`;

      // Search SDN entries by name and aliases
      const entries = db.prepare(`
        SELECT e.*,
          GROUP_CONCAT(DISTINCT a.alt_name) as alias_list
        FROM ofac_sdn_entries e
        LEFT JOIN ofac_sdn_aliases a ON e.ent_num = a.ent_num
        WHERE e.sdn_name LIKE ? ESCAPE '\\' OR a.alt_name LIKE ? ESCAPE '\\'
        GROUP BY e.id
        ORDER BY e.sdn_name
        LIMIT 25
      `).all(searchTerm, searchTerm) as any[];

      if (entries.length === 0) return [];

      return entries.map(entry => this.mapEntry(entry));
    } catch (err) {
      console.error('[OfacSource] Search error:', err);
      return [];
    }
  }

  private mapEntry(entry: any): SourceResult {
    const flags: WatchlistFlag[] = [{
      source: this.name,
      listName: 'OFAC SDN',
      matchType: 'partial',
      matchScore: 0.8,
      category: entry.sdn_type || 'Individual',
      details: [
        entry.program ? `Program: ${entry.program}` : null,
        entry.title ? `Title: ${entry.title}` : null,
        entry.remarks ? `Remarks: ${entry.remarks}` : null,
      ].filter(Boolean).join('; ') || undefined,
      lastUpdated: entry.updated_at || undefined,
    }];

    // Add alias-based flags
    if (entry.alias_list) {
      const aliases = entry.alias_list.split(',').map((a: string) => a.trim()).filter(Boolean);
      for (const alias of aliases) {
        flags.push({
          source: this.name,
          listName: 'OFAC SDN (Alias)',
          matchType: 'alias',
          matchScore: 0.6,
          category: entry.sdn_type || 'Individual',
          details: `Alias: ${alias}`,
        });
      }
    }

    const result: SourceResult = {
      source: this.name,
      sourceType: 'registry',
      confidence: 0.8,
      fetchedAt: localNow(),
      rawResultCount: 1,
      watchlistFlags: flags,
    };

    // Parse name into parts if possible
    const name = entry.sdn_name || '';
    if (name) {
      // SDN names are typically "LAST, First" format
      const commaIdx = name.indexOf(',');
      if (commaIdx > 0) {
        result.names = [{
          source: this.name,
          full: name,
          last: name.substring(0, commaIdx).trim(),
          first: name.substring(commaIdx + 1).trim(),
        }];
      } else {
        result.names = [{
          source: this.name,
          full: name,
        }];
      }
    }

    return result;
  }
}
