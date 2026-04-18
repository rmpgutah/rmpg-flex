// ============================================================
// Skip Tracker 3.5 — FBI Most Wanted Adapter
// ============================================================
// Searches the FBI's public Most Wanted API. No auth required.
// Completely free, always available.
// API docs: https://www.fbi.gov/wanted/api
// Base: https://api.fbi.gov/wanted/v1/list

import sanitizeHtml from 'sanitize-html';
import { BaseDataSource } from './base';
import { SearchQuery, SourceCategory, SourceResult, WatchlistFlag } from '../types';
import { localNow } from '../../../utils/timeUtils';

const API_BASE = 'https://api.fbi.gov/wanted/v1/list';

interface FbiWantedItem {
  uid?: string;
  title?: string;
  description?: string;
  subjects?: string[];
  aliases?: string[];
  dates_of_birth_used?: string[];
  race?: string;
  race_raw?: string;
  sex?: string;
  hair?: string;
  hair_raw?: string;
  eyes?: string;
  eyes_raw?: string;
  height_min?: number;
  height_max?: number;
  weight?: string;
  weight_min?: number;
  weight_max?: number;
  scars_and_marks?: string;
  nationality?: string;
  place_of_birth?: string;
  languages?: string[];
  occupations?: string[];
  ncic?: string;
  reward_text?: string;
  warning_message?: string;
  caution?: string;
  remarks?: string;
  poster_classification?: string;
  person_classification?: string;
  field_offices?: string[];
  status?: string;
  url?: string;
  path?: string;
  images?: Array<{ original?: string; large?: string; thumb?: string; caption?: string }>;
  files?: Array<{ url?: string; name?: string }>;
  modified?: string;
  publication?: string;
  age_min?: number;
  age_max?: number;
  age_range?: string;
}

export default class FbiWantedSource extends BaseDataSource {
  readonly name = 'fbi_wanted';
  readonly displayName = 'FBI Most Wanted';
  readonly category: SourceCategory = 'registry';
  readonly costPerLookup = 0;

  isConfigured(): boolean {
    return true; // Public API — always available
  }

  isEnabled(): boolean {
    return true;
  }

  protected async doSearch(query: SearchQuery): Promise<SourceResult[]> {
    try {
      const name = query.name || [query.firstName, query.lastName].filter(Boolean).join(' ');
      if (!name || name.length < 2) return [];

      const url = `${API_BASE}?title=${encodeURIComponent(name)}&pageSize=20`;
      const res = await this.fetchWithRetry(url, {
        headers: { 'Accept': 'application/json' },
      });

      if (!res.ok) {
        console.error(`[FbiWantedSource] API returned ${res.status}`);
        return [];
      }

      const data = await res.json() as { total?: number; items?: FbiWantedItem[] };
      if (!data.items || data.items.length === 0) return [];

      return data.items.map(item => {
        // Determine match confidence based on name similarity
        const titleLower = (item.title || '').toLowerCase();
        const queryLower = name.toLowerCase();
        const exactMatch = titleLower === queryLower;
        const containsMatch = titleLower.includes(queryLower) || queryLower.includes(titleLower);
        const confidence = exactMatch ? 0.95 : containsMatch ? 0.7 : 0.4;

        // Build watchlist flags
        const flags: WatchlistFlag[] = [{
          source: this.name,
          listName: item.poster_classification === 'ten' ? 'FBI Ten Most Wanted' : 'FBI Wanted',
          matchType: exactMatch ? 'exact' : containsMatch ? 'partial' : 'fuzzy',
          matchScore: confidence,
          category: item.subjects?.join(', ') || undefined,
          details: stripHtml(item.warning_message || item.caution || item.description || ''),
        }];

        const result: SourceResult = {
          source: this.name,
          sourceType: this.category,
          confidence,
          fetchedAt: localNow(),
          rawResultCount: data.total || data.items!.length,
          watchlistFlags: flags,
        };

        // Name + aliases
        if (item.title) {
          result.names = [{ source: this.name, full: item.title }];
        }
        if (item.aliases && item.aliases.length > 0) {
          const aliasNames = item.aliases.map(alias => ({ source: this.name, full: alias }));
          result.names = [...(result.names || []), ...aliasNames];
        }

        // Date of birth
        if (item.dates_of_birth_used && item.dates_of_birth_used.length > 0) {
          result.dobs = item.dates_of_birth_used.map(dob => ({ source: this.name, dob }));
        }

        // Photo
        if (item.images && item.images.length > 0) {
          result.photos = item.images
            .filter(img => img.original || img.large || img.thumb)
            .slice(0, 3)
            .map(img => ({
              source: this.name,
              url: img.original || img.large || img.thumb || '',
              description: img.caption || 'FBI photo',
            }));
        }

        // Physical description
        const physDesc: string[] = [];
        if (item.sex) physDesc.push(`Sex: ${item.sex}`);
        if (item.race_raw || item.race) physDesc.push(`Race: ${item.race_raw || item.race}`);
        if (item.hair_raw || item.hair) physDesc.push(`Hair: ${item.hair_raw || item.hair}`);
        if (item.eyes_raw || item.eyes) physDesc.push(`Eyes: ${item.eyes_raw || item.eyes}`);
        if (item.height_min) {
          const ft = Math.floor(item.height_min / 12);
          const inch = item.height_min % 12;
          const hMax = item.height_max && item.height_max !== item.height_min
            ? ` to ${Math.floor(item.height_max / 12)}'${item.height_max % 12}"`
            : '';
          physDesc.push(`Height: ${ft}'${inch}"${hMax}`);
        }
        if (item.weight) physDesc.push(`Weight: ${item.weight}`);
        if (item.scars_and_marks) physDesc.push(`Scars/Marks: ${item.scars_and_marks}`);
        if (item.nationality) physDesc.push(`Nationality: ${item.nationality}`);
        if (item.place_of_birth) physDesc.push(`Place of Birth: ${item.place_of_birth}`);
        if (item.languages && item.languages.length > 0) physDesc.push(`Languages: ${item.languages.join(', ')}`);
        if (item.occupations && item.occupations.length > 0) physDesc.push(`Occupations: ${item.occupations.join(', ')}`);
        if (physDesc.length > 0) {
          result.notes = [...(result.notes || []), {
            source: this.name,
            text: physDesc.join(' | '),
            category: 'physical_description',
          }];
        }

        // Warning / caution
        if (item.warning_message) {
          result.notes = [...(result.notes || []), {
            source: this.name,
            text: item.warning_message,
            category: 'warning',
          }];
        }

        // Reward
        if (item.reward_text) {
          result.notes = [...(result.notes || []), {
            source: this.name,
            text: stripHtml(item.reward_text),
            category: 'reward',
          }];
        }

        // Caution narrative
        if (item.caution) {
          result.notes = [...(result.notes || []), {
            source: this.name,
            text: stripHtml(item.caution),
            category: 'caution',
          }];
        }

        // NCIC number
        if (item.ncic) {
          result.notes = [...(result.notes || []), {
            source: this.name,
            text: `NCIC: ${item.ncic}`,
            category: 'identifier',
          }];
        }

        // FBI URL
        if (item.url) {
          result.links = [...(result.links || []), {
            source: this.name,
            url: item.url,
            label: 'FBI Wanted Poster',
          }];
        }

        // PDF poster
        if (item.files && item.files.length > 0) {
          for (const f of item.files) {
            if (f.url) {
              result.links = [...(result.links || []), {
                source: this.name,
                url: f.url,
                label: f.name || 'FBI Poster PDF',
              }];
            }
          }
        }

        return result;
      });
    } catch (err) {
      console.error('[FbiWantedSource] Search error:', err);
      return [];
    }
  }
}

/** Strip HTML tags from FBI API caution/remarks fields.
 *  Uses sanitize-html (handles nested-tag bypass + entity decoding) to avoid
 *  CodeQL js/double-escaping (#2749) and js/incomplete-multi-character-sanitization
 *  (#2750) — the prior regex chain re-decoded entities inconsistently. */
function stripHtml(html: string): string {
  const stripped = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} });
  return stripped.replace(/\s+/g, ' ').trim();
}
