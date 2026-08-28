import type { EnrichmentSeed, EnrichedRecord } from '../enrichment/types';
import { query, queryFirst } from '../db';

export interface V2Profile {
  id: string;
  fullName?: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  dob?: string;
  age?: number;
  city?: string;
  state?: string;
  ssn_last4?: string;
  sources: string[];
  addresses?: Array<{ address?: string; city?: string; state?: string; zip?: string; type?: string; source: string }>;
  phones?: Array<{ number: string; type?: string; source: string }>;
  emails?: Array<{ email?: string; source: string }>;
  associates?: Array<{ name: string; relationship?: string; source: string }>;
  watchlistFlags?: Array<{ listName?: string; type?: string; details?: string; source: string }>;
  custodyRecords?: Array<{ facility?: string; status?: string; bookingDate?: string; charges?: string[]; source: string }>;
  sexOffenderRecords?: Array<{ registryState?: string; tier?: string; offenses?: string[]; source: string }>;
  propertyRecords?: Array<{ address?: string; city?: string; state?: string; ownerName?: string; source: string }>;
  businesses?: Array<{ name: string; role?: string; status?: string; source: string }>;
}

export interface V2SearchParams {
  q: string;
  firstName?: string;
  lastName?: string;
  dob?: string;
  ssn_last4?: string;
  city?: string;
  state?: string;
  engine: 'microbilt' | 'rapidapi' | 'all';
  categories: string[];
}

interface PersonRow {
  id: number;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  dob: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  ssn_last4: string | null;
  ssn_full: string | null;
}

function ageFromDob(dob: string | null): number | undefined {
  if (!dob) return undefined;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return undefined;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 && age < 130 ? age : undefined;
}

function last4(ssn: string | null): string | undefined {
  if (!ssn) return undefined;
  const digits = ssn.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : undefined;
}

export function personRowToProfile(p: PersonRow): V2Profile {
  const fullName = [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ').trim();
  return {
    id: `LOCAL-${p.id}`,
    fullName: fullName || undefined,
    firstName: p.first_name ?? undefined,
    middleName: p.middle_name ?? undefined,
    lastName: p.last_name ?? undefined,
    dob: p.dob ?? undefined,
    age: ageFromDob(p.dob),
    city: p.city ?? undefined,
    state: p.state ?? undefined,
    ssn_last4: p.ssn_last4 ?? last4(p.ssn_full),
    sources: ['local_rms'],
    phones: p.phone ? [{ number: p.phone, source: 'local_rms' }] : [],
    emails: p.email ? [{ email: p.email, source: 'local_rms' }] : [],
    addresses: p.address || p.city || p.state ? [{
      address: p.address ?? undefined,
      city: p.city ?? undefined,
      state: p.state ?? undefined,
      zip: p.zip ?? undefined,
      type: 'current',
      source: 'local_rms',
    }] : [],
  };
}

export function enrichedRecordToProfile(rec: EnrichedRecord, sourceKey: string): V2Profile {
  const parts = (rec.name ?? '').trim().split(/\s+/);
  const firstName = parts[0] || undefined;
  const lastName = parts.length > 1 ? parts.slice(1).join(' ') : undefined;
  return {
    id: `${sourceKey}-${crypto.randomUUID()}`,
    fullName: rec.name,
    firstName,
    lastName,
    dob: rec.dob,
    ssn_last4: rec.ssn_last4,
    sources: [sourceKey],
    addresses: rec.addresses.map(a => ({
      address: a.street,
      city: a.city,
      state: a.state,
      zip: a.zip,
      source: sourceKey,
    })),
    phones: rec.phones.map(n => ({ number: n, source: sourceKey })),
    emails: rec.emails.map(e => ({ email: e, source: sourceKey })),
    watchlistFlags: rec.watchlist_flags?.map(f => ({ listName: f, source: sourceKey })),
    businesses: rec.business_associations?.map(b => ({ name: b, source: sourceKey })),
  };
}

function detectSearchType(q: string, params: V2SearchParams): string {
  const trimmed = q.trim();
  if (params.firstName || params.lastName) return 'name';
  if (!trimmed) return 'general';
  if (trimmed.replace(/\D/g, '').length >= 10) return 'phone';
  if (trimmed.includes('@')) return 'email';
  if (/\d/.test(trimmed) && /\b(st|street|ave|avenue|blvd|boulevard|dr|drive|rd|road|ln|lane|ct|court|way|pl|place)\b/i.test(trimmed)) {
    return 'address';
  }
  return 'name';
}

function mergeProfiles(existing: V2Profile[], incoming: V2Profile[]): V2Profile[] {
  const out = [...existing];
  for (const p of incoming) {
    const key = (p.fullName || `${p.firstName ?? ''}|${p.lastName ?? ''}|${p.dob ?? ''}`).toLowerCase();
    const idx = out.findIndex(o =>
      (o.fullName || `${o.firstName ?? ''}|${o.lastName ?? ''}|${o.dob ?? ''}`).toLowerCase() === key,
    );
    if (idx >= 0) {
      const base = out[idx];
      out[idx] = {
        ...base,
        sources: [...new Set([...(base.sources ?? []), ...(p.sources ?? [])])],
        addresses: [...(base.addresses ?? []), ...(p.addresses ?? [])],
        phones: [...(base.phones ?? []), ...(p.phones ?? [])],
        emails: [...(base.emails ?? []), ...(p.emails ?? [])],
        watchlistFlags: [...(base.watchlistFlags ?? []), ...(p.watchlistFlags ?? [])],
        custodyRecords: [...(base.custodyRecords ?? []), ...(p.custodyRecords ?? [])],
        sexOffenderRecords: [...(base.sexOffenderRecords ?? []), ...(p.sexOffenderRecords ?? [])],
        propertyRecords: [...(base.propertyRecords ?? []), ...(p.propertyRecords ?? [])],
        businesses: [...(base.businesses ?? []), ...(p.businesses ?? [])],
      };
    } else {
      out.push(p);
    }
  }
  return out;
}

async function searchLocalPersons(db: D1Database, params: V2SearchParams): Promise<V2Profile[]> {
  const q = params.q.trim();
  const type = detectSearchType(q, params);
  const limit = 50;
  let rows: PersonRow[] = [];

  if (type === 'phone') {
    const digits = q.replace(/\D/g, '').slice(-10);
    const wild = `%${digits.slice(0, 48)}%`;
    rows = await query<PersonRow>(db,
      `SELECT id, first_name, middle_name, last_name, dob, phone, email, address, city, state, zip, ssn_last4, ssn_full
         FROM persons WHERE replace(replace(replace(phone, '-', ''), '(', ''), ')', '') LIKE ?
         ORDER BY last_name, first_name LIMIT ?`, wild, limit);
  } else if (type === 'email') {
    const wild = `%${q.slice(0, 48)}%`;
    rows = await query<PersonRow>(db,
      `SELECT id, first_name, middle_name, last_name, dob, phone, email, address, city, state, zip, ssn_last4, ssn_full
         FROM persons WHERE email LIKE ?
         ORDER BY last_name, first_name LIMIT ?`, wild, limit);
  } else if (type === 'address') {
    const wild = `%${q.slice(0, 48)}%`;
    rows = await query<PersonRow>(db,
      `SELECT id, first_name, middle_name, last_name, dob, phone, email, address, city, state, zip, ssn_last4, ssn_full
         FROM persons WHERE address LIKE ? OR city LIKE ? OR zip LIKE ?
         ORDER BY last_name, first_name LIMIT ?`, wild, wild, wild, limit);
  } else {
    const name = [params.firstName, params.lastName, q].filter(Boolean).join(' ').trim();
    const tokens = name.split(/\s+/).filter(Boolean).slice(0, 4);
    if (tokens.length === 0) return [];
    const where = tokens.map(() =>
      '(first_name LIKE ? OR middle_name LIKE ? OR last_name LIKE ? OR alias_nickname LIKE ? OR aliases LIKE ?)',
    ).join(' AND ');
    const binds: unknown[] = [];
    for (const t of tokens) {
      const wild = `%${t.slice(0, 48)}%`;
      binds.push(wild, wild, wild, wild, wild);
    }
    let sql = `SELECT id, first_name, middle_name, last_name, dob, phone, email, address, city, state, zip, ssn_last4, ssn_full
                 FROM persons WHERE ${where}`;
    if (params.dob) { sql += ' AND dob = ?'; binds.push(params.dob); }
    if (params.city) { sql += ' AND city LIKE ?'; binds.push(`%${params.city.slice(0, 48)}%`); }
    if (params.state) { sql += ' AND upper(state) = ?'; binds.push(params.state.toUpperCase()); }
    if (params.ssn_last4) { sql += ' AND (ssn_last4 = ? OR ssn_full LIKE ?)'; binds.push(params.ssn_last4, `%${params.ssn_last4}`); }
    sql += ' ORDER BY last_name, first_name LIMIT ?';
    binds.push(limit);
    rows = await query<PersonRow>(db, sql, ...binds);
  }

  return rows.map(personRowToProfile);
}

async function searchMicrobiltCache(db: D1Database, params: V2SearchParams): Promise<V2Profile[]> {
  const q = params.q.trim();
  if (!q) return [];
  try {
    const wild = `%${q.slice(0, 48)}%`;
    const cacheRows = await query<{ response_data: string }>(db,
      `SELECT response_data FROM microbilt_searches
        WHERE search_input LIKE ? AND hit = 1
        ORDER BY created_at DESC LIMIT 20`, wild);

    const profiles: V2Profile[] = [];
    for (const row of cacheRows) {
      try {
        const data = JSON.parse(row.response_data);
        const people = data?.PeopleDetails ?? data?.people ?? data?.results ?? [];
        if (!Array.isArray(people)) continue;
        for (const entry of people.slice(0, 10)) {
          if (!entry || typeof entry !== 'object') continue;
          const name = String(entry.Name ?? entry.name ?? '').trim();
          if (!name) continue;
          const parts = name.split(/\s+/);
          profiles.push({
            id: `MICROBILT-CACHE-${profiles.length + 1}`,
            fullName: name,
            firstName: parts[0],
            lastName: parts.slice(1).join(' ') || undefined,
            age: typeof entry.Age === 'number' ? entry.Age : undefined,
            city: String(entry['Lives in'] ?? entry.city ?? '').split(',')[0]?.trim() || undefined,
            state: String(entry['Lives in'] ?? entry.state ?? '').split(',')[1]?.trim() || undefined,
            sources: ['microbilt_cache'],
            phones: Array.isArray(entry.phones) ? entry.phones.map((n: string) => ({ number: n, source: 'microbilt_cache' })) : [],
            emails: Array.isArray(entry.emails) ? entry.emails.map((e: string) => ({ email: e, source: 'microbilt_cache' })) : [],
          });
        }
      } catch { /* skip malformed cache row */ }
    }
    return profiles;
  } catch {
    return [];
  }
}

async function getConfigValue(db: D1Database, key: string): Promise<string | null> {
  const row = await queryFirst<{ config_value: string }>(db,
    'SELECT config_value FROM system_config WHERE config_key = ? AND is_active = 1 LIMIT 1', key);
  return row?.config_value ?? null;
}

async function isSourceEnabled(db: D1Database, name: string): Promise<boolean> {
  const v = await getConfigValue(db, `skiptracer_v2_source_${name}_enabled`);
  return v !== '0' && v !== 'false';
}

async function searchRapidApi(db: D1Database, params: V2SearchParams): Promise<{ profiles: V2Profile[]; error?: string }> {
  const apiKey = await getConfigValue(db, 'skiptracer_rapidapi_key');
  if (!apiKey) return { profiles: [], error: 'not_configured' };
  if (!(await isSourceEnabled(db, 'rapidapi_skiptrace'))) return { profiles: [] };

  const host = (await getConfigValue(db, 'skiptracer_api_host'))
    ?? 'skip-tracing-api-people-search-lookup.p.rapidapi.com';
  const q = params.q.trim();
  const urlParams = new URLSearchParams();
  let path = '/api/person/search';

  if (q.replace(/\D/g, '').length >= 10) {
    path = '/api/person/reverse';
    urlParams.set('phone', q.replace(/\D/g, ''));
  } else if (q.includes('@')) {
    path = '/api/person/reverse';
    urlParams.set('email', q);
  } else {
    const first = params.firstName || q.split(/\s+/)[0] || '';
    const last = params.lastName || q.split(/\s+/).slice(1).join(' ') || '';
    urlParams.set('firstName', first);
    urlParams.set('lastName', last);
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(`https://${host}${path}?${urlParams}`, {
      headers: {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': host,
      },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { profiles: [], error: `HTTP ${res.status}` };
    const data = await res.json() as any;
    const results = data?.data?.results ?? data?.results ?? data?.people ?? [];
    const profiles: V2Profile[] = [];
    for (const rec of (Array.isArray(results) ? results : [])) {
      const first = rec.firstName ?? rec.first_name ?? '';
      const last = rec.lastName ?? rec.last_name ?? '';
      const fullName = [first, last].filter(Boolean).join(' ').trim();
      if (!fullName) continue;
      profiles.push({
        id: `RAPIDAPI-${profiles.length + 1}`,
        fullName,
        firstName: first || undefined,
        lastName: last || undefined,
        dob: rec.born ?? rec.dob ?? undefined,
        age: rec.age ? Number(rec.age) : undefined,
        sources: ['rapidapi_skiptrace'],
        addresses: rec.currentAddress ? [{ address: String(rec.currentAddress), source: 'rapidapi_skiptrace' }] : [],
        phones: Array.isArray(rec.phones) ? rec.phones.map((p: any) => ({
          number: String(p.number ?? p.phone ?? p),
          source: 'rapidapi_skiptrace',
        })) : [],
        associates: Array.isArray(rec.relatives) ? rec.relatives.map((r: any) => ({
          name: String(r.name ?? r.Name ?? r),
          relationship: 'relative',
          source: 'rapidapi_skiptrace',
        })) : [],
      });
    }
    return { profiles };
  } catch (e) {
    return { profiles: [], error: e instanceof Error ? e.message : 'rapidapi failed' };
  }
}

export function buildEnrichmentSeed(params: V2SearchParams): EnrichmentSeed | null {
  const q = params.q.trim();
  const first = params.firstName || q.split(/\s+/)[0] || '';
  const last = params.lastName || q.split(/\s+/).slice(1).join(' ') || '';
  if (!first && !last) return null;
  return {
    first_name: first,
    last_name: last,
    dob: params.dob,
    city: params.city,
    state: params.state,
    phone: q.replace(/\D/g, '').length >= 10 ? q : undefined,
    email: q.includes('@') ? q : undefined,
    address: detectSearchType(q, params) === 'address' ? q : undefined,
    ssn_last4: params.ssn_last4,
  };
}

export interface SearchOutcome {
  profiles: V2Profile[];
  sourcesQueried: string[];
  sourcesResponded: string[];
  sourcesFailed: Array<{ name: string; error: string }>;
  totalCost: number;
}

const ENRICHMENT_SOURCE_CATEGORIES: Record<string, string> = {
  nsopw: 'registry',
  sl_assessor: 'property',
  open_sanctions: 'registry',
  fbi_wanted: 'registry',
  bop_inmates: 'registry',
  usps: 'property',
  open_corporates: 'business',
  numverify: 'osint',
  census_geocoder: 'property',
  ofac_sdn: 'registry',
};

export async function runSkipTracerSearch(
  db: D1Database,
  env: Record<string, unknown>,
  params: V2SearchParams,
  enrichmentModules: Array<{ key: string; mod: { search: (seed: EnrichmentSeed, env: Record<string, unknown>) => Promise<{ ok: boolean; records: EnrichedRecord[]; error?: string }> } }>,
): Promise<SearchOutcome> {
  const sourcesQueried: string[] = [];
  const sourcesResponded: string[] = [];
  const sourcesFailed: Array<{ name: string; error: string }> = [];
  let profiles: V2Profile[] = [];
  let totalCost = 0;

  const wantLocal = params.engine === 'all' || params.engine === 'microbilt';
  const wantRapid = params.engine === 'all' || params.engine === 'rapidapi';
  const categories = new Set(params.categories);

  if (wantLocal) {
    sourcesQueried.push('local_rms', 'microbilt_cache');
    if (await isSourceEnabled(db, 'local_rms')) {
      profiles = mergeProfiles(profiles, await searchLocalPersons(db, params));
      if (profiles.length) sourcesResponded.push('local_rms');
    }
    if (await isSourceEnabled(db, 'microbilt_cache')) {
      const cached = await searchMicrobiltCache(db, params);
      profiles = mergeProfiles(profiles, cached);
      if (cached.length) sourcesResponded.push('microbilt_cache');
    }
  }

  if (wantRapid) {
    sourcesQueried.push('rapidapi_skiptrace');
    const rapid = await searchRapidApi(db, params);
    if (rapid.error === 'not_configured') {
      sourcesFailed.push({ name: 'rapidapi_skiptrace', error: 'not_configured' });
    } else if (rapid.error) {
      sourcesFailed.push({ name: 'rapidapi_skiptrace', error: rapid.error });
    } else if (rapid.profiles.length) {
      sourcesResponded.push('rapidapi_skiptrace');
      profiles = mergeProfiles(profiles, rapid.profiles);
      totalCost += 0.05 * rapid.profiles.length;
    }
  }

  const seed = buildEnrichmentSeed(params);
  if (seed) {
    for (const src of enrichmentModules) {
      const cat = ENRICHMENT_SOURCE_CATEGORIES[src.key] ?? 'osint';
      if (categories.size > 0 && !categories.has(cat)) continue;
      if (!(await isSourceEnabled(db, src.key))) continue;
      sourcesQueried.push(src.key);
      try {
        const result = await src.mod.search(seed, env);
        if (result.ok && result.records.length) {
          sourcesResponded.push(src.key);
          profiles = mergeProfiles(profiles, result.records.map(r => enrichedRecordToProfile(r, src.key)));
        } else if (!result.ok && result.error) {
          sourcesFailed.push({ name: src.key, error: result.error });
        }
      } catch (e) {
        sourcesFailed.push({ name: src.key, error: e instanceof Error ? e.message : 'failed' });
      }
    }
  }

  return { profiles, sourcesQueried, sourcesResponded, sourcesFailed, totalCost };
}

export function parseSearchParams(searchParams: URLSearchParams): V2SearchParams {
  const categoriesRaw = searchParams.get('categories') ?? '';
  return {
    q: searchParams.get('q') ?? '',
    firstName: searchParams.get('firstName') ?? undefined,
    lastName: searchParams.get('lastName') ?? undefined,
    dob: searchParams.get('dob') ?? undefined,
    ssn_last4: searchParams.get('ssn_last4') ?? undefined,
    city: searchParams.get('city') ?? undefined,
    state: searchParams.get('state') ?? undefined,
    engine: (searchParams.get('engine') as V2SearchParams['engine']) || 'microbilt',
    categories: categoriesRaw ? categoriesRaw.split(',').map(s => s.trim()).filter(Boolean) : [],
  };
}

export function detectSearchTypeFromParams(params: V2SearchParams): string {
  return detectSearchType(params.q, params);
}
