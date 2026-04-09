// ============================================================
// Skip Tracker — RapidAPI Skip Tracing Integration
// ============================================================
// Proxy routes for the Skip Tracing Working API on RapidAPI.
// Credentials are stored AES-256-GCM encrypted in system_config,
// following the same pattern as microbilt.ts and servemanager.ts.
//
// Endpoints proxied:
//   /search/byname          — name + page
//   /search/byaddress       — address + page
//   /search/bynameaddress — name + address + page
//   /search/byphone         — phone + page
//   /search/byemail         — email + page
//   /personDetailsByID      — id
//
// All search results are persisted locally for audit trail.
// API docs: https://rapidapi.com/oneapiproject/api/skip-tracing-working-api

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { validateParamId, validateParamIdMiddleware } from '../middleware/sanitize';
import { localNow } from '../utils/timeUtils';
import { auditLog } from '../utils/auditLogger';
import { broadcastAdminUpdate } from '../utils/websocket';
import { ipKeyGenerator, rateLimit } from '../middleware/rateLimiter';
import config from '../config';

const router = Router();
router.use(authenticateToken);

// Rate limit all skip tracer searches: 20 searches per 5-minute window per user
const skipSearchRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 20,
  keyGenerator: (req) =>
    req.user?.userId
      ? `skiptracer:user:${req.user.userId}`
      : `skiptracer:ip:${ipKeyGenerator(req.ip || req.socket.remoteAddress || '')}`,
  message: { error: 'Skip tracer search rate limit exceeded. Please wait before searching again.' },
  // Disable IPv6 key-gen validation: this route is behind authenticateToken, so
  // req.user.userId is always present and req.ip is never actually used as the key.
  validate: { keyGeneratorIpFallback: false },
});

// ============================================================
// Encryption helpers (same pattern as microbilt.ts)
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
  apiKey: 'skiptracer_api_key',
  environment: 'skiptracer_environment',
  enabled: 'skiptracer_enabled',
} as const;

const RAPIDAPI_HOST = 'skip-tracing-working-api.p.rapidapi.com';
const RAPIDAPI_BASE = `https://${RAPIDAPI_HOST}`;

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

function getApiKey(): string | null {
  return getDecryptedValue(CONFIG_KEYS.apiKey);
}

// ============================================================
// Ensure skip_tracer_searches table exists
// ============================================================

function ensureTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS skip_tracer_searches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      search_type TEXT NOT NULL,
      query_params TEXT NOT NULL,
      result_count INTEGER DEFAULT 0,
      results_json TEXT,
      searched_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    )
  `);
}

// ============================================================
// RapidAPI proxy helper
// ============================================================

async function rapidApiFetch(path: string, params: Record<string, string>): Promise<any> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Skip Tracker API key not configured');

  const qs = new URLSearchParams(params).toString();
  const url = `${RAPIDAPI_BASE}${path}${qs ? '?' + qs : ''}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'x-rapidapi-key': apiKey,
      'x-rapidapi-host': RAPIDAPI_HOST,
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Skip Tracker API error (${res.status}): ${text.slice(0, 500)}`);
  }

  return res.json();
}

// ============================================================
// Persist search to audit trail
// ============================================================

function persistSearch(searchType: string, queryParams: Record<string, string>, results: any, userId: number): void {
  try {
    ensureTable();
    const db = getDb();
    const resultCount = results?.Records ||
      (Array.isArray(results?.PeopleDetails) ? results.PeopleDetails.length : 0);

    db.prepare(
      'INSERT INTO skip_tracer_searches (search_type, query_params, result_count, results_json, searched_by, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      searchType,
      JSON.stringify(queryParams),
      resultCount,
      JSON.stringify(results),
      userId,
      localNow(),
    );
  } catch (err) {
    console.error('[Skip Tracker] Failed to persist search:', err);
  }
}

// ============================================================
// Routes
// ============================================================

// ── Status ──────────────────────────────────────────────────
router.get('/status', (_req: Request, res: Response) => {
  try {
    const apiKey = getApiKey();
    const enabled = getConfigValue(CONFIG_KEYS.enabled);
    res.json({
      configured: !!apiKey,
      enabled: enabled === '1',
      host: RAPIDAPI_HOST,
    });
  } catch {
    res.json({ configured: false, enabled: false, host: RAPIDAPI_HOST });
  }
});

// ── Save config (admin only) ────────────────────────────────
router.put('/config', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { apiKey, enabled } = req.body;

    if (apiKey !== undefined) {
      if (apiKey === '') {
        deleteConfigValue(CONFIG_KEYS.apiKey);
      } else {
        setConfigValue(CONFIG_KEYS.apiKey, apiKey, true);
      }
    }

    if (enabled !== undefined) {
      setConfigValue(CONFIG_KEYS.enabled, enabled ? '1' : '0');
    }

    // Always production for RapidAPI
    setConfigValue(CONFIG_KEYS.environment, 'production');

    auditLog(req, 'skiptracer_config_updated', 'integration', 0, 'Skip Tracker configuration updated');
    broadcastAdminUpdate({ type: 'skiptracer_config_updated' });

    res.json({ success: true });
  } catch (err: any) {
    console.error('Skip Tracker error:', err.message);
    res.status(500).json({ error: 'Skip Tracker operation failed', code: 'SKIP_TRACER_ERROR' });
  }
});

// ── Delete config (admin only) ──────────────────────────────
router.delete('/config', requireRole('admin'), (req: Request, res: Response) => {
  try {
    Object.values(CONFIG_KEYS).forEach(deleteConfigValue);

    auditLog(req, 'skiptracer_config_cleared', 'integration', 0, 'Skip Tracker configuration cleared');
    broadcastAdminUpdate({ type: 'skiptracer_config_cleared' });

    res.json({ success: true });
  } catch (err: any) {
    console.error('Skip Tracker error:', err.message);
    res.status(500).json({ error: 'Skip Tracker operation failed', code: 'SKIP_TRACER_ERROR' });
  }
});

// ── Test connection ─────────────────────────────────────────
router.post('/test', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const apiKey = getApiKey();
    if (!apiKey) {
      return res.status(400).json({ success: false, error: 'API key not configured' });
    }

    // Quick test: search by name with a known test query
    const testRes = await fetch(`${RAPIDAPI_BASE}/search/byname?name=John+Smith&page=1`, {
      method: 'GET',
      headers: {
        'x-rapidapi-key': apiKey,
        'x-rapidapi-host': RAPIDAPI_HOST,
      },
      signal: AbortSignal.timeout(15000),
    });

    if (testRes.ok) {
      const data = await testRes.json();
      const count = data?.Records || (Array.isArray(data?.PeopleDetails) ? data.PeopleDetails.length : 0);
      res.json({
        success: true,
        message: `Connected successfully. Test query returned ${count} results.`,
        statusCode: testRes.status,
      });
    } else {
      const text = await testRes.text().catch(() => '');
      res.status(502).json({
        success: false,
        error: `API returned ${testRes.status}: ${text.slice(0, 200)}`,
      });
    }
  } catch (err: any) {
    console.error('[Skip Tracker] Connection test error:', err?.message || err);
    res.status(502).json({ success: false, error: 'Failed to connect to Skip Tracker API' });
  }
});

// ── Search by Name ──────────────────────────────────────────
router.get('/search/byname', skipSearchRateLimit, async (req: Request, res: Response) => {
  try {
    const { name, page } = req.query;
    if (!name) return res.status(400).json({ error: 'name parameter required', code: 'NAME_PARAMETER_REQUIRED' });
    if (String(name).length > 200) return res.status(400).json({ error: 'name too long (max 200 chars)', code: 'NAME_TOO_LONG_MAX' });

    const params: Record<string, string> = { name: String(name) };
    if (page) {
      const p = parseInt(String(page), 10);
      if (isNaN(p) || p < 1 || p > 1000) return res.status(400).json({ error: 'page must be between 1 and 1000', code: 'PAGE_MUST_BE_BETWEEN' });
      params.page = String(p);
    }

    const data = await rapidApiFetch('/search/byname', params);
    persistSearch('byname', params, data, req.user!.userId);
    auditLog(req, 'skiptracer_search', 'skiptracer', 0, `Skip trace by name: ${name}`);
    res.json(data);
  } catch (err: any) {
    console.error('Skip Tracker error:', err.message);
    res.status(500).json({ error: 'Skip Tracker operation failed', code: 'SKIP_TRACER_ERROR' });
  }
});

// ── Search by Address ───────────────────────────────────────
router.get('/search/byaddress', skipSearchRateLimit, async (req: Request, res: Response) => {
  try {
    const { address, page } = req.query;
    if (!address) return res.status(400).json({ error: 'address parameter required', code: 'ADDRESS_PARAMETER_REQUIRED' });
    if (String(address).length > 500) return res.status(400).json({ error: 'address too long (max 500 chars)', code: 'ADDRESS_TOO_LONG_MAX' });

    const params: Record<string, string> = { address: String(address) };
    if (page) {
      const p = parseInt(String(page), 10);
      if (isNaN(p) || p < 1 || p > 1000) return res.status(400).json({ error: 'page must be between 1 and 1000', code: 'PAGE_MUST_BE_BETWEEN' });
      params.page = String(p);
    }

    const data = await rapidApiFetch('/search/byaddress', params);
    persistSearch('byaddress', params, data, req.user!.userId);
    auditLog(req, 'skiptracer_search', 'skiptracer', 0, `Skip trace by address: ${address}`);
    res.json(data);
  } catch (err: any) {
    console.error('Skip Tracker error:', err.message);
    res.status(500).json({ error: 'Skip Tracker operation failed', code: 'SKIP_TRACER_ERROR' });
  }
});

// ── Search by Name and Address ──────────────────────────────
router.get('/search/bynameaddress', skipSearchRateLimit, async (req: Request, res: Response) => {
  try {
    const { name, address, page } = req.query;
    if (!name || !address) return res.status(400).json({ error: 'name and address parameters required', code: 'NAME_AND_ADDRESS_PARAMETERS' });
    if (String(name).length > 200) return res.status(400).json({ error: 'name too long (max 200 chars)', code: 'NAME_TOO_LONG_MAX' });
    if (String(address).length > 500) return res.status(400).json({ error: 'address too long (max 500 chars)', code: 'ADDRESS_TOO_LONG_MAX' });

    const params: Record<string, string> = { name: String(name), address: String(address) };
    if (page) {
      const p = parseInt(String(page), 10);
      if (isNaN(p) || p < 1 || p > 1000) return res.status(400).json({ error: 'page must be between 1 and 1000', code: 'PAGE_MUST_BE_BETWEEN' });
      params.page = String(p);
    }

    const data = await rapidApiFetch('/search/bynameaddress', params);
    persistSearch('bynameaddress', params, data, req.user!.userId);
    auditLog(req, 'skiptracer_search', 'skiptracer', 0, `Skip trace by name+address: ${name}`);
    res.json(data);
  } catch (err: any) {
    console.error('Skip Tracker error:', err.message);
    res.status(500).json({ error: 'Skip Tracker operation failed', code: 'SKIP_TRACER_ERROR' });
  }
});

// ── Search by Phone ─────────────────────────────────────────
router.get('/search/byphone', skipSearchRateLimit, async (req: Request, res: Response) => {
  try {
    const { phone, page } = req.query;
    if (!phone) return res.status(400).json({ error: 'phone parameter required', code: 'PHONE_PARAMETER_REQUIRED' });
    // Validate phone format (digits, spaces, dashes, parens, plus)
    const phoneStr = String(phone);
    if (phoneStr.length > 30 || !/^[0-9()\-+\s.]+$/.test(phoneStr)) {
      return res.status(400).json({ error: 'Invalid phone format', code: 'INVALID_PHONE_FORMAT' });
    }

    const params: Record<string, string> = { phone: phoneStr };
    if (page) {
      const p = parseInt(String(page), 10);
      if (isNaN(p) || p < 1 || p > 1000) return res.status(400).json({ error: 'page must be between 1 and 1000', code: 'PAGE_MUST_BE_BETWEEN' });
      params.page = String(p);
    }

    const data = await rapidApiFetch('/search/byphone', params);
    persistSearch('byphone', params, data, req.user!.userId);
    auditLog(req, 'skiptracer_search', 'skiptracer', 0, `Skip trace by phone: ${phone}`);
    res.json(data);
  } catch (err: any) {
    console.error('Skip Tracker error:', err.message);
    res.status(500).json({ error: 'Skip Tracker operation failed', code: 'SKIP_TRACER_ERROR' });
  }
});

// ── Search by Email ─────────────────────────────────────────
router.get('/search/byemail', skipSearchRateLimit, async (req: Request, res: Response) => {
  try {
    const { email, page } = req.query;
    if (!email) return res.status(400).json({ error: 'email parameter required', code: 'EMAIL_PARAMETER_REQUIRED' });
    // Basic email format validation
    const emailStr = String(email);
    if (emailStr.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailStr)) {
      return res.status(400).json({ error: 'Invalid email format', code: 'INVALID_EMAIL_FORMAT' });
    }

    const params: Record<string, string> = { email: emailStr };
    if (page) {
      const p = parseInt(String(page), 10);
      if (isNaN(p) || p < 1 || p > 1000) return res.status(400).json({ error: 'page must be between 1 and 1000', code: 'PAGE_MUST_BE_BETWEEN' });
      params.page = String(p);
    }

    const data = await rapidApiFetch('/search/byemail', params);
    persistSearch('byemail', params, data, req.user!.userId);
    auditLog(req, 'skiptracer_search', 'skiptracer', 0, `Skip trace by email: ${email}`);
    res.json(data);
  } catch (err: any) {
    console.error('Skip Tracker error:', err.message);
    res.status(500).json({ error: 'Skip Tracker operation failed', code: 'SKIP_TRACER_ERROR' });
  }
});

// ── Person Details by ID (email, phone) ─────────────────────
router.get('/person/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!id || !id.trim()) return res.status(400).json({ error: 'id parameter required', code: 'ID_PARAMETER_REQUIRED' });

    const data = await rapidApiFetch('/search/detailsbyID', { id });
    persistSearch('personDetailsByID', { id }, data, req.user!.userId);
    res.json(data);
  } catch (err: any) {
    console.error('Skip Tracker error:', err.message);
    res.status(500).json({ error: 'Skip Tracker operation failed', code: 'SKIP_TRACER_ERROR' });
  }
});

// ── Search History ──────────────────────────────────────────
router.get('/history', async (req: Request, res: Response) => {
  try {
    ensureTable();
    const db = getDb();
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 50), 200);
    const rawOffset = Number(req.query.offset) || 0;
    const offset = Math.max(0, Math.min(rawOffset, 100000));

    const rows = db.prepare(`
      SELECT s.*, u.full_name AS searched_by_name
      FROM skip_tracer_searches s
      LEFT JOIN users u ON s.searched_by = u.id
      ORDER BY s.created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    const total = (db.prepare('SELECT COUNT(*) as cnt FROM skip_tracer_searches').get() as any)?.cnt || 0;

    res.json({ searches: rows, total, limit, offset });
  } catch (err: any) {
    console.error('Skip Tracker error:', err.message);
    res.status(500).json({ error: 'Skip Tracker operation failed', code: 'SKIP_TRACER_ERROR' });
  }
});

// ── Search Stats ────────────────────────────────────────────
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    ensureTable();
    const db = getDb();
    const stats = db.prepare(`
      SELECT
        COUNT(*) AS total_searches,
        SUM(result_count) AS total_results,
        COUNT(DISTINCT searched_by) AS unique_users,
        MAX(created_at) AS last_search
      FROM skip_tracer_searches
    `).get() as any;

    const byType = db.prepare(`
      SELECT search_type, COUNT(*) AS count
      FROM skip_tracer_searches
      GROUP BY search_type
      ORDER BY count DESC
    `).all();

    res.set('Cache-Control', 'private, max-age=60');
    res.json({ ...stats, byType });
  } catch (err: any) {
    console.error('Skip Tracker error:', err.message);
    res.status(500).json({ error: 'Skip Tracker operation failed', code: 'SKIP_TRACER_ERROR' });
  }
});

// ── Skip Tracker CSV Export ────────────────────────────────────────────────────
router.get('/export/csv', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT s.search_type, s.query_params, s.result_count,
             u.full_name as searched_by_name, s.created_at
      FROM skip_tracer_searches s
      LEFT JOIN users u ON s.searched_by = u.id
      ORDER BY s.created_at DESC
      LIMIT 10000
    `).all() as any[];
    const headers = ['Search Type', 'Query', 'Result Count', 'Searched By', 'Date'];
    const csv = [
      headers.join(','),
      ...rows.map((r: any) => [
        r.search_type,
        (r.query_params || '').replace(/"/g, '""'),
        r.result_count,
        (r.searched_by_name || '').replace(/"/g, '""'),
        r.created_at
      ].map(v => `"${v || ''}"`).join(','))
    ].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="skip_traces_export_${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (error: any) {
    console.error('Skip tracer CSV export error:', error);
    res.status(500).json({ error: 'Failed to export skip traces', code: 'SKIPTRACER_EXPORT_ERROR' });
  }
});

export default router;
