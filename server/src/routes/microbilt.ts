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
  const parts = stored.split(':');
  if (parts.length < 3) throw new Error('Malformed encrypted value');
  const [ivHex, authTagHex, ciphertext] = parts;
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
    console.error('MicroBilt connection test error:', error.message);
    res.json({
      success: false,
      error: 'Connection test failed',
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
// OFAC / SDN Watchlist Search (local sanctions database)
// ============================================================
// Searches the locally-synced U.S. Treasury sanctions list.
// Data is synced daily by ofacScraper.ts from treasury.gov.

router.post('/ofac/search', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { fullName, firstName, lastName } = req.body;

    let searchName = '';
    if (fullName) {
      searchName = fullName.trim();
    } else if (lastName) {
      searchName = firstName ? `${lastName}, ${firstName}`.trim() : lastName.trim();
    }

    if (!searchName || searchName.length < 2) {
      res.status(400).json({ error: 'Name required (min 2 chars)' });
      return;
    }

    const searchTerm = `%${searchName}%`;

    // Search SDN entries by name
    const entries = db.prepare(`
      SELECT e.*,
        GROUP_CONCAT(DISTINCT a.alias_name) as alias_list,
        GROUP_CONCAT(DISTINCT addr.address || ', ' || COALESCE(addr.city,'') || ' ' || COALESCE(addr.country,'')) as address_list
      FROM ofac_sdn_entries e
      LEFT JOIN ofac_sdn_aliases a ON e.ent_num = a.ent_num
      LEFT JOIN ofac_sdn_addresses addr ON e.ent_num = addr.ent_num
      WHERE e.sdn_name LIKE ? OR a.alias_name LIKE ?
      GROUP BY e.id
      ORDER BY e.sdn_name
      LIMIT 10
    `).all(searchTerm, searchTerm) as any[];

    // Map to NcicOfacSubject format expected by client
    const subjects = entries.map(e => ({
      name: e.sdn_name,
      type: e.sdn_type || 'Individual',
      program: e.program,
      source_list: e.source_list || 'SDN',
      title: e.title,
      remarks: e.remarks,
      match_source: 'LOCAL_OFAC_DB',
      aliases: e.alias_list
        ? e.alias_list.split(',').map((a: string) => ({ name: a.trim(), type: 'AKA' }))
        : [],
      addresses: e.address_list
        ? e.address_list.split(',').map((a: string) => {
            const parts = a.trim().split(', ');
            return {
              address: parts.length > 0 ? parts[0] : '',
              city: parts.length > 1 ? parts[1] : '',
              country: parts.length > 2 ? parts[2] : '',
            };
          })
        : [],
    }));

    res.json({
      hit: subjects.length > 0,
      sources: ['US_TREASURY_SDN'],
      subjects,
      resultCount: subjects.length,
    });
  } catch (error: any) {
    console.error('OFAC search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
