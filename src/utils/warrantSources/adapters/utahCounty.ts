import type { D1Database } from '@cloudflare/workers-types';
import type { WarrantSourceAdapter, RawWarrantHit } from '../types';
import { cleanName } from '../normalize';

const API = 'https://sheriff.utahcounty.gov/api/mostWanted';

interface UtCoItem {
  id?: number | string;
  top_name?: string;
  age?: number | string;
  charge_info?: string;
  web_photo_path?: string;
  photo_path?: string;
  added_on?: string;
}

export function normalizeUtahCountyItem(raw: unknown): RawWarrantHit {
  const it = (raw ?? {}) as UtCoItem;
  const age = it.age == null || it.age === '' ? null : Number(it.age);
  return {
    source_key: 'utah-county-mostwanted',
    warrant_id: String(it.id ?? ''),
    full_name: cleanName(it.top_name ?? null),
    age: age != null && Number.isFinite(age) ? age : null,
    state: 'UT',
    city: 'Utah County',
    charge_description: it.charge_info ?? null,
    warrant_type: 'most-wanted',
    photo_url: it.web_photo_path ? `https://sheriff.utahcounty.gov${it.web_photo_path}` : null,
  };
}

export const utahCountyAdapter: WarrantSourceAdapter = {
  meta: {
    key: 'utah-county-mostwanted',
    display_name: 'Utah County Sheriff Most Wanted',
    state: 'UT',
    county: 'Utah',
    source_url: API,
    kind: 'json',
    priority: 1,
    family: 'utah-county',
    category: 'wanted',
  },
  mode: 'full-list',
  async fetchAll(_env: { DB: D1Database } & Record<string, unknown>): Promise<RawWarrantHit[]> {
    try {
      const res = await fetch(API, { headers: { Accept: 'application/json' } });
      if (!res.ok) return [];
      const body = (await res.json()) as unknown;
      return (Array.isArray(body) ? body : []).map(normalizeUtahCountyItem).filter((h) => h.warrant_id);
    } catch {
      return [];
    }
  },
};
