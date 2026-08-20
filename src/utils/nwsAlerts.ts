// ============================================================
// RMPG Flex — National Weather Service active-alerts client
// ============================================================
// Worker-safe wrapper for api.weather.gov. No API key required.
//
// ⚠️ Two things about this API drive the whole design:
//
// 1. Alerts carry `geometry: null`. Almost every NWS product is issued
//    against ZONES (UGC codes like UTZ479), referenced by URL in
//    `properties.affectedZones`. The polygon must be fetched per zone.
//
// 2. The bulk endpoint does NOT help. `/zones?area=UT&include_geometry=true`
//    silently ignores the flag — verified 2026-08-02: 88 Utah zones returned,
//    0 with geometry. So per-zone fetches are unavoidable.
//
// Zone polygons are effectively static (they change on NWS restructures,
// years apart) while the alert list changes by the minute — hence the two
// very different cache TTLs the route applies.
//
// NWS requires a User-Agent identifying the caller; requests without one are
// rejected. This is a documented API requirement, not politeness.
// ============================================================

import { log } from './logger';

const NWS_BASE = 'https://api.weather.gov';
const USER_AGENT = 'RMPG-Flex/1.0 (Rocky Mountain Protective Group; ops@rmpgutah.us)';
const REQUEST_TIMEOUT_MS = 10_000;

export class NwsHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'NwsHttpError';
  }
}

export type AlertSeverity = 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';

export interface NwsAlert {
  id: string;
  event: string;
  severity: AlertSeverity;
  urgency: string | null;
  certainty: string | null;
  headline: string | null;
  description: string | null;
  instruction: string | null;
  area_desc: string | null;
  sender: string | null;
  effective: string | null;
  onset: string | null;
  expires: string | null;
  ends: string | null;
  /** Zone KEYS ("fire/UTZ479") whose polygons cover this alert. Type-qualified
   *  because the bare UGC id is NOT unique across zone types. */
  zone_ids: string[];
  /** Inline polygon when NWS supplied one (storm-based warnings do). */
  geometry: unknown | null;
}

export interface NwsZoneGeometry {
  /** Type-qualified key, e.g. "fire/UTZ479". The join key. */
  key: string;
  /** Bare UGC id, e.g. "UTZ479". Display only — NOT unique across types. */
  id: string;
  name: string | null;
  geometry: unknown;
}

interface RawAlertFeature {
  properties?: Record<string, unknown>;
  geometry?: unknown;
}

async function nwsFetch(url: string, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json' },
    });
    if (!res.ok) throw new NwsHttpError(res.status, `NWS responded ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

const SEVERITIES: AlertSeverity[] = ['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown'];

function toSeverity(v: unknown): AlertSeverity {
  return SEVERITIES.includes(v as AlertSeverity) ? (v as AlertSeverity) : 'Unknown';
}

/**
 * Type-qualified zone key from a zone URL — "…/zones/fire/UTZ479" → "fire/UTZ479".
 *
 * ⚠️ Deliberately keeps the TYPE segment. The bare UGC id is NOT unique across
 * zone types (a `fire/UTZ479` and a `forecast/UTZ479` can both exist), so
 * keying geometry by id alone silently collapses two different polygons into
 * one and draws the wrong shape on the map.
 */
export function zoneKeyFromUrl(url: string): string | null {
  const m = /\/zones\/([a-z]+)\/([A-Z0-9]+)/.exec(url);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** Bare UGC id from a zone URL — display only. */
export function zoneIdFromUrl(url: string): string | null {
  const key = zoneKeyFromUrl(url);
  return key ? key.split('/')[1] : null;
}

/** Absolute NWS URL for a type-qualified zone key. */
export function zoneUrlFromKey(key: string): string {
  return `${NWS_BASE}/zones/${key}`;
}

export function parseAlerts(payload: unknown): NwsAlert[] {
  const features = (payload as { features?: RawAlertFeature[] })?.features;
  if (!Array.isArray(features)) return [];

  const out: NwsAlert[] = [];
  for (const f of features) {
    const p = f?.properties ?? {};
    const id = str(p.id);
    const event = str(p.event);
    // An alert with no id or no event name is unrenderable — skip rather than
    // emit a blank row into a dispatcher's alert list.
    if (!id || !event) continue;

    const zoneUrls = Array.isArray(p.affectedZones) ? (p.affectedZones as unknown[]) : [];
    const zone_ids = zoneUrls
      .filter((z): z is string => typeof z === 'string')
      .map(zoneKeyFromUrl)
      .filter((z): z is string => z != null);

    out.push({
      id,
      event,
      severity: toSeverity(p.severity),
      urgency: str(p.urgency),
      certainty: str(p.certainty),
      headline: str(p.headline),
      description: str(p.description),
      instruction: str(p.instruction),
      area_desc: str(p.areaDesc),
      sender: str(p.senderName),
      effective: str(p.effective),
      onset: str(p.onset),
      expires: str(p.expires),
      ends: str(p.ends),
      zone_ids,
      geometry: f.geometry ?? null,
    });
  }
  return out;
}

/**
 * Coordinate decimal places kept when caching zone geometry.
 *
 * NWS ships 6-7 decimals (~10 cm) for zones that span tens of miles. 4 decimals
 * is ~11 m — far finer than a warning boundary is meaningful to — and cuts the
 * Utah payload by roughly a third. Applied BEFORE the KV write so the saving
 * is paid once, not on every read.
 */
const COORD_PRECISION = 4;

function roundCoords(node: unknown): unknown {
  if (typeof node === 'number') {
    const f = 10 ** COORD_PRECISION;
    return Math.round(node * f) / f;
  }
  return Array.isArray(node) ? node.map(roundCoords) : node;
}

/** Quantize a GeoJSON geometry's coordinates in place-free fashion. */
export function quantizeGeometry(geometry: unknown): unknown {
  if (!geometry || typeof geometry !== 'object') return geometry;
  const g = geometry as { type?: string; coordinates?: unknown };
  if (!g.coordinates) return geometry;
  return { ...g, coordinates: roundCoords(g.coordinates) };
}

/** Active alerts for a state/marine area code (e.g. "UT"). */
export async function fetchActiveAlerts(area: string, signal?: AbortSignal): Promise<NwsAlert[]> {
  const payload = await nwsFetch(`${NWS_BASE}/alerts/active?area=${encodeURIComponent(area)}`, signal);
  return parseAlerts(payload);
}

/** Polygon for one zone URL. Returns null when NWS has no geometry for it. */
export async function fetchZoneGeometry(zoneUrl: string, signal?: AbortSignal): Promise<NwsZoneGeometry | null> {
  const key = zoneKeyFromUrl(zoneUrl);
  if (!key) return null;
  try {
    const payload = (await nwsFetch(zoneUrl, signal)) as {
      geometry?: unknown;
      properties?: { name?: string };
    };
    if (!payload?.geometry) return null;
    return {
      key,
      id: key.split('/')[1],
      name: str(payload.properties?.name),
      geometry: quantizeGeometry(payload.geometry),
    };
  } catch (err) {
    // One unreachable zone must not sink the whole alert list — the alert
    // still renders in the list panel, just without its polygon.
    log.warn('nws zone geometry fetch failed', { zoneUrl, err: String(err) });
    return null;
  }
}

/**
 * Resolve many zone URLs with bounded concurrency.
 *
 * NWS publishes no numeric rate limit but asks callers not to hammer the API.
 * A cold cache for Utah is ~36 zones; 4-at-a-time keeps that to ~9 sequential
 * round trips while staying well-mannered. `limit` caps total fetches per
 * request so a pathological alert day can't stall the endpoint — uncached
 * zones simply fill in on the next poll.
 */
export async function fetchZonesBounded(
  zoneUrls: string[],
  opts: { concurrency?: number; limit?: number; signal?: AbortSignal } = {},
): Promise<NwsZoneGeometry[]> {
  const { concurrency = 4, limit = 60, signal } = opts;
  const queue = zoneUrls.slice(0, limit);
  const results: NwsZoneGeometry[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < queue.length) {
      const i = cursor++;
      const geo = await fetchZoneGeometry(queue[i], signal);
      if (geo) results.push(geo);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return results;
}
