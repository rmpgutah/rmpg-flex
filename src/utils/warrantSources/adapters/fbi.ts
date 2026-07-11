import type { D1Database } from '@cloudflare/workers-types';
import type { WarrantSourceAdapter, RawWarrantHit, FullListResult } from '../types';
import { cleanName, normalizeDate } from '../normalize';

const API = 'https://api.fbi.gov/wanted/v1/list';
// FBI's Cloudflare front 403s identifier-style UAs; use a browser UA (same trick as utahWarrantPoller).
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

interface FbiItem {
  uid?: string;
  title?: string;
  description?: string;
  subjects?: string[];
  dates_of_birth_used?: string[];
  sex?: string;
  race?: string;
  field_offices?: string[];
  warning_message?: string;
  images?: { thumb?: string; large?: string; original?: string }[];
  url?: string;
}

/**
 * FBI title is "FIRST [M] LAST"; reformat to "Last, First M".
 * Handles single-word titles gracefully.
 */
function titleToName(title: string | undefined): string | null {
  if (!title) return null;
  const parts = title.trim().split(/\s+/);
  if (parts.length < 2) return cleanName(title) || null;
  const last = parts[parts.length - 1];
  const firstMid = parts.slice(0, -1).join(' ');
  return cleanName(`${last}, ${firstMid}`) || null;
}

export function normalizeFbiItem(raw: unknown): RawWarrantHit {
  const it = (raw ?? {}) as FbiItem;
  const charge = [it.description, ...(it.subjects ?? [])].filter(Boolean).join(' · ') || null;
  return {
    source_key: 'fbi-wanted',
    warrant_id: it.uid ?? '',
    full_name: titleToName(it.title),
    date_of_birth: normalizeDate(it.dates_of_birth_used?.[0] ?? null),
    state: 'US',
    charge_description: charge,
    warrant_type: it.warning_message ? `FEDERAL · ${it.warning_message}` : 'FEDERAL',
    photo_url: it.images?.[0]?.thumb ?? it.images?.[0]?.large ?? null,
    detail_url: it.url ?? null,
  };
}

async function fetchList(): Promise<FbiItem[]> {
  try {
    const out: FbiItem[] = [];
    for (let page = 1; page <= 60; page++) {  // ~1200 records / 50 = ~24 pages; cap at 60
      const res = await fetch(`${API}?page=${page}&pageSize=50`, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
      });
      if (!res.ok) break;
      const body = (await res.json()) as { items?: FbiItem[]; total?: number };
      const items = body.items ?? [];
      out.push(...items);
      if (items.length < 50) break;
    }
    return out;
  } catch {
    return [];
  }
}

export const fbiAdapter: WarrantSourceAdapter = {
  meta: {
    key: 'fbi-wanted',
    display_name: 'FBI Wanted',
    state: 'US',
    county: null,
    source_url: API,
    kind: 'json',
    priority: 1,
    family: 'fbi',
    category: 'wanted',
  },
  mode: 'full-list',
  async fetchAll(_env: { DB: D1Database } & Record<string, unknown>): Promise<FullListResult> {
    const items = await fetchList();
    return { hits: items.map(normalizeFbiItem).filter((h) => h.warrant_id) };
  },
};
