// ============================================================
// Skip Tracker 3.5 — Arrest Records Adapter
// ============================================================
// Searches the local arrest_records table (synced from JailBase
// and county booking feeds). Always configured, zero cost.

import { BaseDataSource } from './base';
import { SearchQuery, SourceCategory, SourceResult, CourtRecord, CustodyRecord } from '../types';
import { getDb } from '../../../models/database';
import { localNow } from '../../../utils/timeUtils';

export default class ArrestsSource extends BaseDataSource {
  readonly name = 'arrests';
  readonly displayName = 'Arrest Records';
  readonly category: SourceCategory = 'court';
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

      const fullName = query.name || [query.firstName, query.lastName].filter(Boolean).join(' ');
      const firstName = query.firstName || '';
      const lastName = query.lastName || '';

      if (!fullName && !firstName && !lastName) return [];

      let sql = 'SELECT * FROM arrest_records WHERE 1=0';
      const params: string[] = [];

      if (fullName) {
        sql += ' OR full_name LIKE ?';
        params.push(`%${fullName}%`);
      }
      if (lastName) {
        sql += ' OR last_name LIKE ?';
        params.push(`%${lastName}%`);
      }
      if (firstName) {
        sql += ' OR first_name LIKE ?';
        params.push(`%${firstName}%`);
      }

      sql += ' ORDER BY booking_date DESC LIMIT 50';

      const rows = db.prepare(sql).all(...params) as any[];

      if (rows.length === 0) return [];

      return rows.map(row => this.mapArrestRow(row));
    } catch (err) {
      console.error('[ArrestsSource] Search error:', err);
      return [];
    }
  }

  private mapArrestRow(row: any): SourceResult {
    const result: SourceResult = {
      source: this.name,
      sourceType: 'court',
      confidence: 0.7,
      fetchedAt: localNow(),
      rawResultCount: 1,
    };

    // Name
    const first = row.first_name || '';
    const last = row.last_name || '';
    const full = row.full_name || [first, last].filter(Boolean).join(' ');
    if (full) {
      result.names = [{
        source: this.name,
        full,
        first: first || undefined,
        last: last || undefined,
      }];
    }

    // DOB
    if (row.date_of_birth) {
      result.dobs = [{ source: this.name, dob: row.date_of_birth }];
    }

    // Parse charges
    let chargesArr: string[] = [];
    if (row.charges) {
      try {
        const parsed = JSON.parse(row.charges);
        if (Array.isArray(parsed)) {
          chargesArr = parsed.map((c: any) => typeof c === 'string' ? c : c.description || c.charge || String(c));
        } else {
          chargesArr = [String(row.charges)];
        }
      } catch {
        // Charges stored as plain text
        chargesArr = row.charges.split(/[;\n]/).map((c: string) => c.trim()).filter(Boolean);
      }
    }

    // Court record
    const courtRecord: CourtRecord = {
      source: this.name,
      caseNumber: row.booking_number || row.jailbase_id || `ARR-${row.id}`,
      court: row.county ? `${row.county} County` : 'Unknown',
      state: row.state || 'UT',
      county: row.county || undefined,
      caseType: 'criminal',
      filingDate: row.booking_date || undefined,
      charges: chargesArr.length > 0 ? chargesArr : undefined,
      status: row.status === 'active' ? 'open' : 'closed',
    };
    result.courtRecords = [courtRecord];

    // Custody record
    const custodyRecord: CustodyRecord = {
      source: this.name,
      facility: row.source_name || row.county ? `${row.county || 'Unknown'} County Jail` : 'Unknown Facility',
      facilityState: row.state || 'UT',
      facilityType: 'jail',
      inmateId: row.jailbase_id || undefined,
      bookingDate: row.booking_date || undefined,
      releaseDate: row.release_date || undefined,
      charges: chargesArr.length > 0 ? chargesArr : undefined,
      status: row.release_date ? 'released' : (row.status === 'active' ? 'in_custody' : 'unknown'),
    };
    result.custodyRecords = [custodyRecord];

    // Mugshot photo
    if (row.mugshot_url) {
      result.photos = [{
        source: this.name,
        url: row.mugshot_url,
        description: 'Booking photo',
      }];
    }

    return result;
  }
}
