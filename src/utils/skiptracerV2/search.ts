import type { EnrichmentSeed, EnrichedRecord, EnrichmentResponse } from '../enrichment/types';
import { runEnrichmentSearch } from '../enrichment/runSearch';
import { ENRICHMENT_SOURCE_CATEGORIES, OPEN_SOURCE_ENRICHMENT_SOURCES } from '../enrichment/catalog';
import { splitPersonName } from '../enrichment/sources/http';
import { query, queryFirst } from '../db';
import { mapSkipTracerRecordsToProfiles, normalizeResponse } from '../personIntel/adapters/skiptracer';
import { enrichVehicleRecord, type EnrichEnv } from '../vehicleEnrichment/enrichChain';
import { decodeVin } from '../vehicleEnrichment/client';

export interface VehicleRecord {
  year?: string;
  make?: string;
  model?: string;
  color?: string;
  plate?: string;
  plateState?: string;
  vin?: string;
  source: string;
}

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
  confidenceScore?: number;
  matchTier?: 'CONFIRMED' | 'UNCONFIRMED';
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
  vehicles?: VehicleRecord[];
}

export interface V2SearchParams {
  q: string;
  firstName?: string;
  lastName?: string;
  dob?: string;
  ssn_last4?: string;
  city?: string;
  state?: string;
  /** Optional address seed for enrichment property sources during a name search. */
  address?: string;
  /** microbilt = local + open-source enrichment; rapidapi = RapidAPI; all = everything */
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
    matchTier: 'CONFIRMED',
    confidenceScore: 1,
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

export function enrichedRecordToProfile(
  rec: EnrichedRecord,
  sourceKey: string,
  matchTier: 'CONFIRMED' | 'UNCONFIRMED',
): V2Profile {
  const { first, last } = splitPersonName('', '', rec.name ?? '');
  const confirmed = matchTier === 'CONFIRMED';
  return {
    id: `${sourceKey}-${crypto.randomUUID()}`,
    fullName: rec.name,
    firstName: first || undefined,
    lastName: last || undefined,
    dob: rec.dob,
    ssn_last4: rec.ssn_last4,
    matchTier,
    confidenceScore: confirmed ? 0.95 : 0.45,
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
    sexOffenderRecords: sourceKey === 'nsopw' && rec.watchlist_flags?.length
      ? [{ registryState: rec.addresses[0]?.state, offenses: rec.watchlist_flags, source: sourceKey }]
      : undefined,
    custodyRecords: sourceKey === 'bop_inmates' && rec.name
      ? [{ facility: rec.raw && typeof rec.raw === 'object' ? String((rec.raw as any).facility ?? 'BOP') : 'BOP', source: sourceKey }]
      : undefined,
  };
}

function isVin(value: string): boolean {
  const v = value.replace(/\s/g, '').toUpperCase();
  return v.length === 17 && /^[A-HJ-NPR-Z0-9]{17}$/.test(v);
}

export function parseVehicleQuery(q: string, stateParam?: string): { plate?: string; state?: string; vin?: string } {
  const trimmed = q.trim();
  if (isVin(trimmed)) return { vin: trimmed.replace(/\s/g, '').toUpperCase() };
  const combined = trimmed.toUpperCase();
  const statePlate = combined.match(/^([A-Z]{2})[\s-]+([A-Z0-9-]+)$/);
  if (statePlate) return { state: statePlate[1], plate: statePlate[2].replace(/[^A-Z0-9]/g, '') };
  // Multi-word queries are people or addresses, not plates.
  if (/\s/.test(trimmed)) return {};
  const plateOnly = combined.replace(/[^A-Z0-9]/g, '');
  if (stateParam && plateOnly.length >= 2 && plateOnly.length <= 8) {
    return { plate: plateOnly, state: stateParam.toUpperCase() };
  }
  if (/^[A-Z0-9]{2,8}$/.test(plateOnly) && !isVin(plateOnly)) return { plate: plateOnly };
  return {};
}

function detectSearchType(q: string, params: V2SearchParams): string {
  const trimmed = q.trim();
  if (params.firstName || params.lastName) return 'name';
  if (!trimmed) return 'general';
  if (isVin(trimmed)) return 'vin';
  const vehicle = parseVehicleQuery(trimmed, params.state);
  if (vehicle.plate || vehicle.vin) return 'vehicle';
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length >= 10 && digits.length === trimmed.replace(/\D/g, '').length && !/[A-Za-z]/.test(trimmed)) {
    return 'phone';
  }
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
        matchTier: base.matchTier === 'CONFIRMED' || p.matchTier === 'CONFIRMED' ? 'CONFIRMED' : 'UNCONFIRMED',
        confidenceScore: Math.max(base.confidenceScore ?? 0, p.confidenceScore ?? 0),
        sources: [...new Set([...(base.sources ?? []), ...(p.sources ?? [])])],
        addresses: [...(base.addresses ?? []), ...(p.addresses ?? [])],
        phones: [...(base.phones ?? []), ...(p.phones ?? [])],
        emails: [...(base.emails ?? []), ...(p.emails ?? [])],
        watchlistFlags: [...(base.watchlistFlags ?? []), ...(p.watchlistFlags ?? [])],
        custodyRecords: [...(base.custodyRecords ?? []), ...(p.custodyRecords ?? [])],
        sexOffenderRecords: [...(base.sexOffenderRecords ?? []), ...(p.sexOffenderRecords ?? [])],
        propertyRecords: [...(base.propertyRecords ?? []), ...(p.propertyRecords ?? [])],
        businesses: [...(base.businesses ?? []), ...(p.businesses ?? [])],
        vehicles: [...(base.vehicles ?? []), ...(p.vehicles ?? [])],
      };
    } else {
      out.push(p);
    }
  }
  return out;
}

async function isSourceEnabled(db: D1Database, name: string): Promise<boolean> {
  const row = await queryFirst<{ config_value: string }>(db,
    'SELECT config_value FROM system_config WHERE config_key = ? AND is_active = 1 LIMIT 1',
    `skiptracer_v2_source_${name}_enabled`,
  );
  const v = row?.config_value;
  return v !== '0' && v !== 'false';
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

async function getConfigValue(db: D1Database, key: string): Promise<string | null> {
  const row = await queryFirst<{ config_value: string }>(db,
    'SELECT config_value FROM system_config WHERE config_key = ? AND is_active = 1 LIMIT 1', key);
  return row?.config_value ?? null;
}

async function getRapidApiKey(db: D1Database): Promise<string | null> {
  for (const key of ['skiptracer_rapidapi_key', 'plate_check_rapidapi_key']) {
    const value = (await getConfigValue(db, key))?.trim();
    if (value) return value;
  }
  return null;
}

interface VehicleRow {
  id: number;
  plate_number: string | null;
  state: string | null;
  vin: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
}

function vehicleDataToProfile(
  data: { plate?: string; state?: string; vin?: string; make?: string | null; model?: string | null; year?: number | null; color?: string | null },
  source: string,
  idSuffix: string,
): V2Profile {
  const label = [data.year, data.make, data.model].filter(Boolean).join(' ').trim();
  const vehicle: VehicleRecord = {
    year: data.year != null ? String(data.year) : undefined,
    make: data.make ?? undefined,
    model: data.model ?? undefined,
    color: data.color ?? undefined,
    plate: data.plate,
    plateState: data.state,
    vin: data.vin,
    source,
  };
  return {
    id: idSuffix,
    fullName: label || data.plate || data.vin || 'Vehicle',
    matchTier: 'CONFIRMED',
    confidenceScore: 1,
    sources: [source],
    vehicles: [vehicle],
  };
}

async function searchLocalVehicles(db: D1Database, params: V2SearchParams): Promise<V2Profile[]> {
  const parsed = parseVehicleQuery(params.q.trim(), params.state);
  const limit = 25;
  let rows: VehicleRow[] = [];

  if (parsed.vin) {
    rows = await query<VehicleRow>(db,
      `SELECT id, plate_number, state, vin, make, model, year, color
         FROM vehicles_records
        WHERE UPPER(TRIM(vin)) = ?
          AND vin IS NOT NULL AND TRIM(vin) != ''
        ORDER BY id DESC LIMIT ?`,
      parsed.vin, limit);
  } else if (parsed.plate) {
    const plate = parsed.plate.toUpperCase();
    if (parsed.state) {
      rows = await query<VehicleRow>(db,
        `SELECT id, plate_number, state, vin, make, model, year, color
           FROM vehicles_records
          WHERE UPPER(TRIM(plate_number)) = ? AND UPPER(TRIM(state)) = ?
          ORDER BY id DESC LIMIT ?`,
        plate, parsed.state.toUpperCase(), limit);
    } else {
      rows = await query<VehicleRow>(db,
        `SELECT id, plate_number, state, vin, make, model, year, color
           FROM vehicles_records
          WHERE UPPER(TRIM(plate_number)) = ?
          ORDER BY id DESC LIMIT ?`,
        plate, limit);
    }
  }

  return rows.map(r => vehicleDataToProfile({
    plate: r.plate_number ?? undefined,
    state: r.state ?? undefined,
    vin: r.vin ?? undefined,
    make: r.make,
    model: r.model,
    year: r.year,
    color: r.color,
  }, 'local_rms', `LOCAL-VEH-${r.id}`));
}

async function searchVehicleEnrichment(
  db: D1Database,
  env: Record<string, unknown>,
  params: V2SearchParams,
): Promise<{ profiles: V2Profile[]; error?: string; sourcesResponded: string[]; sourcesFailed: Array<{ name: string; error: string }> }> {
  const parsed = parseVehicleQuery(params.q.trim(), params.state);
  const sourcesResponded: string[] = [];
  const sourcesFailed: Array<{ name: string; error: string }> = [];

  // Secrets preferred; Admin → Skip Tracer can also store keys in system_config.
  const plateToVin = (env.PLATE_TO_VIN_API_KEY as string | undefined)?.trim()
    || (await getConfigValue(db, 'plate_to_vin_api_key'))
    || (await getConfigValue(db, 'plate_check_rapidapi_key'));
  const vinDecoder = (env.VIN_DECODER_API_KEY as string | undefined)?.trim()
    || (await getConfigValue(db, 'vin_decoder_api_key'));
  const plateDecoder = (env.PLATE_DECODER_API_KEY as string | undefined)?.trim()
    || (await getConfigValue(db, 'plate_decoder_api_key'));
  const enrichEnv = {
    ...env,
    PLATE_TO_VIN_API_KEY: plateToVin || undefined,
    VIN_DECODER_API_KEY: vinDecoder || undefined,
    PLATE_DECODER_API_KEY: plateDecoder || undefined,
  } as EnrichEnv;

  if (parsed.plate && parsed.state) {
    const hasAnyKey = enrichEnv.PLATE_TO_VIN_API_KEY || enrichEnv.VIN_DECODER_API_KEY || enrichEnv.PLATE_DECODER_API_KEY;
    if (!hasAnyKey) {
      return { profiles: [], error: 'not_configured', sourcesResponded, sourcesFailed: [{ name: 'vehicle_enrichment', error: 'not_configured' }] };
    }
    try {
      const result = await enrichVehicleRecord(parsed.plate, parsed.state, db, enrichEnv);
      if (result.stepsRun.length) sourcesResponded.push('vehicle_enrichment');
      for (const [step, err] of Object.entries(result.stepErrors)) {
        if (err && err !== 'config:no_key') sourcesFailed.push({ name: step, error: err });
      }
      const profile = vehicleDataToProfile({
        plate: parsed.plate,
        state: parsed.state,
        vin: result.data.vin ?? undefined,
        make: result.data.make,
        model: result.data.model,
        year: result.data.year,
        color: result.data.color,
      }, 'vehicle_enrichment', `VEH-${parsed.state}-${parsed.plate}`);
      return { profiles: [profile], sourcesResponded, sourcesFailed };
    } catch (e) {
      return {
        profiles: [],
        error: e instanceof Error ? e.message : 'vehicle enrichment failed',
        sourcesResponded,
        sourcesFailed: [{ name: 'vehicle_enrichment', error: e instanceof Error ? e.message : 'failed' }],
      };
    }
  }

  if (parsed.vin && enrichEnv.VIN_DECODER_API_KEY) {
    try {
      const decoded = await decodeVin(parsed.vin, enrichEnv.VIN_DECODER_API_KEY);
      sourcesResponded.push('vehicle_vin_decoder');
      const profile = vehicleDataToProfile({
        vin: parsed.vin,
        make: decoded.make,
        model: decoded.model,
        year: decoded.year,
        color: decoded.color,
      }, 'vehicle_vin_decoder', `VIN-${parsed.vin}`);
      return { profiles: [profile], sourcesResponded, sourcesFailed };
    } catch (e) {
      sourcesFailed.push({ name: 'vehicle_vin_decoder', error: e instanceof Error ? e.message : 'failed' });
    }
  }

  if (parsed.vin || parsed.plate) {
    return { profiles: [], error: parsed.plate && !parsed.state ? 'state_required' : 'not_configured', sourcesResponded, sourcesFailed };
  }
  return { profiles: [], sourcesResponded, sourcesFailed };
}

async function searchRapidApi(db: D1Database, params: V2SearchParams): Promise<{ profiles: V2Profile[]; error?: string }> {
  const apiKey = await getRapidApiKey(db);
  if (!apiKey) return { profiles: [], error: 'not_configured' };
  if (!(await isSourceEnabled(db, 'rapidapi_skiptrace'))) return { profiles: [], error: 'disabled' };

  const host = (await getConfigValue(db, 'skiptracer_api_host'))
    ?? 'skip-tracing-api-people-search-lookup.p.rapidapi.com';
  const q = params.q.trim();
  const searchType = detectSearchType(q, params);
  const urlParams = new URLSearchParams();
  let path = '/api/person/search';

  if (searchType === 'phone') {
    path = '/api/person/reverse';
    urlParams.set('phone', q.replace(/\D/g, ''));
  } else if (searchType === 'email') {
    path = '/api/person/reverse';
    urlParams.set('email', q);
  } else if (searchType === 'address') {
    path = '/api/person/reverse';
    urlParams.set('address', q);
  } else {
    // "Karl Allen Turley" → firstName=Karl, lastName=Turley (not "Allen Turley").
    const parts = [params.firstName, params.lastName].filter(Boolean).join(' ').trim()
      || q;
    const tokens = parts.split(/\s+/).filter(Boolean);
    const first = tokens[0] || '';
    const last = tokens.length > 1 ? tokens[tokens.length - 1] : '';
    urlParams.set('firstName', first);
    urlParams.set('lastName', last);
    if (params.city) urlParams.set('city', params.city);
    if (params.state) urlParams.set('state', params.state);
    if (params.dob) urlParams.set('dob', params.dob);
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(`https://${host}${path}?${urlParams}`, {
      headers: {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': host,
        Accept: 'application/json',
        'User-Agent': 'RMPG-Flex/1.0 (Cloudflare Workers; sworn LE)',
      },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const snippet = body.replace(/\s+/g, ' ').slice(0, 120);
      return { profiles: [], error: `HTTP ${res.status}${snippet ? `: ${snippet}` : ''}` };
    }
    const data = await res.json() as Record<string, unknown>;
    const records = normalizeResponse(data);
    const mapped = mapSkipTracerRecordsToProfiles(records);
    const profiles: V2Profile[] = mapped.map((rec, i) => ({
      id: `RAPIDAPI-${i + 1}`,
      fullName: rec.fullName,
      firstName: rec.firstName,
      lastName: rec.lastName,
      dob: rec.dob,
      age: rec.age,
      matchTier: 'UNCONFIRMED',
      confidenceScore: 0.6,
      sources: ['rapidapi_skiptrace'],
      addresses: rec.addresses,
      phones: rec.phones,
      emails: rec.emails,
      associates: rec.associates,
    }));
    return { profiles };
  } catch (e) {
    return { profiles: [], error: e instanceof Error ? e.message : 'rapidapi failed' };
  }
}

export function buildEnrichmentSeed(params: V2SearchParams): EnrichmentSeed | null {
  const q = params.q.trim();
  const searchType = detectSearchType(q, params);

  if (searchType === 'vehicle' || searchType === 'vin') return null;

  if (searchType === 'address') {
    return {
      first_name: '',
      last_name: '',
      city: params.city,
      state: params.state,
      address: q,
    };
  }

  // Prefer explicit first/last; otherwise split "Karl Allen Turley" → Karl / Turley.
  const tokens = [params.firstName, params.lastName].filter(Boolean).join(' ').trim().split(/\s+/).filter(Boolean);
  const qTokens = q.split(/\s+/).filter(Boolean);
  const parts = tokens.length >= 2 ? tokens : qTokens;
  const first = parts[0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1] : '';
  if (!first && !last) return null;
  return {
    first_name: first,
    last_name: last,
    dob: params.dob,
    city: params.city,
    state: params.state,
    address: params.address,
    phone: searchType === 'phone' ? q : undefined,
    email: searchType === 'email' ? q : undefined,
    ssn_last4: params.ssn_last4,
  };
}

export interface SearchOutcome {
  profiles: V2Profile[];
  sourcesQueried: string[];
  sourcesResponded: string[];
  sourcesFailed: Array<{ name: string; error: string }>;
  totalCost: number;
  matchTier?: 'CONFIRMED' | 'UNCONFIRMED';
  anchors?: string[];
}

function enrichmentProfiles(
  enrichment: EnrichmentResponse,
  categories: Set<string>,
): { profiles: V2Profile[]; queried: string[]; responded: string[]; failed: Array<{ name: string; error: string }> } {
  const profiles: V2Profile[] = [];
  const queried: string[] = [];
  const responded: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];

  for (const src of enrichment.sources) {
    const cat = ENRICHMENT_SOURCE_CATEGORIES[src.source] ?? 'osint';
    if (categories.size > 0 && !categories.has(cat)) continue;
    queried.push(src.source);
    if (src.ok && src.records.length) {
      responded.push(src.source);
      for (const rec of src.records) {
        const tier = enrichment.match_tier;
        profiles.push(enrichedRecordToProfile(rec, src.source, tier));
      }
    } else if (!src.ok && src.error && src.error !== 'not_configured') {
      failed.push({ name: src.source, error: src.error });
    }
  }
  return { profiles, queried, responded, failed };
}

export async function runSkipTracerSearch(
  db: D1Database,
  env: Record<string, unknown>,
  params: V2SearchParams,
  searchedBy?: number | null,
): Promise<SearchOutcome> {
  const sourcesQueried: string[] = [];
  const sourcesResponded: string[] = [];
  const sourcesFailed: Array<{ name: string; error: string }> = [];
  let profiles: V2Profile[] = [];
  let totalCost = 0;
  const categories = new Set(params.categories);

  const searchType = detectSearchType(params.q, params);
  const isVehicleSearch = searchType === 'vehicle' || searchType === 'vin';

  const wantLocal = !isVehicleSearch && (params.engine === 'all' || params.engine === 'microbilt');
  const wantRapid = !isVehicleSearch && (params.engine === 'all' || params.engine === 'rapidapi');
  const wantEnrichment = !isVehicleSearch && (params.engine === 'all' || params.engine === 'microbilt');
  const wantVehicle = isVehicleSearch && (params.engine === 'all' || params.engine === 'rapidapi' || params.engine === 'microbilt');

  if (wantVehicle) {
    if (await isSourceEnabled(db, 'local_rms')) {
      sourcesQueried.push('local_rms');
      const localVehicles = await searchLocalVehicles(db, params);
      profiles = mergeProfiles(profiles, localVehicles);
      if (localVehicles.length) sourcesResponded.push('local_rms');
    }
    if (params.engine === 'all' || params.engine === 'rapidapi') {
      sourcesQueried.push('vehicle_enrichment');
      const vehicle = await searchVehicleEnrichment(db, env, params);
      if (vehicle.error === 'not_configured') {
        sourcesFailed.push({ name: 'vehicle_enrichment', error: 'not_configured' });
      } else if (vehicle.error && vehicle.profiles.length === 0) {
        sourcesFailed.push({ name: 'vehicle_enrichment', error: vehicle.error });
      }
      sourcesResponded.push(...vehicle.sourcesResponded);
      sourcesFailed.push(...vehicle.sourcesFailed);
      if (vehicle.profiles.length) {
        profiles = mergeProfiles(profiles, vehicle.profiles);
        totalCost += 0.05;
      }
    }
    return {
      profiles,
      sourcesQueried,
      sourcesResponded,
      sourcesFailed,
      totalCost,
    };
  }

  if (wantLocal && await isSourceEnabled(db, 'local_rms')) {
    sourcesQueried.push('local_rms');
    const local = await searchLocalPersons(db, params);
    profiles = mergeProfiles(profiles, local);
    if (local.length) sourcesResponded.push('local_rms');
  }

  if (wantRapid) {
    sourcesQueried.push('rapidapi_skiptrace');
    const rapid = await searchRapidApi(db, params);
    if (rapid.error === 'not_configured') {
      sourcesFailed.push({ name: 'rapidapi_skiptrace', error: 'not_configured' });
    } else if (rapid.error === 'disabled') {
      sourcesFailed.push({ name: 'rapidapi_skiptrace', error: 'disabled' });
    } else if (rapid.error) {
      sourcesFailed.push({ name: 'rapidapi_skiptrace', error: rapid.error });
    } else if (rapid.profiles.length) {
      sourcesResponded.push('rapidapi_skiptrace');
      profiles = mergeProfiles(profiles, rapid.profiles);
      totalCost += 0.05 * rapid.profiles.length;
    }
  }

  const seed = buildEnrichmentSeed(params);
  let matchTier: 'CONFIRMED' | 'UNCONFIRMED' | undefined;
  let anchors: string[] | undefined;

  if (wantEnrichment && seed) {
    const activeSources = [];
    for (const src of OPEN_SOURCE_ENRICHMENT_SOURCES) {
      if (categories.size > 0 && !categories.has(src.category)) continue;
      if (!(await isSourceEnabled(db, src.key))) continue;
      activeSources.push(src);
    }

    if (activeSources.length > 0) {
      const enrichment = await runEnrichmentSearch(db, env, seed, {
        sources: activeSources,
        searchedBy,
      });
      matchTier = enrichment.match_tier;
      anchors = enrichment.anchors;
      const mapped = enrichmentProfiles(enrichment, categories);
      sourcesQueried.push(...mapped.queried);
      sourcesResponded.push(...mapped.responded);
      sourcesFailed.push(...mapped.failed);
      profiles = mergeProfiles(profiles, mapped.profiles);
    }
  }

  return {
    profiles,
    sourcesQueried,
    sourcesResponded,
    sourcesFailed,
    totalCost,
    matchTier,
    anchors,
  };
}

export function parseSearchParams(searchParams: URLSearchParams): V2SearchParams {
  const categoriesRaw = searchParams.get('categories') ?? '';
  const engineRaw = searchParams.get('engine');
  const engine = engineRaw === 'microbilt' || engineRaw === 'rapidapi' ? engineRaw : 'all';
  return {
    q: searchParams.get('q') ?? '',
    firstName: searchParams.get('firstName') ?? undefined,
    lastName: searchParams.get('lastName') ?? undefined,
    dob: searchParams.get('dob') ?? undefined,
    ssn_last4: searchParams.get('ssn_last4') ?? undefined,
    city: searchParams.get('city') ?? undefined,
    state: searchParams.get('state') ?? undefined,
    address: searchParams.get('address') ?? undefined,
    engine,
    categories: categoriesRaw ? categoriesRaw.split(',').map(s => s.trim()).filter(Boolean) : [],
  };
}

export function detectSearchTypeFromParams(params: V2SearchParams): string {
  return detectSearchType(params.q, params);
}

/** Reconstruct a display/re-run query from stored history JSON. */
export function historyQueryFromParams(params: Record<string, unknown>): string {
  const q = typeof params.q === 'string' ? params.q.trim() : '';
  if (q) return q;
  for (const key of ['name', 'phone', 'email', 'address'] as const) {
    const legacy = params[key];
    if (typeof legacy === 'string' && legacy.trim()) return legacy.trim();
  }
  const parts = [params.firstName, params.lastName].filter(v => typeof v === 'string' && v.trim()).join(' ');
  return parts.trim();
}
