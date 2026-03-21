// ============================================================
// Skip Tracer v2 — Local Database Adapter
// ============================================================
// Searches the local persons table for matching records.
// Always configured, always enabled, zero cost.

import { BaseDataSource } from './base';
import { SearchQuery, SourceCategory, SourceResult } from '../types';
import { getDb } from '../../../models/database';
import { localNow } from '../../../utils/timeUtils';

export default class LocalDbSource extends BaseDataSource {
  readonly name = 'local_db';
  readonly displayName = 'Local Records';
  readonly category: SourceCategory = 'people';
  readonly costPerLookup = 0;
  readonly priority = 0; // Search first — free and instant

  isConfigured(): boolean {
    return true;
  }

  isEnabled(): boolean {
    return true;
  }

  protected async doSearch(query: SearchQuery): Promise<SourceResult[]> {
    try {
      const db = getDb();
      const results: SourceResult[] = [];

      // Build search term from query
      const fullName = query.name || [query.firstName, query.lastName].filter(Boolean).join(' ');
      const firstName = query.firstName || '';
      const lastName = query.lastName || '';

      // ── Search persons table ──
      if (fullName || firstName || lastName || query.phone || query.email) {
        let sql = 'SELECT * FROM persons WHERE 1=0';
        const params: string[] = [];

        if (fullName) {
          sql += " OR (first_name || ' ' || last_name) LIKE ?";
          params.push(`%${fullName}%`);
        }
        if (firstName) {
          sql += ' OR first_name LIKE ?';
          params.push(`%${firstName}%`);
        }
        if (lastName) {
          sql += ' OR last_name LIKE ?';
          params.push(`%${lastName}%`);
        }
        if (query.phone) {
          sql += ' OR phone LIKE ?';
          params.push(`%${query.phone}%`);
        }
        if (query.email) {
          sql += ' OR email LIKE ?';
          params.push(`%${query.email}%`);
        }

        sql += ' LIMIT 50';

        const rows = db.prepare(sql).all(...params) as any[];

        for (const row of rows) {
          results.push(this.mapPersonRow(row));
        }
      }

      // ── Search people_index table (skip tracer accumulated data) ──
      if (fullName || firstName || lastName || query.phone || query.email) {
        let piSql = 'SELECT * FROM people_index WHERE 1=0';
        const piParams: string[] = [];

        if (fullName) {
          piSql += ' OR full_name LIKE ?';
          piParams.push(`%${fullName}%`);
        }
        if (firstName) {
          piSql += ' OR first_name LIKE ?';
          piParams.push(`%${firstName}%`);
        }
        if (lastName) {
          piSql += ' OR last_name LIKE ?';
          piParams.push(`%${lastName}%`);
        }
        if (query.phone) {
          piSql += ' OR phones LIKE ?';
          piParams.push(`%${query.phone}%`);
        }
        if (query.email) {
          piSql += ' OR emails LIKE ?';
          piParams.push(`%${query.email}%`);
        }

        piSql += ' LIMIT 50';

        try {
          const piRows = db.prepare(piSql).all(...piParams) as any[];
          for (const row of piRows) {
            results.push(this.mapPeopleIndexRow(row));
          }
        } catch {
          // people_index table may not exist yet — skip silently
        }
      }

      return results;
    } catch (err) {
      console.error('[LocalDbSource] Search error:', err);
      return [];
    }
  }

  private mapPeopleIndexRow(row: any): SourceResult {
    const result: SourceResult = {
      source: this.name,
      sourceType: 'people',
      confidence: 0.85,
      fetchedAt: localNow(),
      rawResultCount: 1,
    };

    if (row.full_name || row.first_name || row.last_name) {
      result.names = [{
        source: this.name,
        full: row.full_name || [row.first_name, row.last_name].filter(Boolean).join(' '),
        first: row.first_name || undefined,
        middle: row.middle_name || undefined,
        last: row.last_name || undefined,
      }];
    }

    if (row.dob) {
      result.dobs = [{ source: this.name, dob: row.dob }];
    }

    // Parse JSON array fields
    try {
      const phones = JSON.parse(row.phones || '[]');
      if (Array.isArray(phones) && phones.length > 0) {
        result.phones = phones.map((ph: any) => ({
          source: this.name,
          number: typeof ph === 'string' ? ph : (ph.number || ph.phone || ''),
          type: ph.type || undefined,
        }));
      }
    } catch { /* skip */ }

    try {
      const emails = JSON.parse(row.emails || '[]');
      if (Array.isArray(emails) && emails.length > 0) {
        result.emails = emails.map((em: any) => ({
          source: this.name,
          address: typeof em === 'string' ? em : (em.address || em.email || ''),
        }));
      }
    } catch { /* skip */ }

    try {
      const addresses = JSON.parse(row.addresses || '[]');
      if (Array.isArray(addresses) && addresses.length > 0) {
        result.addresses = addresses.map((a: any) => ({
          source: this.name,
          street: a.street || a.address || '',
          city: a.city || '',
          state: a.state || '',
          zip: a.zip || '',
        }));
      }
    } catch { /* skip */ }

    if (row.photo_url) {
      result.photos = [{ source: this.name, url: row.photo_url, description: 'People index photo' }];
    }

    return result;
  }

  private mapPersonRow(row: any): SourceResult {
    const result: SourceResult = {
      source: this.name,
      sourceType: 'people',
      confidence: 0.9, // Exact local match
      fetchedAt: localNow(),
      rawResultCount: 1,
    };

    // Name
    if (row.first_name || row.last_name) {
      result.names = [{
        source: this.name,
        full: [row.first_name, row.last_name].filter(Boolean).join(' '),
        first: row.first_name || undefined,
        last: row.last_name || undefined,
      }];
    }

    // DOB
    if (row.dob) {
      result.dobs = [{ source: this.name, dob: row.dob }];
    }

    // Address
    if (row.address) {
      result.addresses = [{
        source: this.name,
        street: row.address,
        city: '',
        state: '',
        zip: '',
      }];
    }

    // Phone
    if (row.phone) {
      result.phones = [{
        source: this.name,
        number: row.phone,
      }];
    }

    // Email
    if (row.email) {
      result.emails = [{
        source: this.name,
        address: row.email,
      }];
    }

    // Photo
    if (row.photo_url) {
      result.photos = [{
        source: this.name,
        url: row.photo_url,
        description: 'Local records photo',
      }];
    }

    return result;
  }
}
