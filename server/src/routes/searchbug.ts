// ============================================================
// SearchBug NCIC Search API Integration
// ============================================================
// Proxies criminal records, people search, and property lookups
// through SearchBug's API so credentials stay server-side.
// Stores encrypted API credentials in system_config.
//
// API docs: https://www.searchbug.com/info/api/api-guide/
// Endpoint: POST https://data.searchbug.com/api/search.aspx
// Auth: CO_CODE (account #) + PASS (API key)
//
// Supported TYPE values:
//   api_crm  — Criminal Records  ($1.75/search)
//   api_ppl  — People Search     ($0.33-$0.79/search)
//   api_back — Background Report (requires reportToken from People Search)
//   api_prop — Property Records  ($0.20-$0.50/search)

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow } from '../utils/timeUtils';
import config from '../config';

const router = Router();
router.use(authenticateToken);

// ============================================================
// Encryption helpers (reuses pattern from microbilt.ts)
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
  accountNumber: 'searchbug_account_number',
  apiKey: 'searchbug_api_key',
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
// SearchBug API constants
// ============================================================

const SEARCHBUG_API_URL = 'https://data.searchbug.com/api/search.aspx';

/** Max criminal results returned to conserve credits */
const MAX_CRIMINAL_RESULTS = 2;

// ============================================================
// Shared helper — call SearchBug API
// ============================================================

async function callSearchBug(params: Record<string, string>): Promise<{ ok: boolean; data?: any; error?: string; raw?: string }> {
  const accountNumber = getDecryptedValue(CONFIG_KEYS.accountNumber);
  const apiKey = getDecryptedValue(CONFIG_KEYS.apiKey);
  if (!accountNumber || !apiKey) {
    return { ok: false, error: 'SearchBug API not configured. Contact your admin.' };
  }

  const formData = new URLSearchParams();
  formData.append('CO_CODE', accountNumber);
  formData.append('PASS', apiKey);
  formData.append('FORMAT', 'JSON');

  for (const [k, v] of Object.entries(params)) {
    if (v) formData.append(k, v);
  }

  try {
    const resp = await fetch(SEARCHBUG_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    });

    const text = await resp.text();

    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      if (text.includes('<FOUND>No</FOUND>')) {
        return { ok: true, data: { found: false } };
      }
      return { ok: false, error: 'Unexpected response format from SearchBug', raw: text.substring(0, 500) };
    }

    if (data?.Status === 'Error' || data?.Error) {
      return { ok: false, error: data.Error || 'SearchBug returned an error' };
    }

    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message || 'SearchBug API call failed' };
  }
}

/** Audit-log a search */
function logSearch(req: Request, searchType: string, details: Record<string, any>): void {
  try {
    const db = getDb();
    const now = localNow();
    const userId = (req as any).user?.id || 0;
    db.prepare(
      "INSERT INTO audit_log (user_id, action, resource_type, details, created_at) VALUES (?, 'search', ?, ?, ?)"
    ).run(userId, searchType, JSON.stringify({ source: 'searchbug', ...details }), now);
  } catch { /* audit table may not exist */ }
}

// ============================================================
// Admin routes — credential management
// ============================================================

// GET /api/searchbug/status
router.get('/status', requireRole('admin', 'manager'), (_req: Request, res: Response) => {
  try {
    const accountNumber = getConfigValue(CONFIG_KEYS.accountNumber);
    res.json({
      configured: !!accountNumber,
      has_account_number: !!accountNumber,
      has_api_key: !!getConfigValue(CONFIG_KEYS.apiKey),
    });
  } catch (error: any) {
    console.error('SearchBug status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/searchbug/credentials
router.put('/credentials', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { account_number, api_key } = req.body;
    if (account_number) setConfigValue(CONFIG_KEYS.accountNumber, account_number, true);
    if (api_key) setConfigValue(CONFIG_KEYS.apiKey, api_key, true);

    const db = getDb();
    const now = localNow();
    const userId = (req as any).user?.id || 0;
    try {
      db.prepare(
        "INSERT INTO audit_log (user_id, action, resource_type, details, created_at) VALUES (?, 'update', 'system_config', ?, ?)"
      ).run(userId, 'SearchBug API credentials updated', now);
    } catch { /* audit table may not exist */ }

    res.json({ message: 'SearchBug credentials saved' });
  } catch (error: any) {
    console.error('SearchBug credentials error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/searchbug/credentials
router.delete('/credentials', requireRole('admin'), (_req: Request, res: Response) => {
  try {
    deleteConfigValue(CONFIG_KEYS.accountNumber);
    deleteConfigValue(CONFIG_KEYS.apiKey);
    res.json({ message: 'SearchBug credentials removed' });
  } catch (error: any) {
    console.error('SearchBug delete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/searchbug/test
router.post('/test', requireRole('admin', 'manager'), async (_req: Request, res: Response) => {
  try {
    const result = await callSearchBug({ TYPE: 'status', TYPE_API: 'api_crm' });
    if (!result.ok) {
      return res.json({ success: false, error: result.error });
    }
    const d = result.data;
    if (d?.Status === 'Success' || d?.Data?.BALANCE) {
      return res.json({
        success: true,
        message: `Connected \u2014 Balance: $${d.Data?.BALANCE || '?'}, Rate: $${d.Data?.RATE || '?'}/search`,
        balance: d.Data?.BALANCE,
        rate: d.Data?.RATE,
      });
    }
    return res.json({ success: false, error: d?.Error || 'Unknown error from SearchBug' });
  } catch (error: any) {
    console.error('SearchBug test error:', error);
    res.status(500).json({ success: false, error: error.message || 'Connection failed' });
  }
});

// ============================================================
// Criminal Records Search  (TYPE = api_crm)
// ============================================================

router.post('/criminal-search', async (req: Request, res: Response) => {
  try {
    const { first_name, last_name, city, state, dob } = req.body;

    if (!last_name) return res.status(400).json({ error: 'Last name is required' });
    if (!first_name) return res.status(400).json({ error: 'First name is required for credit conservation' });
    if (!state) return res.status(400).json({ error: 'State is required for credit conservation' });

    const result = await callSearchBug({
      TYPE: 'api_crm',
      FNAME: first_name?.trim() || '',
      LNAME: last_name.trim(),
      CITY: city?.trim() || '',
      STATE: state?.trim() || '',
      DOB: dob?.trim() || '',
      REF: `rmpg-flex-${(req as any).user?.id || 0}`,
    });

    if (!result.ok) {
      return res.status(result.error?.includes('not configured') ? 400 : 502).json({ error: result.error });
    }

    if (result.data?.found === false) {
      return res.json({ found: false, count: 0, criminals: [] });
    }

    logSearch(req, 'criminal_records', { last_name, first_name, state });

    // Normalize the response
    const criminals = result.data?.criminals || result.data?.result?.criminals || [];
    const criminalList = Array.isArray(criminals) ? criminals : (criminals?.criminal ? [criminals.criminal] : []);

    // Cap results to conserve credits
    const capped = criminalList.slice(0, MAX_CRIMINAL_RESULTS);

    const results = capped.map((c: any) => {
      const suspect = c?.suspect || {};
      const name = suspect?.name || {};
      const address = suspect?.address || {};
      const crimes = c?.crimeDetailsRecords?.crimeDetails || [];
      const crimeList = Array.isArray(crimes) ? crimes : [crimes];

      return {
        name: { first: name.firstName || '', middle: name.middleName || '', last: name.lastName || '', suffix: name.nameSuffix || '' },
        dob: suspect.DOB || '',
        age: suspect.currentAge || '',
        gender: suspect.gender || '',
        race: suspect.ethnicity || '',
        hair: suspect.hair || '',
        eyes: suspect.eyes || '',
        height: suspect.height || '',
        weight: suspect.weight || '',
        scars_marks: suspect.scarsMarks || '',
        is_sex_offender: suspect.isSexOffender || 'Unknown',
        report_token: suspect.reportToken || '',
        address: {
          line1: address.line1 || address.Line1 || '',
          city: address.City || address.city || '',
          county: address.county || '',
          state: address.state || '',
          zip: address.zip || '',
        },
        crimes: crimeList.filter(Boolean).map((crime: any) => ({
          source_state: crime.sourceState || '',
          case_number: crime.caseNumber || '',
          crime_type: crime.crimeType || '',
          case_type: crime.caseType || '',
          offense_code: crime.offenseCode || '',
          offense_description: crime.offenseDescription1 || '',
          offense_description_2: crime.offenseDescription2 || '',
          disposition: crime.disposition || '',
          disposition_date: crime.dispositionDate || '',
          offense_date: crime.offenseDate || '',
          charges_filed_date: crime.chargesFiledDate || '',
          court: crime.court || '',
          county: crime.crimeCounty || '',
          sentence: crime.sentence || '',
          probation: crime.probation || '',
          fines: crime.fines || '',
          plea: crime.plea || '',
          arresting_agency: crime.arrestingAgency || '',
          warrant: crime.warrant || '',
          warrant_date: crime.warrantDate || '',
          victim_gender: crime.victimGender || '',
          victim_age: crime.victimAge || '',
          victim_is_minor: crime.victimIsMinor || '',
        })),
      };
    });

    const totalFound = criminalList.length;
    res.json({
      found: results.length > 0,
      count: results.length,
      total_found: totalFound,
      capped: totalFound > MAX_CRIMINAL_RESULTS,
      criminals: results,
    });
  } catch (error: any) {
    console.error('SearchBug criminal search error:', error);
    res.status(500).json({ error: 'Criminal records search failed' });
  }
});

// ============================================================
// People Search  (TYPE = api_ppl)
// ============================================================

router.post('/people-search', async (req: Request, res: Response) => {
  try {
    const { first_name, last_name, middle_name, address, city, state, zip, phone, email, dob } = req.body;

    // Require at least one strong identifier
    const hasName = !!(first_name && last_name);
    const hasPhone = !!phone;
    const hasEmail = !!email;
    const hasAddress = !!(address && city && state);

    if (!hasName && !hasPhone && !hasEmail && !hasAddress) {
      return res.status(400).json({
        error: 'Provide at least one: (First + Last Name), Phone Number, Email, or (Address + City + State)',
      });
    }

    const params: Record<string, string> = {
      TYPE: 'api_ppl',
      REF: `rmpg-flex-${(req as any).user?.id || 0}`,
    };

    if (first_name) params.FNAME = first_name.trim();
    if (middle_name) params.MNAME = middle_name.trim();
    if (last_name) params.LNAME = last_name.trim();
    if (address) params.ADDRESS = address.trim();
    if (city) params.CITY = city.trim();
    if (state) params.STATE = state.trim();
    if (zip) params.ZIP = zip.trim();
    if (phone) params.F = phone.replace(/\D/g, '');
    if (email) params.EMAIL = email.trim();
    if (dob) params.DOB = dob.trim();

    const result = await callSearchBug(params);
    if (!result.ok) {
      return res.status(result.error?.includes('not configured') ? 400 : 502).json({ error: result.error });
    }

    if (result.data?.found === false) {
      return res.json({ found: false, count: 0, people: [] });
    }

    logSearch(req, 'people_search', { last_name, first_name, phone, email, state });

    // Normalize people search results
    const peopleRaw = result.data?.result?.people?.person || result.data?.people?.person || result.data?.result?.people || [];
    const peopleList = Array.isArray(peopleRaw) ? peopleRaw : [peopleRaw];

    // Cap to 2 to conserve credits
    const capped = peopleList.filter(Boolean).slice(0, MAX_CRIMINAL_RESULTS);

    const people = capped.map((p: any) => {
      const names = p?.names?.name || [];
      const nameList = Array.isArray(names) ? names : [names];
      const primaryName = nameList[0] || {};

      const addresses = p?.addresses?.address || [];
      const addressList = Array.isArray(addresses) ? addresses : [addresses];

      const phones = p?.phones?.phone || [];
      const phoneList = Array.isArray(phones) ? phones : [phones];

      const emails = p?.emailAddresses?.emailAddress || p?.emails?.email || [];
      const emailList = Array.isArray(emails) ? emails : [emails];

      const relatives = p?.relatives?.relative || [];
      const relativeList = Array.isArray(relatives) ? relatives : [relatives];

      return {
        report_token: p?.reportToken || '',
        name: {
          first: primaryName.firstName || '',
          middle: primaryName.middleName || '',
          last: primaryName.lastName || '',
          suffix: primaryName.nameSuffix || '',
        },
        aliases: nameList.slice(1).map((n: any) => `${n.firstName || ''} ${n.middleName || ''} ${n.lastName || ''}`.trim()).filter(Boolean),
        dob: p?.DOBs?.DOB || p?.dob || '',
        age: p?.currentAge || p?.age || '',
        is_deceased: p?.isDeceased || 'No',
        dod: p?.DOD || '',
        addresses: addressList.filter(Boolean).map((a: any) => ({
          line1: a.line1 || a.Line1 || '',
          city: a.City || a.city || '',
          state: a.state || '',
          zip: a.zip || '',
          county: a.county || '',
          type: a.addressType || '',
          first_seen: a.firstDate || '',
          last_seen: a.lastDate || '',
        })),
        phones: phoneList.filter(Boolean).map((ph: any) => ({
          number: ph.phoneNumber || ph.phone || '',
          type: ph.phoneType || ph.type || '',
          carrier: ph.carrier || '',
          is_connected: ph.isConnected || '',
        })),
        emails: emailList.filter(Boolean).map((e: any) => (typeof e === 'string' ? e : e.address || e.email || '')).filter(Boolean),
        relatives: relativeList.filter(Boolean).slice(0, 5).map((r: any) => ({
          name: `${r.firstName || ''} ${r.lastName || ''}`.trim(),
          relationship: r.relationship || '',
          dob: r.DOB || '',
          report_token: r.relativeReportToken || '',
        })),
        bankruptcies: p?.bankruptcies || [],
        liens: p?.liens || [],
        judgments: p?.judgments || [],
      };
    });

    res.json({
      found: people.length > 0,
      count: people.length,
      total_found: peopleList.length,
      capped: peopleList.length > MAX_CRIMINAL_RESULTS,
      people,
    });
  } catch (error: any) {
    console.error('SearchBug people search error:', error);
    res.status(500).json({ error: 'People search failed' });
  }
});

// ============================================================
// Background Report  (TYPE = api_back)
// ============================================================

router.post('/background-report', async (req: Request, res: Response) => {
  try {
    const { report_token } = req.body;
    if (!report_token) {
      return res.status(400).json({ error: 'Report token is required (from People Search results)' });
    }

    const result = await callSearchBug({
      TYPE: 'api_back',
      reportToken: report_token,
      REF: `rmpg-flex-${(req as any).user?.id || 0}`,
    });

    if (!result.ok) {
      return res.status(502).json({ error: result.error });
    }

    logSearch(req, 'background_report', { report_token: report_token.substring(0, 10) + '...' });

    // Pass through the full background report (it's comprehensive)
    const report = result.data?.result || result.data || {};

    // Extract key sections
    const person = report?.person || report?.people?.person || {};
    const names = person?.names?.name || [];
    const nameList = Array.isArray(names) ? names : [names];
    const addresses = person?.addresses?.address || [];
    const addressList = Array.isArray(addresses) ? addresses : [addresses];
    const phones = person?.phones?.phone || [];
    const phoneList = Array.isArray(phones) ? phones : [phones];
    const emails = person?.emailAddresses?.emailAddress || person?.emails?.email || [];
    const emailList = Array.isArray(emails) ? emails : [emails];
    const criminalRecords = person?.criminalRecords?.criminal || [];
    const crimList = Array.isArray(criminalRecords) ? criminalRecords : [criminalRecords];
    const evictions = person?.evictions?.eviction || [];
    const evictionList = Array.isArray(evictions) ? evictions : [evictions];
    const relatives = person?.relatives?.relative || [];
    const relativeList = Array.isArray(relatives) ? relatives : [relatives];
    const bankruptcies = person?.personalBankruptcyFilings?.filing || [];
    const bankruptcyList = Array.isArray(bankruptcies) ? bankruptcies : [bankruptcies];
    const liens = person?.personalLienFilings?.filing || [];
    const lienList = Array.isArray(liens) ? liens : [liens];
    const judgments = person?.personalJudgmentFilings?.filing || [];
    const judgmentList = Array.isArray(judgments) ? judgments : [judgments];
    const weapons = person?.concealedWeaponPermits?.permit || [];
    const weaponList = Array.isArray(weapons) ? weapons : [weapons];
    const watchlist = person?.watchListRecords?.record || [];
    const watchlistList = Array.isArray(watchlist) ? watchlist : [watchlist];

    res.json({
      found: true,
      report: {
        names: nameList.filter(Boolean).map((n: any) => ({
          first: n.firstName || '', middle: n.middleName || '', last: n.lastName || '', suffix: n.nameSuffix || '',
        })),
        dob: person?.DOBs?.DOB || person?.dob || '',
        dod: person?.DODs?.DOD || '',
        addresses: addressList.filter(Boolean).map((a: any) => ({
          line1: a.line1 || a.Line1 || '', city: a.City || a.city || '', state: a.state || '',
          zip: a.zip || '', county: a.county || '', first_seen: a.firstDate || '', last_seen: a.lastDate || '',
        })),
        phones: phoneList.filter(Boolean).map((ph: any) => ({
          number: ph.phoneNumber || ph.phone || '', type: ph.phoneType || '', carrier: ph.carrier || '',
        })),
        emails: emailList.filter(Boolean).map((e: any) => (typeof e === 'string' ? e : e.address || e.email || '')).filter(Boolean),
        relatives: relativeList.filter(Boolean).slice(0, 10).map((r: any) => ({
          name: `${r.firstName || ''} ${r.lastName || ''}`.trim(), relationship: r.relationship || '', dob: r.DOB || '',
        })),
        criminal_records: crimList.filter(Boolean).length,
        evictions: evictionList.filter(Boolean).length,
        bankruptcies: bankruptcyList.filter(Boolean).length,
        liens: lienList.filter(Boolean).length,
        judgments: judgmentList.filter(Boolean).length,
        weapon_permits: weaponList.filter(Boolean).length,
        watchlist_hits: watchlistList.filter(Boolean).length,
        raw_sections: {
          criminal_records: crimList.filter(Boolean),
          evictions: evictionList.filter(Boolean),
          bankruptcies: bankruptcyList.filter(Boolean),
          liens: lienList.filter(Boolean),
          judgments: judgmentList.filter(Boolean),
          weapon_permits: weaponList.filter(Boolean),
          watchlist: watchlistList.filter(Boolean),
        },
      },
    });
  } catch (error: any) {
    console.error('SearchBug background report error:', error);
    res.status(500).json({ error: 'Background report failed' });
  }
});

// ============================================================
// Property Search  (TYPE = api_prop)
// ============================================================

router.post('/property-search', async (req: Request, res: Response) => {
  try {
    const { address, city, state, zip } = req.body;

    if (!address || !city || !state) {
      return res.status(400).json({ error: 'Address, city, and state are required' });
    }

    const result = await callSearchBug({
      TYPE: 'api_prop',
      ADDRESS: address.trim(),
      CITY: city.trim(),
      STATE: state.trim(),
      ZIP: zip?.trim() || '',
      REF: `rmpg-flex-${(req as any).user?.id || 0}`,
    });

    if (!result.ok) {
      return res.status(502).json({ error: result.error });
    }

    if (result.data?.found === false) {
      return res.json({ found: false, property: null });
    }

    logSearch(req, 'property_search', { address, city, state });

    // Normalize property results
    const prop = result.data?.result?.property || result.data?.property || result.data?.result || {};

    res.json({
      found: true,
      property: {
        owner_name: prop?.ownerName || prop?.owner?.name || '',
        owner_name_2: prop?.ownerName2 || '',
        mailing_address: {
          line1: prop?.mailingAddress?.line1 || '',
          city: prop?.mailingAddress?.city || '',
          state: prop?.mailingAddress?.state || '',
          zip: prop?.mailingAddress?.zip || '',
        },
        property_address: {
          line1: prop?.propertyAddress?.line1 || address,
          city: prop?.propertyAddress?.city || city,
          state: prop?.propertyAddress?.state || state,
          zip: prop?.propertyAddress?.zip || zip || '',
        },
        property_type: prop?.propertyType || prop?.landUseDescription || '',
        bedrooms: prop?.bedrooms || '',
        bathrooms: prop?.bathrooms || '',
        sqft: prop?.buildingArea || prop?.sqft || '',
        lot_size: prop?.lotSize || '',
        year_built: prop?.yearBuilt || '',
        assessed_value: prop?.assessedValue || prop?.totalAssessedValue || '',
        market_value: prop?.marketValue || prop?.totalMarketValue || '',
        last_sale_date: prop?.lastSaleDate || '',
        last_sale_price: prop?.lastSalePrice || '',
        tax_amount: prop?.taxAmount || '',
        zoning: prop?.zoning || '',
        apn: prop?.apn || prop?.parcelNumber || '',
        legal_description: prop?.legalDescription || '',
        elevation: prop?.elevation || '',
        usps_classification: prop?.uspsClassification || '',
      },
    });
  } catch (error: any) {
    console.error('SearchBug property search error:', error);
    res.status(500).json({ error: 'Property search failed' });
  }
});

export default router;
