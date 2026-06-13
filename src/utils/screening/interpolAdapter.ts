import type { Bindings } from '../../types';
import type { ScreeningAdapter, NormalizedCandidate, PersonRow, SearchParams, MatchResult, ScreeningHitRow } from './types';
import { ageFromDob, scoreNameMatch } from './scoring';
import { getDb, queryFirst, execute } from '../db';
import { emitAlert } from '../alertHub';

const BASE = 'https://ws-public.interpol.int/notices/v1';
export type InterpolType = 'red' | 'yellow' | 'un';

interface RawNotice {
  entity_id?: string;
  forename?: string; name?: string;
  date_of_birth?: string;
  nationalities?: string[];
  sex_id?: string;
  _links?: { thumbnail?: { href?: string }; images?: { href?: string } };
}

export function normalizeInterpolNotice(raw: unknown, type: InterpolType): NormalizedCandidate {
  const n = (raw ?? {}) as RawNotice;
  const displayName = [n.forename, n.name].filter(Boolean).join(' ').trim() || (n.entity_id ?? 'unknown');
  const nats = Array.isArray(n.nationalities) ? n.nationalities : [];
  return {
    sourceKey: `interpol-${type}`,
    externalId: n.entity_id ?? '',
    displayName,
    summary: `INTERPOL ${type.toUpperCase()} Notice${nats.length ? ` · ${nats.join('/')}` : ''}`,
    photoUrl: n._links?.thumbnail?.href,
    country: nats[0],
    listType: type,
    dob: n.date_of_birth ?? null,
    nationalities: nats,
    raw,
  };
}

async function fetchNotices(type: InterpolType, qs: Record<string, string>): Promise<RawNotice[]> {
  const params = new URLSearchParams({ resultPerPage: '20', ...qs });
  const res = await fetch(`${BASE}/${type}?${params}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) return [];
  const body = (await res.json()) as { _embedded?: { notices?: RawNotice[] } };
  return body._embedded?.notices ?? [];
}

export function interpolAdapter(type: InterpolType): ScreeningAdapter {
  return {
    sourceKey: `interpol-${type}`,
    kind: 'notice',
    label: `INTERPOL ${type[0].toUpperCase()}${type.slice(1)} Notice`,
    supportsSearch: true,
    supportsWatch: true,

    normalize: (raw) => normalizeInterpolNotice(raw, type),

    async searchAdHoc(env: Bindings, params: SearchParams): Promise<NormalizedCandidate[]> {
      const qs: Record<string, string> = {};
      if (params.name) qs.name = params.name;
      if (params.forename) qs.forename = params.forename;
      if (params.nationality) qs.nationality = params.nationality;
      if (params.ageMin != null) qs.ageMin = String(params.ageMin);
      if (params.ageMax != null) qs.ageMax = String(params.ageMax);
      if (params.sexId) qs.sexId = params.sexId;
      if (params.page != null) qs.page = String(params.page);
      const cacheKey = `interpol:${type}:${JSON.stringify(qs)}`;
      const cached = await env.KV.get(cacheKey, 'json').catch(() => null);
      if (cached) return cached as NormalizedCandidate[];
      const notices = await fetchNotices(type, qs);
      const out = notices.map((n) => normalizeInterpolNotice(n, type));
      await env.KV.put(cacheKey, JSON.stringify(out), { expirationTtl: 3600 }).catch(() => {});
      return out;
    },

    async fetchForPerson(env: Bindings, person: PersonRow): Promise<NormalizedCandidate[]> {
      if (!person.last_name) return [];
      const qs: Record<string, string> = { name: person.last_name };
      if (person.first_name) qs.forename = person.first_name;
      const notices = await fetchNotices(type, qs);
      return notices.map((n) => normalizeInterpolNotice(n, type));
    },

    scoreMatch(person: PersonRow, candidate: NormalizedCandidate): MatchResult {
      const raw = candidate.raw as RawNotice;
      const candAge = ageFromDob(candidate.dob, new Date().getUTCFullYear());
      return scoreNameMatch({
        personSurname: person.last_name ?? '',
        personForename: person.first_name ?? '',
        personAge: ageFromDob(person.dob, new Date().getUTCFullYear()),
        personNationality: person.nationality ?? person.citizenship ?? null,
        candSurname: raw?.name ?? '',
        candForename: raw?.forename ?? '',
        candAgeMin: candAge, candAgeMax: candAge,
        candNationalities: candidate.nationalities ?? [],
      });
    },

    async confirmHit(env: Bindings, hit: ScreeningHitRow): Promise<{ promotedRef: string }> {
      const db = getDb(env);
      if (type !== 'red') return { promotedRef: 'noted' };
      const [first, ...rest] = (hit.display_name ?? '').split(' ');
      const last = rest.join(' ') || first;
      const warrantNumber = `INTERPOL-RED-${hit.external_id}`;
      const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM warrants WHERE warrant_number = ?', warrantNumber);
      if (!existing) {
        await execute(db,
          `INSERT INTO warrants
             (warrant_number, external_warrant_id, external_source_key, subject_person_id,
              subject_first_name, subject_last_name, warrant_type, source, priority,
              issuing_agency, auto_created, charge_description, status)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          warrantNumber, hit.external_id, 'interpol-red', hit.person_id,
          first ?? null, last ?? null, 'INTERPOL_RED', 'interpol', 'P2',
          'INTERPOL', 1, hit.summary ?? 'INTERPOL Red Notice', 'active',
        );
      }
      const row = await queryFirst<{ id: number }>(db, 'SELECT id FROM warrants WHERE warrant_number = ?', warrantNumber);
      await emitAlert(env, 'screening:hit_confirmed', {
        source: 'interpol-red', personId: hit.person_id, name: hit.display_name, warrantId: row?.id,
      }).catch(() => {});
      return { promotedRef: `warrant:${row?.id ?? ''}` };
    },
  };
}
