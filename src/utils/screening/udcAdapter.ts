import type { Bindings } from '../../types';
import type {
  ScreeningAdapter, NormalizedCandidate, PersonRow, SearchParams, MatchResult, ScreeningHitRow,
} from './types';
import { scoreNameMatch, ageFromDob } from './scoring';
import { mapUdcListResult, udcSearchByName, udcGetDetail, splitUdcName } from './udcApi';
import { getDb, queryFirst, execute } from '../db';

export const udcAdapter: ScreeningAdapter = {
  sourceKey: 'utah-doc',
  kind: 'custody',
  label: 'Utah DOC (current supervision)',
  supportsSearch: true,
  supportsWatch: true,
  normalize: (raw) => mapUdcListResult(raw as Record<string, unknown>),

  async searchAdHoc(env: Bindings, params: SearchParams): Promise<NormalizedCandidate[]> {
    // UI search box maps to `name` (surname) + optional `forename`.
    const last = (params.name ?? '').trim();
    const first = (params.forename ?? '').trim();
    if (!last && !first) return [];
    return udcSearchByName(env, first, last).catch(() => []);
  },

  async fetchForPerson(env: Bindings, person: PersonRow): Promise<NormalizedCandidate[]> {
    if (!person.last_name) return [];
    return udcSearchByName(env, person.first_name ?? '', person.last_name).catch(() => []);
  },

  scoreMatch(person: PersonRow, candidate: NormalizedCandidate): MatchResult {
    const parts = splitUdcName(candidate.displayName);
    const nowYear = new Date().getUTCFullYear();
    return scoreNameMatch({
      personSurname: person.last_name ?? '',
      personForename: person.first_name ?? '',
      personAge: ageFromDob(person.dob, nowYear),
      personNationality: null,
      candSurname: parts.last,
      candForename: parts.first,
      candAgeMin: ageFromDob(candidate.dob, nowYear),
      candAgeMax: ageFromDob(candidate.dob, nowYear),
      candNationalities: candidate.nationalities ?? [],
    });
  },

  // Confirming a custody hit snapshots the full UDC detail into udc_custody
  // and links it to the person. Capture-all-data: detail_json holds the raw
  // response. Idempotent upsert keyed by offender_number.
  async confirmHit(env: Bindings, hit: ScreeningHitRow): Promise<{ promotedRef: string }> {
    const db = getDb(env);
    const detail = await udcGetDetail(env, hit.external_id).catch(() => null);
    if (!detail) return { promotedRef: 'udc_unavailable' };
    const existing = await queryFirst<{ id: number }>(
      db, 'SELECT id FROM udc_custody WHERE offender_number = ?', detail.offender_number);
    if (existing) {
      await execute(db, `UPDATE udc_custody SET offender_name=?, date_of_birth=?, location=?,
          housing_facility=?, release_date_and_type=?, case_manager_name=?, case_manager_email=?,
          detail_json=?, person_id=COALESCE(?, person_id), source='UDC_API',
          last_seen_at=datetime('now'), updated_at=datetime('now') WHERE id=?`,
        detail.offender_name, detail.date_of_birth, detail.location, detail.housing_facility,
        detail.release_date_and_type, detail.case_manager_name, detail.case_manager_email,
        detail.detail_json, hit.person_id, existing.id).catch(() => {});
    } else {
      await execute(db, `INSERT INTO udc_custody (offender_number, offender_name, date_of_birth, location,
          housing_facility, release_date_and_type, case_manager_name, case_manager_email,
          detail_json, person_id, source, last_seen_at)
        VALUES (?,?,?,?,?,?,?,?,?,?, 'UDC_API', datetime('now'))`,
        detail.offender_number, detail.offender_name, detail.date_of_birth, detail.location,
        detail.housing_facility, detail.release_date_and_type, detail.case_manager_name,
        detail.case_manager_email, detail.detail_json, hit.person_id).catch(() => {});
    }
    return { promotedRef: `udc:${detail.offender_number}` };
  },

  // Live-API source: covered whenever reachable. No empty-local-table
  // false-clear concern (search hits api.utah.gov directly).
  async coverage(_env: Bindings) {
    return { available: true, severity: 'ok' as const };
  },
};
