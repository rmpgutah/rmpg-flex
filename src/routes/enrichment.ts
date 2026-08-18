import { Hono } from 'hono';
import type { Env } from '../types';
import { queryFirst, execute, query } from '../utils/db';
import { recordAudit } from '../utils/auditLog';
import { computeCacheKey } from '../utils/enrichment/normalize';
import { hardLock } from '../utils/enrichment/matcher';
import { normalizeDob } from '../utils/normalizeDob';
import type { EnrichmentSeed, SourceResult, EnrichedRecord, EnrichmentResponse } from '../utils/enrichment/types';
import * as nsopwSrc from '../utils/enrichment/sources/nsopw';
import * as assessorSrc from '../utils/enrichment/sources/assessor';
import * as openSanctionsSrc from '../utils/enrichment/sources/openSanctions';
import * as uspsSrc from '../utils/enrichment/sources/usps';
import * as openCorporatesSrc from '../utils/enrichment/sources/openCorporates';
import * as numverifySrc from '../utils/enrichment/sources/numverify';
import * as fbiSrc from '../utils/enrichment/sources/fbi';
import * as bopSrc from '../utils/enrichment/sources/bop';
import * as ofacSrc from '../utils/enrichment/sources/ofac';

const enrichment = new Hono<Env>();

function actorId(c: any): number | null {
  const u = c.get('user');
  return u?.user_id ?? u?.userId ?? u?.id ?? null;
}

const SOURCES = [
  { key: 'nsopw',            label: 'NSOPW',              requiresKey: null,                     mod: nsopwSrc },
  { key: 'sl_assessor',      label: 'SL County Assessor', requiresKey: null,                     mod: assessorSrc },
  { key: 'open_sanctions',   label: 'OpenSanctions',      requiresKey: null,                     mod: openSanctionsSrc },
  { key: 'fbi_wanted',       label: 'FBI Most Wanted',    requiresKey: null,                     mod: fbiSrc },
  { key: 'bop_inmates',      label: 'BOP Inmate Locator', requiresKey: null,                     mod: bopSrc },
  { key: 'usps',             label: 'USPS Web Tools',     requiresKey: 'USPS_USER_ID',           mod: uspsSrc },
  { key: 'open_corporates',  label: 'OpenCorporates',     requiresKey: 'OPENCORPORATES_API_KEY', mod: openCorporatesSrc },
  { key: 'numverify',        label: 'Numverify',          requiresKey: 'NUMVERIFY_API_KEY',      mod: numverifySrc },
  { key: 'ofac_sdn',        label: 'OFAC SDN',           requiresKey: null,                     mod: ofacSrc },
] as const;

enrichment.get('/sources', (c) => {
  const env = c.env as any;
  return c.json(SOURCES.map(s => ({
    key: s.key,
    label: s.label,
    configured: s.requiresKey ? Boolean((env[s.requiresKey] ?? '').trim()) : true,
  })));
});

enrichment.post('/search', async (c) => {
  const body = await c.req.json<Partial<EnrichmentSeed>>();
  const first = (body.first_name ?? '').trim();
  const last  = (body.last_name  ?? '').trim();
  if (!first || !last) return c.json({ error: 'first_name and last_name required' }, 400);

  const seed: EnrichmentSeed = {
    first_name: first,
    last_name:  last,
    dob:        normalizeDob(body.dob ?? null) ?? undefined,
    city:       body.city,
    state:      body.state,
    address:    body.address,
    phone:      body.phone,
    email:      body.email,
    dl_number:  body.dl_number,
    ssn_last4:  body.ssn_last4,
  };

  const cacheKey = await computeCacheKey(seed);

  // Check for fresh cache hit
  const cached = await queryFirst<{
    results_json: string; match_tier: string; anchors_json: string | null;
    source_count: number; searched_at: string; expires_at: string;
  }>(c.env.DB,
    `SELECT results_json, match_tier, anchors_json, source_count, searched_at, expires_at
     FROM enrichment_cache WHERE cache_key = ?`, cacheKey);

  const now = new Date();
  if (cached) {
    const isStale = new Date(cached.expires_at) < now;
    const parsed = JSON.parse(cached.results_json) as EnrichmentResponse;
    return c.json({ ...parsed, cached: true, stale: isStale });
  }

  // Load known city+state anchors from local persons + dl_records
  const knownCityStates: string[] = [];
  const personRows = await query<{ city: string | null; state: string | null }>(
    c.env.DB,
    `SELECT city, state FROM persons
     WHERE lower(trim(first_name)) = ? AND lower(trim(last_name)) = ? LIMIT 20`,
    first.toLowerCase(), last.toLowerCase(),
  );
  for (const r of personRows) {
    if (r.city && r.state) knownCityStates.push(`${r.city.toLowerCase()}|${r.state.toLowerCase()}`);
  }

  // Fan out to all source adapters
  const env = c.env as any;
  const settled = await Promise.allSettled(
    SOURCES.map(s => s.mod.search(seed, env)),
  );

  const sources: SourceResult[] = settled.map((r, i) =>
    r.status === 'fulfilled' ? r.value : {
      source: SOURCES[i].key, ok: false, latency_ms: 0, records: [],
      error: r.reason instanceof Error ? r.reason.message : 'unknown',
    },
  );

  // Run hard-lock matcher on every record from every source
  const confirmedRecords: EnrichedRecord[] = [];
  const unconfirmedRecords: EnrichedRecord[] = [];
  let confirmedCount = 0;
  const allAnchors = new Set<string>();

  for (const src of sources) {
    for (const rec of src.records) {
      const lock = hardLock(seed, rec, knownCityStates);
      if (lock.confirmed) {
        confirmedCount++;
        lock.anchors.forEach(a => allAnchors.add(a));
        confirmedRecords.push(rec);
      } else {
        unconfirmedRecords.push(rec);
      }
    }
  }
  const allRecords = [...confirmedRecords, ...unconfirmedRecords];

  const matchTier = confirmedCount > 0 ? 'CONFIRMED' : 'UNCONFIRMED';
  const searchedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  const response: EnrichmentResponse = {
    match_tier: matchTier,
    anchors: Array.from(allAnchors),
    sources,
    records: allRecords,
    confirmed_count: confirmedCount,
    cached: false,
    stale: false,
    searched_at: searchedAt,
  };

  // Persist to cache
  await execute(c.env.DB,
    `INSERT INTO enrichment_cache
       (cache_key, seed_json, results_json, match_tier, anchors_json, source_count, searched_at, expires_at, searched_by)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(cache_key) DO UPDATE SET
       results_json=excluded.results_json, match_tier=excluded.match_tier,
       anchors_json=excluded.anchors_json, source_count=excluded.source_count,
       searched_at=excluded.searched_at, expires_at=excluded.expires_at,
       searched_by=excluded.searched_by`,
    cacheKey, JSON.stringify(seed), JSON.stringify(response),
    matchTier, JSON.stringify(Array.from(allAnchors)), sources.length,
    searchedAt, expiresAt, actorId(c),
  );

  await recordAudit(c, {
    action: 'enrichment.search', entityType: 'person', entityId: null,
    details: JSON.stringify({ match_tier: matchTier, source_count: sources.length, confirmed_count: confirmedCount }),
    actorId: actorId(c),
  });

  return c.json(response);
});

export default enrichment;
