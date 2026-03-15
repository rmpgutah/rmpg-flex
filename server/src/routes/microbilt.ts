// ============================================================
// Microbilt API Integration Routes
// ============================================================
// Manages Microbilt Developer API credentials, connection testing,
// product configuration, OFAC SDN screening, and DL search.
//
// OFAC screening uses a self-hosted copy of the U.S. Treasury's
// SDN list (synced daily) for instant local search. MicroBilt API
// is used for DL verification and optional expanded watchlist
// coverage when credentials are configured.
//
// All search results are persisted locally — never lost.
// API docs: https://developer.microbilt.com/apis

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow } from '../utils/timeUtils';
import config from '../config';
import { searchOfacLocal, syncOfacData, getOfacSyncStatus, getOfacListBreakdown } from '../utils/ofacScraper';
import { storeDlRecord, searchDlLocal, getDlStats } from '../utils/dlRecordStore';

const router = Router();
router.use(authenticateToken);

// ============================================================
// Encryption helpers (same pattern as ServeManager)
// ============================================================

function deriveKey(): Buffer {
  return crypto.createHash('sha256').update(config.jwt.secret).digest();
}

function encrypt(plaintext: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(stored: string): string {
  const key = deriveKey();
  const [ivHex, authTagHex, ciphertext] = stored.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ============================================================
// Config helpers
// ============================================================

const CONFIG_KEYS = {
  clientId: 'microbilt_client_id',
  clientSecret: 'microbilt_client_secret',
  subscriberId: 'microbilt_subscriber_id',
  environment: 'microbilt_environment',
  enabledProducts: 'microbilt_enabled_products',
} as const;

function getConfigValue(key: string): string | null {
  try {
    const db = getDb();
    const row = db.prepare(
      "SELECT config_value FROM system_config WHERE config_key = ? AND category = 'integrations' AND is_active = 1 LIMIT 1"
    ).get(key) as { config_value: string } | undefined;
    return row?.config_value || null;
  } catch { return null; }
}

function getDecryptedValue(key: string): string | null {
  const val = getConfigValue(key);
  if (!val) return null;
  try { return decrypt(val); } catch { return null; }
}

function setConfigValue(key: string, value: string, shouldEncrypt = false): void {
  const db = getDb();
  const now = localNow();
  const stored = shouldEncrypt ? encrypt(value) : value;

  db.prepare(
    "DELETE FROM system_config WHERE config_key = ? AND category = 'integrations'"
  ).run(key);

  db.prepare(
    "INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at) VALUES (?, ?, 'integrations', 0, 1, ?, ?)"
  ).run(key, stored, now, now);
}

function deleteConfigValue(key: string): void {
  const db = getDb();
  db.prepare(
    "DELETE FROM system_config WHERE config_key = ? AND category = 'integrations'"
  ).run(key);
}

// ============================================================
// Microbilt API client helpers
// ============================================================

const MB_BASE_URLS: Record<string, string> = {
  sandbox: 'https://apitest.microbilt.com',
  production: 'https://api.microbilt.com',
};

interface MicrobiltTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string | null> {
  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const clientId = getDecryptedValue(CONFIG_KEYS.clientId);
  const clientSecret = getDecryptedValue(CONFIG_KEYS.clientSecret);
  if (!clientId || !clientSecret) return null;

  const env = getConfigValue(CONFIG_KEYS.environment) || 'sandbox';
  const baseUrl = MB_BASE_URLS[env] || MB_BASE_URLS.sandbox;

  try {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const resp = await fetch(`${baseUrl}/OAuth/GetAccessToken`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Token request failed (${resp.status}): ${text}`);
    }

    const data = await resp.json() as MicrobiltTokenResponse;
    cachedToken = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in * 1000),
    };
    return data.access_token;
  } catch (err) {
    cachedToken = null;
    throw err;
  }
}

// ============================================================
// Routes (admin-only)
// ============================================================

// GET /api/microbilt/status — current configuration status
router.get('/status', requireRole('admin', 'manager'), (_req: Request, res: Response) => {
  try {
    const clientId = getConfigValue(CONFIG_KEYS.clientId);
    const subscriberId = getConfigValue(CONFIG_KEYS.subscriberId);
    const environment = getConfigValue(CONFIG_KEYS.environment) || 'sandbox';
    const enabledProducts = getConfigValue(CONFIG_KEYS.enabledProducts);

    let products: string[] = [];
    try { products = enabledProducts ? JSON.parse(enabledProducts) : []; } catch { /* */ }

    res.json({
      configured: !!clientId,
      has_subscriber_id: !!subscriberId,
      environment,
      enabled_products: products,
      token_cached: !!cachedToken && Date.now() < (cachedToken?.expiresAt || 0),
    });
  } catch (error: any) {
    console.error('Microbilt status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/microbilt/credentials — save API credentials (encrypted)
router.put('/credentials', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { client_id, client_secret, subscriber_id, environment } = req.body;

    if (client_id) setConfigValue(CONFIG_KEYS.clientId, client_id, true);
    if (client_secret) setConfigValue(CONFIG_KEYS.clientSecret, client_secret, true);
    if (subscriber_id !== undefined) {
      if (subscriber_id) {
        setConfigValue(CONFIG_KEYS.subscriberId, subscriber_id, true);
      } else {
        deleteConfigValue(CONFIG_KEYS.subscriberId);
      }
    }
    if (environment && ['sandbox', 'production'].includes(environment)) {
      setConfigValue(CONFIG_KEYS.environment, environment, false);
    }

    // Clear cached token when credentials change
    cachedToken = null;

    const db = getDb();
    db.prepare(
      "INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'microbilt_credentials_updated', 'integration', 0, ?, ?)"
    ).run(req.user!.userId, 'Updated Microbilt API credentials', req.ip || 'unknown');

    res.json({ message: 'Credentials saved' });
  } catch (error: any) {
    console.error('Microbilt save credentials error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/microbilt/credentials — remove all credentials
router.delete('/credentials', requireRole('admin'), (req: Request, res: Response) => {
  try {
    Object.values(CONFIG_KEYS).forEach(key => deleteConfigValue(key));
    cachedToken = null;

    const db = getDb();
    db.prepare(
      "INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'microbilt_credentials_cleared', 'integration', 0, ?, ?)"
    ).run(req.user!.userId, 'Cleared Microbilt API credentials', req.ip || 'unknown');

    res.json({ message: 'Credentials cleared' });
  } catch (error: any) {
    console.error('Microbilt clear credentials error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/microbilt/test-connection — test API credentials
router.post('/test-connection', requireRole('admin', 'manager'), async (_req: Request, res: Response) => {
  try {
    const token = await getAccessToken();
    if (!token) {
      res.json({ success: false, error: 'No credentials configured or token request failed' });
      return;
    }

    res.json({
      success: true,
      message: 'Successfully authenticated with Microbilt API',
      token_preview: `${token.substring(0, 8)}...`,
    });
  } catch (error: any) {
    res.json({
      success: false,
      error: error.message || 'Connection test failed',
    });
  }
});

// PUT /api/microbilt/products — update enabled product list
router.put('/products', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { products } = req.body;
    if (!Array.isArray(products)) {
      res.status(400).json({ error: 'products must be an array of product IDs' });
      return;
    }

    setConfigValue(CONFIG_KEYS.enabledProducts, JSON.stringify(products), false);

    const db = getDb();
    db.prepare(
      "INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'microbilt_products_updated', 'integration', 0, ?, ?)"
    ).run(req.user!.userId, `Updated enabled products: ${products.join(', ')}`, req.ip || 'unknown');

    res.json({ message: 'Products updated', products });
  } catch (error: any) {
    console.error('Microbilt update products error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// MicroBilt API caller helper
// ============================================================

function getMbBaseUrl(): string {
  const env = getConfigValue(CONFIG_KEYS.environment) || 'sandbox';
  return MB_BASE_URLS[env] || MB_BASE_URLS.sandbox;
}

function getSubscriberId(): string | null {
  return getDecryptedValue(CONFIG_KEYS.subscriberId);
}

async function callMicrobiltApi(endpoint: string, body: any): Promise<any | null> {
  const token = await getAccessToken();
  if (!token) return null;

  const subscriberId = getSubscriberId();
  const baseUrl = getMbBaseUrl();

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  if (subscriberId) {
    headers['SubscriberId'] = subscriberId;
  }

  const resp = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error(`[MicroBilt API] ${endpoint} failed (${resp.status}):`, text);
    return null;
  }

  return resp.json();
}

// ============================================================
// Search result persistence helper
// ============================================================

function persistSearch(opts: {
  product: string;
  searchType: string;
  searchInput: string;
  responseData: any;
  hit: boolean;
  subjectCount: number;
  userId: number;
  linkedIncident?: string;
  ipAddress?: string;
}): number {
  const db = getDb();
  const now = localNow();

  const result = db.prepare(`
    INSERT INTO microbilt_searches (product, search_type, search_input, response_data, hit, subject_count, searched_by, linked_incident, ip_address, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    opts.product,
    opts.searchType,
    opts.searchInput,
    JSON.stringify(opts.responseData),
    opts.hit ? 1 : 0,
    opts.subjectCount,
    opts.userId,
    opts.linkedIncident || null,
    opts.ipAddress || 'unknown',
    now
  );

  return Number(result.lastInsertRowid);
}

// ============================================================
// OFAC Watchlist Search
// ============================================================

// POST /api/microbilt/ofac/search — screen against OFAC SDN + MicroBilt watchlists
router.post('/ofac/search', requireRole('admin', 'manager', 'officer'), async (req: Request, res: Response) => {
  try {
    const { firstName, lastName, fullName, type, dob, linkedIncident } = req.body;

    const searchQuery = fullName || `${lastName || ''}${firstName ? ', ' + firstName : ''}`.trim();
    if (!searchQuery && !lastName) {
      res.json({ hit: false, sources: [], subjects: [], message: 'Provide a name to search' });
      return;
    }

    const sources: string[] = [];
    const allSubjects: any[] = [];

    // ── 1. Local OFAC SDN search (always available) ─────────
    const localResults = searchOfacLocal(searchQuery, {
      type: type === 'entity' ? 'entity' : type === 'person' ? 'person' : 'all',
      firstName,
      lastName,
      limit: 100,
    });

    if (localResults.length > 0) {
      sources.push('OFAC_SDN_LOCAL');
      for (const r of localResults) {
        // Extract DOB from IDs for matching
        const dobIds = r.ids.filter(id => id.id_type === 'DOB');
        const passports = r.ids.filter(id => id.id_type === 'PASSPORT');
        const nationalities = r.ids.filter(id => id.id_type === 'NATIONALITY' || id.id_type === 'CITIZENSHIP');

        allSubjects.push({
          source: 'OFAC_SDN',
          ent_num: r.ent_num,
          name: r.sdn_name,
          type: r.sdn_type,
          program: r.program,
          source_list: r.source_list || 'SDN',
          title: r.title,
          remarks: r.remarks,
          match_source: r.match_source,
          match_score: r.match_score,
          date_of_birth: dobIds.map(d => d.id_number),
          place_of_birth: r.ids.filter(id => id.id_type === 'POB').map(d => d.id_number),
          nationalities: nationalities.map(n => n.id_number),
          passports: passports.map(p => ({ number: p.id_number, country: p.id_country })),
          other_ids: r.ids.filter(id => !['DOB', 'POB', 'NATIONALITY', 'CITIZENSHIP', 'PASSPORT'].includes(id.id_type)).map(id => ({
            type: id.id_type,
            number: id.id_number,
            country: id.id_country,
          })),
          aliases: r.aliases.map(a => ({ name: a.alt_name, type: a.alt_type })),
          addresses: r.addresses.map(a => ({
            address: a.address,
            city: a.city,
            state: a.state_province,
            country: a.country,
            postal_code: a.postal_code,
          })),
        });
      }
    }

    // ── 2. MicroBilt expanded watchlist (if configured) ──────
    try {
      const mbBody: any = {
        OFACSearchRequest: {
          SearchBy: {
            PersonInfo: {} as any,
          },
        },
      };

      if (firstName || lastName) {
        mbBody.OFACSearchRequest.SearchBy.PersonInfo.PersonName = {};
        if (firstName) mbBody.OFACSearchRequest.SearchBy.PersonInfo.PersonName.FirstName = firstName;
        if (lastName) mbBody.OFACSearchRequest.SearchBy.PersonInfo.PersonName.LastName = lastName;
      } else if (fullName) {
        mbBody.OFACSearchRequest.SearchBy.PersonInfo.PersonName = { FullName: fullName };
      }

      if (dob) {
        mbBody.OFACSearchRequest.SearchBy.PersonInfo.BirthDt = dob;
      }

      const mbResult = await callMicrobiltApi('/OFACSearch/GetReport', mbBody);
      if (mbResult) {
        sources.push('MICROBILT');
        // Parse MicroBilt OFAC response and add subjects
        const mbSubjects = parseMicrobiltOfacResponse(mbResult);
        allSubjects.push(...mbSubjects);
      }
    } catch (err) {
      // MicroBilt not available — local results still returned
      console.log('[OFAC Search] MicroBilt API unavailable, using local SDN data only');
    }

    const hit = allSubjects.length > 0;
    const syncStatus = getOfacSyncStatus();

    // Persist search
    const searchId = persistSearch({
      product: 'ofac',
      searchType: type || 'person',
      searchInput: JSON.stringify({ firstName, lastName, fullName, dob }),
      responseData: { hit, sources, subjects: allSubjects },
      hit,
      subjectCount: allSubjects.length,
      userId: req.user!.userId,
      linkedIncident,
      ipAddress: req.ip,
    });

    // Audit log
    const db = getDb();
    db.prepare(
      "INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'ofac_search', 'screening', ?, ?, ?)"
    ).run(req.user!.userId, searchId, `OFAC search: ${searchQuery} — ${hit ? allSubjects.length + ' hit(s)' : 'no hits'}`, req.ip || 'unknown');

    res.json({
      hit,
      sources,
      subjects: allSubjects,
      searchId,
      resultCount: allSubjects.length,
      lastSyncTime: syncStatus.lastSync,
      sdnEntriesCount: syncStatus.entriesCount,
    });
  } catch (error: any) {
    console.error('OFAC search error:', error);
    // Per requirement: never return error codes — return empty results
    res.json({ hit: false, sources: [], subjects: [], resultCount: 0, message: 'Search completed with no results' });
  }
});

// Parse MicroBilt OFAC API response into normalized subjects
function parseMicrobiltOfacResponse(data: any): any[] {
  const subjects: any[] = [];
  try {
    const matches = data?.OFACSearchInfo?.OFACSearchRecord || [];
    const records = Array.isArray(matches) ? matches : [matches];
    for (const rec of records) {
      if (!rec) continue;
      subjects.push({
        source: 'MICROBILT_WATCHLIST',
        name: rec.PersonName?.FullName || rec.PersonName?.LastName || rec.OrgName || 'Unknown',
        type: rec.EntityType || 'unknown',
        program: rec.Program || '',
        title: rec.Title || '',
        remarks: rec.Remarks || '',
        match_source: 'api',
        match_score: parseFloat(rec.MatchScore || '0'),
        date_of_birth: rec.BirthDt ? [rec.BirthDt] : [],
        nationalities: rec.Nationality ? [rec.Nationality] : [],
        addresses: rec.Addresses ? (Array.isArray(rec.Addresses) ? rec.Addresses : [rec.Addresses]).map((a: any) => ({
          address: a.StreetAddress || '',
          city: a.City || '',
          state: a.State || '',
          country: a.Country || '',
          postal_code: a.PostalCode || '',
        })) : [],
        aliases: rec.Aliases ? (Array.isArray(rec.Aliases) ? rec.Aliases : [rec.Aliases]).map((a: any) => ({
          name: a.AliasName || a.Name || '',
          type: a.AliasType || 'AKA',
        })) : [],
        other_ids: [],
        passports: [],
      });
    }
  } catch (err) {
    console.error('[OFAC] Error parsing MicroBilt response:', err);
  }
  return subjects;
}

// ============================================================
// Driver's License Search
// ============================================================

// POST /api/microbilt/dl/search — search driver's license records
// Uses structured dl_records table for instant local search, then
// calls MicroBilt API for fresh data and persists new records.
router.post('/dl/search', requireRole('admin', 'manager', 'officer'), async (req: Request, res: Response) => {
  try {
    const { firstName, lastName, dlNumber, state, dob, linkedIncident } = req.body;

    const searchInput = JSON.stringify({ firstName, lastName, dlNumber, state, dob });
    const db = getDb();

    // ── 1. Search structured local DL records (instant) ─────
    const searchQuery = dlNumber || `${lastName || ''}${firstName ? ' ' + firstName : ''}`.trim();
    const localResults = searchDlLocal(searchQuery, {
      firstName,
      lastName,
      dlNumber,
      state,
      dob,
      limit: 50,
    });

    // ── 2. Call MicroBilt DL Search API for fresh data ───────
    let apiSubjects: any[] = [];
    let apiCalled = false;

    try {
      const dlBody: any = {
        DLSearchRequest: {
          SearchBy: {} as any,
        },
      };

      if (dlNumber && state) {
        dlBody.DLSearchRequest.SearchBy.DLInfo = {
          DLNum: dlNumber,
          DLIssuingBody: state,
        };
      }

      if (firstName || lastName) {
        dlBody.DLSearchRequest.SearchBy.PersonInfo = {
          PersonName: {} as any,
        };
        if (firstName) dlBody.DLSearchRequest.SearchBy.PersonInfo.PersonName.FirstName = firstName;
        if (lastName) dlBody.DLSearchRequest.SearchBy.PersonInfo.PersonName.LastName = lastName;
        if (dob) dlBody.DLSearchRequest.SearchBy.PersonInfo.BirthDt = dob;

        if (state && !dlNumber) {
          dlBody.DLSearchRequest.SearchBy.DLInfo = { DLIssuingBody: state };
        }
      }

      const mbResult = await callMicrobiltApi('/DLSearch/GetReport', dlBody);
      if (mbResult) {
        apiCalled = true;
        apiSubjects = parseMicrobiltDlResponse(mbResult);

        // ── 3. Store every API result into structured dl_records ─
        for (const subject of apiSubjects) {
          storeDlRecord(subject);
        }
      }
    } catch (err) {
      console.log('[DL Search] MicroBilt API unavailable, using local DL records');
    }

    // ── 4. Merge: API results take priority, local fills gaps ─
    let subjects: any[] = [];
    let source: string = 'NONE';

    if (apiSubjects.length > 0) {
      // Use fresh API data — but also include any local records
      // that weren't in the API response (different DL numbers)
      const apiDlKeys = new Set(apiSubjects.map(s => `${s.dl_number}:${s.dl_state}`));
      const uniqueLocal = localResults.filter(
        lr => !apiDlKeys.has(`${lr.dl_number}:${lr.dl_state}`)
      );
      subjects = [...apiSubjects, ...uniqueLocal];
      source = 'MICROBILT_API';
    } else if (localResults.length > 0) {
      subjects = localResults;
      source = 'LOCAL_DB';
    } else {
      // ── 5. Fallback: check persons table for DL info ──────
      // If no dl_records or API results, search the persons table
      // which may have DL numbers entered directly on person records
      try {
        let personDlQuery = '';
        const personDlParams: any[] = [];
        if (dlNumber) {
          personDlQuery = `SELECT * FROM persons WHERE drivers_license LIKE ? AND drivers_license IS NOT NULL LIMIT 5`;
          personDlParams.push(`%${dlNumber}%`);
        } else if (firstName && lastName) {
          personDlQuery = `SELECT * FROM persons WHERE last_name LIKE ? AND first_name LIKE ? AND drivers_license IS NOT NULL AND drivers_license != '' LIMIT 5`;
          personDlParams.push(`${lastName}%`, `${firstName}%`);
        } else if (lastName) {
          personDlQuery = `SELECT * FROM persons WHERE last_name LIKE ? AND drivers_license IS NOT NULL AND drivers_license != '' LIMIT 5`;
          personDlParams.push(`${lastName}%`);
        }

        if (personDlQuery) {
          const personDlResults = db.prepare(personDlQuery).all(...personDlParams) as any[];
          if (personDlResults.length > 0) {
            subjects = personDlResults.map(p => ({
              first_name: p.first_name,
              last_name: p.last_name,
              middle_name: p.middle_name,
              date_of_birth: p.date_of_birth,
              gender: p.sex,
              height: p.height,
              weight: p.weight ? String(p.weight) : undefined,
              eye_color: p.eye_color,
              hair_color: p.hair_color,
              race: p.race,
              dl_number: p.drivers_license,
              dl_state: p.dl_state || state || 'UT',
              dl_status: 'RECORD ON FILE',
              addresses: p.address ? [{ address: p.address, city: p.city, state: p.state }] : [],
              source: 'PERSON_RECORD',
              match_source: 'Cross-loaded from person records',
            }));
            source = 'PERSON_RECORD';
          }
        }
      } catch (err) {
        console.log('[DL Search] Person table fallback failed:', err);
      }

      if (subjects.length === 0) {
        subjects = [];
        source = 'NONE';
      }
    }

    const hit = subjects.length > 0;

    // Persist search attempt to audit log
    const searchId = persistSearch({
      product: 'dl',
      searchType: dlNumber ? 'dl_number' : 'name',
      searchInput,
      responseData: { hit, source, subjects },
      hit,
      subjectCount: subjects.length,
      userId: req.user!.userId,
      linkedIncident,
      ipAddress: req.ip,
    });

    db.prepare(
      "INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'dl_search', 'screening', ?, ?, ?)"
    ).run(req.user!.userId, searchId, `DL search: ${dlNumber || lastName || 'unknown'} (${state || 'all'}) — ${hit ? subjects.length + ' result(s)' : 'no results'}`, req.ip || 'unknown');

    res.json({
      hit,
      source,
      subjects,
      searchId,
      resultCount: subjects.length,
    });
  } catch (error: any) {
    console.error('DL search error:', error);
    res.json({ hit: false, source: 'NONE', subjects: [], resultCount: 0, message: 'Search completed with no results' });
  }
});

// GET /api/microbilt/dl/stats — local DL record count + last fetch
router.get('/dl/stats', requireRole('admin', 'manager', 'officer'), (_req: Request, res: Response) => {
  try {
    const stats = getDlStats();
    res.json(stats);
  } catch (error: any) {
    res.json({ recordCount: 0, lastFetchedAt: null });
  }
});

// Parse MicroBilt DL Search response into normalized subjects
function parseMicrobiltDlResponse(data: any): any[] {
  const subjects: any[] = [];
  try {
    const records = data?.DLSearchInfo?.DLSearchRecord;
    const list = Array.isArray(records) ? records : records ? [records] : [];
    for (const rec of list) {
      if (!rec) continue;

      const personName = rec.PersonInfo?.PersonName || {};
      const dlInfo = rec.DLInfo || {};
      const addresses = rec.PersonInfo?.ContactInfo?.PostAddr;
      const addrList = addresses ? (Array.isArray(addresses) ? addresses : [addresses]) : [];

      subjects.push({
        source: 'MICROBILT_DL',
        // Personal info
        first_name: personName.FirstName || '',
        middle_name: personName.MiddleName || '',
        last_name: personName.LastName || '',
        full_name: personName.FullName || `${personName.FirstName || ''} ${personName.LastName || ''}`.trim(),
        suffix: personName.NameSuffix || '',
        date_of_birth: rec.PersonInfo?.BirthDt || '',
        gender: rec.PersonInfo?.Gender || '',
        height: rec.PersonInfo?.Height || '',
        weight: rec.PersonInfo?.Weight || '',
        eye_color: rec.PersonInfo?.EyeColor || '',
        hair_color: rec.PersonInfo?.HairColor || '',
        race: rec.PersonInfo?.Race || '',
        // DL info
        dl_number: dlInfo.DLNum || '',
        dl_state: dlInfo.DLIssuingBody || '',
        dl_class: dlInfo.DLClass || '',
        dl_status: dlInfo.DLStatus || '',
        dl_expiration: dlInfo.DLExpDt || '',
        dl_issue_date: dlInfo.DLIssueDt || '',
        dl_restrictions: dlInfo.DLRestrictions || '',
        dl_endorsements: dlInfo.DLEndorsements || '',
        // Address
        addresses: addrList.map((a: any) => ({
          address: a.Addr1 || a.StreetAddress || '',
          address2: a.Addr2 || '',
          city: a.City || '',
          state: a.StateProv || '',
          postal_code: a.PostalCode || '',
          country: a.Country || 'US',
        })),
        // Raw record for full detail preservation
        raw_record: rec,
      });
    }
  } catch (err) {
    console.error('[DL Search] Error parsing MicroBilt response:', err);
  }
  return subjects;
}

// ============================================================
// Background Check Search (QB command)
// ============================================================

// POST /api/microbilt/background/search — nationwide background check
// Checks cache first (30-day window), calls MicroBilt API if no cached result.
router.post('/background/search', requireRole('admin', 'manager', 'officer'), async (req: Request, res: Response) => {
  try {
    const { firstName, lastName, dob, state, forceFresh, linkedIncident } = req.body;

    if (!lastName && !firstName) {
      res.json({ hit: false, sources: [], records: [], resultCount: 0, message: 'Provide at least a first or last name' });
      return;
    }

    const searchInput = JSON.stringify({ firstName, lastName, dob, state });
    const db = getDb();

    // ── 1. Check enabled products ─────────────────────────────
    const enabledProducts = getConfigValue(CONFIG_KEYS.enabledProducts);
    let products: string[] = [];
    try { products = enabledProducts ? JSON.parse(enabledProducts) : []; } catch { /* */ }

    if (!products.includes('background_check')) {
      res.json({
        hit: false,
        sources: [],
        records: [],
        resultCount: 0,
        message: 'Background Check is not enabled. Enable it in Admin → Microbilt → API Products.',
      });
      return;
    }

    // ── 2. Cache check (30-day window) ────────────────────────
    if (!forceFresh) {
      const cacheWindow = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const namePattern = `%${(firstName || '').toUpperCase()}%${(lastName || '').toUpperCase()}%`;

      const cached = db.prepare(`
        SELECT id, response_data, created_at FROM microbilt_searches
        WHERE product = 'background'
          AND UPPER(search_input) LIKE ?
          AND created_at > ?
        ORDER BY created_at DESC LIMIT 1
      `).get(namePattern, cacheWindow) as { id: number; response_data: string; created_at: string } | undefined;

      if (cached) {
        try {
          const cachedData = JSON.parse(cached.response_data);
          res.json({
            ...cachedData,
            cached: true,
            cachedAt: cached.created_at,
            searchId: cached.id,
          });
          return;
        } catch { /* fall through to live search */ }
      }
    }

    // ── 3. Build MicroBilt API request ────────────────────────
    const allRecords: any[] = [];
    const sources: string[] = [];

    // 3a. Criminal Records Search
    try {
      const crimBody: any = {
        CriminalSearchRequest: {
          SearchBy: {
            PersonInfo: {
              PersonName: {} as any,
            },
          },
        },
      };
      if (firstName) crimBody.CriminalSearchRequest.SearchBy.PersonInfo.PersonName.FirstName = firstName.toUpperCase();
      if (lastName) crimBody.CriminalSearchRequest.SearchBy.PersonInfo.PersonName.LastName = lastName.toUpperCase();
      if (dob) crimBody.CriminalSearchRequest.SearchBy.PersonInfo.BirthDt = dob;
      if (state) crimBody.CriminalSearchRequest.SearchBy.PersonInfo.ContactInfo = { PostAddr: { StateProv: state } };

      const crimResult = await callMicrobiltApi('/CriminalSearch/GetReport', crimBody);
      if (crimResult) {
        sources.push('CRIMINAL_RECORDS');
        const records = parseCriminalResponse(crimResult);
        allRecords.push(...records);
      }
    } catch (err) {
      console.log('[Background Check] Criminal records API unavailable');
    }

    // 3b. Sex Offender Registry Search
    try {
      const soBody: any = {
        SexOffenderSearchRequest: {
          SearchBy: {
            PersonInfo: {
              PersonName: {} as any,
            },
          },
        },
      };
      if (firstName) soBody.SexOffenderSearchRequest.SearchBy.PersonInfo.PersonName.FirstName = firstName.toUpperCase();
      if (lastName) soBody.SexOffenderSearchRequest.SearchBy.PersonInfo.PersonName.LastName = lastName.toUpperCase();
      if (dob) soBody.SexOffenderSearchRequest.SearchBy.PersonInfo.BirthDt = dob;
      if (state) soBody.SexOffenderSearchRequest.SearchBy.PersonInfo.ContactInfo = { PostAddr: { StateProv: state } };

      const soResult = await callMicrobiltApi('/SexOffenderSearch/GetReport', soBody);
      if (soResult) {
        sources.push('SEX_OFFENDER_REGISTRY');
        const records = parseSexOffenderResponse(soResult);
        allRecords.push(...records);
      }
    } catch (err) {
      console.log('[Background Check] Sex offender API unavailable');
    }

    // 3c. Public Records / Court Cases Search
    try {
      const prBody: any = {
        PublicRecordSearchRequest: {
          SearchBy: {
            PersonInfo: {
              PersonName: {} as any,
            },
          },
        },
      };
      if (firstName) prBody.PublicRecordSearchRequest.SearchBy.PersonInfo.PersonName.FirstName = firstName.toUpperCase();
      if (lastName) prBody.PublicRecordSearchRequest.SearchBy.PersonInfo.PersonName.LastName = lastName.toUpperCase();
      if (dob) prBody.PublicRecordSearchRequest.SearchBy.PersonInfo.BirthDt = dob;

      const prResult = await callMicrobiltApi('/PublicRecordSearch/GetReport', prBody);
      if (prResult) {
        sources.push('PUBLIC_RECORDS');
        const records = parsePublicRecordResponse(prResult);
        allRecords.push(...records);
      }
    } catch (err) {
      console.log('[Background Check] Public records API unavailable');
    }

    const hit = allRecords.length > 0;

    // ── 4. Persist search result for caching & audit ──────────
    const responsePayload = { hit, sources, records: allRecords, resultCount: allRecords.length };

    const searchId = persistSearch({
      product: 'background',
      searchType: 'person',
      searchInput,
      responseData: responsePayload,
      hit,
      subjectCount: allRecords.length,
      userId: req.user!.userId,
      linkedIncident,
      ipAddress: req.ip,
    });

    // Audit log
    db.prepare(
      "INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'background_check', 'screening', ?, ?, ?)"
    ).run(
      req.user!.userId,
      searchId,
      `Background check: ${firstName || ''} ${lastName || ''} — ${hit ? allRecords.length + ' record(s)' : 'no records'}`,
      req.ip || 'unknown'
    );

    res.json({
      ...responsePayload,
      cached: false,
      searchId,
    });
  } catch (error: any) {
    console.error('Background check error:', error);
    res.json({ hit: false, sources: [], records: [], resultCount: 0, message: 'Search completed with no results' });
  }
});

// GET /api/microbilt/background/:searchId — retrieve a cached background check result
router.get('/background/:searchId', requireRole('admin', 'manager', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const row = db.prepare(
      "SELECT * FROM microbilt_searches WHERE id = ? AND product = 'background'"
    ).get(req.params.searchId) as any;

    if (!row) {
      res.json({ found: false, message: 'Background check record not found' });
      return;
    }

    let responseData = {};
    try { responseData = JSON.parse(row.response_data); } catch { /* */ }

    res.json({
      found: true,
      search: { ...row, response_data: responseData },
    });
  } catch (error: any) {
    res.json({ found: false, message: 'Unable to retrieve record' });
  }
});

// GET /api/microbilt/background/usage — background check usage stats for admin
router.get('/background/usage', requireRole('admin', 'manager'), (_req: Request, res: Response) => {
  try {
    const db = getDb();

    const total = (db.prepare(
      "SELECT COUNT(*) as cnt FROM microbilt_searches WHERE product = 'background'"
    ).get() as any).cnt;

    const totalHits = (db.prepare(
      "SELECT COUNT(*) as cnt FROM microbilt_searches WHERE product = 'background' AND hit = 1"
    ).get() as any).cnt;

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const last30Days = (db.prepare(
      "SELECT COUNT(*) as cnt FROM microbilt_searches WHERE product = 'background' AND created_at > ?"
    ).get(thirtyDaysAgo) as any).cnt;

    // Count unique subjects searched
    const uniqueSubjects = (db.prepare(
      "SELECT COUNT(DISTINCT search_input) as cnt FROM microbilt_searches WHERE product = 'background'"
    ).get() as any).cnt;

    res.json({
      totalSearches: total,
      totalHits,
      hitRate: total > 0 ? Math.round((totalHits / total) * 100) : 0,
      uniqueSubjects,
      last30Days,
    });
  } catch (error: any) {
    res.json({ totalSearches: 0, totalHits: 0, hitRate: 0, uniqueSubjects: 0, last30Days: 0 });
  }
});

// ── Background check response parsers ──────────────────────

function parseCriminalResponse(data: any): any[] {
  const records: any[] = [];
  try {
    const searchRecords = data?.CriminalSearchInfo?.CriminalSearchRecord;
    const list = Array.isArray(searchRecords) ? searchRecords : searchRecords ? [searchRecords] : [];
    for (const rec of list) {
      if (!rec) continue;
      const personName = rec.PersonInfo?.PersonName || {};
      const offenses = rec.Offenses || rec.CriminalOffense;
      const offenseList = offenses ? (Array.isArray(offenses) ? offenses : [offenses]) : [];

      for (const offense of offenseList) {
        records.push({
          record_type: 'CRIMINAL',
          source: 'STATE_CRIMINAL',
          subject_name: personName.FullName || `${personName.FirstName || ''} ${personName.LastName || ''}`.trim(),
          dob: rec.PersonInfo?.BirthDt || '',
          offense: offense.OffenseDesc || offense.ChargeDesc || offense.Offense || '',
          offense_date: offense.OffenseDt || offense.ArrestDt || '',
          case_number: offense.CaseNum || offense.CaseId || '',
          court: offense.CourtName || offense.Court || '',
          disposition: offense.Disposition || '',
          sentence: offense.Sentence || '',
          state: offense.State || rec.PersonInfo?.ContactInfo?.PostAddr?.StateProv || '',
          status: offense.CaseStatus || 'CLOSED',
        });
      }

      // If no individual offenses but record exists, add the record itself
      if (offenseList.length === 0) {
        records.push({
          record_type: 'CRIMINAL',
          source: 'STATE_CRIMINAL',
          subject_name: personName.FullName || `${personName.FirstName || ''} ${personName.LastName || ''}`.trim(),
          dob: rec.PersonInfo?.BirthDt || '',
          offense: rec.ChargeDesc || 'CRIMINAL RECORD ON FILE',
          offense_date: rec.OffenseDt || '',
          case_number: rec.CaseNum || '',
          court: rec.CourtName || '',
          disposition: rec.Disposition || '',
          sentence: '',
          state: rec.PersonInfo?.ContactInfo?.PostAddr?.StateProv || '',
          status: rec.CaseStatus || '',
        });
      }
    }
  } catch (err) {
    console.error('[Background Check] Error parsing criminal response:', err);
  }
  return records;
}

function parseSexOffenderResponse(data: any): any[] {
  const records: any[] = [];
  try {
    const searchRecords = data?.SexOffenderSearchInfo?.SexOffenderSearchRecord;
    const list = Array.isArray(searchRecords) ? searchRecords : searchRecords ? [searchRecords] : [];
    for (const rec of list) {
      if (!rec) continue;
      const personName = rec.PersonInfo?.PersonName || {};
      records.push({
        record_type: 'SEX_OFFENDER',
        source: 'NATIONAL_REGISTRY',
        subject_name: personName.FullName || `${personName.FirstName || ''} ${personName.LastName || ''}`.trim(),
        dob: rec.PersonInfo?.BirthDt || '',
        offense: rec.Offense || rec.ConvictionOffense || 'REGISTERED SEX OFFENDER',
        offense_date: rec.RegistrationDt || rec.ConvictionDt || '',
        case_number: rec.CaseNum || '',
        court: rec.ConvictionJurisdiction || '',
        disposition: '',
        sentence: '',
        state: rec.RegistrationState || rec.State || '',
        status: rec.RegistrationStatus || 'REGISTERED',
        tier: rec.RiskLevel || rec.Tier || '',
        registry_address: rec.Address || '',
      });
    }
  } catch (err) {
    console.error('[Background Check] Error parsing sex offender response:', err);
  }
  return records;
}

function parsePublicRecordResponse(data: any): any[] {
  const records: any[] = [];
  try {
    const searchRecords = data?.PublicRecordSearchInfo?.PublicRecordSearchRecord;
    const list = Array.isArray(searchRecords) ? searchRecords : searchRecords ? [searchRecords] : [];
    for (const rec of list) {
      if (!rec) continue;
      const personName = rec.PersonInfo?.PersonName || {};
      records.push({
        record_type: 'COURT',
        source: rec.RecordSource || 'PUBLIC_RECORD',
        subject_name: personName.FullName || `${personName.FirstName || ''} ${personName.LastName || ''}`.trim(),
        dob: rec.PersonInfo?.BirthDt || '',
        offense: rec.CaseType || rec.Description || '',
        offense_date: rec.FilingDt || rec.CaseDt || '',
        case_number: rec.CaseNum || rec.CaseId || '',
        court: rec.CourtName || rec.FilingJurisdiction || '',
        disposition: rec.CaseDisposition || '',
        sentence: '',
        state: rec.State || rec.FilingState || '',
        status: rec.CaseStatus || '',
      });
    }
  } catch (err) {
    console.error('[Background Check] Error parsing public record response:', err);
  }
  return records;
}

// ============================================================
// Search History & OFAC Sync Management
// ============================================================

// GET /api/microbilt/searches — paginated search history
router.get('/searches', requireRole('admin', 'manager', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const product = req.query.product as string || null;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;

    let sql = 'SELECT id, product, search_type, search_input, hit, subject_count, searched_by, linked_incident, created_at FROM microbilt_searches';
    const params: any[] = [];

    if (product) {
      sql += ' WHERE product = ?';
      params.push(product);
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = db.prepare(sql).all(...params);

    // Get total count
    let countSql = 'SELECT COUNT(*) as total FROM microbilt_searches';
    if (product) countSql += ' WHERE product = ?';
    const total = (db.prepare(countSql).get(...(product ? [product] : [])) as any).total;

    res.json({ searches: rows, total, limit, offset });
  } catch (error: any) {
    console.error('Search history error:', error);
    res.json({ searches: [], total: 0, limit: 50, offset: 0 });
  }
});

// GET /api/microbilt/searches/:id — full cached result
router.get('/searches/:id', requireRole('admin', 'manager', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const row = db.prepare(
      'SELECT * FROM microbilt_searches WHERE id = ?'
    ).get(req.params.id) as any;

    if (!row) {
      res.json({ found: false, message: 'Search record not found' });
      return;
    }

    // Parse stored JSON response
    let responseData = {};
    try { responseData = JSON.parse(row.response_data); } catch { /* */ }

    res.json({
      found: true,
      search: {
        ...row,
        response_data: responseData,
      },
    });
  } catch (error: any) {
    console.error('Search detail error:', error);
    res.json({ found: false, message: 'Unable to retrieve search record' });
  }
});

// POST /api/microbilt/ofac/sync — manually trigger OFAC SDN refresh
router.post('/ofac/sync', requireRole('admin'), async (_req: Request, res: Response) => {
  try {
    const result = await syncOfacData();
    res.json({
      success: true,
      entries: result.entries,
      aliases: result.aliases,
      addresses: result.addresses,
      duration_ms: result.duration,
    });
  } catch (error: any) {
    console.error('Manual OFAC sync error:', error);
    res.json({ success: false, message: 'Sync attempted but encountered an issue. Will retry automatically.' });
  }
});

// GET /api/microbilt/ofac/sync-status — last sync info
router.get('/ofac/sync-status', requireRole('admin', 'manager', 'officer'), (_req: Request, res: Response) => {
  try {
    const status = getOfacSyncStatus();
    const listBreakdown = getOfacListBreakdown();
    res.json({ ...status, listBreakdown });
  } catch (error: any) {
    res.json({ lastSync: null, entriesCount: 0, status: 'unknown', lastError: null, listBreakdown: [] });
  }
});

export default router;
