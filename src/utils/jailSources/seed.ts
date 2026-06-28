// Utah jail roster source registry seed (Intel Wave 3a).
// All 29 Utah counties + statewide UDC + VINELink. Idempotent upsert —
// runs from the scan orchestrator's first pass so a fresh/live D1 gets
// the full registry without a separate migration data-load step. Live
// scraping status starts 'pending'; UDC/VINELink flip to 'active' as
// their adapters are wired (they self-report health via last_status).
import type { D1Database } from '@cloudflare/workers-types';
import { execute, queryFirst } from '../db';

interface SeedRow { key: string; name: string; county: string | null; url: string; kind: string; status: string }

const UT_COUNTIES = [
  'Beaver', 'Box Elder', 'Cache', 'Carbon', 'Daggett', 'Davis', 'Duchesne',
  'Emery', 'Garfield', 'Grand', 'Iron', 'Juab', 'Kane', 'Millard', 'Morgan',
  'Piute', 'Rich', 'Salt Lake', 'San Juan', 'Sanpete', 'Sevier', 'Summit',
  'Tooele', 'Uintah', 'Utah', 'Wasatch', 'Washington', 'Wayne', 'Weber',
];

const slug = (s: string) => s.toLowerCase().replace(/\s+/g, '-');

export const JAIL_SOURCE_SEED: SeedRow[] = [
  { key: 'ut-udc', name: 'Utah Dept. of Corrections (statewide)', county: null,
    url: 'https://corrections.utah.gov/inmate-services/offender-search/', kind: 'json', status: 'active' },
  { key: 'ut-vinelink', name: 'VINELink (statewide jails)', county: null,
    url: 'https://www.vinelink.com/', kind: 'portal', status: 'active' },
  ...UT_COUNTIES.map((c) => ({
    key: `ut-${slug(c)}`, name: `${c} County Jail`, county: c,
    url: '', kind: 'portal', status: 'pending',
  })),
];

export async function seedJailSources(db: D1Database): Promise<void> {
  for (const r of JAIL_SOURCE_SEED) {
    try {
      const exists = await queryFirst<any>(db, 'SELECT source_key FROM jail_roster_sources WHERE source_key = ?', r.key);
      if (exists) continue; // never override operator status changes
      await execute(db,
        `INSERT INTO jail_roster_sources (source_key, display_name, county, state, source_url, kind, status)
         VALUES (?, ?, ?, 'UT', ?, ?, ?)`,
        r.key, r.name, r.county, r.url, r.kind, r.status);
    } catch (err: any) { console.error('[jail-seed] failed:', err?.message); }
  }
}
