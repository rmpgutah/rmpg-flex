// ============================================================
// RMPG Flex — MicroBilt DL Search (Cloudflare Worker)
// ============================================================
// Ports the DL-search subset of legacy/server-vps/src/routes/microbilt.ts.
// The client's DL SEARCH page (DlSearchPage.tsx) POSTs /api/microbilt/dl/search
// — until now that path was a stub mount in the rewrite and unrouted on the
// proxy, so every search 404'd ("Failed to search driver's license records").
//
// Search strategy (mirrors legacy):
//   1. Local structured dl_records (+ dl_addresses) — instant, always on.
//   2. Live MicroBilt DLSearch API when credentials are configured in
//      system_config (category='integrations', AES-256-GCM encrypted with
//      SHA-256(JWT_SECRET) — same format the legacy VPS wrote, decrypted
//      here via WebCrypto). API results are persisted into dl_records.
//   3. persons table fallback — local person records with a dl_number on
//      file surface as LOCAL matches too (the rewrite's RMS is the richer
//      data source on live D1).
//
// Every search round-trip is persisted to microbilt_searches + activity_log
// (best-effort — audit failures never fail the search).
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { containsClause } from '../utils/searchText';

const microbilt = new Hono<Env>();

function requireRole(
  c: { get: (k: 'user') => { role: string } | undefined },
  ...roles: string[]
): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

// ── Credential decryption (legacy-compatible) ───────────────
// Legacy stored "ivHex:authTagHex:ciphertextHex", AES-256-GCM, key =
// SHA-256(JWT_SECRET). WebCrypto expects ciphertext||authTag concatenated.
function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function decryptLegacy(stored: string, jwtSecret: string): Promise<string | null> {
  try {
    const [ivHex, tagHex, ctHex] = stored.split(':');
    if (!ivHex || !tagHex || !ctHex) return null;
    const keyBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(jwtSecret));
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
    const ct = hexToBytes(ctHex);
    const tag = hexToBytes(tagHex);
    const data = new Uint8Array(ct.length + tag.length);
    data.set(ct); data.set(tag, ct.length);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: hexToBytes(ivHex) as unknown as BufferSource, tagLength: 128 },
      key, data as unknown as BufferSource,
    );
    return new TextDecoder().decode(plain);
  } catch { return null; }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Encrypt a credential for storage in the SAME "ivHex:authTagHex:ciphertextHex"
 *  format decryptLegacy() reads — AES-256-GCM, key = SHA-256(JWT_SECRET). Node's
 *  GCM cipher.getAuthTag() returns the tag separately; WebCrypto appends it to
 *  the ciphertext, so this splits the last 16 bytes back off to match. */
async function encryptLegacy(plaintext: string, jwtSecret: string): Promise<string> {
  const keyBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(jwtSecret));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ctWithTag = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource, tagLength: 128 },
    key, new TextEncoder().encode(plaintext) as unknown as BufferSource,
  ));
  const tag = ctWithTag.slice(ctWithTag.length - 16);
  const ct = ctWithTag.slice(0, ctWithTag.length - 16);
  return `${bytesToHex(iv)}:${bytesToHex(tag)}:${bytesToHex(ct)}`;
}

async function setConfigValue(db: ReturnType<typeof getDb>, key: string, value: string): Promise<void> {
  await execute(db, "DELETE FROM system_config WHERE config_key = ? AND category = 'integrations'", key);
  await execute(
    db,
    "INSERT INTO system_config (config_key, config_value, category, is_active) VALUES (?, ?, 'integrations', 1)",
    key, value,
  );
}

async function deleteConfigValue(db: ReturnType<typeof getDb>, key: string): Promise<void> {
  try { await execute(db, "DELETE FROM system_config WHERE config_key = ? AND category = 'integrations'", key); }
  catch { /* best-effort */ }
}

async function getConfigValue(db: ReturnType<typeof getDb>, key: string): Promise<string | null> {
  try {
    const row = await queryFirst<{ config_value: string }>(
      db,
      `SELECT config_value FROM system_config
       WHERE config_key = ? AND category = 'integrations' AND is_active = 1 LIMIT 1`,
      key,
    );
    return row?.config_value || null;
  } catch { return null; }
}

const MB_BASE_URLS: Record<string, string> = {
  sandbox: 'https://apitest.microbilt.com',
  production: 'https://api.microbilt.com',
};

/** OAuth client-credentials token; null when creds absent/undecryptable. */
async function getMicrobiltToken(
  db: ReturnType<typeof getDb>,
  jwtSecret: string,
): Promise<{ token: string; baseUrl: string } | null> {
  const [encId, encSecret] = await Promise.all([
    getConfigValue(db, 'microbilt_client_id'),
    getConfigValue(db, 'microbilt_client_secret'),
  ]);
  if (!encId || !encSecret) return null;
  const clientId = await decryptLegacy(encId, jwtSecret);
  const clientSecret = await decryptLegacy(encSecret, jwtSecret);
  if (!clientId || !clientSecret) return null;

  const envName = (await getConfigValue(db, 'microbilt_environment')) || 'sandbox';
  const baseUrl = MB_BASE_URLS[envName] || MB_BASE_URLS.sandbox;
  const resp = await fetch(`${baseUrl}/OAuth/GetAccessToken`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!resp.ok) return null;
  const data = await resp.json() as { access_token?: string };
  return data.access_token ? { token: data.access_token, baseUrl } : null;
}

// ── Local dl_records search ─────────────────────────────────
interface DlRecordRow {
  id: number; first_name: string; middle_name: string; last_name: string;
  full_name: string; suffix: string; date_of_birth: string; gender: string;
  height: string; weight: string; eye_color: string; hair_color: string; race: string;
  dl_number: string; dl_state: string; dl_class: string; dl_status: string;
  dl_expiration: string; dl_issue_date: string; dl_restrictions: string;
  dl_endorsements: string; source: string; fetched_at: string;
}

async function searchDlLocal(
  db: ReturnType<typeof getDb>,
  p: { firstName?: string; lastName?: string; dlNumber?: string; state?: string; dob?: string },
): Promise<any[]> {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (p.dlNumber) { const m = containsClause('dl_number'); conds.push(m.sql); params.push(m.bind(p.dlNumber)); }
  if (p.lastName) { const m = containsClause('last_name'); conds.push(m.sql); params.push(m.bind(p.lastName)); }
  if (p.firstName) { const m = containsClause('first_name'); conds.push(m.sql); params.push(m.bind(p.firstName)); }
  if (p.state) { conds.push('dl_state = ?'); params.push(p.state); }
  if (p.dob) { conds.push('date_of_birth = ?'); params.push(p.dob); }
  if (conds.length === 0) return [];

  const rows = await query<DlRecordRow>(
    db,
    `SELECT * FROM dl_records WHERE ${conds.join(' AND ')} ORDER BY updated_at DESC LIMIT 50`,
    ...params,
  );
  const subjects: any[] = [];
  for (const r of rows) {
    let addresses: any[] = [];
    try {
      addresses = await query<any>(
        db,
        'SELECT address, address2, city, state, postal_code, country FROM dl_addresses WHERE dl_record_id = ?',
        r.id,
      );
    } catch { /* addresses optional */ }
    subjects.push({ ...r, addresses, source: r.source || 'LOCAL_DB', match_source: 'dl_records' });
  }
  return subjects;
}

/** Secondary local source: persons rows that carry a DL number. */
async function searchPersonsWithDl(
  db: ReturnType<typeof getDb>,
  p: { firstName?: string; lastName?: string; dlNumber?: string; state?: string; dob?: string },
): Promise<any[]> {
  const conds: string[] = ["COALESCE(dl_number,'') != ''"];
  const params: unknown[] = [];
  if (p.dlNumber) { const m = containsClause('dl_number'); conds.push(m.sql); params.push(m.bind(p.dlNumber)); }
  if (p.lastName) { const m = containsClause('last_name'); conds.push(m.sql); params.push(m.bind(p.lastName)); }
  if (p.firstName) { const m = containsClause('first_name'); conds.push(m.sql); params.push(m.bind(p.firstName)); }
  if (p.state) { conds.push('dl_state = ?'); params.push(p.state); }
  if (p.dob) { conds.push('dob = ?'); params.push(p.dob); }
  try {
    const rows = await query<any>(
      db,
      `SELECT id, first_name, middle_name, last_name, dob, gender, height, weight,
              eye_color, hair_color, race, dl_number, dl_state, dl_class, dl_expiry,
              address, city, state as person_state, zip
       FROM persons WHERE ${conds.join(' AND ')} ORDER BY updated_at DESC LIMIT 25`,
      ...params,
    );
    return rows.map((r) => ({
      id: r.id,
      first_name: r.first_name || '',
      middle_name: r.middle_name || '',
      last_name: r.last_name || '',
      full_name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
      date_of_birth: r.dob || '',
      gender: r.gender || '',
      height: r.height || '',
      weight: r.weight || '',
      eye_color: r.eye_color || '',
      hair_color: r.hair_color || '',
      race: r.race || '',
      dl_number: r.dl_number || '',
      dl_state: r.dl_state || '',
      dl_class: r.dl_class || '',
      dl_expiration: r.dl_expiry || '',
      addresses: r.address ? [{ address: r.address, city: r.city || '', state: r.person_state || '', postal_code: r.zip || '', country: 'US' }] : [],
      source: 'PERSONS_DB',
      match_source: 'persons',
    }));
  } catch { return []; }
}

// ── MicroBilt response → normalized subject (port of legacy parser) ──
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
        first_name: personName.FirstName || '',
        middle_name: personName.MiddleName || '',
        last_name: personName.LastName || '',
        full_name: personName.FullName || `${personName.FirstName || ''} ${personName.LastName || ''}`.trim(),
        suffix: personName.SuffixName || '',
        date_of_birth: rec.PersonInfo?.BirthDt || '',
        gender: rec.PersonInfo?.Gender || '',
        height: rec.PersonInfo?.Height || '',
        weight: rec.PersonInfo?.Weight || '',
        eye_color: rec.PersonInfo?.EyeColor || '',
        hair_color: rec.PersonInfo?.HairColor || '',
        race: rec.PersonInfo?.Race || '',
        dl_number: dlInfo.DLNum || '',
        dl_state: dlInfo.DLIssuingBody || '',
        dl_class: dlInfo.DLClass || '',
        dl_status: dlInfo.DLStatus || '',
        dl_expiration: dlInfo.ExpDt || '',
        dl_issue_date: dlInfo.IssueDt || '',
        dl_restrictions: dlInfo.Restrictions || '',
        dl_endorsements: dlInfo.Endorsements || '',
        addresses: addrList.map((a: any) => ({
          address: a?.Addr1 || '', address2: a?.Addr2 || '', city: a?.City || '',
          state: a?.StateProv || '', postal_code: a?.PostalCode || '', country: a?.Country || 'US',
        })),
      });
    }
  } catch { /* malformed API payload → no subjects */ }
  return subjects;
}

/** Persist an API subject into dl_records (upsert on dl_number+dl_state). */
async function storeDlRecord(db: ReturnType<typeof getDb>, s: any): Promise<void> {
  if (!s.dl_number || !s.dl_state) return;
  try {
    const existing = await queryFirst<{ id: number }>(
      db, 'SELECT id FROM dl_records WHERE dl_number = ? AND dl_state = ?', s.dl_number, s.dl_state,
    );
    if (existing) {
      await execute(
        db,
        `UPDATE dl_records SET first_name=?, middle_name=?, last_name=?, full_name=?,
           date_of_birth=?, gender=?, dl_class=?, dl_status=?, dl_expiration=?,
           source='MICROBILT_DL', fetched_at=datetime('now'), updated_at=datetime('now')
         WHERE id=?`,
        s.first_name || '', s.middle_name || '', s.last_name || '', s.full_name || '',
        s.date_of_birth || '', s.gender || '', s.dl_class || '', s.dl_status || '',
        s.dl_expiration || '', existing.id,
      );
    } else {
      await execute(
        db,
        `INSERT INTO dl_records (
           dl_number, dl_state, dl_class, dl_status, dl_expiration, dl_issue_date,
           dl_restrictions, dl_endorsements, first_name, middle_name, last_name,
           full_name, suffix, date_of_birth, gender, height, weight, eye_color,
           hair_color, race, source, fetched_at, updated_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'MICROBILT_DL', datetime('now'), datetime('now'))`,
        s.dl_number, s.dl_state, s.dl_class || '', s.dl_status || '', s.dl_expiration || '',
        s.dl_issue_date || '', s.dl_restrictions || '', s.dl_endorsements || '',
        s.first_name || '', s.middle_name || '', s.last_name || '', s.full_name || '',
        s.suffix || '', s.date_of_birth || '', s.gender || '', s.height || '',
        s.weight || '', s.eye_color || '', s.hair_color || '', s.race || '',
      );
    }
  } catch (err) {
    console.error('[Microbilt] storeDlRecord failed (non-fatal):', err);
  }
}

// ── POST /dl/search ─────────────────────────────────────────
microbilt.post('/dl/search', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'officer', 'dispatcher');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, any>>().catch(() => ({} as Record<string, any>));
    const { firstName, lastName, dlNumber, state, dob, linkedIncident } = body;
    if (!lastName && !dlNumber) {
      return c.json({ hit: false, source: 'NONE', subjects: [], searchId: 0, resultCount: 0 });
    }
    const params = { firstName, lastName, dlNumber, state, dob };

    // 1. Local structured stores (dl_records + persons), in parallel.
    const [localResults, personResults] = await Promise.all([
      searchDlLocal(db, params),
      searchPersonsWithDl(db, params),
    ]);

    // 2. Live MicroBilt API when configured (best-effort).
    let apiSubjects: any[] = [];
    try {
      const auth = await getMicrobiltToken(db, c.env.JWT_SECRET);
      if (auth) {
        const dlBody: any = { DLSearchRequest: { SearchBy: {} as any } };
        if (dlNumber && state) dlBody.DLSearchRequest.SearchBy.DLInfo = { DLNum: dlNumber, DLIssuingBody: state };
        if (firstName || lastName) {
          dlBody.DLSearchRequest.SearchBy.PersonInfo = { PersonName: {} as any };
          if (firstName) dlBody.DLSearchRequest.SearchBy.PersonInfo.PersonName.FirstName = firstName;
          if (lastName) dlBody.DLSearchRequest.SearchBy.PersonInfo.PersonName.LastName = lastName;
          if (dob) dlBody.DLSearchRequest.SearchBy.PersonInfo.BirthDt = dob;
          if (state && !dlNumber) dlBody.DLSearchRequest.SearchBy.DLInfo = { DLIssuingBody: state };
        }
        const resp = await fetch(`${auth.baseUrl}/DLSearch/GetReport`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(dlBody),
        });
        if (resp.ok) {
          apiSubjects = parseMicrobiltDlResponse(await resp.json());
          for (const s of apiSubjects) await storeDlRecord(db, s);
        }
      }
    } catch (err) {
      console.log('[Microbilt] API unavailable, local results only:', err);
    }

    // 3. Merge: API first, then unique local dl_records, then unique persons.
    const seen = new Set(apiSubjects.map((s) => `${s.dl_number}:${s.dl_state}`));
    const merged = [...apiSubjects];
    for (const r of [...localResults, ...personResults]) {
      const key = `${r.dl_number}:${r.dl_state}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(r);
    }
    const hit = merged.length > 0;
    const source = apiSubjects.length > 0 ? 'MICROBILT_API' : hit ? 'LOCAL_DB' : 'NONE';

    // 4. Persist the search (best-effort audit trail).
    let searchId = 0;
    const userId = (c.get('userId') as number | undefined) ?? null;
    try {
      const result = await execute(
        db,
        `INSERT INTO microbilt_searches
           (product, search_type, search_input, response_data, hit, subject_count, searched_by, linked_incident, ip_address, created_at)
         VALUES ('dl', ?, ?, ?, ?, ?, ?, ?, 'worker', datetime('now'))`,
        dlNumber ? 'dl_number' : 'name',
        JSON.stringify({ firstName, lastName, dlNumber, state, dob }),
        JSON.stringify({ hit, source, count: merged.length }),
        hit ? 1 : 0, merged.length, userId, linkedIncident || null,
      );
      searchId = Number(result.meta.last_row_id) || 0;
      await execute(
        db,
        `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
         VALUES (?, 'dl_search', 'screening', ?, ?, 'worker')`,
        userId, searchId,
        `DL search: ${dlNumber || lastName || 'unknown'} (${state || 'all'}) — ${hit ? merged.length + ' result(s)' : 'no results'}`,
      );
    } catch (err) {
      console.error('[Microbilt] search audit failed (non-fatal):', err);
    }

    return c.json({ hit, source, subjects: merged, searchId, resultCount: merged.length });
  } catch (err) {
    console.error('[Microbilt] DL search error:', err);
    return c.json({ hit: false, source: 'NONE', subjects: [], searchId: 0, resultCount: 0 });
  }
});

// ── GET /dl/stats — local DL record count + last fetch ──────
microbilt.get('/dl/stats', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'officer', 'dispatcher');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const row = await queryFirst<{ cnt: number; last: string | null }>(
      db, 'SELECT COUNT(*) as cnt, MAX(fetched_at) as last FROM dl_records',
    );
    return c.json({ recordCount: row?.cnt ?? 0, lastFetchedAt: row?.last ?? null });
  } catch {
    return c.json({ recordCount: 0, lastFetchedAt: null });
  }
});

// ── GET /status — configuration status (read-only) ──────────
microbilt.get('/status', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const [clientId, subscriberId, environment, enabledProducts] = await Promise.all([
      getConfigValue(db, 'microbilt_client_id'),
      getConfigValue(db, 'microbilt_subscriber_id'),
      getConfigValue(db, 'microbilt_environment'),
      getConfigValue(db, 'microbilt_enabled_products'),
    ]);
    let products: string[] = [];
    try { products = enabledProducts ? JSON.parse(enabledProducts) : []; } catch { /* */ }
    return c.json({
      configured: !!clientId,
      has_subscriber_id: !!subscriberId,
      environment: environment || 'sandbox',
      enabled_products: products,
      token_cached: false,
    });
  } catch {
    return c.json({ configured: false, has_subscriber_id: false, environment: 'sandbox', enabled_products: [], token_cached: false });
  }
});

// ── PUT /credentials — save client_id/client_secret/subscriber_id/environment ──
// Also doubles as the environment-only update AdminMicrobiltTab.tsx's
// handleEnvironmentChange sends (client_id/client_secret omitted).
microbilt.put('/credentials', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const body = await c.req.json<{
      client_id?: string; client_secret?: string; subscriber_id?: string; environment?: string;
    }>().catch(() => ({} as Record<string, never>));
    if (body.client_id && body.client_secret) {
      const [encId, encSecret] = await Promise.all([
        encryptLegacy(body.client_id, c.env.JWT_SECRET),
        encryptLegacy(body.client_secret, c.env.JWT_SECRET),
      ]);
      await setConfigValue(db, 'microbilt_client_id', encId);
      await setConfigValue(db, 'microbilt_client_secret', encSecret);
    }
    if (body.subscriber_id) {
      await setConfigValue(db, 'microbilt_subscriber_id', await encryptLegacy(body.subscriber_id, c.env.JWT_SECRET));
    }
    if (body.environment === 'sandbox' || body.environment === 'production') {
      await setConfigValue(db, 'microbilt_environment', body.environment);
    }
    return c.json({ success: true });
  } catch (err) {
    console.error('[Microbilt] save credentials failed:', err);
    return c.json({ error: 'Failed to save credentials' }, 500);
  }
});

// ── DELETE /credentials — clear everything, including cached token flag ──
microbilt.delete('/credentials', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  const db = getDb(c.env);
  for (const key of ['microbilt_client_id', 'microbilt_client_secret', 'microbilt_subscriber_id']) {
    await deleteConfigValue(db, key);
  }
  return c.json({ success: true });
});

// ── POST /test-connection — fetch a real OAuth token to confirm credentials work ──
microbilt.post('/test-connection', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const auth = await getMicrobiltToken(db, c.env.JWT_SECRET);
    if (!auth) {
      return c.json({ success: false, error: 'No credentials saved, or credentials are invalid' });
    }
    return c.json({ success: true, message: 'Connected to MicroBilt', token_preview: `${auth.token.slice(0, 8)}...` });
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Connection test failed' });
  }
});

// ── PUT /products — save the enabled product list ────────────
microbilt.put('/products', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const body = await c.req.json<{ products?: string[] }>().catch(() => ({} as Record<string, never>));
    const products = Array.isArray(body.products) ? body.products.filter((p) => typeof p === 'string') : [];
    await setConfigValue(db, 'microbilt_enabled_products', JSON.stringify(products));
    return c.json({ success: true, enabled_products: products });
  } catch (err) {
    console.error('[Microbilt] save products failed:', err);
    return c.json({ error: 'Failed to save products' }, 500);
  }
});

// ── GET /background/usage — usage stats for the QB background-check product ──
// Real query against microbilt_searches — no separate QB search flow has
// shipped yet (only DL search writes rows today), so this honestly reports
// zeros until that flow lands, rather than fabricating numbers.
microbilt.get('/background/usage', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const totals = await queryFirst<{ total: number; hits: number; subjects: number }>(db, `
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN hit = 1 THEN 1 ELSE 0 END) AS hits,
             COUNT(DISTINCT search_input) AS subjects
      FROM microbilt_searches WHERE product = 'background_check'
    `);
    const recent = await queryFirst<{ n: number }>(db, `
      SELECT COUNT(*) AS n FROM microbilt_searches
      WHERE product = 'background_check' AND created_at > datetime('now', '-30 days')
    `);
    const total = totals?.total ?? 0;
    const hits = totals?.hits ?? 0;
    return c.json({
      totalSearches: total,
      totalHits: hits,
      hitRate: total > 0 ? Math.round((hits / total) * 1000) / 10 : 0,
      uniqueSubjects: totals?.subjects ?? 0,
      last30Days: recent?.n ?? 0,
    });
  } catch (err) {
    console.error('[Microbilt] background usage query failed:', err);
    return c.json({ totalSearches: 0, totalHits: 0, hitRate: 0, uniqueSubjects: 0, last30Days: 0 });
  }
});

export default microbilt;
