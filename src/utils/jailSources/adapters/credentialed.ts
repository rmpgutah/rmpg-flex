// Generic credentialed JSON jail adapter (automated scraping item 3).
// When an authorized JSON feed exists for a source, store its URL + bearer
// token in system_config (keys jail_<src>_url / jail_<src>_token) and this
// adapter pulls directly in the Worker cron — no external runner needed.
// Degrades to [] + recorded status on missing config / non-200; never throws.
import type { D1Database } from '@cloudflare/workers-types';
import { queryFirst } from '../../db';
import type { JailSourceAdapter, JailSourceMeta, JailBooking } from '../types';

interface CredentialedConfig {
  urlKey: string;            // system_config key holding the feed URL
  tokenKey?: string;         // system_config key holding the bearer token
  listPath?: string[];       // path into the JSON to the array of records
  map: (record: any) => Partial<JailBooking>;
}

async function configValue(db: D1Database, key: string): Promise<string | null> {
  try {
    const row = await queryFirst<any>(db, 'SELECT config_value FROM system_config WHERE config_key = ?', key);
    return row?.config_value ?? null;
  } catch { return null; }
}

function walk(obj: any, path: string[] | undefined): any[] {
  let cur = obj;
  for (const k of path || []) cur = cur?.[k];
  if (Array.isArray(cur)) return cur;
  if (Array.isArray(obj)) return obj;
  return [];
}

export function makeCredentialedAdapter(meta: JailSourceMeta, cfg: CredentialedConfig): JailSourceAdapter {
  return {
    meta,
    async fetchRecent(env): Promise<JailBooking[]> {
      const db = env.DB;
      const url = await configValue(db, cfg.urlKey);
      if (!url) return [];
      const token = cfg.tokenKey ? await configValue(db, cfg.tokenKey) : null;
      try {
        const res = await fetch(url, {
          headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) return [];
        const json = await res.json();
        return walk(json, cfg.listPath).slice(0, 200).map((rec) => ({
          source_key: meta.key,
          booking_id: '',
          ...cfg.map(rec),
        })) as JailBooking[];
      } catch {
        return [];
      }
    },
  };
}

// UDC, wired as a credentialed adapter — flips live the moment an authorized
// feed URL/token is dropped into system_config (jail_ut-udc_url / _token).
export const udcCredentialedAdapter = makeCredentialedAdapter(
  {
    key: 'ut-udc', display_name: 'Utah Dept. of Corrections (statewide)',
    county: null, state: 'UT',
    source_url: 'https://corrections.utah.gov/inmate-services/offender-search/',
    kind: 'json',
  },
  {
    urlKey: 'jail_ut-udc_url',
    tokenKey: 'jail_ut-udc_token',
    listPath: ['offenders'],
    map: (r: any) => ({
      full_name: r.name ?? r.full_name ?? null,
      first_name: r.first_name ?? null,
      last_name: r.last_name ?? null,
      dob: r.dob ?? r.date_of_birth ?? null,
      booking_date: r.booking_date ?? r.intake_date ?? null,
      charges: Array.isArray(r.charges) ? r.charges.join('; ') : (r.charges ?? null),
      county: r.facility ?? r.county ?? null,
    }),
  },
);
