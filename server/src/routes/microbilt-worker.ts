// Microbilt routes for Workers
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum, localNow } from '../worker-middleware/d1Helpers';

const CONFIG_KEYS = { clientId: 'microbilt_client_id', clientSecret: 'microbilt_client_secret', subscriberId: 'microbilt_subscriber_id', environment: 'microbilt_environment', enabledProducts: 'microbilt_enabled_products' } as const;
const MB_BASE_URLS: Record<string, string> = { sandbox: 'https://apitest.microbilt.com', production: 'https://api.microbilt.com' };

// ── Web Crypto helpers ──
async function deriveKey(jwtSecret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.digest('SHA-256', encoder.encode(jwtSecret));
  return await crypto.subtle.importKey('raw', keyMaterial, 'AES-256-GCM', false, ['encrypt', 'decrypt']);
}

async function encryptWeb(plaintext: string, jwtSecret: string): Promise<string> {
  const key = await deriveKey(jwtSecret);
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const encoder = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plaintext));
  const encBuf = new Uint8Array(encrypted);
  const authTag = encBuf.slice(-16);
  const ciphertext = encBuf.slice(0, -16);
  const toHex = (buf: Uint8Array) => Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${toHex(iv)}:${toHex(authTag)}:${toHex(ciphertext)}`;
}

async function decryptWeb(stored: string, jwtSecret: string): Promise<string> {
  const key = await deriveKey(jwtSecret);
  const parts = stored.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted format');
  const fromHex = (hex: string) => new Uint8Array(hex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  const iv = fromHex(parts[0]);
  const authTag = fromHex(parts[1]);
  const ciphertext = fromHex(parts[2]);
  const combined = new Uint8Array(ciphertext.length + authTag.length);
  combined.set(ciphertext);
  combined.set(authTag, ciphertext.length);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, combined);
  return new TextDecoder().decode(decrypted);
}

async function getConfigValue(db: D1Db, key: string): Promise<string | null> {
  try {
    const row = await db.prepare("SELECT config_value FROM system_config WHERE config_key = ? AND category = 'integrations' AND is_active = 1 LIMIT 1").get(key) as { config_value?: string } | undefined;
    return row?.config_value || null;
  } catch { return null; }
}

async function getDecryptedValue(db: D1Db, key: string, jwtSecret: string): Promise<string | null> {
  const val = await getConfigValue(db, key);
  if (!val) return null;
  try { return await decryptWeb(val, jwtSecret); } catch { return null; }
}

async function setConfigValue(db: D1Db, key: string, value: string, shouldEncrypt: boolean, jwtSecret: string): Promise<void> {
  const now = localNow();
  const stored = shouldEncrypt ? await encryptWeb(value, jwtSecret) : value;
  await db.prepare("DELETE FROM system_config WHERE config_key = ? AND category = 'integrations'").run(key);
  await db.prepare("INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at) VALUES (?, ?, 'integrations', 0, 1, ?, ?)").run(key, stored, now, now);
}

async function deleteConfigValue(db: D1Db, key: string): Promise<void> {
  await db.prepare("DELETE FROM system_config WHERE config_key = ? AND category = 'integrations'").run(key);
}

// Token cache (per-worker-instance)
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(db: D1Db, jwtSecret: string): Promise<string | null> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.token;
  const clientId = await getDecryptedValue(db, CONFIG_KEYS.clientId, jwtSecret);
  const clientSecret = await getDecryptedValue(db, CONFIG_KEYS.clientSecret, jwtSecret);
  if (!clientId || !clientSecret) return null;
  const env = await getConfigValue(db, CONFIG_KEYS.environment) || 'sandbox';
  const baseUrl = MB_BASE_URLS[env] || MB_BASE_URLS.sandbox;
  const credentials = btoa(`${clientId}:${clientSecret}`);
  const resp = await fetch(`${baseUrl}/OAuth/GetAccessToken`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!resp.ok) throw new Error(`Token request failed (${resp.status}): ${await resp.text()}`);
  const data = await resp.json() as { access_token: string; token_type: string; expires_in: number };
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in * 1000) };
  return data.access_token;
}

function getMbBaseUrl(env: string | null): string {
  return MB_BASE_URLS[env || 'sandbox'] || MB_BASE_URLS.sandbox;
}

async function callMicrobiltApi(db: D1Db, jwtSecret: string, endpoint: string, body: any): Promise<any | null> {
  const token = await getAccessToken(db, jwtSecret);
  if (!token) return null;
  const subscriberId = await getDecryptedValue(db, CONFIG_KEYS.subscriberId, jwtSecret);
  const env = await getConfigValue(db, CONFIG_KEYS.environment) || 'sandbox';
  const baseUrl = getMbBaseUrl(env);
  const headers: Record<string, string> = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' };
  if (subscriberId) headers['SubscriberId'] = subscriberId;
  const resp = await fetch(`${baseUrl}${endpoint}`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!resp.ok) { console.error(`[MicroBilt API] ${endpoint} failed (${resp.status}):`, await resp.text()); return null; }
  return resp.json();
}

async function persistSearch(db: D1Db, opts: { product: string; searchType: string; searchInput: string; responseData: any; hit: boolean; subjectCount: number; userId: number; linkedIncident?: string; ipAddress?: string }): Promise<number> {
  const now = localNow();
  const result = await db.prepare(`INSERT INTO microbilt_searches (product, search_type, search_input, response_data, hit, subject_count, searched_by, linked_incident, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    opts.product, opts.searchType, opts.searchInput, JSON.stringify(opts.responseData), opts.hit ? 1 : 0, opts.subjectCount, opts.userId, opts.linkedIncident || null, opts.ipAddress || 'unknown', now);
  return Number(result.meta.last_row_id);
}

// Stub: OFAC scraper not available in Workers
function searchOfacLocal(_query: string, _opts: any): any[] { return []; }
function getOfacSyncStatus(): any { return { lastSync: null, entriesCount: 0, status: 'unknown', lastError: null }; }
function getOfacListBreakdown(): any[] { return []; }
async function syncOfacData(): Promise<any> { return { entries: 0, aliases: 0, addresses: 0, duration: 0 }; }

// Stub: DL record store not available in Workers
function storeDlRecord(_subject: any): void { /* no-op */ }
function searchDlLocal(_query: string, _opts: any): any[] { return []; }
function getDlStats(): any { return { recordCount: 0, lastFetchedAt: null }; }

function parseMicrobiltOfacResponse(data: any): any[] {
  const subjects: any[] = [];
  try {
    const matches = data?.OFACSearchInfo?.OFACSearchRecord || [];
    const records = Array.isArray(matches) ? matches : [matches];
    for (const rec of records) {
      if (!rec) continue;
      subjects.push({
        source: 'MICROBILT_WATCHLIST', name: rec.PersonName?.FullName || rec.PersonName?.LastName || rec.OrgName || 'Unknown',
        type: rec.EntityType || 'unknown', program: rec.Program || '', title: rec.Title || '', remarks: rec.Remarks || '',
        match_source: 'api', match_score: parseFloat(rec.MatchScore || '0'), date_of_birth: rec.BirthDt ? [rec.BirthDt] : [],
        nationalities: rec.Nationality ? [rec.Nationality] : [],
        addresses: rec.Addresses ? (Array.isArray(rec.Addresses) ? rec.Addresses : [rec.Addresses]).map((a: any) => ({ address: a.StreetAddress || '', city: a.City || '', state: a.State || '', country: a.Country || '', postal_code: a.PostalCode || '' })) : [],
        aliases: rec.Aliases ? (Array.isArray(rec.Aliases) ? rec.Aliases : [rec.Aliases]).map((a: any) => ({ name: a.AliasName || a.Name || '', type: a.AliasType || 'AKA' })) : [],
        other_ids: [], passports: [],
      });
    }
  } catch { /* ignore */ }
  return subjects;
}

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
        source: 'MICROBILT_DL', first_name: personName.FirstName || '', middle_name: personName.MiddleName || '', last_name: personName.LastName || '',
        full_name: personName.FullName || `${personName.FirstName || ''} ${personName.LastName || ''}`.trim(), suffix: personName.NameSuffix || '',
        date_of_birth: rec.PersonInfo?.BirthDt || '', gender: rec.PersonInfo?.Gender || '', height: rec.PersonInfo?.Height || '',
        weight: rec.PersonInfo?.Weight || '', eye_color: rec.PersonInfo?.EyeColor || '', hair_color: rec.PersonInfo?.HairColor || '', race: rec.PersonInfo?.Race || '',
        dl_number: dlInfo.DLNum || '', dl_state: dlInfo.DLIssuingBody || '', dl_class: dlInfo.DLClass || '', dl_status: dlInfo.DLStatus || '',
        dl_expiration: dlInfo.DLExpDt || '', dl_issue_date: dlInfo.DLIssueDt || '', dl_restrictions: dlInfo.DLRestrictions || '', dl_endorsements: dlInfo.DLEndorsements || '',
        addresses: addrList.map((a: any) => ({ address: a.Addr1 || a.StreetAddress || '', address2: a.Addr2 || '', city: a.City || '', state: a.StateProv || '', postal_code: a.PostalCode || '', country: a.Country || 'US' })),
        raw_record: rec,
      });
    }
  } catch { /* ignore */ }
  return subjects;
}

export function mountMicrobiltRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  api.get('/status', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const clientId = await getConfigValue(db, CONFIG_KEYS.clientId);
      const subscriberId = await getConfigValue(db, CONFIG_KEYS.subscriberId);
      const environment = await getConfigValue(db, CONFIG_KEYS.environment) || 'sandbox';
      const enabledProducts = await getConfigValue(db, CONFIG_KEYS.enabledProducts);
      let products: string[] = [];
      try { products = enabledProducts ? JSON.parse(enabledProducts) : []; } catch { /* */ }
      return c.json({ configured: !!clientId, has_subscriber_id: !!subscriberId, environment, enabled_products: products, token_cached: !!cachedToken && Date.now() < (cachedToken?.expiresAt || 0) });
    } catch {
      return c.json({ error: 'Failed to microbilt status', code: 'MICROBILT_STATUS_ERROR' }, 500);
    }
  });

  api.put('/credentials', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const { client_id, client_secret, subscriber_id, environment } = body;
      if (client_id) await setConfigValue(db, CONFIG_KEYS.clientId, client_id, true, c.env.JWT_SECRET);
      if (client_secret) await setConfigValue(db, CONFIG_KEYS.clientSecret, client_secret, true, c.env.JWT_SECRET);
      if (subscriber_id !== undefined) { if (subscriber_id) await setConfigValue(db, CONFIG_KEYS.subscriberId, subscriber_id, true, c.env.JWT_SECRET); else await deleteConfigValue(db, CONFIG_KEYS.subscriberId); }
      if (environment && ['sandbox', 'production'].includes(environment)) await setConfigValue(db, CONFIG_KEYS.environment, environment, false, c.env.JWT_SECRET);
      cachedToken = null;
      const user = c.get('user');
      await db.prepare("INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'microbilt_credentials_updated', 'integration', 0, ?, ?)").run(user.userId, 'Updated Microbilt API credentials', c.req.header('CF-Connecting-IP') || 'unknown');
      return c.json({ message: 'Credentials saved' });
    } catch {
      return c.json({ error: 'Failed to microbilt save credentials', code: 'MICROBILT_SAVE_CREDENTIALS_ERROR' }, 500);
    }
  });

  api.delete('/credentials', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      for (const key of Object.values(CONFIG_KEYS)) await deleteConfigValue(db, key);
      cachedToken = null;
      const user = c.get('user');
      await db.prepare("INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'microbilt_credentials_cleared', 'integration', 0, ?, ?)").run(user.userId, 'Cleared Microbilt API credentials', c.req.header('CF-Connecting-IP') || 'unknown');
      return c.json({ message: 'Credentials cleared' });
    } catch {
      return c.json({ error: 'Failed to microbilt clear credentials', code: 'MICROBILT_CLEAR_CREDENTIALS_ERROR' }, 500);
    }
  });

  api.post('/test-connection', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const token = await getAccessToken(db, c.env.JWT_SECRET);
      if (!token) return c.json({ success: false, error: 'No credentials configured or token request failed' });
      return c.json({ success: true, message: 'Successfully authenticated with Microbilt API', token_preview: `${token.substring(0, 8)}...` });
    } catch (error: any) {
      return c.json({ success: false, error: error.message || 'Connection test failed' });
    }
  });

  api.put('/products', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const { products } = body;
      if (!Array.isArray(products)) return c.json({ error: 'products must be an array of product IDs', code: 'PRODUCTS_MUST_BE_AN' }, 400);
      await setConfigValue(db, CONFIG_KEYS.enabledProducts, JSON.stringify(products), false, c.env.JWT_SECRET);
      const user = c.get('user');
      await db.prepare("INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'microbilt_products_updated', 'integration', 0, ?, ?)").run(user.userId, `Updated enabled products: ${products.join(', ')}`, c.req.header('CF-Connecting-IP') || 'unknown');
      return c.json({ message: 'Products updated', products });
    } catch {
      return c.json({ error: 'Failed to microbilt update products', code: 'MICROBILT_UPDATE_PRODUCTS_ERROR' }, 500);
    }
  });

  api.post('/ofac/search', requireRole('admin', 'manager', 'officer'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const { firstName, lastName, fullName, type, dob, linkedIncident } = body;
      const searchQuery = fullName || `${lastName || ''}${firstName ? ', ' + firstName : ''}`.trim();
      if (!searchQuery && !lastName) return c.json({ hit: false, sources: [], subjects: [], message: 'Provide a name to search' });
      const sources: string[] = [];
      const allSubjects: any[] = [];
      // Local OFAC (stub in Workers)
      const localResults = searchOfacLocal(searchQuery, { type: type === 'entity' ? 'entity' : type === 'person' ? 'person' : 'all', firstName, lastName, limit: 100 });
      if (localResults.length > 0) {
        sources.push('OFAC_SDN_LOCAL');
        for (const r of localResults) {
          const dobIds = r.ids.filter((id: any) => id.id_type === 'DOB');
          const passports = r.ids.filter((id: any) => id.id_type === 'PASSPORT');
          const nationalities = r.ids.filter((id: any) => id.id_type === 'NATIONALITY' || id.id_type === 'CITIZENSHIP');
          allSubjects.push({ source: 'OFAC_SDN', ent_num: r.ent_num, name: r.sdn_name, type: r.sdn_type, program: r.program, source_list: r.source_list || 'SDN', title: r.title, remarks: r.remarks, match_source: r.match_source, match_score: r.match_score, date_of_birth: dobIds.map((d: any) => d.id_number), place_of_birth: r.ids.filter((id: any) => id.id_type === 'POB').map((d: any) => d.id_number), nationalities: nationalities.map((n: any) => n.id_number), passports: passports.map((p: any) => ({ number: p.id_number, country: p.id_country })), other_ids: r.ids.filter((id: any) => !['DOB', 'POB', 'NATIONALITY', 'CITIZENSHIP', 'PASSPORT'].includes(id.id_type)).map((id: any) => ({ type: id.id_type, number: id.id_number, country: id.id_country })), aliases: r.aliases.map((a: any) => ({ name: a.alt_name, type: a.alt_type })), addresses: r.addresses.map((a: any) => ({ address: a.address, city: a.city, state: a.state_province, country: a.country, postal_code: a.postal_code })) });
        }
      }
      // MicroBilt API
      try {
        const mbBody: any = { OFACSearchRequest: { SearchBy: { PersonInfo: {} as any } } };
        if (firstName || lastName) { mbBody.OFACSearchRequest.SearchBy.PersonInfo.PersonName = {}; if (firstName) mbBody.OFACSearchRequest.SearchBy.PersonInfo.PersonName.FirstName = firstName; if (lastName) mbBody.OFACSearchRequest.SearchBy.PersonInfo.PersonName.LastName = lastName; }
        else if (fullName) mbBody.OFACSearchRequest.SearchBy.PersonInfo.PersonName = { FullName: fullName };
        if (dob) mbBody.OFACSearchRequest.SearchBy.PersonInfo.BirthDt = dob;
        const mbResult = await callMicrobiltApi(db, c.env.JWT_SECRET, '/OFACSearch/GetReport', mbBody);
        if (mbResult) { sources.push('MICROBILT'); allSubjects.push(...parseMicrobiltOfacResponse(mbResult)); }
      } catch { /* MicroBilt not available */ }
      const hit = allSubjects.length > 0;
      const syncStatus = getOfacSyncStatus();
      const user = c.get('user');
      const searchId = await persistSearch(db, { product: 'ofac', searchType: type || 'person', searchInput: JSON.stringify({ firstName, lastName, fullName, dob }), responseData: { hit, sources, subjects: allSubjects }, hit, subjectCount: allSubjects.length, userId: user.userId, linkedIncident, ipAddress: c.req.header('CF-Connecting-IP') });
      await db.prepare("INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'ofac_search', 'screening', ?, ?, ?)").run(user.userId, searchId, `OFAC search: ${searchQuery} — ${hit ? allSubjects.length + ' hit(s)' : 'no hits'}`, c.req.header('CF-Connecting-IP') || 'unknown');
      return c.json({ hit, sources, subjects: allSubjects, searchId, resultCount: allSubjects.length, lastSyncTime: syncStatus.lastSync, sdnEntriesCount: syncStatus.entriesCount });
    } catch {
      return c.json({ hit: false, sources: [], subjects: [], resultCount: 0, message: 'Search completed with no results' });
    }
  });

  api.post('/dl/search', requireRole('admin', 'manager', 'officer'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const { firstName, lastName, dlNumber, state, dob, linkedIncident } = body;
      const searchInput = JSON.stringify({ firstName, lastName, dlNumber, state, dob });
      const searchQuery = dlNumber || `${lastName || ''}${firstName ? ' ' + firstName : ''}`.trim();
      const localResults = searchDlLocal(searchQuery, { firstName, lastName, dlNumber, state, dob, limit: 50 });
      let apiSubjects: any[] = [];
      try {
        const dlBody: any = { DLSearchRequest: { SearchBy: {} as any } };
        if (dlNumber && state) dlBody.DLSearchRequest.SearchBy.DLInfo = { DLNum: dlNumber, DLIssuingBody: state };
        if (firstName || lastName) {
          dlBody.DLSearchRequest.SearchBy.PersonInfo = { PersonName: {} as any };
          if (firstName) dlBody.DLSearchRequest.SearchBy.PersonInfo.PersonName.FirstName = firstName;
          if (lastName) dlBody.DLSearchRequest.SearchBy.PersonInfo.PersonName.LastName = lastName;
          if (dob) dlBody.DLSearchRequest.SearchBy.PersonInfo.BirthDt = dob;
          if (state && !dlNumber) dlBody.DLSearchRequest.SearchBy.DLInfo = { DLIssuingBody: state };
        }
        const mbResult = await callMicrobiltApi(db, c.env.JWT_SECRET, '/DLSearch/GetReport', dlBody);
        if (mbResult) {
          apiSubjects = parseMicrobiltDlResponse(mbResult);
          for (const subject of apiSubjects) storeDlRecord(subject);
        }
      } catch { /* MicroBilt not available */ }
      let subjects: any[];
      let source: string;
      if (apiSubjects.length > 0) {
        const apiDlKeys = new Set(apiSubjects.map(s => `${s.dl_number}:${s.dl_state}`));
        const uniqueLocal = localResults.filter(lr => !apiDlKeys.has(`${lr.dl_number}:${lr.dl_state}`));
        subjects = [...apiSubjects, ...uniqueLocal];
        source = 'MICROBILT_API';
      } else if (localResults.length > 0) { subjects = localResults; source = 'LOCAL_DB'; }
      else { subjects = []; source = 'NONE'; }
      const hit = subjects.length > 0;
      const user = c.get('user');
      const searchId = await persistSearch(db, { product: 'dl', searchType: dlNumber ? 'dl_number' : 'name', searchInput, responseData: { hit, source, subjects }, hit, subjectCount: subjects.length, userId: user.userId, linkedIncident, ipAddress: c.req.header('CF-Connecting-IP') });
      await db.prepare("INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'dl_search', 'screening', ?, ?, ?)").run(user.userId, searchId, `DL search: ${dlNumber || lastName || 'unknown'} (${state || 'all'}) — ${hit ? subjects.length + ' result(s)' : 'no results'}`, c.req.header('CF-Connecting-IP') || 'unknown');
      return c.json({ hit, source, subjects, searchId, resultCount: subjects.length });
    } catch {
      return c.json({ hit: false, source: 'NONE', subjects: [], resultCount: 0, message: 'Search completed with no results' });
    }
  });

  api.get('/dl/stats', requireRole('admin', 'manager', 'officer'), async (c) => {
    try { return c.json(getDlStats()); } catch { return c.json({ recordCount: 0, lastFetchedAt: null }); }
  });

  api.get('/searches', requireRole('admin', 'manager', 'officer'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const q = c.req.query();
      const product = q.product || null;
      const limit = Math.min(100000, Math.max(1, parseInt(q.limit || '100000') || 100000));
      const offset = parseInt(q.offset || '0') || 0;
      let sql = 'SELECT id, product, search_type, search_input, hit, subject_count, searched_by, linked_incident, created_at FROM microbilt_searches';
      const params: any[] = [];
      if (product) { sql += ' WHERE product = ?'; params.push(product); }
      sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);
      const rows = await db.prepare(sql).all(...params);
      let countSql = 'SELECT COUNT(*) as total FROM microbilt_searches';
      if (product) countSql += ' WHERE product = ?';
      const total = (await db.prepare(countSql).get(...(product ? [product] : [])) as any).total;
      return c.json({ searches: rows, total, limit, offset });
    } catch {
      return c.json({ searches: [], total: 0, limit: 50, offset: 0 });
    }
  });

  api.get('/searches/:id', requireRole('admin', 'manager', 'officer'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const row = await db.prepare('SELECT * FROM microbilt_searches WHERE id = ?').get(id) as any;
      if (!row) return c.json({ found: false, message: 'Search record not found' });
      let responseData = {};
      try { responseData = JSON.parse(row.response_data); } catch { /* */ }
      return c.json({ found: true, search: { ...row, response_data: responseData } });
    } catch {
      return c.json({ found: false, message: 'Unable to retrieve search record' });
    }
  });

  api.post('/ofac/sync', requireRole('admin'), async (c) => {
    try {
      const result = await syncOfacData();
      return c.json({ success: true, entries: result.entries, aliases: result.aliases, addresses: result.addresses, duration_ms: result.duration });
    } catch {
      return c.json({ success: false, message: 'Sync attempted but encountered an issue. Will retry automatically.' });
    }
  });

  api.get('/ofac/sync-status', requireRole('admin', 'manager', 'officer'), async (c) => {
    try {
      const status = getOfacSyncStatus();
      const listBreakdown = getOfacListBreakdown();
      return c.json({ ...status, listBreakdown });
    } catch {
      return c.json({ lastSync: null, entriesCount: 0, status: 'unknown', lastError: null, listBreakdown: [] });
    }
  });

  app.route('/api/microbilt', api);
}
