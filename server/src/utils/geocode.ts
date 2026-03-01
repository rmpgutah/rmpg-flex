// ============================================================
// RMPG Flex — Geocoding Utility
// ============================================================
// Dual-provider geocoder: UGRC (Utah primary) + Google (fallback).
// UGRC is free, no rate limits, and authoritative for Utah addresses.
// Google handles out-of-state and acts as fallback if UGRC fails.
// UGRC API key stored in system_config (encrypted) with hardcoded default.

import { getDb } from '../models/database';
import crypto from 'crypto';
import config from '../config';

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// Default UGRC API key — can be overridden via admin UI
const DEFAULT_UGRC_KEY = 'UGRC-03ECCCBD387119';

// ── Encryption (shared with other integrations) ──────────────

function deriveKey(): Buffer {
  return crypto.createHash('sha256').update(config.jwt.secret).digest();
}

export function encryptUgrcKey(plaintext: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decryptCredential(stored: string): string {
  const key = deriveKey();
  const [ivHex, authTagHex, encrypted] = stored.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ── UGRC credential resolution ───────────────────────────────

function getUgrcApiKey(): string {
  try {
    const db = getDb();
    const row = db.prepare(
      `SELECT config_value FROM system_config WHERE config_key = 'ugrc_api_key'`
    ).get() as any;
    if (row?.config_value) return decryptCredential(row.config_value);
  } catch { /* fall through */ }
  return DEFAULT_UGRC_KEY;
}

export function isUgrcConfigured(): boolean {
  return !!getUgrcApiKey();
}

export function getStoredUgrcKey(): string | null {
  try {
    const db = getDb();
    const row = db.prepare(
      `SELECT config_value FROM system_config WHERE config_key = 'ugrc_api_key'`
    ).get() as any;
    if (row?.config_value) return decryptCredential(row.config_value);
  } catch { /* fall through */ }
  return null;
}

// ── Utah address detection ───────────────────────────────────

const UTAH_CITIES = new Set([
  'salt lake city', 'west valley city', 'provo', 'west jordan', 'orem',
  'sandy', 'ogden', 'st. george', 'saint george', 'layton', 'south jordan',
  'lehi', 'millcreek', 'taylorsville', 'logan', 'murray', 'draper',
  'bountiful', 'riverton', 'herriman', 'spanish fork', 'pleasant grove',
  'springville', 'tooele', 'eagle mountain', 'cedar city', 'kaysville',
  'clearfield', 'cottonwood heights', 'midvale', 'roy', 'american fork',
  'syracuse', 'saratoga springs', 'holladay', 'brigham city', 'north ogden',
  'south ogden', 'farmington', 'heber city', 'payson', 'lindon', 'vineyard',
  'centerville', 'north salt lake', 'west haven', 'park city', 'mapleton',
  'highland', 'alpine', 'bluffdale', 'hurricane', 'washington', 'ivins',
  'vernal', 'richfield', 'price', 'moab', 'kanab', 'nephi', 'delta',
  'fillmore', 'manti', 'ephraim', 'santaquin', 'salem', 'elk ridge',
  'woodland hills', 'cedar hills', 'magna', 'kearns', 'west point',
  'clinton', 'sunset', 'woods cross', 'fruit heights', 'south weber',
  'harrisville', 'pleasant view', 'plain city', 'riverdale', 'washington terrace',
  'nibley', 'hyrum', 'smithfield', 'providence', 'north logan',
  'stansbury park', 'grantsville', 'stockton', 'wendover', 'tremonton',
]);

/** Check if an address string appears to be in Utah */
function isUtahAddress(address: string): boolean {
  const lower = address.toLowerCase();
  // Explicit state references
  if (/\but\b/.test(lower) || /\butah\b/.test(lower)) return true;
  // Utah ZIP codes: 840xx–847xx
  if (/\b84[0-7]\d{2}\b/.test(lower)) return true;
  // Known Utah cities
  for (const city of UTAH_CITIES) {
    if (lower.includes(city)) return true;
  }
  return false;
}

// ── Result type ──────────────────────────────────────────────

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  source?: 'ugrc' | 'google';
}

// ── Parse address into street + zone for UGRC ────────────────

interface UgrcAddressParts {
  street: string;
  zone: string; // city name or ZIP code
}

/**
 * UGRC needs street and zone (city or ZIP) as separate path params.
 * Parse "123 Main St, Salt Lake City, UT 84101" into street + zone.
 */
function parseAddressForUgrc(address: string): UgrcAddressParts | null {
  const parts = address.split(',').map(p => p.trim());
  if (parts.length < 2) return null;

  const street = parts[0];
  if (!street) return null;

  // Try to extract ZIP code first (most reliable zone identifier)
  const zipMatch = address.match(/\b(84[0-7]\d{2})\b/);
  if (zipMatch) {
    return { street, zone: zipMatch[1] };
  }

  // Use city name as zone (second part, strip state abbreviation)
  let city = parts[1].replace(/\s+(UT|Utah)\s*$/i, '').trim();
  if (city) {
    return { street, zone: city };
  }

  return null;
}

// ── UGRC Geocoding API ───────────────────────────────────────

const UGRC_BASE = 'https://api.mapserv.utah.gov/api/v1';

/**
 * Geocode via UGRC (Utah Geospatial Resource Center).
 * GET /geocode/{street}/{zone}?apiKey=...&spatialReference=4326
 * Returns WGS84 lat/lng or null on failure.
 */
async function ugrcGeocode(address: string): Promise<GeocodeResult | null> {
  const apiKey = getUgrcApiKey();
  if (!apiKey) return null;

  const parsed = parseAddressForUgrc(address);
  if (!parsed) return null;

  try {
    const url = `${UGRC_BASE}/geocode/${encodeURIComponent(parsed.street)}/${encodeURIComponent(parsed.zone)}?apiKey=${apiKey}&spatialReference=4326`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[ugrc] HTTP ${res.status} for "${address}"`);
      return null;
    }

    const data = await res.json();
    if (data.status === 200 && data.result?.location) {
      const { x, y } = data.result.location;
      console.log(`[ugrc] Geocoded "${address}" → ${y}, ${x} (score: ${data.result.score})`);
      return { latitude: y, longitude: x, source: 'ugrc' };
    }
    return null;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.warn('[ugrc] Geocode request timed out');
    } else {
      console.error('[ugrc] Geocode error:', err.message);
    }
    return null;
  }
}

/**
 * Reverse-geocode via UGRC.
 * GET /geocode/reverse/{x}/{y}?apiKey=...&spatialReference=4326
 */
async function ugrcReverseGeocode(lat: number, lng: number): Promise<string | null> {
  const apiKey = getUgrcApiKey();
  if (!apiKey) return null;

  try {
    const url = `${UGRC_BASE}/geocode/reverse/${lng}/${lat}?apiKey=${apiKey}&spatialReference=4326`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const data = await res.json();
    if (data.status === 200 && data.result?.inputAddress) {
      return data.result.inputAddress;
    }
    return null;
  } catch (err: any) {
    if (err.name !== 'AbortError') {
      console.error('[ugrc] Reverse geocode error:', err.message);
    }
    return null;
  }
}

// ── Google Geocoding (fallback) ──────────────────────────────

async function googleGeocode(address: string): Promise<GeocodeResult | null> {
  if (!GOOGLE_MAPS_API_KEY) return null;

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_MAPS_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    if (data.status === 'OK' && data.results?.length > 0) {
      const loc = data.results[0].geometry.location;
      return { latitude: loc.lat, longitude: loc.lng, source: 'google' };
    }
    return null;
  } catch (err) {
    console.error('[geocode] Google geocode error:', err);
    return null;
  }
}

async function googleReverseGeocode(lat: number, lng: number): Promise<string | null> {
  if (!GOOGLE_MAPS_API_KEY) return null;

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    if (data.status === 'OK' && data.results?.length > 0) {
      return data.results[0].formatted_address;
    }
    return null;
  } catch (err) {
    console.error('[geocode] Google reverse geocode error:', err);
    return null;
  }
}

// ── Public API — smart routing ───────────────────────────────

/**
 * Geocode an address: UGRC first for Utah addresses, Google fallback.
 * Returns { latitude, longitude, source } or null.
 */
export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  if (!address.trim()) return null;

  // Utah addresses: try UGRC first
  if (isUtahAddress(address)) {
    const ugrcResult = await ugrcGeocode(address);
    if (ugrcResult) return ugrcResult;
    console.log(`[geocode] UGRC miss for "${address}", trying Google...`);
  }

  // Non-Utah or UGRC fallback: use Google
  return googleGeocode(address);
}

/**
 * Reverse-geocode GPS coordinates to a street address.
 * If coords are in Utah bbox, try UGRC first, then Google fallback.
 */
export async function reverseGeocodeAddress(lat: number, lng: number): Promise<string | null> {
  // Utah bounding box (approximate)
  const inUtah = lat >= 36.99 && lat <= 42.01 && lng >= -114.05 && lng <= -109.04;

  if (inUtah) {
    const ugrcResult = await ugrcReverseGeocode(lat, lng);
    if (ugrcResult) return ugrcResult;
  }

  return googleReverseGeocode(lat, lng);
}

/**
 * If a call has an address but no coordinates, geocode it and update the DB.
 * Runs asynchronously — does not block the response.
 */
export function geocodeCallIfNeeded(callId: number, address: string, lat: any, lng: any): void {
  if (lat || lng || !address.trim()) return;

  geocodeAddress(address).then((result) => {
    if (!result) return;
    try {
      const db = getDb();
      db.prepare('UPDATE calls_for_service SET latitude = ?, longitude = ? WHERE id = ?')
        .run(result.latitude, result.longitude, callId);
      console.log(`[geocode] Geocoded call ${callId}: ${result.latitude}, ${result.longitude} (via ${result.source})`);
    } catch (err) {
      console.error('[geocode] Failed to update call coordinates:', err);
    }
  });
}

/**
 * Test UGRC connection with a known address.
 */
export async function testUgrcConnection(): Promise<{ success: boolean; message: string; score?: number }> {
  try {
    const apiKey = getUgrcApiKey();
    if (!apiKey) return { success: false, message: 'No UGRC API key configured' };

    const url = `${UGRC_BASE}/geocode/326 E South Temple St/Salt Lake City?apiKey=${apiKey}&spatialReference=4326`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.status === 200 && data.result?.location) {
      return {
        success: true,
        message: `Connected (score: ${data.result.score}, addr: ${data.result.matchAddress || 'N/A'})`,
        score: data.result.score,
      };
    }
    return { success: false, message: data.message || `HTTP ${data.status}` };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// UGRC SGID Search — Business, Address, and Parcel lookups
// ═══════════════════════════════════════════════════════════════
// Uses GET /api/v1/search/{table}/{fields}?apiKey=...&predicate=...
// All results returned in WGS84 (spatialReference=4326).

/** Generic SGID search helper */
async function sgidSearch<T = any>(
  table: string,
  fields: string,
  predicate: string,
  options?: { buffer?: number; geometry?: string }
): Promise<{ success: boolean; results: T[]; message?: string }> {
  const apiKey = getUgrcApiKey();
  if (!apiKey) return { success: false, results: [], message: 'No UGRC API key configured' };

  try {
    let url = `${UGRC_BASE}/search/${encodeURIComponent(table)}/${encodeURIComponent(fields)}?apiKey=${apiKey}&spatialReference=4326`;
    if (predicate) url += `&predicate=${encodeURIComponent(predicate)}`;
    if (options?.buffer) url += `&buffer=${options.buffer}`;
    if (options?.geometry) url += `&geometry=${encodeURIComponent(options.geometry)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text();
      console.warn(`[ugrc-sgid] HTTP ${res.status} for ${table}: ${body.substring(0, 200)}`);
      return { success: false, results: [], message: `HTTP ${res.status}` };
    }

    const data = await res.json();
    if (data.status === 200 && Array.isArray(data.result)) {
      return {
        success: true,
        results: data.result.map((r: any) => ({ ...r.attributes, _geometry: r.geometry })),
      };
    }
    return { success: false, results: [], message: data.message || `Status ${data.status}` };
  } catch (err: any) {
    if (err.name === 'AbortError') return { success: false, results: [], message: 'Request timed out' };
    return { success: false, results: [], message: err.message };
  }
}

// ── Business Search (society.open_source_places) ────────────

export interface UgrcBusinessResult {
  osm_id?: string;
  name: string;
  category?: string;
  amenity?: string;
  shop?: string;
  city?: string;
  zip?: string;
  ugrc_addr?: string;
  osm_addr?: string;
  phone?: string;
  website?: string;
  open_hours?: string;
  lon?: number;
  lat?: number;
}

/**
 * Search Utah businesses via SGID Open Source Places layer.
 * Supports name search, city filter, and category filter.
 */
export async function ugrcSearchBusinesses(
  query: string,
  options?: { city?: string; category?: string; limit?: number }
): Promise<{ success: boolean; results: UgrcBusinessResult[]; total: number; message?: string }> {
  const fields = 'osm_id,name,category,amenity,shop,city,zip,ugrc_addr,osm_addr,phone,website,open_hours,lon,lat';
  const predicates: string[] = [];

  // Name search (case-insensitive LIKE)
  if (query.trim()) {
    predicates.push(`UPPER(name) LIKE '%${query.trim().toUpperCase().replace(/'/g, "''")}%'`);
  }
  if (options?.city) {
    predicates.push(`UPPER(city) = '${options.city.trim().toUpperCase().replace(/'/g, "''")}'`);
  }
  if (options?.category) {
    predicates.push(`(UPPER(category) LIKE '%${options.category.trim().toUpperCase()}%' OR UPPER(amenity) LIKE '%${options.category.trim().toUpperCase()}%' OR UPPER(shop) LIKE '%${options.category.trim().toUpperCase()}%')`);
  }

  const predicate = predicates.length > 0 ? predicates.join(' AND ') : '1=1';
  const result = await sgidSearch<UgrcBusinessResult>('society.open_source_places', fields, predicate);

  const limited = result.results.slice(0, options?.limit || 50);
  return {
    success: result.success,
    results: limited,
    total: result.results.length,
    message: result.message,
  };
}

// ── Address Search (location.address_points) ────────────────

export interface UgrcAddressResult {
  utaddptid?: string;
  fulladd: string;
  addnum?: string;
  prefixdir?: string;
  streetname?: string;
  streettype?: string;
  suffixdir?: string;
  landmarkname?: string;
  building?: string;
  unittype?: string;
  unitid?: string;
  city: string;
  zipcode?: string;
  countyid?: string;
  pttype?: string;
  parcelid?: string;
  _geometry?: any;
}

/**
 * Search Utah residential addresses via SGID Address Points layer.
 * Can search by partial address, city, ZIP, or landmark name.
 */
export async function ugrcSearchAddresses(
  query: string,
  options?: { city?: string; zip?: string; limit?: number }
): Promise<{ success: boolean; results: UgrcAddressResult[]; total: number; message?: string }> {
  const fields = 'UTAddPtID,FullAdd,AddNum,PrefixDir,StreetName,StreetType,SuffixDir,LandmarkName,Building,UnitType,UnitID,City,ZipCode,CountyID,PtType,ParcelID,shape@';
  const predicates: string[] = [];

  if (query.trim()) {
    // Smart search: if it looks like a street number, search FullAdd; otherwise search StreetName or LandmarkName
    const cleaned = query.trim().replace(/'/g, "''").toUpperCase();
    if (/^\d/.test(cleaned)) {
      predicates.push(`UPPER(FullAdd) LIKE '${cleaned}%'`);
    } else {
      predicates.push(`(UPPER(StreetName) LIKE '%${cleaned}%' OR UPPER(LandmarkName) LIKE '%${cleaned}%')`);
    }
  }
  if (options?.city) {
    predicates.push(`UPPER(City) = '${options.city.trim().toUpperCase().replace(/'/g, "''")}'`);
  }
  if (options?.zip) {
    predicates.push(`ZipCode = '${options.zip.trim()}'`);
  }

  const predicate = predicates.length > 0 ? predicates.join(' AND ') : '1=1';
  const result = await sgidSearch<UgrcAddressResult>('location.address_points', fields, predicate);

  // Extract coordinates from geometry
  const enriched = result.results.map(r => {
    const geo = (r as any)._geometry;
    if (geo?.x !== undefined && geo?.y !== undefined) {
      return { ...r, _lon: geo.x, _lat: geo.y };
    }
    return r;
  });

  const limited = enriched.slice(0, options?.limit || 50);
  return {
    success: result.success,
    results: limited,
    total: result.results.length,
    message: result.message,
  };
}

// ── Parcel Search (cadastre.{county}_county_parcels_lir) ────

export interface UgrcParcelResult {
  parcel_id: string;
  parcel_add?: string;
  parcel_city?: string;
  county_name?: string;
  serial_num?: string;
  total_mkt_value?: number;
  land_mkt_value?: number;
  parcel_acres?: number;
  prop_class?: string;
  primary_res?: string;
  house_cnt?: number;
  subdiv_name?: string;
  bldg_sqft?: number;
  floors_cnt?: number;
  built_yr?: number;
  taxexempt_type?: string;
  _geometry?: any;
}

// County name mapping for parcel table lookups
const COUNTY_FROM_FIPS: Record<string, string> = {
  '49001': 'beaver', '49003': 'box_elder', '49005': 'cache', '49007': 'carbon',
  '49009': 'daggett', '49011': 'davis', '49013': 'duchesne', '49015': 'emery',
  '49017': 'garfield', '49019': 'grand', '49021': 'iron', '49023': 'juab',
  '49025': 'kane', '49027': 'millard', '49029': 'morgan', '49031': 'piute',
  '49033': 'rich', '49035': 'salt_lake', '49037': 'san_juan', '49039': 'sanpete',
  '49041': 'sevier', '49043': 'summit', '49045': 'tooele', '49047': 'uintah',
  '49049': 'utah', '49051': 'wasatch', '49053': 'washington', '49055': 'wayne',
  '49057': 'weber',
};

const COUNTY_NAMES: Record<string, string> = {
  'salt lake': 'salt_lake', 'salt lake city': 'salt_lake', 'slc': 'salt_lake',
  'box elder': 'box_elder', 'san juan': 'san_juan',
  'beaver': 'beaver', 'cache': 'cache', 'carbon': 'carbon', 'daggett': 'daggett',
  'davis': 'davis', 'duchesne': 'duchesne', 'emery': 'emery', 'garfield': 'garfield',
  'grand': 'grand', 'iron': 'iron', 'juab': 'juab', 'kane': 'kane',
  'millard': 'millard', 'morgan': 'morgan', 'piute': 'piute', 'rich': 'rich',
  'sanpete': 'sanpete', 'sevier': 'sevier', 'summit': 'summit', 'tooele': 'tooele',
  'uintah': 'uintah', 'utah': 'utah', 'wasatch': 'wasatch', 'washington': 'washington',
  'wayne': 'wayne', 'weber': 'weber',
};

/** Resolve a county name/FIPS to the SGID table-safe name */
function resolveCountyTable(county: string): string | null {
  const lower = county.toLowerCase().trim().replace(/\s+county$/i, '');
  if (COUNTY_NAMES[lower]) return COUNTY_NAMES[lower];
  if (COUNTY_FROM_FIPS[county]) return COUNTY_FROM_FIPS[county];
  return null;
}

/** Map city name to its most likely county for parcel lookups */
const CITY_TO_COUNTY: Record<string, string> = {
  'salt lake city': 'salt_lake', 'west valley city': 'salt_lake', 'west jordan': 'salt_lake',
  'sandy': 'salt_lake', 'south jordan': 'salt_lake', 'murray': 'salt_lake',
  'draper': 'salt_lake', 'riverton': 'salt_lake', 'taylorsville': 'salt_lake',
  'midvale': 'salt_lake', 'holladay': 'salt_lake', 'millcreek': 'salt_lake',
  'cottonwood heights': 'salt_lake', 'herriman': 'salt_lake', 'bluffdale': 'salt_lake',
  'magna': 'salt_lake', 'kearns': 'salt_lake',
  'provo': 'utah', 'orem': 'utah', 'lehi': 'utah', 'pleasant grove': 'utah',
  'spanish fork': 'utah', 'springville': 'utah', 'american fork': 'utah',
  'saratoga springs': 'utah', 'eagle mountain': 'utah', 'mapleton': 'utah',
  'highland': 'utah', 'alpine': 'utah', 'cedar hills': 'utah', 'lindon': 'utah',
  'vineyard': 'utah', 'payson': 'utah', 'santaquin': 'utah', 'salem': 'utah',
  'elk ridge': 'utah', 'woodland hills': 'utah',
  'ogden': 'weber', 'south ogden': 'weber', 'north ogden': 'weber', 'roy': 'weber',
  'riverdale': 'weber', 'washington terrace': 'weber', 'harrisville': 'weber',
  'pleasant view': 'weber', 'plain city': 'weber', 'west haven': 'weber',
  'layton': 'davis', 'bountiful': 'davis', 'kaysville': 'davis', 'clearfield': 'davis',
  'syracuse': 'davis', 'farmington': 'davis', 'centerville': 'davis',
  'north salt lake': 'davis', 'west point': 'davis', 'clinton': 'davis',
  'sunset': 'davis', 'woods cross': 'davis', 'fruit heights': 'davis', 'south weber': 'davis',
  'st. george': 'washington', 'saint george': 'washington', 'washington': 'washington',
  'hurricane': 'washington', 'ivins': 'washington',
  'logan': 'cache', 'north logan': 'cache', 'hyrum': 'cache', 'smithfield': 'cache',
  'providence': 'cache', 'nibley': 'cache',
  'tooele': 'tooele', 'grantsville': 'tooele', 'stansbury park': 'tooele',
  'park city': 'summit', 'heber city': 'wasatch',
  'cedar city': 'iron', 'brigham city': 'box_elder', 'tremonton': 'box_elder',
  'vernal': 'uintah', 'price': 'carbon', 'moab': 'grand', 'richfield': 'sevier',
  'nephi': 'juab', 'delta': 'millard', 'fillmore': 'millard', 'manti': 'sanpete',
  'ephraim': 'sanpete', 'kanab': 'kane',
};

/**
 * Search Utah parcel records via SGID LIR (Land Information Records).
 * Requires county — inferred from city or provided directly.
 */
export async function ugrcSearchParcels(
  query: string,
  options?: { county?: string; city?: string; parcelId?: string; limit?: number }
): Promise<{ success: boolean; results: UgrcParcelResult[]; total: number; message?: string }> {
  // Determine county
  let countyTable: string | null = null;
  if (options?.county) {
    countyTable = resolveCountyTable(options.county);
  } else if (options?.city) {
    const cityLower = options.city.toLowerCase().trim();
    countyTable = CITY_TO_COUNTY[cityLower] || null;
  }
  if (!countyTable) {
    // Try to extract city from the query itself
    const queryLower = query.toLowerCase();
    for (const [city, county] of Object.entries(CITY_TO_COUNTY)) {
      if (queryLower.includes(city)) {
        countyTable = county;
        break;
      }
    }
  }
  if (!countyTable) {
    return { success: false, results: [], total: 0, message: 'County required for parcel search. Provide county name or a recognized Utah city.' };
  }

  const table = `cadastre.${countyTable}_county_parcels_lir`;
  const fields = 'PARCEL_ID,PARCEL_ADD,PARCEL_CITY,COUNTY_NAME,SERIAL_NUM,TOTAL_MKT_VALUE,LAND_MKT_VALUE,PARCEL_ACRES,PROP_CLASS,PRIMARY_RES,HOUSE_CNT,SUBDIV_NAME,BLDG_SQFT,FLOORS_CNT,BUILT_YR,TAXEXEMPT_TYPE,shape@envelope';

  const predicates: string[] = [];
  if (options?.parcelId) {
    predicates.push(`PARCEL_ID = '${options.parcelId.replace(/'/g, "''")}'`);
  } else if (query.trim()) {
    const cleaned = query.trim().replace(/'/g, "''").toUpperCase();
    predicates.push(`UPPER(PARCEL_ADD) LIKE '%${cleaned}%'`);
  }

  const predicate = predicates.length > 0 ? predicates.join(' AND ') : '1=1';
  const result = await sgidSearch<UgrcParcelResult>(table, fields, predicate);

  const limited = result.results.slice(0, options?.limit || 50);
  return {
    success: result.success,
    results: limited,
    total: result.results.length,
    message: result.message,
  };
}
