// ============================================================
// Unified Records Search Routes (NHTSA + FMCSA + Criminal + OpenCorporates)
// ============================================================
// Free federal APIs — no credentials needed for NHTSA.
// FMCSA requires a free Login.gov webkey.
// Criminal Checks requires paid API key.
// OpenCorporates requires API token (free tier: 200 req/mo).
// Self-initializing audit table for all queries.

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow } from '../utils/timeUtils';
import { decodeVin, getRecalls, getComplaints, getFullVinReport } from '../utils/nhtsaClient';
import {
  lookupCarrier, searchCarrierByName, testConnection as testFmcsa,
  isConfigured as isFmcsaConfigured, encryptCredential, getWebKey,
} from '../utils/fmcsaClient';
import {
  searchCriminalRecords, testConnection as testCriminal,
  isConfigured as isCriminalConfigured, getApiKey as getCriminalKey,
  encryptCredential as encryptCriminalKey,
} from '../utils/criminalChecksClient';
import {
  searchCompanies, searchOfficers, testConnection as testOC,
  isConfigured as isOCConfigured, getApiToken as getOCToken,
  encryptCredential as encryptOCKey,
} from '../utils/openCorporatesClient';
import {
  searchPerson, reversePhone, searchAddress,
  testConnection as testEnformion, isConfigured as isEnformionConfigured,
  encryptCredential as encryptEnformionKey,
} from '../utils/enformionClient';
import {
  testUgrcConnection, isUgrcConfigured, getStoredUgrcKey,
  encryptUgrcKey, ugrcSearchBusinesses, ugrcSearchAddresses, ugrcSearchParcels,
} from '../utils/geocode';
import {
  linkEnformionResults, linkNhtsaResults, linkCriminalResults, linkVehicle,
  linkUgrcBusinessResults, linkUgrcAddressResults, linkUgrcParcelResults,
  deduplicateProperties,
} from '../utils/recordLinkage';

const router = Router();
router.use(authenticateToken);

// ── Self-initializing table ──────────────────────────────────

function initTables(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS nhtsa_queries (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      source        TEXT NOT NULL,
      query_type    TEXT NOT NULL,
      query_input   TEXT NOT NULL,
      queried_by    INTEGER NOT NULL,
      response_json TEXT,
      hit           INTEGER DEFAULT 0,
      error_msg     TEXT,
      queried_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (queried_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_nhtsa_q_source ON nhtsa_queries(source);
    CREATE INDEX IF NOT EXISTS idx_nhtsa_q_type   ON nhtsa_queries(query_type);
    CREATE INDEX IF NOT EXISTS idx_nhtsa_q_user   ON nhtsa_queries(queried_by);
  `);
}

try { initTables(); } catch { /* tables may already exist */ }

// ── Audit helper ─────────────────────────────────────────────

function logQuery(source: string, type: string, input: string, userId: number, hit: boolean, responseJson?: string, errorMsg?: string) {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO nhtsa_queries (source, query_type, query_input, queried_by, hit, response_json, error_msg, queried_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(source, type, input, userId, hit ? 1 : 0, responseJson || null, errorMsg || null, localNow());

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, details, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, `${source.toUpperCase()} ${type} query`, 'mvr_query', JSON.stringify({ source, type, input }), '', localNow());
  } catch { /* non-fatal */ }
}

// ============================================================
//  NHTSA — VIN DECODE (free, no credentials)
// ============================================================

router.get('/nhtsa/vin/:vin', async (req: Request, res: Response) => {
  try {
    initTables();
    const { vin } = req.params;
    const userId = (req as any).user?.id || 0;

    if (!vin || vin.length < 11) {
      return res.status(400).json({ error: 'VIN must be at least 11 characters (full 17 recommended)' });
    }

    const result = await decodeVin(vin.toUpperCase());
    logQuery('nhtsa', 'vin_decode', vin.toUpperCase(), userId, result.success, JSON.stringify(result.data));

    // Auto-link VIN data to vehicles_records
    if (result.success && result.data) {
      try { linkNhtsaResults(result.data, vin.toUpperCase()); } catch { /* non-fatal */ }
    }

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  NHTSA — FULL VIN REPORT (decode + recalls + complaints)
// ============================================================

router.get('/nhtsa/report/:vin', async (req: Request, res: Response) => {
  try {
    initTables();
    const { vin } = req.params;
    const userId = (req as any).user?.id || 0;

    if (!vin || vin.length < 11) {
      return res.status(400).json({ error: 'VIN must be at least 11 characters' });
    }

    const result = await getFullVinReport(vin.toUpperCase());
    logQuery('nhtsa', 'full_report', vin.toUpperCase(), userId, result.success,
      result.success ? JSON.stringify({ recallCount: result.data.recallCount, complaintCount: result.data.complaintCount }) : undefined,
      result.error);

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  NHTSA — RECALLS ONLY (by make/model/year)
// ============================================================

router.get('/nhtsa/recalls', async (req: Request, res: Response) => {
  try {
    initTables();
    const { make, model, year } = req.query;
    const userId = (req as any).user?.id || 0;

    if (!make || !model || !year) {
      return res.status(400).json({ error: 'Required: make, model, year query parameters' });
    }

    const result = await getRecalls(make as string, model as string, year as string);
    logQuery('nhtsa', 'recalls', `${make} ${model} ${year}`, userId, result.success && result.count > 0);

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  NHTSA — COMPLAINTS ONLY (by make/model/year)
// ============================================================

router.get('/nhtsa/complaints', async (req: Request, res: Response) => {
  try {
    initTables();
    const { make, model, year } = req.query;
    const userId = (req as any).user?.id || 0;

    if (!make || !model || !year) {
      return res.status(400).json({ error: 'Required: make, model, year query parameters' });
    }

    const result = await getComplaints(make as string, model as string, year as string);
    logQuery('nhtsa', 'complaints', `${make} ${model} ${year}`, userId, result.success && result.count > 0);

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  FMCSA — CARRIER LOOKUP BY DOT NUMBER
// ============================================================

router.get('/fmcsa/carrier/:dotNumber', async (req: Request, res: Response) => {
  try {
    initTables();
    const { dotNumber } = req.params;
    const userId = (req as any).user?.id || 0;

    const result = await lookupCarrier(dotNumber);
    logQuery('fmcsa', 'carrier_dot', dotNumber, userId, result.success, JSON.stringify(result.data), result.error);

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  FMCSA — CARRIER SEARCH BY NAME
// ============================================================

router.get('/fmcsa/carrier/search/:name', async (req: Request, res: Response) => {
  try {
    initTables();
    const { name } = req.params;
    const userId = (req as any).user?.id || 0;

    const result = await searchCarrierByName(name);
    logQuery('fmcsa', 'carrier_name', name, userId, result.success && result.data.length > 0, undefined, result.error);

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  FMCSA — CREDENTIALS MANAGEMENT (admin only)
// ============================================================

router.put('/fmcsa/credentials', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { webkey } = req.body;
    if (!webkey) return res.status(400).json({ error: 'webkey is required' });

    const db = getDb();
    const encrypted = encryptCredential(webkey);

    db.prepare(`INSERT OR REPLACE INTO system_config (config_key, config_value, category)
      VALUES ('fmcsa_webkey', ?, 'integration')`).run(encrypted);

    return res.json({ success: true, message: 'FMCSA webkey saved' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/fmcsa/credentials', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare(`DELETE FROM system_config WHERE config_key = 'fmcsa_webkey'`).run();
    return res.json({ success: true, message: 'FMCSA webkey removed' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/fmcsa/test-connection', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const result = await testFmcsa();
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
//  CRIMINAL CHECKS — SEARCH BY NAME
// ============================================================

router.get('/criminal/search/:name', async (req: Request, res: Response) => {
  try {
    initTables();
    const { name } = req.params;
    const feeds = req.query.feeds ? String(req.query.feeds).split(',') as any : undefined;
    const userId = (req as any).user?.id || 0;

    const result = await searchCriminalRecords(name, feeds);
    logQuery('criminal', 'name_search', name, userId, result.success && result.totalRecords > 0,
      result.success ? JSON.stringify({ totalRecords: result.totalRecords, feedsSearched: result.feedsSearched }) : undefined,
      result.error);

    // Auto-link criminal records to persons
    if (result.success && result.records?.length > 0) {
      try { linkCriminalResults(result.records); } catch { /* non-fatal */ }
    }

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  CRIMINAL CHECKS — CREDENTIALS MANAGEMENT (admin only)
// ============================================================

router.put('/criminal/credentials', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey) return res.status(400).json({ error: 'apiKey is required' });

    const db = getDb();
    const encrypted = encryptCriminalKey(apiKey);

    db.prepare(`INSERT OR REPLACE INTO system_config (config_key, config_value, category)
      VALUES ('criminal_checks_api_key', ?, 'integration')`).run(encrypted);

    return res.json({ success: true, message: 'Criminal Checks API key saved' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/criminal/credentials', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare(`DELETE FROM system_config WHERE config_key = 'criminal_checks_api_key'`).run();
    return res.json({ success: true, message: 'Criminal Checks API key removed' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/criminal/test-connection', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const result = await testCriminal();
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
//  OPENCORPORATES — COMPANY SEARCH
// ============================================================

router.get('/opencorporates/companies/:query', async (req: Request, res: Response) => {
  try {
    initTables();
    const { query } = req.params;
    const jurisdiction = req.query.jurisdiction as string | undefined;
    const page = parseInt(req.query.page as string) || 1;
    const userId = (req as any).user?.id || 0;

    const result = await searchCompanies(query, jurisdiction, page);
    logQuery('opencorporates', 'company_search', query, userId, result.success && result.totalCount > 0,
      result.success ? JSON.stringify({ totalCount: result.totalCount, companiesReturned: result.companies.length }) : undefined,
      result.error);

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  OPENCORPORATES — OFFICER SEARCH
// ============================================================

router.get('/opencorporates/officers/:query', async (req: Request, res: Response) => {
  try {
    initTables();
    const { query } = req.params;
    const jurisdiction = req.query.jurisdiction as string | undefined;
    const page = parseInt(req.query.page as string) || 1;
    const userId = (req as any).user?.id || 0;

    const result = await searchOfficers(query, jurisdiction, page);
    logQuery('opencorporates', 'officer_search', query, userId, result.success && result.totalCount > 0,
      result.success ? JSON.stringify({ totalCount: result.totalCount, officersReturned: result.officers.length }) : undefined,
      result.error);

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  OPENCORPORATES — CREDENTIALS MANAGEMENT (admin only)
// ============================================================

router.put('/opencorporates/credentials', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { apiToken } = req.body;
    if (!apiToken) return res.status(400).json({ error: 'apiToken is required' });

    const db = getDb();
    const encrypted = encryptOCKey(apiToken);

    db.prepare(`INSERT OR REPLACE INTO system_config (config_key, config_value, category)
      VALUES ('opencorporates_api_token', ?, 'integration')`).run(encrypted);

    return res.json({ success: true, message: 'OpenCorporates API token saved' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/opencorporates/credentials', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare(`DELETE FROM system_config WHERE config_key = 'opencorporates_api_token'`).run();
    return res.json({ success: true, message: 'OpenCorporates API token removed' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/opencorporates/test-connection', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const result = await testOC();
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
//  ENFORMION — PERSON SEARCH
// ============================================================

router.get('/enformion/person/:query', async (req: Request, res: Response) => {
  try {
    initTables();
    const { query } = req.params;
    const userId = (req as any).user?.id || 0;

    const result = await searchPerson(query);
    logQuery('enformion', 'person_search', query, userId, result.success && result.totalCount > 0,
      result.success ? JSON.stringify({ totalCount: result.totalCount, personsReturned: result.persons.length }) : undefined,
      result.error);

    // Auto-link results to local records (async, non-blocking)
    if (result.success && result.persons.length > 0) {
      try { linkEnformionResults(result.persons); } catch { /* non-fatal */ }
    }

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  ENFORMION — REVERSE PHONE
// ============================================================

router.get('/enformion/phone/:phone', async (req: Request, res: Response) => {
  try {
    initTables();
    const { phone } = req.params;
    const userId = (req as any).user?.id || 0;

    const result = await reversePhone(phone);
    logQuery('enformion', 'reverse_phone', phone, userId, result.success && result.totalCount > 0,
      result.success ? JSON.stringify({ totalCount: result.totalCount }) : undefined,
      result.error);

    // Auto-link results to local records
    if (result.success && result.persons.length > 0) {
      try { linkEnformionResults(result.persons); } catch { /* non-fatal */ }
    }

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  ENFORMION — ADDRESS LOOKUP
// ============================================================

router.get('/enformion/address/:query', async (req: Request, res: Response) => {
  try {
    initTables();
    const { query } = req.params;
    const userId = (req as any).user?.id || 0;

    const result = await searchAddress(query);
    logQuery('enformion', 'address_search', query, userId, result.success && result.totalCount > 0,
      result.success ? JSON.stringify({ totalCount: result.totalCount }) : undefined,
      result.error);

    // Auto-link address results
    if (result.success && result.persons?.length > 0) {
      try { linkEnformionResults(result.persons); } catch { /* non-fatal */ }
    }

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  ENFORMION — CREDENTIALS MANAGEMENT (admin only)
// ============================================================

router.put('/enformion/credentials', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { apiKey, apName, apPassword } = req.body;
    if (!apiKey || !apName || !apPassword) {
      return res.status(400).json({ error: 'apiKey, apName, and apPassword are all required' });
    }

    const db = getDb();
    const stmt = db.prepare(`INSERT OR REPLACE INTO system_config (config_key, config_value, category) VALUES (?, ?, 'integration')`);
    stmt.run('enformion_api_key', encryptEnformionKey(apiKey));
    stmt.run('enformion_ap_name', encryptEnformionKey(apName));
    stmt.run('enformion_ap_password', encryptEnformionKey(apPassword));

    return res.json({ success: true, message: 'Enformion credentials saved (3 keys)' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/enformion/credentials', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare(`DELETE FROM system_config WHERE config_key IN ('enformion_api_key', 'enformion_ap_name', 'enformion_ap_password')`).run();
    return res.json({ success: true, message: 'Enformion credentials removed' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/enformion/test-connection', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const result = await testEnformion();
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
//  UGRC — Utah Geospatial Resource Center (Geocoding)
// ============================================================

router.put('/ugrc/credentials', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey) return res.status(400).json({ error: 'apiKey required' });

    const db = getDb();
    const encrypted = encryptUgrcKey(apiKey);
    db.prepare(`DELETE FROM system_config WHERE config_key = 'ugrc_api_key'`).run();
    db.prepare(`INSERT INTO system_config (config_key, config_value, category) VALUES (?, ?, 'ugrc')`)
      .run('ugrc_api_key', encrypted);

    return res.json({ success: true, message: 'UGRC API key saved' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/ugrc/credentials', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare(`DELETE FROM system_config WHERE config_key = 'ugrc_api_key'`).run();
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/ugrc/test-connection', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const result = await testUgrcConnection();
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
//  UGRC SGID — Business, Address, Parcel search
// ============================================================

router.post('/ugrc/search/business', async (req: Request, res: Response) => {
  try {
    initTables();
    const { query, city, category, limit } = req.body;
    if (!query && !city && !category) {
      return res.status(400).json({ success: false, error: 'Provide at least one of: query, city, category' });
    }

    const result = await ugrcSearchBusinesses(query || '', { city, category, limit: limit || 50 });

    // Audit log
    const db = getDb();
    const userId = (req as any).user?.userId;
    db.prepare(`INSERT INTO nhtsa_queries (source, query_type, query_input, queried_by, hit, queried_at)
      VALUES ('ugrc', 'business_search', ?, ?, ?, ?)`
    ).run(query || city || category, userId, result.results.length > 0 ? 1 : 0, localNow());

    // Auto-link business results to Properties
    if (result.success && result.results.length > 0) {
      try { linkUgrcBusinessResults(result.results); } catch { /* non-fatal */ }
    }

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/ugrc/search/address', async (req: Request, res: Response) => {
  try {
    initTables();
    const { query, city, zip, limit } = req.body;
    if (!query && !city && !zip) {
      return res.status(400).json({ success: false, error: 'Provide at least one of: query, city, zip' });
    }

    const result = await ugrcSearchAddresses(query || '', { city, zip, limit: limit || 50 });

    // Audit log
    const db = getDb();
    const userId = (req as any).user?.userId;
    db.prepare(`INSERT INTO nhtsa_queries (source, query_type, query_input, queried_by, hit, queried_at)
      VALUES ('ugrc', 'address_search', ?, ?, ?, ?)`
    ).run(query || `${city || ''} ${zip || ''}`.trim(), userId, result.results.length > 0 ? 1 : 0, localNow());

    // Auto-link address results to Properties
    if (result.success && result.results.length > 0) {
      try { linkUgrcAddressResults(result.results); } catch { /* non-fatal */ }
    }

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/ugrc/search/parcel', async (req: Request, res: Response) => {
  try {
    initTables();
    const { query, county, city, parcelId, limit } = req.body;
    if (!query && !parcelId) {
      return res.status(400).json({ success: false, error: 'Provide query (address) or parcelId' });
    }

    const result = await ugrcSearchParcels(query || '', { county, city, parcelId, limit: limit || 50 });

    // Audit log
    const db = getDb();
    const userId = (req as any).user?.userId;
    db.prepare(`INSERT INTO nhtsa_queries (source, query_type, query_input, queried_by, hit, queried_at)
      VALUES ('ugrc', 'parcel_search', ?, ?, ?, ?)`
    ).run(parcelId || query, userId, result.results.length > 0 ? 1 : 0, localNow());

    // Auto-link parcel results to Properties
    if (result.success && result.results.length > 0) {
      try { linkUgrcParcelResults(result.results); } catch { /* non-fatal */ }
    }

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
//  UGRC — Deduplicate Properties
// ============================================================

router.post('/ugrc/dedup-properties', async (_req: Request, res: Response) => {
  try {
    const result = deduplicateProperties();
    return res.json({ success: true, ...result });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
//  STATUS — All data sources
// ============================================================

router.get('/status', (req: Request, res: Response) => {
  try {
    initTables();
    const db = getDb();

    const nhtsaStats = db.prepare(`
      SELECT COUNT(*) as total, SUM(hit) as hits FROM nhtsa_queries WHERE source = 'nhtsa'
    `).get() as any;

    const fmcsaStats = db.prepare(`
      SELECT COUNT(*) as total, SUM(hit) as hits FROM nhtsa_queries WHERE source = 'fmcsa'
    `).get() as any;

    const criminalStats = db.prepare(`
      SELECT COUNT(*) as total, SUM(hit) as hits FROM nhtsa_queries WHERE source = 'criminal'
    `).get() as any;

    const ocStats = db.prepare(`
      SELECT COUNT(*) as total, SUM(hit) as hits FROM nhtsa_queries WHERE source = 'opencorporates'
    `).get() as any;

    const enformionStats = db.prepare(`
      SELECT COUNT(*) as total, SUM(hit) as hits FROM nhtsa_queries WHERE source = 'enformion'
    `).get() as any;

    const lastQuery = db.prepare(`
      SELECT queried_at FROM nhtsa_queries ORDER BY id DESC LIMIT 1
    `).get() as any;

    return res.json({
      sources: {
        nhtsa: {
          name: 'NHTSA (National Highway Traffic Safety Administration)',
          status: 'active',
          credentials_required: false,
          capabilities: ['VIN Decode', 'Safety Recalls', 'Consumer Complaints'],
          total_queries: nhtsaStats?.total || 0,
          total_hits: nhtsaStats?.hits || 0,
        },
        fmcsa: {
          name: 'FMCSA (Federal Motor Carrier Safety Administration)',
          status: isFmcsaConfigured() ? 'active' : 'not_configured',
          credentials_required: true,
          credentials_configured: isFmcsaConfigured(),
          capabilities: ['Carrier Lookup by DOT#', 'Carrier Search by Name', 'Safety Rating', 'Authority Status'],
          total_queries: fmcsaStats?.total || 0,
          total_hits: fmcsaStats?.hits || 0,
        },
        criminal: {
          name: 'Complete Criminal Checks',
          status: isCriminalConfigured() ? 'active' : 'not_configured',
          credentials_required: true,
          credentials_configured: isCriminalConfigured(),
          capabilities: ['Sex Offender Registry', 'DOC Inmate Records', 'Arrest Warrants', 'Court Records'],
          total_queries: criminalStats?.total || 0,
          total_hits: criminalStats?.hits || 0,
        },
        opencorporates: {
          name: 'OpenCorporates (Global Business Registry)',
          status: isOCConfigured() ? 'active' : 'not_configured',
          credentials_required: true,
          credentials_configured: isOCConfigured(),
          capabilities: ['Company Search', 'Officer/Director Search', 'Jurisdiction Filtering', 'Corporate Status'],
          total_queries: ocStats?.total || 0,
          total_hits: ocStats?.hits || 0,
        },
        enformion: {
          name: 'Enformion (People & Public Records)',
          status: isEnformionConfigured() ? 'active' : 'not_configured',
          credentials_required: true,
          credentials_configured: isEnformionConfigured(),
          capabilities: ['Person Search', 'Reverse Phone Lookup', 'Address Search', 'Public Records'],
          total_queries: enformionStats?.total || 0,
          total_hits: enformionStats?.hits || 0,
        },
        ugrc: {
          name: 'UGRC (Utah Geospatial Resource Center)',
          status: isUgrcConfigured() ? 'active' : 'not_configured',
          credentials_required: true,
          credentials_configured: isUgrcConfigured(),
          capabilities: ['Address Geocoding', 'Reverse Geocoding', 'Utah SGID Data'],
        },
      },
      total_queries: (nhtsaStats?.total || 0) + (fmcsaStats?.total || 0) + (criminalStats?.total || 0) + (ocStats?.total || 0) + (enformionStats?.total || 0),
      last_query_at: lastQuery?.queried_at || null,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  AUDIT LOG
// ============================================================

router.get('/audit-log', requireRole('admin'), (req: Request, res: Response) => {
  try {
    initTables();
    const db = getDb();
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 25, 100);
    const offset = (page - 1) * limit;

    const total = (db.prepare(`SELECT COUNT(*) as cnt FROM nhtsa_queries`).get() as any).cnt;
    const rows = db.prepare(`
      SELECT nq.*, u.full_name as queried_by_name
      FROM nhtsa_queries nq
      LEFT JOIN users u ON u.id = nq.queried_by
      ORDER BY nq.id DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    return res.json({ rows, total, page, pages: Math.ceil(total / limit) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
