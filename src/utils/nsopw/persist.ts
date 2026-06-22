// ============================================================
// RMPG Flex — NSOPW offender persistence.
// ------------------------------------------------------------
// Upserts NsopwOffender rows into national_sex_offenders, keyed by
// (jurisdiction, nsopw_offender_id). The unique index keeps the
// table clean across re-queries: the same offender returned by 50
// different officer lookups stays one row, with `last_seen_at` /
// `updated_at` bumped.
//
// This module does NOT decide whether to persist — that's the
// orchestrator's call (in index.ts). We persist confirmed AND
// possible candidates (so the review queue's "show offender detail"
// works even after the cache expires); we do NOT persist excluded
// candidates (those are 50-state noise from common-surname queries).
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { queryFirst, execute } from '../db';
import type { NsopwOffender } from './types';

/**
 * Upsert one offender. Returns the row id (existing or newly inserted).
 */
export async function upsertOffender(db: D1Database, o: NsopwOffender): Promise<number> {
  // Idempotency: (jurisdiction, nsopw_offender_id) is unique. If both are
  // empty (unusual but possible), fall back to a name+DOB match so we don't
  // create a row per query for the same person.
  const id = (o.nsopwOffenderId || '').trim();
  const jur = (o.jurisdiction || '').trim();

  let existing: { id: number } | null = null;
  if (id && jur) {
    existing = await queryFirst<{ id: number }>(
      db,
      `SELECT id FROM national_sex_offenders
        WHERE jurisdiction = ? AND nsopw_offender_id = ?
        LIMIT 1`,
      jur, id,
    );
  }
  if (!existing) {
    existing = await queryFirst<{ id: number }>(
      db,
      `SELECT id FROM national_sex_offenders
        WHERE last_name = ? AND first_name = ?
          AND (date_of_birth IS NULL OR date_of_birth = '' OR date_of_birth = ?)
        LIMIT 1`,
      o.lastName, o.firstName, o.dateOfBirth ?? '',
    ).catch(() => null);
  }

  if (existing) {
    await execute(
      db,
      `UPDATE national_sex_offenders SET
         nsopw_offender_id = COALESCE(NULLIF(?, ''), nsopw_offender_id),
         jurisdiction = COALESCE(NULLIF(?, ''), jurisdiction),
         jurisdiction_label = COALESCE(NULLIF(?, ''), jurisdiction_label),
         first_name = COALESCE(NULLIF(?, ''), first_name),
         middle_name = COALESCE(NULLIF(?, ''), middle_name),
         last_name = COALESCE(NULLIF(?, ''), last_name),
         suffix = COALESCE(NULLIF(?, ''), suffix),
         aliases = COALESCE(NULLIF(?, ''), aliases),
         date_of_birth = COALESCE(NULLIF(?, ''), date_of_birth),
         sex = COALESCE(NULLIF(?, ''), sex),
         race = COALESCE(NULLIF(?, ''), race),
         height = COALESCE(NULLIF(?, ''), height),
         weight = COALESCE(NULLIF(?, ''), weight),
         hair_color = COALESCE(NULLIF(?, ''), hair_color),
         eye_color = COALESCE(NULLIF(?, ''), eye_color),
         scars_marks = COALESCE(NULLIF(?, ''), scars_marks),
         address = COALESCE(NULLIF(?, ''), address),
         city = COALESCE(NULLIF(?, ''), city),
         state = COALESCE(NULLIF(?, ''), state),
         zip = COALESCE(NULLIF(?, ''), zip),
         offense = COALESCE(NULLIF(?, ''), offense),
         risk_level = COALESCE(NULLIF(?, ''), risk_level),
         tier = COALESCE(?, tier),
         registration_status = COALESCE(NULLIF(?, ''), registration_status),
         compliance_status = COALESCE(NULLIF(?, ''), compliance_status),
         photo_url = COALESCE(NULLIF(?, ''), photo_url),
         detail_url = COALESCE(NULLIF(?, ''), detail_url),
         detail_json = ?,
         last_seen_at = datetime('now'),
         updated_at = datetime('now')
       WHERE id = ?`,
      o.nsopwOffenderId, o.jurisdiction, o.jurisdictionLabel,
      o.firstName, o.middleName ?? '', o.lastName, o.suffix ?? '',
      JSON.stringify(o.aliases), o.dateOfBirth ?? '',
      o.sex ?? '', o.race ?? '', o.height ?? '', o.weight ?? '',
      o.hairColor ?? '', o.eyeColor ?? '', o.scarsMarks ?? '',
      o.address ?? '', o.city ?? '', o.state ?? '', o.zip ?? '',
      o.offense ?? '', o.riskLevel ?? '', o.tier,
      o.registrationStatus ?? '', o.complianceStatus ?? '',
      o.photoUrl ?? '', o.detailUrl ?? '',
      JSON.stringify(o.raw ?? null),
      existing.id,
    );
    return existing.id;
  }

  const ins = await execute(
    db,
    `INSERT INTO national_sex_offenders (
       nsopw_offender_id, jurisdiction, jurisdiction_label,
       first_name, middle_name, last_name, suffix, aliases,
       date_of_birth, sex, race, height, weight,
       hair_color, eye_color, scars_marks,
       address, city, state, zip,
       offense, risk_level, tier, registration_status, compliance_status,
       photo_url, detail_url, detail_json, last_seen_at
     ) VALUES (?, ?, ?,  ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?,  ?, ?, ?,
              ?, ?, ?, ?,  ?, ?, ?, ?, ?,
              ?, ?, ?, datetime('now'))`,
    o.nsopwOffenderId, o.jurisdiction, o.jurisdictionLabel,
    o.firstName, o.middleName, o.lastName, o.suffix, JSON.stringify(o.aliases),
    o.dateOfBirth, o.sex, o.race, o.height, o.weight,
    o.hairColor, o.eyeColor, o.scarsMarks,
    o.address, o.city, o.state, o.zip,
    o.offense, o.riskLevel, o.tier, o.registrationStatus, o.complianceStatus,
    o.photoUrl, o.detailUrl, JSON.stringify(o.raw ?? null),
  );
  const meta = (ins as { meta?: { last_row_id?: number } }).meta;
  return meta?.last_row_id ?? 0;
}
