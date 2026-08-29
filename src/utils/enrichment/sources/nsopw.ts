import type { EnrichmentSeed, SourceResult, EnrichedRecord } from '../types';
import type { Bindings } from '../../../types';
import { nsopwSearch, resolveClientConfig } from '../../nsopw/client';
import { query } from '../../db';
import { splitPersonName } from './http';

interface LocalSorRow {
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  jurisdiction: string | null;
  absconder: number | null;
}

function rowsToRecords(rows: LocalSorRow[], source: string): EnrichedRecord[] {
  return rows.map(r => ({
    name: [r.first_name, r.middle_name, r.last_name].filter(Boolean).join(' '),
    dob: r.date_of_birth ?? undefined,
    addresses: (r.address || r.city || r.state)
      ? [{
          street: r.address ?? undefined,
          city: r.city ?? undefined,
          state: r.state ?? undefined,
          zip: r.zip ?? undefined,
          source,
        }]
      : [],
    phones: [],
    emails: [],
    watchlist_flags: r.absconder
      ? ['sex_offender_registry', 'absconder']
      : ['sex_offender_registry'],
    source,
    raw: { jurisdiction: r.jurisdiction, local: true },
  }));
}

async function searchLocal(db: D1Database, seed: EnrichmentSeed, source: string): Promise<EnrichedRecord[]> {
  const { first, last } = splitPersonName(seed.first_name, seed.last_name);
  if (!last) return [];
  const rows = await query<LocalSorRow>(
    db,
    `SELECT first_name, middle_name, last_name, date_of_birth, address, city, state, zip,
            jurisdiction, absconder
       FROM national_sex_offenders
      WHERE LOWER(last_name) = ?
        AND (? = '' OR LOWER(first_name) = ? OR LOWER(first_name) LIKE ?)
      LIMIT 25`,
    last.toLowerCase(),
    first.toLowerCase(),
    first.toLowerCase(),
    `${first.toLowerCase()}%`,
  );
  return rowsToRecords(rows, source);
}

export async function search(seed: EnrichmentSeed, env: Bindings): Promise<SourceResult> {
  const start = Date.now();
  const source = 'nsopw';
  const config = resolveClientConfig(env);
  const db = env.DB;

  // Prefer live federated API when enabled; fall back to local cache on
  // Cloudflare bot-challenge / timeout (common from Worker egress).
  if (config.enabled) {
    try {
      const { first, last } = splitPersonName(seed.first_name, seed.last_name);
      const { response } = await nsopwSearch(env, {
        forename: first,
        surname: last,
        city: seed.city,
      }, config);

      // nsopwSearch already returns a parsed NsopwSearchResponse — do NOT
      // re-parse (parseOffender expects wire-format givenName/surName).
      const records: EnrichedRecord[] = response.offenders.map(o => ({
        name: [o.firstName, o.middleName, o.lastName].filter(Boolean).join(' '),
        dob: o.dateOfBirth ?? undefined,
        addresses: o.locations.length > 0
          ? o.locations.map(loc => ({
              street: loc.streetAddress ?? undefined,
              city: loc.city ?? undefined,
              state: loc.state ?? undefined,
              zip: loc.zipCode ?? undefined,
              type: loc.type?.toLowerCase(),
              source,
            }))
          : (o.address ? [{
              street: o.address,
              city: o.city ?? undefined,
              state: o.state ?? undefined,
              zip: o.zip ?? undefined,
              source,
            }] : []),
        phones: [],
        emails: [],
        watchlist_flags: o.absconder
          ? ['sex_offender_registry', 'absconder']
          : ['sex_offender_registry'],
        source,
        raw: o.raw,
      }));

      return { source, ok: true, latency_ms: Date.now() - start, records };
    } catch (err) {
      // Live API blocked (CF challenge) or timed out — try local cache.
      if (db) {
        try {
          const local = await searchLocal(db, seed, source);
          return {
            source, ok: true, latency_ms: Date.now() - start, records: local,
            error: local.length === 0
              ? `live_unavailable:${err instanceof Error ? err.message : 'unknown'};local_0`
              : `live_unavailable_local_${local.length}`,
          };
        } catch { /* fall through to error */ }
      }
      return {
        source, ok: false, latency_ms: Date.now() - start, records: [],
        error: err instanceof Error ? err.message : 'unknown',
      };
    }
  }

  // Not configured for live — still serve local cache (never a clearance).
  if (db) {
    try {
      const local = await searchLocal(db, seed, source);
      return {
        source, ok: true, latency_ms: Date.now() - start, records: local,
        error: local.length === 0 ? 'not_configured_local_0' : undefined,
      };
    } catch (err) {
      return {
        source, ok: false, latency_ms: Date.now() - start, records: [],
        error: err instanceof Error ? err.message : 'unknown',
      };
    }
  }

  return { source, ok: false, latency_ms: 0, records: [], error: 'not_configured' };
}
