// ============================================================
// Skip Tracker 3.5 — People Index Background Sync
// ============================================================
// Saves resolved dossier profiles into the `people_index` table
// for cross-reference and future lookups. Called automatically
// after each search in the orchestrator.

import { getDb } from '../../models/database';
import { localNow } from '../../utils/timeUtils';
import type { DossierProfile } from './types';

/**
 * Upsert a resolved profile into the people_index table.
 * - If a record with matching full_name + dob exists: merge new data
 * - Otherwise: insert a new record
 */
export function saveToPeopleIndex(profile: DossierProfile): void {
  const db = getDb();
  const fullName = [profile.firstName, profile.middleName, profile.lastName, profile.suffix]
    .filter(Boolean)
    .join(' ')
    .trim();

  if (!fullName) return;

  // Look for existing record by name + dob
  let existing: any = null;
  if (profile.dob) {
    existing = db.prepare(
      'SELECT * FROM people_index WHERE full_name = ? AND dob = ?'
    ).get(fullName, profile.dob);
  }
  if (!existing) {
    existing = db.prepare(
      'SELECT * FROM people_index WHERE full_name = ? AND (dob IS NULL OR dob = ?)'
    ).get(fullName, profile.dob || null);
  }

  const now = localNow();

  if (existing) {
    // Merge: combine arrays, deduplicate
    const merged = {
      aliases: mergeJsonArrays(existing.aliases, profile.aliases || []),
      addresses: mergeJsonArrays(existing.addresses, profile.addresses || []),
      phones: mergeJsonArrays(existing.phones, profile.phones || []),
      emails: mergeJsonArrays(existing.emails, profile.emails || []),
      social_profiles: mergeJsonArrays(existing.social_profiles, profile.socialProfiles || []),
      associates: mergeJsonArrays(existing.associates, profile.associates || []),
      court_records: mergeJsonArrays(existing.court_records, profile.courtRecords || []),
      property_records: mergeJsonArrays(existing.property_records, profile.propertyRecords || []),
      licenses: mergeJsonArrays(existing.licenses, profile.licenses || []),
      vehicles: mergeJsonArrays(existing.vehicles, profile.vehicles || []),
      business_records: mergeJsonArrays(existing.business_records, profile.businesses || []),
      watchlist_flags: mergeJsonArrays(existing.watchlist_flags, profile.watchlistFlags || []),
      sources: mergeJsonArrays(existing.sources, profile.sources || []),
    };

    db.prepare(`
      UPDATE people_index SET
        first_name = COALESCE(?, first_name),
        last_name = COALESCE(?, last_name),
        middle_name = COALESCE(?, middle_name),
        dob = COALESCE(?, dob),
        age = COALESCE(?, age),
        aliases = ?,
        addresses = ?,
        phones = ?,
        emails = ?,
        social_profiles = ?,
        associates = ?,
        court_records = ?,
        property_records = ?,
        licenses = ?,
        vehicles = ?,
        business_records = ?,
        watchlist_flags = ?,
        sources = ?,
        confidence_score = MAX(confidence_score, ?),
        photo_url = COALESCE(?, photo_url),
        last_updated_at = ?
      WHERE id = ?
    `).run(
      profile.firstName || null,
      profile.lastName || null,
      profile.middleName || null,
      profile.dob || null,
      profile.age || null,
      JSON.stringify(merged.aliases),
      JSON.stringify(merged.addresses),
      JSON.stringify(merged.phones),
      JSON.stringify(merged.emails),
      JSON.stringify(merged.social_profiles),
      JSON.stringify(merged.associates),
      JSON.stringify(merged.court_records),
      JSON.stringify(merged.property_records),
      JSON.stringify(merged.licenses),
      JSON.stringify(merged.vehicles),
      JSON.stringify(merged.business_records),
      JSON.stringify(merged.watchlist_flags),
      JSON.stringify(merged.sources),
      profile.confidenceScore || 0,
      profile.photoUrl || null,
      now,
      existing.id,
    );
  } else {
    // Insert new record
    db.prepare(`
      INSERT INTO people_index
        (first_name, last_name, middle_name, full_name, dob, age, aliases, addresses, phones, emails,
         social_profiles, associates, court_records, property_records, licenses, vehicles,
         business_records, watchlist_flags, sources, confidence_score, photo_url, created_at, last_updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      profile.firstName || null,
      profile.lastName || null,
      profile.middleName || null,
      fullName,
      profile.dob || null,
      profile.age || null,
      JSON.stringify(profile.aliases || []),
      JSON.stringify(profile.addresses || []),
      JSON.stringify(profile.phones || []),
      JSON.stringify(profile.emails || []),
      JSON.stringify(profile.socialProfiles || []),
      JSON.stringify(profile.associates || []),
      JSON.stringify(profile.courtRecords || []),
      JSON.stringify(profile.propertyRecords || []),
      JSON.stringify(profile.licenses || []),
      JSON.stringify(profile.vehicles || []),
      JSON.stringify(profile.businesses || []),
      JSON.stringify(profile.watchlistFlags || []),
      JSON.stringify(profile.sources || []),
      profile.confidenceScore || 0,
      profile.photoUrl || null,
      now,
      now,
    );
  }
}

/**
 * Merge a JSON-encoded array (from DB) with a new array, deduplicating by JSON stringification.
 */
function mergeJsonArrays(existingJson: string | null, newItems: any[]): any[] {
  let existing: any[] = [];
  try {
    if (existingJson) existing = JSON.parse(existingJson);
  } catch { /* ignore parse errors */ }

  if (!Array.isArray(existing)) existing = [];
  if (!newItems.length) return existing;

  // Simple dedup by serialized value
  const seen = new Set(existing.map(item => typeof item === 'string' ? item : JSON.stringify(item)));
  for (const item of newItems) {
    const key = typeof item === 'string' ? item : JSON.stringify(item);
    if (!seen.has(key)) {
      seen.add(key);
      existing.push(item);
    }
  }

  return existing;
}
