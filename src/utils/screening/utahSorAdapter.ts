import type { Bindings } from '../../types';
import type {
  ScreeningAdapter,
  NormalizedCandidate,
  PersonRow,
  SearchParams,
  MatchResult,
  ScreeningHitRow,
} from './types';
import { scoreSanctionMatch } from './scoring';
import { sorCoverage } from './coverage';
import { getDb, query, queryFirst, execute } from '../db';

// Column mapping (from migrations/0096_utah_sex_offenders.sql):
//   id, registry_id, first_name, middle_name, last_name,
//   date_of_birth, aliases, sex, race, height, weight,
//   hair_color, eye_color, scars_marks, address, city, state, zip,
//   offense, risk_level, registration_status, compliance_status,
//   photo_url, source, last_seen_at, fetched_at, updated_at
//
// Note: DOB column is `date_of_birth` (not `dob`).
//       Offender ID is `registry_id` (no `sor_number` column on this table).

function rowToCandidate(row: Record<string, unknown>): NormalizedCandidate {
  const name = [row.first_name, row.last_name].filter(Boolean).join(' ');
  return {
    sourceKey: 'utah-sor',
    externalId: String(row.registry_id ?? row.id ?? ''),
    displayName: name || 'unknown',
    summary: `Utah Sex Offender Registry${row.city ? ` · ${row.city}` : ''}`,
    country: 'US',
    listType: 'utah-sor',
    dob: (row.date_of_birth as string) ?? null,
    nationalities: ['US'],
    raw: row,
  };
}

export const utahSorAdapter: ScreeningAdapter = {
  sourceKey: 'utah-sor',
  kind: 'sex_offender',
  label: 'Utah Sex Offender Registry',
  supportsSearch: true,
  supportsWatch: true,
  normalize: rowToCandidate,

  async searchAdHoc(env: Bindings, params: SearchParams): Promise<NormalizedCandidate[]> {
    const term = `%${(params.name ?? '').trim().replace(/[%_\\]/g, '\\$&')}%`;
    const rows = await query<Record<string, unknown>>(
      getDb(env),
      "SELECT * FROM utah_sex_offenders WHERE last_name LIKE ? ESCAPE '\\' LIMIT 50",
      term,
    ).catch(() => []);
    return rows.map(rowToCandidate);
  },

  async fetchForPerson(env: Bindings, person: PersonRow): Promise<NormalizedCandidate[]> {
    if (!person.last_name) return [];
    const term = `%${person.last_name.replace(/[%_\\]/g, '\\$&')}%`;
    const rows = await query<Record<string, unknown>>(
      getDb(env),
      "SELECT * FROM utah_sex_offenders WHERE last_name LIKE ? ESCAPE '\\' LIMIT 50",
      term,
    ).catch(() => []);
    return rows.map(rowToCandidate);
  },

  async coverage(env: Bindings) {
    const db = getDb(env);
    const cnt = await queryFirst<{ n: number }>(
      db, 'SELECT COUNT(*) n FROM utah_sex_offenders').catch(() => null);
    const cfg = await queryFirst<{ config_value: string }>(
      db, "SELECT config_value FROM system_config WHERE config_key = 'sor_feed_url' ORDER BY id DESC LIMIT 1",
    ).catch(() => null);
    const configured = !!(cfg?.config_value && /^https:\/\//i.test(cfg.config_value));
    return sorCoverage(cnt?.n ?? 0, configured);
  },

  scoreMatch(person: PersonRow, candidate: NormalizedCandidate): MatchResult {
    return scoreSanctionMatch(
      person.last_name ?? '',
      person.first_name ?? '',
      candidate.displayName,
    );
  },

  async confirmHit(env: Bindings, hit: ScreeningHitRow): Promise<{ promotedRef: string }> {
    const db = getDb(env);
    if (hit.person_id) {
      // persons.is_sex_offender (INTEGER) and persons.sor_number (TEXT) are
      // confirmed columns in the baseline persons schema.
      await execute(
        db,
        "UPDATE persons SET is_sex_offender = 1, sor_number = COALESCE(NULLIF(sor_number, ''), ?) WHERE id = ?",
        hit.external_id,
        hit.person_id,
      ).catch(() => {});
    }
    return { promotedRef: 'sor_flag' };
  },
};
