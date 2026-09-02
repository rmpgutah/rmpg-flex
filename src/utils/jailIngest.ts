// ============================================================
// RMPG Flex — Jail booking ingestion + cross-hit (Intel Wave 3a)
// ============================================================
// Normalizes bookings from any source (live adapter or manual paste),
// upserts them into the existing arrest_records table, and cross-hits
// each against known persons — linking to the dossier and raising an
// alert when the booked subject is on a watchlist or has an active
// warrant. Pure parsers/helpers are unit-tested in tests/jailIngest.test.ts.
// ============================================================

import { log } from './logger';
import type { D1Database } from '@cloudflare/workers-types';
import { query, queryFirst, execute } from './db';
import { isRealValue } from './intelMatch';
import { screenPerson } from './intelScreen';
import type { JailBooking } from './jailSources/types';
import { confirmIdentity } from './identityConfirm';

// ── Pure parsing/normalization ───────────────────────────────

// Parse a pasted roster: 'csv' (header row with name/dob/booking_date/charges
// columns, order-flexible) or 'lines' ("Name - charges" per line).
export function parseRosterText(text: string, format: 'csv' | 'lines'): Partial<JailBooking>[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  if (format === 'lines') {
    return lines.map((l) => {
      const [name, ...rest] = l.split(/\s+-\s+/);
      return { full_name: name.trim(), charges: rest.join(' - ').trim() || null };
    });
  }
  // CSV
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const idx = (names: string[]) => header.findIndex((h) => names.includes(h));
  const iName = idx(['name', 'full_name', 'subject']);
  const iFirst = idx(['first', 'first_name']);
  const iLast = idx(['last', 'last_name']);
  const iDob = idx(['dob', 'date_of_birth', 'birthdate']);
  const iBooked = idx(['booking_date', 'booked', 'date', 'arrest_date']);
  const iCharges = idx(['charges', 'charge', 'offense', 'offenses']);
  const out: Partial<JailBooking>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim());
    const row: Partial<JailBooking> = {
      full_name: iName >= 0 ? cols[iName] : undefined,
      first_name: iFirst >= 0 ? cols[iFirst] : undefined,
      last_name: iLast >= 0 ? cols[iLast] : undefined,
      dob: iDob >= 0 ? cols[iDob] : undefined,
      booking_date: iBooked >= 0 ? cols[iBooked] : undefined,
      charges: iCharges >= 0 ? cols[iCharges] : undefined,
    };
    if (isRealValue(row.full_name) || isRealValue(row.last_name)) out.push(row);
  }
  return out;
}

export function normalizeBooking(b: Partial<JailBooking> & { source_key: string; booking_id: string }): JailBooking {
  let first = isRealValue(b.first_name) ? String(b.first_name).trim() : '';
  let last = isRealValue(b.last_name) ? String(b.last_name).trim() : '';
  let middle = isRealValue(b.middle_name) ? String(b.middle_name).trim() : '';
  if ((!first || !last) && isRealValue(b.full_name)) {
    const parts = String(b.full_name).trim().split(/\s+/);
    if (parts.length === 1) { last = last || parts[0]; }
    else { first = first || parts[0]; last = last || parts[parts.length - 1]; middle = middle || parts.slice(1, -1).join(' '); }
  }
  return {
    source_key: b.source_key,
    booking_id: b.booking_id,
    full_name: isRealValue(b.full_name) ? String(b.full_name) : `${first} ${last}`.trim(),
    first_name: first || null,
    last_name: last || null,
    middle_name: middle || null,
    dob: isRealValue(b.dob) ? String(b.dob) : null,
    booking_date: isRealValue(b.booking_date) ? String(b.booking_date) : null,
    charges: isRealValue(b.charges) ? String(b.charges) : null,
    county: isRealValue(b.county) ? String(b.county) : null,
    agency: isRealValue(b.agency) ? String(b.agency) : null,
    mugshot_url: isRealValue(b.mugshot_url) ? String(b.mugshot_url) : null,
    detail_url: isRealValue(b.detail_url) ? String(b.detail_url) : null,
  };
}

export function bookingDedupeId(sourceKey: string, bookingId: string, fullName?: string, bookingDate?: string): string {
  if (isRealValue(bookingId)) return `${sourceKey}:${bookingId}`;
  return `${sourceKey}:${(fullName || '').toLowerCase().trim()}:${bookingDate || ''}`;
}

// ── Ingestion + cross-hit (DB-bound) ─────────────────────────

export interface IngestResult { ingested: number; matched: number; alerts: number }

async function crossHit(db: D1Database, arrestId: number, b: JailBooking): Promise<{ matched: boolean; alerted: boolean }> {
  if (!isRealValue(b.last_name)) return { matched: false, alerted: false };
  let person: any = null;
  try {
    const candidates = await query<any>(db,
      'SELECT id, first_name, last_name, dob, city, state FROM persons WHERE LOWER(last_name) = LOWER(?) AND LOWER(first_name) = LOWER(?) LIMIT 25',
      b.last_name, b.first_name || '');
    const seed = { first: b.first_name, last: b.last_name, dob: b.dob };
    const confirmed = (candidates ?? []).filter((p) => confirmIdentity(seed, {
      first: p.first_name, last: p.last_name, dob: p.dob, city: p.city, state: p.state,
    }).matched);
    person = confirmed.length === 1 ? confirmed[0] : null;
  } catch (err: any) { console.error('[jail-ingest] person match failed:', err?.message); }
  if (!person) return { matched: false, alerted: false };

  // Link the booking to the person so it shows on the dossier timeline.
  try {
    await execute(db,
      `INSERT INTO arrest_cross_links (arrest_record_id, linked_type, linked_id, match_type, match_confidence, created_at)
       VALUES (?, 'person', ?, ?, ?, datetime('now'))`,
      arrestId, person.id, b.dob ? 'name_dob' : 'name', b.dob ? 0.9 : 0.6);
  } catch (err: any) { console.error('[jail-ingest] cross-link failed:', err?.message); }

  // Alert only when the booked subject is already of interest.
  let alerted = false;
  try {
    const hits = (await screenPerson(db, person.id)).filter((h) => h.severity === 'critical');
    if (hits.length) {
      const dedup = `jail_booking:${arrestId}`;
      const dup = await queryFirst<any>(db, 'SELECT id FROM anomaly_alerts WHERE dedup_key = ?', dedup);
      if (!dup) {
        await execute(db,
          `INSERT INTO anomaly_alerts (alert_type, severity, title, details, dedup_key, created_at, updated_at)
           VALUES ('jail_booking', 'critical', ?, ?, ?, datetime('now'), datetime('now'))`,
          `BOOKED + WANTED: ${b.full_name}`,
          `Jail booking${b.county ? ` (${b.county})` : ''} matches a flagged subject — ${hits.map((h) => h.detail).join('; ')}`,
          dedup);
        alerted = true;
      }
    }
  } catch (err: any) { console.error('[jail-ingest] screen failed:', err?.message); }
  return { matched: true, alerted };
}

export async function ingestBookings(
  db: D1Database, bookings: JailBooking[], entrySource = 'roster_scrape', enteredBy: number | null = null,
): Promise<IngestResult> {
  let ingested = 0, matched = 0, alerts = 0;
  for (const raw of bookings) {
    try {
      const b = normalizeBooking(raw);
      const dedupeId = bookingDedupeId(b.source_key, b.booking_id, b.full_name || '', b.booking_date || '');
      let arrestId: number;
      const existing = await queryFirst<any>(db, 'SELECT id FROM arrest_records WHERE jailbase_id = ?', dedupeId);
      if (existing) {
        arrestId = existing.id;
        await execute(db,
          `UPDATE arrest_records SET charges = COALESCE(?, charges), status = 'active', updated_at = datetime('now') WHERE id = ?`,
          b.charges, arrestId);
      } else {
        const r = await execute(db,
          `INSERT INTO arrest_records
             (jailbase_id, source_id, source_name, full_name, first_name, last_name, middle_name,
              date_of_birth, booking_date, charges, county, mugshot_url, details_url, entry_source, entered_by, status, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'))`,
          dedupeId, b.source_key, b.source_key, b.full_name, b.first_name, b.last_name, b.middle_name,
          b.dob, b.booking_date, b.charges, b.county, b.mugshot_url, b.detail_url, entrySource, enteredBy);
        arrestId = r.meta.last_row_id as number;
        ingested++;
      }
      const xh = await crossHit(db, arrestId, b);
      if (xh.matched) matched++;
      if (xh.alerted) alerts++;
    } catch (err: any) {
      console.error('[jail-ingest] row failed:', err?.message);
    }
  }
  return { ingested, matched, alerts };
}
