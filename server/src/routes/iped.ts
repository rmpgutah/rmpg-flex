// ============================================================
// RMPG Flex — IPED Digital Forensics Integration
// ============================================================
// Proxy layer for the IPED (Digital Evidence Processor and
// Indexer) Web API.  IPED runs as a standalone REST server
// (typically port 11111) alongside its case database.
//
// This route provides:
//  • Encrypted credential storage (base URL + API key)
//  • Connection testing
//  • Case browsing — list / search IPED cases
//  • Item search — Lucene-powered queries within IPED cases
//  • Bookmark retrieval and posting
//  • Findings import — pull regex hits (crypto, emails, IPs,
//    credit cards) into forensic analysis conclusions
//  • Timeline import — merge IPED event data into the
//    forensic activity log
//  • Report import — reference IPED HTML/CSV exports as
//    forensic case report artifacts
//  • Full audit trail of every import operation
//
// Pattern follows microbilt.ts: encrypted creds in
// system_config, proxy helper, local persistence.
// ============================================================

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow } from '../utils/timeUtils';
import config from '../config';

const router = Router();
router.use(authenticateToken);

// ============================================================
// Encryption helpers  (mirrors microbilt.ts)
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

const IPED_KEYS = {
  baseUrl:  'iped_base_url',
  apiKey:   'iped_api_key',
  enabled:  'iped_enabled',
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
  db.prepare("DELETE FROM system_config WHERE config_key = ? AND category = 'integrations'").run(key);
  db.prepare(
    "INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at) VALUES (?, ?, 'integrations', 0, 1, ?, ?)"
  ).run(key, stored, now, now);
}

function deleteConfigValue(key: string): void {
  const db = getDb();
  db.prepare("DELETE FROM system_config WHERE config_key = ? AND category = 'integrations'").run(key);
}

// ============================================================
// IPED API client
// ============================================================

async function callIpedApi(path: string, method: 'GET' | 'POST' = 'GET', body?: any): Promise<any | null> {
  const baseUrl = getDecryptedValue(IPED_KEYS.baseUrl);
  const apiKey = getDecryptedValue(IPED_KEYS.apiKey);
  if (!baseUrl) return null;

  const url = `${baseUrl.replace(/\/+$/, '')}${path}`;
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };
  if (apiKey) headers['X-Api-Key'] = apiKey;

  try {
    const opts: RequestInit = { method, headers, signal: AbortSignal.timeout(30_000) };
    if (body && method === 'POST') opts.body = JSON.stringify(body);

    const res = await fetch(url, opts);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[IPED] ${method} ${path} → ${res.status}: ${text}`);
      return null;
    }
    return await res.json();
  } catch (err: any) {
    console.error(`[IPED] ${method} ${path} error:`, err.message);
    return null;
  }
}

// ============================================================
// Activity log helper  (shared with forensics.ts)
// ============================================================

function logForensicActivity(caseId: number, action: string, details: string, userId: number, userName: string, exhibitId?: number) {
  const db = getDb();
  const now = localNow();
  db.prepare(`
    INSERT INTO forensic_activity_log (forensic_case_id, exhibit_id, action, details, performed_by, performed_by_name, performed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(caseId, exhibitId || null, action, details, userId, userName, now);
}

// ============================================================
// ─── Connection Management ─────────────────────────────────
// ============================================================

// GET /api/iped/status — connection status
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const baseUrl = getDecryptedValue(IPED_KEYS.baseUrl);
    const hasApiKey = !!getConfigValue(IPED_KEYS.apiKey);
    const enabled = getConfigValue(IPED_KEYS.enabled) === 'true';

    res.json({
      configured: !!baseUrl,
      enabled,
      baseUrl: baseUrl ? baseUrl.replace(/\/\/(.+?):(.+?)@/, '//$1:***@') : null,
      hasApiKey,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/iped/credentials — save IPED server URL + optional API key
router.put('/credentials', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { baseUrl, apiKey } = req.body;
    if (!baseUrl) return res.status(400).json({ error: 'baseUrl is required', code: 'BASEURL_IS_REQUIRED' });

    setConfigValue(IPED_KEYS.baseUrl, baseUrl.trim(), true);
    if (apiKey) setConfigValue(IPED_KEYS.apiKey, apiKey.trim(), true);
    else deleteConfigValue(IPED_KEYS.apiKey);
    setConfigValue(IPED_KEYS.enabled, 'true');

    res.json({ message: 'IPED credentials saved' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/iped/credentials — remove all IPED config
router.delete('/credentials', requireRole('admin'), (_req: Request, res: Response) => {
  try {
    Object.values(IPED_KEYS).forEach(k => deleteConfigValue(k));
    res.json({ message: 'IPED credentials removed' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/iped/test-connection — verify IPED server is reachable
router.post('/test-connection', async (_req: Request, res: Response) => {
  try {
    const baseUrl = getDecryptedValue(IPED_KEYS.baseUrl);
    if (!baseUrl) return res.status(400).json({ error: 'IPED not configured', code: 'IPED_NOT_CONFIGURED' });

    const start = Date.now();
    const result = await callIpedApi('/api/v1/cases');
    const latency = Date.now() - start;

    if (result) {
      res.json({ connected: true, latency, caseCount: Array.isArray(result) ? result.length : 0 });
    } else {
      res.json({ connected: false, latency, error: 'No response from IPED server' });
    }
  } catch (err: any) {
    res.json({ connected: false, error: err.message });
  }
});

// ============================================================
// ─── IPED Case Browsing ────────────────────────────────────
// ============================================================

// GET /api/iped/cases — list all IPED cases
router.get('/cases', async (_req: Request, res: Response) => {
  try {
    const cases = await callIpedApi('/api/v1/cases');
    if (!cases) return res.status(502).json({ error: 'Unable to reach IPED server', code: 'UNABLE_TO_REACH_IPED' });
    res.json({ data: Array.isArray(cases) ? cases : [] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/iped/cases/:caseId — single IPED case info
router.get('/cases/:caseId', async (req: Request, res: Response) => {
  try {
    const result = await callIpedApi(`/api/v1/cases/${encodeURIComponent(req.params.caseId as string)}`);
    if (!result) return res.status(502).json({ error: 'Unable to reach IPED server', code: 'UNABLE_TO_REACH_IPED' });
    res.json({ data: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/iped/cases/:caseId/stats — item statistics for an IPED case
router.get('/cases/:caseId/stats', async (req: Request, res: Response) => {
  try {
    const caseId = encodeURIComponent(req.params.caseId as string);
    const result = await callIpedApi(`/api/v1/cases/${caseId}/statistics`);
    if (!result) return res.status(502).json({ error: 'Unable to reach IPED server', code: 'UNABLE_TO_REACH_IPED' });
    res.json({ data: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ─── Item Search ────────────────────────────────────────────
// ============================================================

// GET /api/iped/cases/:caseId/search — search items with Lucene query
router.get('/cases/:caseId/search', async (req: Request, res: Response) => {
  try {
    const caseId = encodeURIComponent(req.params.caseId as string);
    const q = (req.query.q as string) || '*';
    const page = parseInt((req.query.page as string) || '0', 10);
    const pageSize = Math.min(parseInt((req.query.pageSize as string) || '50', 10), 200);
    const category = req.query.category ? `&category=${encodeURIComponent(req.query.category as string)}` : '';

    const result = await callIpedApi(
      `/api/v1/cases/${caseId}/search?q=${encodeURIComponent(q)}&page=${page}&pageSize=${pageSize}${category}`
    );
    if (!result) return res.status(502).json({ error: 'Unable to reach IPED server', code: 'UNABLE_TO_REACH_IPED' });
    res.json({ data: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/iped/cases/:caseId/items/:itemId — item metadata
router.get('/cases/:caseId/items/:itemId', async (req: Request, res: Response) => {
  try {
    const caseId = encodeURIComponent(req.params.caseId as string);
    const itemId = encodeURIComponent(req.params.itemId as string);
    const result = await callIpedApi(`/api/v1/cases/${caseId}/items/${itemId}`);
    if (!result) return res.status(502).json({ error: 'Unable to reach IPED server', code: 'UNABLE_TO_REACH_IPED' });
    res.json({ data: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ─── Bookmarks ──────────────────────────────────────────────
// ============================================================

// GET /api/iped/cases/:caseId/bookmarks — list bookmarks
router.get('/cases/:caseId/bookmarks', async (req: Request, res: Response) => {
  try {
    const caseId = encodeURIComponent(req.params.caseId as string);
    const result = await callIpedApi(`/api/v1/cases/${caseId}/bookmarks`);
    if (!result) return res.status(502).json({ error: 'Unable to reach IPED server', code: 'UNABLE_TO_REACH_IPED' });
    res.json({ data: Array.isArray(result) ? result : [] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/iped/cases/:caseId/bookmarks — create bookmark in IPED
router.post('/cases/:caseId/bookmarks', async (req: Request, res: Response) => {
  try {
    const caseId = encodeURIComponent(req.params.caseId as string);
    const result = await callIpedApi(`/api/v1/cases/${caseId}/bookmarks`, 'POST', req.body);
    if (!result) return res.status(502).json({ error: 'Unable to reach IPED server', code: 'UNABLE_TO_REACH_IPED' });
    res.json({ data: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ─── Regex / PII Findings ───────────────────────────────────
// ============================================================

// GET /api/iped/cases/:caseId/findings — fetch IPED regex hits
// IPED's regex engine tags items that match patterns for
// crypto wallets, emails, IPs, credit cards, phone numbers etc.
router.get('/cases/:caseId/findings', async (req: Request, res: Response) => {
  try {
    const caseId = encodeURIComponent(req.params.caseId as string);
    const category = req.query.category || 'regex';

    // IPED stores regex matches as bookmarks or categories — search for them
    const result = await callIpedApi(
      `/api/v1/cases/${caseId}/search?q=*&category=${encodeURIComponent(category as string)}&pageSize=200`
    );
    if (!result) return res.status(502).json({ error: 'Unable to reach IPED server', code: 'UNABLE_TO_REACH_IPED' });

    // Normalize findings into structured format
    const items = Array.isArray(result?.items || result) ? (result?.items || result) : [];
    const findings = items.map((item: any) => ({
      id: item.id,
      name: item.name || item.fileName,
      path: item.path,
      category: item.category || category,
      type: item.type || item.mediaType,
      size: item.size || item.length,
      hash: item.hash || item.md5,
      content_preview: item.content?.substring(0, 500) || item.preview,
      metadata: item.metadata || {},
      bookmarked: item.bookmarked || false,
    }));

    res.json({ data: findings, total: result?.totalItems || findings.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ─── Timeline Events ────────────────────────────────────────
// ============================================================

// GET /api/iped/cases/:caseId/timeline — fetch IPED timeline events
router.get('/cases/:caseId/timeline', async (req: Request, res: Response) => {
  try {
    const caseId = encodeURIComponent(req.params.caseId as string);
    const from = req.query.from ? `&from=${encodeURIComponent(req.query.from as string)}` : '';
    const to = req.query.to ? `&to=${encodeURIComponent(req.query.to as string)}` : '';

    const result = await callIpedApi(
      `/api/v1/cases/${caseId}/timeline?pageSize=500${from}${to}`
    );
    if (!result) return res.status(502).json({ error: 'Unable to reach IPED server', code: 'UNABLE_TO_REACH_IPED' });

    const events = Array.isArray(result?.events || result) ? (result?.events || result) : [];
    res.json({ data: events, total: result?.totalEvents || events.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ─── Import Operations ─────────────────────────────────────
// ============================================================

// POST /api/iped/import/link — link an IPED case to a forensic case
router.post('/import/link', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const { forensicCaseId, ipedCaseId, ipedCaseName } = req.body;
    if (!forensicCaseId || !ipedCaseId) return res.status(400).json({ error: 'forensicCaseId and ipedCaseId required', code: 'FORENSICCASEID_AND_IPEDCASEID_REQUIRED' });

    const now = localNow();
    const stmt = db.prepare(`
      INSERT INTO iped_imports (forensic_case_id, import_type, iped_case_id, iped_case_name, summary, imported_by, imported_by_name, created_at)
      VALUES (?, 'case_link', ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(forensicCaseId, ipedCaseId, ipedCaseName || null, `Linked IPED case: ${ipedCaseName || ipedCaseId}`, user.userId, user.fullName, now);

    logForensicActivity(forensicCaseId, 'iped_case_linked', `Linked to IPED case: ${ipedCaseName || ipedCaseId}`, user.userId, user.fullName);

    res.status(201).json({ data: { id: result.lastInsertRowid } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/iped/import/findings — import regex findings into a forensic analysis
router.post('/import/findings', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const { forensicCaseId, ipedCaseId, ipedCaseName, findings, analysisId, category } = req.body;
    if (!forensicCaseId || !ipedCaseId || !findings) {
      return res.status(400).json({ error: 'forensicCaseId, ipedCaseId, and findings required', code: 'FORENSICCASEID_IPEDCASEID_AND_FINDINGS' });
    }

    const now = localNow();
    const findingsArr = Array.isArray(findings) ? findings : [];

    // Build structured summary of findings by type
    const byCategory: Record<string, number> = {};
    findingsArr.forEach((f: any) => {
      const cat = f.category || category || 'unknown';
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    });
    const summaryParts = Object.entries(byCategory).map(([k, v]) => `${v} ${k}`);
    const summary = `Imported ${findingsArr.length} findings: ${summaryParts.join(', ')}`;

    // Persist import record
    const importStmt = db.prepare(`
      INSERT INTO iped_imports (forensic_case_id, import_type, iped_case_id, iped_case_name, source_query, item_count, imported_data, summary, imported_by, imported_by_name, created_at)
      VALUES (?, 'findings', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    importStmt.run(
      forensicCaseId, ipedCaseId, ipedCaseName || null,
      category || null, findingsArr.length,
      JSON.stringify(findingsArr), summary,
      user.userId, user.fullName, now,
    );

    // If an analysisId was provided, append findings to the analysis conclusion
    if (analysisId) {
      const analysis = db.prepare('SELECT id, results, conclusion FROM forensic_analyses WHERE id = ? AND forensic_case_id = ?')
        .get(analysisId, forensicCaseId) as any;

      if (analysis) {
        const existingResults = analysis.results || '';
        const findingsSummary = findingsArr.map((f: any, i: number) =>
          `[${i + 1}] ${f.category || 'item'}: ${f.name || f.path || 'unnamed'} — ${f.content_preview || ''}`
        ).join('\n');

        const newResults = existingResults
          ? `${existingResults}\n\n── IPED Import (${now}) ──\n${findingsSummary}`
          : `── IPED Import (${now}) ──\n${findingsSummary}`;

        db.prepare('UPDATE forensic_analyses SET results = ?, updated_at = ? WHERE id = ?')
          .run(newResults, now, analysisId);
      }
    }

    logForensicActivity(forensicCaseId, 'iped_findings_imported', summary, user.userId, user.fullName);

    res.status(201).json({ data: { imported: findingsArr.length, summary } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/iped/import/timeline — import IPED timeline events into forensic activity log
router.post('/import/timeline', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const { forensicCaseId, ipedCaseId, ipedCaseName, events } = req.body;
    if (!forensicCaseId || !ipedCaseId || !events) {
      return res.status(400).json({ error: 'forensicCaseId, ipedCaseId, and events required', code: 'FORENSICCASEID_IPEDCASEID_AND_EVENTS' });
    }

    const now = localNow();
    const eventsArr = Array.isArray(events) ? events : [];

    // Insert each IPED timeline event as a forensic activity entry
    const actStmt = db.prepare(`
      INSERT INTO forensic_activity_log (forensic_case_id, action, details, performed_by, performed_by_name, performed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction(() => {
      for (const evt of eventsArr) {
        const timestamp = evt.timestamp || evt.date || now;
        const action = 'iped_timeline_event';
        const details = `[IPED] ${evt.type || 'event'}: ${evt.description || evt.name || evt.path || 'Unknown'} (${evt.source || 'IPED'})`;
        actStmt.run(forensicCaseId, action, details, user.userId, `IPED: ${user.fullName}`, timestamp);
      }
    });
    insertMany();

    // Persist import record
    const summary = `Imported ${eventsArr.length} timeline events from IPED case ${ipedCaseName || ipedCaseId}`;
    db.prepare(`
      INSERT INTO iped_imports (forensic_case_id, import_type, iped_case_id, iped_case_name, item_count, imported_data, summary, imported_by, imported_by_name, created_at)
      VALUES (?, 'timeline', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(forensicCaseId, ipedCaseId, ipedCaseName || null, eventsArr.length, JSON.stringify(eventsArr), summary, user.userId, user.fullName, now);

    logForensicActivity(forensicCaseId, 'iped_timeline_imported', summary, user.userId, user.fullName);

    res.status(201).json({ data: { imported: eventsArr.length, summary } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/iped/import/report — attach an IPED report reference to a forensic case
router.post('/import/report', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const { forensicCaseId, ipedCaseId, ipedCaseName, reportName, reportType, reportUrl, itemCount } = req.body;
    if (!forensicCaseId || !ipedCaseId) {
      return res.status(400).json({ error: 'forensicCaseId and ipedCaseId required', code: 'FORENSICCASEID_AND_IPEDCASEID_REQUIRED' });
    }

    const now = localNow();
    const rName = reportName || 'IPED Report';
    const rType = reportType || 'html';
    const summary = `Attached ${rType.toUpperCase()} report: ${rName} (${itemCount || 0} items) from IPED case ${ipedCaseName || ipedCaseId}`;

    const reportData = JSON.stringify({
      reportName: rName,
      reportType: rType,
      reportUrl: reportUrl || null,
      itemCount: itemCount || 0,
      ipedCaseName: ipedCaseName || ipedCaseId,
      attachedAt: now,
    });

    db.prepare(`
      INSERT INTO iped_imports (forensic_case_id, import_type, iped_case_id, iped_case_name, item_count, imported_data, summary, imported_by, imported_by_name, created_at)
      VALUES (?, 'report', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(forensicCaseId, ipedCaseId, ipedCaseName || null, itemCount || 0, reportData, summary, user.userId, user.fullName, now);

    logForensicActivity(forensicCaseId, 'iped_report_attached', summary, user.userId, user.fullName);

    res.status(201).json({ data: { summary } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/iped/import/items — bulk import IPED items as forensic exhibits
router.post('/import/items', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const { forensicCaseId, ipedCaseId, ipedCaseName, items } = req.body;
    if (!forensicCaseId || !ipedCaseId || !items) {
      return res.status(400).json({ error: 'forensicCaseId, ipedCaseId, and items required', code: 'FORENSICCASEID_IPEDCASEID_AND_ITEMS' });
    }

    const now = localNow();
    const itemsArr = Array.isArray(items) ? items : [];

    // Get current max exhibit number for this case
    const maxExhibit = db.prepare(
      'SELECT exhibit_number FROM forensic_exhibits WHERE forensic_case_id = ? ORDER BY id DESC LIMIT 1'
    ).get(forensicCaseId) as { exhibit_number: string } | undefined;

    let nextNum = 1;
    if (maxExhibit) {
      const m = maxExhibit.exhibit_number.match(/EX-(\d+)/);
      if (m) nextNum = parseInt(m[1], 10) + 1;
    }

    // Insert each IPED item as a forensic exhibit
    const exStmt = db.prepare(`
      INSERT INTO forensic_exhibits (forensic_case_id, exhibit_number, exhibit_type, description, hash_md5, hash_sha256, chain_of_custody, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction(() => {
      for (const item of itemsArr) {
        const exhibitNum = `EX-${String(nextNum++).padStart(3, '0')}`;
        const type = mapIpedTypeToExhibitType(item.type || item.mediaType);
        const desc = `[IPED] ${item.name || item.fileName || 'Item'} — ${item.path || ''}`.trim();
        const custody = JSON.stringify([{
          action: 'imported_from_iped',
          by: user.fullName,
          at: now,
          notes: `Imported from IPED case ${ipedCaseName || ipedCaseId}, item ID: ${item.id}`,
        }]);
        const notes = `IPED Item ID: ${item.id}\nIPED Case: ${ipedCaseName || ipedCaseId}\nSize: ${item.size || 'N/A'}\nCategory: ${item.category || 'N/A'}`;

        exStmt.run(forensicCaseId, exhibitNum, type, desc, item.md5 || item.hash || null, item.sha256 || null, custody, notes, now, now);
      }
    });
    insertMany();

    const summary = `Imported ${itemsArr.length} items as exhibits from IPED case ${ipedCaseName || ipedCaseId}`;
    db.prepare(`
      INSERT INTO iped_imports (forensic_case_id, import_type, iped_case_id, iped_case_name, item_count, imported_data, summary, imported_by, imported_by_name, created_at)
      VALUES (?, 'items', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(forensicCaseId, ipedCaseId, ipedCaseName || null, itemsArr.length, '[]', summary, user.userId, user.fullName, now);

    logForensicActivity(forensicCaseId, 'iped_items_imported', summary, user.userId, user.fullName);

    res.status(201).json({ data: { imported: itemsArr.length, summary } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ─── Import History ─────────────────────────────────────────
// ============================================================

// GET /api/iped/imports/:forensicCaseId — list imports for a forensic case
router.get('/imports/:forensicCaseId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const caseId = parseInt(req.params.forensicCaseId as string);
    const rows = db.prepare(`
      SELECT * FROM iped_imports WHERE forensic_case_id = ? ORDER BY created_at DESC
    
      LIMIT 1000
    `).all(caseId);
    res.json({ data: rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/iped/imports — list all imports (admin overview)
router.get('/imports', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt((req.query.limit as string) || '50', 10), 200);
    const rows = db.prepare(`
      SELECT i.*, fc.lab_number, fc.title as case_title
      FROM iped_imports i
      LEFT JOIN forensic_cases fc ON fc.id = i.forensic_case_id
      ORDER BY i.created_at DESC
      LIMIT ?
    `).all(limit);
    res.json({ data: rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Helper: map IPED media type → forensic exhibit type
// ============================================================

function mapIpedTypeToExhibitType(ipedType: string): string {
  if (!ipedType) return 'other';
  const t = ipedType.toLowerCase();
  if (t.includes('image') || t.includes('photo') || t.includes('video') || t.includes('audio')) return 'digital';
  if (t.includes('document') || t.includes('pdf') || t.includes('text') || t.includes('office')) return 'document';
  if (t.includes('executable') || t.includes('application') || t.includes('database')) return 'digital';
  if (t.includes('email') || t.includes('message') || t.includes('chat')) return 'digital';
  return 'other';
}

// GET /hashes/search — Search hash results by MD5, SHA1, or SHA256
router.get('/hashes/search', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { q } = req.query;
    if (!q || String(q).trim().length < 4) {
      return res.status(400).json({ error: 'Search query must be at least 4 characters', code: 'SEARCH_QUERY_MUST_BE' });
    }

    const searchTerm = `%${String(q).trim()}%`;
    const results = db.prepare(`
      SELECT hr.*, j.input_path, j.job_type
      FROM hash_results hr
      LEFT JOIN iped_jobs j ON hr.iped_job_id = j.id
      WHERE hr.md5 LIKE ? OR hr.sha1 LIKE ? OR hr.sha256 LIKE ?
        OR (hr.sha512 IS NOT NULL AND hr.sha512 LIKE ?)
      ORDER BY hr.flagged DESC, hr.created_at DESC
      LIMIT 50
    `).all(searchTerm, searchTerm, searchTerm, searchTerm);

    res.json({ results, total: results.length });
  } catch (error: any) {
    console.error('Hash search error:', error);
    res.status(500).json({ error: 'Failed to hash search', code: 'HASH_SEARCH_ERROR' });
  }
});

export default router;
