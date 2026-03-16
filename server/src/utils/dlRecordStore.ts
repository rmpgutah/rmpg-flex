// ============================================================
// DL Record Store — Local Driver's License Search Engine
// ============================================================
// Structured local storage for DL records captured from MicroBilt API.
// Mirrors the OFAC SDN pattern: every record fetched via API is parsed
// into structured columns for instant local search without API calls.
//
// All data is real — sourced from live MicroBilt DLSearch/GetReport API.
// Once fetched, records are permanently stored locally.
// ============================================================

import { getDb } from '../models/database';
import { localNow } from './timeUtils';
import { escapeLike } from '../middleware/sanitize';

// ── Types ───────────────────────────────────────────────────

export interface DlRecordSubject {
  source: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  full_name: string;
  suffix: string;
  date_of_birth: string;
  gender: string;
  height: string;
  weight: string;
  eye_color: string;
  hair_color: string;
  race: string;
  dl_number: string;
  dl_state: string;
  dl_class: string;
  dl_status: string;
  dl_expiration: string;
  dl_issue_date: string;
  dl_restrictions: string;
  dl_endorsements: string;
  addresses: {
    address: string;
    address2: string;
    city: string;
    state: string;
    postal_code: string;
    country: string;
  }[];
  raw_record?: any;
}

export interface DlSearchResult extends DlRecordSubject {
  id: number;
  match_score: number;
  match_source: 'dl_number' | 'name' | 'local';
  fetched_at: string;
}

// ── Store a DL record from MicroBilt API response ───────────

export function storeDlRecord(subject: DlRecordSubject): number {
  const db = getDb();
  const now = localNow();

  // Skip records without a DL number — can't uniquely identify them
  if (!subject.dl_number || !subject.dl_state) {
    return -1;
  }

  // Check if record already exists
  const existing = db.prepare(
    'SELECT id FROM dl_records WHERE dl_number = ? AND dl_state = ?'
  ).get(subject.dl_number, subject.dl_state) as { id: number } | undefined;

  let recordId: number;

  if (existing) {
    // Update existing record with fresh data
    db.prepare(`
      UPDATE dl_records SET
        dl_class = ?, dl_status = ?, dl_expiration = ?, dl_issue_date = ?,
        dl_restrictions = ?, dl_endorsements = ?,
        first_name = ?, middle_name = ?, last_name = ?, full_name = ?, suffix = ?,
        date_of_birth = ?, gender = ?, height = ?, weight = ?,
        eye_color = ?, hair_color = ?, race = ?,
        raw_record = ?, source = ?, updated_at = ?
      WHERE id = ?
    `).run(
      subject.dl_class, subject.dl_status, subject.dl_expiration, subject.dl_issue_date,
      subject.dl_restrictions, subject.dl_endorsements,
      subject.first_name, subject.middle_name, subject.last_name, subject.full_name, subject.suffix,
      subject.date_of_birth, subject.gender, subject.height, subject.weight,
      subject.eye_color, subject.hair_color, subject.race,
      subject.raw_record ? JSON.stringify(subject.raw_record) : null,
      subject.source || 'MICROBILT', now,
      existing.id
    );
    recordId = existing.id;

    // Replace addresses
    db.prepare('DELETE FROM dl_addresses WHERE dl_record_id = ?').run(recordId);
  } else {
    // Insert new record
    const result = db.prepare(`
      INSERT INTO dl_records (
        dl_number, dl_state, dl_class, dl_status, dl_expiration, dl_issue_date,
        dl_restrictions, dl_endorsements,
        first_name, middle_name, last_name, full_name, suffix,
        date_of_birth, gender, height, weight, eye_color, hair_color, race,
        raw_record, source, fetched_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      subject.dl_number, subject.dl_state, subject.dl_class, subject.dl_status,
      subject.dl_expiration, subject.dl_issue_date,
      subject.dl_restrictions, subject.dl_endorsements,
      subject.first_name, subject.middle_name, subject.last_name, subject.full_name, subject.suffix,
      subject.date_of_birth, subject.gender, subject.height, subject.weight,
      subject.eye_color, subject.hair_color, subject.race,
      subject.raw_record ? JSON.stringify(subject.raw_record) : null,
      subject.source || 'MICROBILT', now, now
    );
    recordId = Number(result.lastInsertRowid);
  }

  // Insert addresses
  if (subject.addresses?.length > 0) {
    const insertAddr = db.prepare(`
      INSERT INTO dl_addresses (dl_record_id, address, address2, city, state, postal_code, country)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const addr of subject.addresses) {
      insertAddr.run(
        recordId, addr.address, addr.address2, addr.city,
        addr.state, addr.postal_code, addr.country || 'US'
      );
    }
  }

  return recordId;
}

// ── Local DL Search Engine ──────────────────────────────────

export function searchDlLocal(query: string, options?: {
  firstName?: string;
  lastName?: string;
  dlNumber?: string;
  state?: string;
  dob?: string;
  limit?: number;
}): DlSearchResult[] {
  const db = getDb();
  const limit = options?.limit || 50;

  // ── Exact DL number lookup (highest priority) ─────────
  if (options?.dlNumber) {
    const params: any[] = [options.dlNumber];
    let sql = 'SELECT * FROM dl_records WHERE dl_number = ?';
    if (options.state) {
      sql += ' AND dl_state = ?';
      params.push(options.state);
    }
    sql += ' LIMIT ?';
    params.push(limit);

    const rows = db.prepare(sql).all(...params) as any[];
    return rows.map(row => enrichDlResult(row, 'dl_number', 10));
  }

  // ── Name-based search ─────────────────────────────────
  let searchName = query.trim();
  if (options?.lastName && options?.firstName) {
    searchName = `${options.lastName} ${options.firstName}`;
  } else if (options?.lastName) {
    searchName = options.lastName;
  }

  if (!searchName) return [];

  const normalized = searchName.toUpperCase().replace(/[^A-Z0-9\s]/g, '');
  const words = normalized.split(/\s+/).filter(w => w.length > 1);
  if (words.length === 0) return [];

  // Build search conditions across name fields
  const conditions: string[] = [];
  const params: any[] = [];

  for (const word of words) {
    conditions.push("(UPPER(last_name) LIKE ? ESCAPE '\\' OR UPPER(first_name) LIKE ? ESCAPE '\\' OR UPPER(full_name) LIKE ? ESCAPE '\\')");
    const escaped = escapeLike(word);
    params.push(`%${escaped}%`, `%${escaped}%`, `%${escaped}%`);
  }

  let sql = `SELECT * FROM dl_records WHERE ${conditions.join(' AND ')}`;

  // Optional state filter
  if (options?.state) {
    sql += ' AND dl_state = ?';
    params.push(options.state);
  }

  // Optional DOB filter
  if (options?.dob) {
    sql += ' AND date_of_birth = ?';
    params.push(options.dob);
  }

  sql += ' ORDER BY updated_at DESC LIMIT ?';
  params.push(limit);

  const rows = db.prepare(sql).all(...params) as any[];

  // Score and enrich results
  const results = rows.map(row => {
    const nameUpper = `${row.last_name || ''} ${row.first_name || ''} ${row.full_name || ''}`.toUpperCase();
    let score = 0;
    for (const w of words) {
      if (nameUpper.includes(w)) score += 1;
    }
    // Exact last name match bonus
    if (options?.lastName && (row.last_name || '').toUpperCase() === options.lastName.toUpperCase()) {
      score += 3;
    }
    // Exact first name match bonus
    if (options?.firstName && (row.first_name || '').toUpperCase() === options.firstName.toUpperCase()) {
      score += 2;
    }
    return enrichDlResult(row, 'name', score);
  });

  results.sort((a, b) => b.match_score - a.match_score);
  return results;
}

// ── Exact DL record lookup ──────────────────────────────────

export function getDlRecord(dlNumber: string, state: string): DlSearchResult | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM dl_records WHERE dl_number = ? AND dl_state = ?'
  ).get(dlNumber, state) as any;

  if (!row) return null;
  return enrichDlResult(row, 'dl_number', 10);
}

// ── Stats ───────────────────────────────────────────────────

export function getDlStats(): { recordCount: number; lastFetchedAt: string | null } {
  const db = getDb();
  const count = (db.prepare('SELECT COUNT(*) as count FROM dl_records').get() as any)?.count || 0;
  const latest = db.prepare('SELECT fetched_at FROM dl_records ORDER BY fetched_at DESC LIMIT 1').get() as any;
  return {
    recordCount: count,
    lastFetchedAt: latest?.fetched_at || null,
  };
}

// ── Enrich a raw DB row with addresses ──────────────────────

function enrichDlResult(row: any, matchSource: 'dl_number' | 'name' | 'local', score: number): DlSearchResult {
  const db = getDb();
  const addresses = db.prepare(
    'SELECT address, address2, city, state, postal_code, country FROM dl_addresses WHERE dl_record_id = ?'
  ).all(row.id) as { address: string; address2: string; city: string; state: string; postal_code: string; country: string }[];

  return {
    id: row.id,
    source: row.source || 'MICROBILT',
    first_name: row.first_name || '',
    middle_name: row.middle_name || '',
    last_name: row.last_name || '',
    full_name: row.full_name || '',
    suffix: row.suffix || '',
    date_of_birth: row.date_of_birth || '',
    gender: row.gender || '',
    height: row.height || '',
    weight: row.weight || '',
    eye_color: row.eye_color || '',
    hair_color: row.hair_color || '',
    race: row.race || '',
    dl_number: row.dl_number || '',
    dl_state: row.dl_state || '',
    dl_class: row.dl_class || '',
    dl_status: row.dl_status || '',
    dl_expiration: row.dl_expiration || '',
    dl_issue_date: row.dl_issue_date || '',
    dl_restrictions: row.dl_restrictions || '',
    dl_endorsements: row.dl_endorsements || '',
    addresses,
    match_score: score,
    match_source: matchSource,
    fetched_at: row.fetched_at || '',
  };
}
