// ============================================================
// Skip Tracer v2 — Search Orchestrator Route
// ============================================================
// Main Express router that orchestrates multi-source searches,
// manages dossiers, and tracks search history / statistics.

import { Router, Request, Response } from 'express';
import crypto, { randomUUID } from 'crypto';
import { authenticateToken, requireRole } from '../../middleware/auth';
import { config } from '../../config';
import { getDb } from '../../models/database';
import { localNow } from '../../utils/timeUtils';
import { auditLog } from '../../utils/auditLogger';
import { resolveResults } from './resolver';
import { ensureSkipTracerV2Tables } from './database';
import { getAllSources, getEnabledSources } from './sources/registry';
import type { SearchQuery, UnifiedSearchResult } from './types';

const router = Router();
router.use(authenticateToken);

// Ensure tables exist on first load
ensureSkipTracerV2Tables();

// ============================================================
// Query Type Detection
// ============================================================

const STREET_WORDS = /\b(st|street|ave|avenue|blvd|boulevard|dr|drive|rd|road|ln|lane|ct|court|way|pl|place|cir|circle|pkwy|parkway|hwy|highway)\b/i;

function detectQueryType(q: string): 'phone' | 'email' | 'address' | 'name' {
  const stripped = q.replace(/[\s\-().+]/g, '');
  // 10+ consecutive digits → phone
  if (/\d{10,}/.test(stripped)) return 'phone';
  // Contains @ → email
  if (q.includes('@')) return 'email';
  // Contains digits AND street-type words → address
  if (/\d/.test(q) && STREET_WORDS.test(q)) return 'address';
  // Default → name
  return 'name';
}

function buildSearchQuery(params: {
  q?: string;
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  type?: string;
}): { query: SearchQuery; searchType: string } {
  const { q, name, phone, email, address, type } = params;

  // Explicit field params take precedence
  if (name) return { query: { name }, searchType: 'name' };
  if (phone) return { query: { phone: phone.replace(/\D/g, '') }, searchType: 'phone' };
  if (email) return { query: { email: email.toLowerCase().trim() }, searchType: 'email' };
  if (address) return { query: { address }, searchType: 'address' };

  if (!q) {
    return { query: {}, searchType: 'unknown' };
  }

  const detected = type || detectQueryType(q);

  switch (detected) {
    case 'phone':
      return { query: { phone: q.replace(/\D/g, '') }, searchType: 'phone' };
    case 'email':
      return { query: { email: q.toLowerCase().trim() }, searchType: 'email' };
    case 'address':
      return { query: { address: q }, searchType: 'address' };
    default:
      return { query: { name: q }, searchType: 'name' };
  }
}

// ============================================================
// GET /search — Unified multi-source search
// ============================================================

router.get('/search', async (req: Request, res: Response) => {
  try {
    const { q, name, phone, email, address, type } = req.query as Record<string, string | undefined>;

    if (!q && !name && !phone && !email && !address) {
      res.status(400).json({ error: 'At least one search parameter is required (q, name, phone, email, or address)' });
      return;
    }

    const { query, searchType } = buildSearchQuery({ q, name, phone, email, address, type });
    const sources = getEnabledSources();
    const searchId = randomUUID();
    const startTime = Date.now();

    // Execute all sources in parallel
    const settled = await Promise.allSettled(
      sources.map(s => s.search(query))
    );

    const sourcesQueried = sources.map(s => s.name);
    const sourcesResponded: string[] = [];
    const sourcesFailed: Array<{ name: string; error: string }> = [];
    const successfulResults: import('./types').SourceResult[] = [];
    let totalCost = 0;

    settled.forEach((outcome, i) => {
      const sourceName = sources[i].name;
      if (outcome.status === 'fulfilled') {
        const result = outcome.value;
        if (result.error) {
          sourcesFailed.push({ name: sourceName, error: result.error });
        } else {
          sourcesResponded.push(sourceName);
          successfulResults.push(result);
          totalCost += sources[i].costPerLookup;
        }
      } else {
        sourcesFailed.push({
          name: sourceName,
          error: outcome.reason?.message || 'Unknown error',
        });
      }
    });

    // Resolve into unified profiles
    const profiles = resolveResults(successfulResults);
    const durationMs = Date.now() - startTime;

    const result: UnifiedSearchResult = {
      profiles,
      sourcesQueried,
      sourcesResponded,
      sourcesFailed: sourcesFailed.length > 0 ? sourcesFailed : undefined,
      totalResults: profiles.length,
      totalCost: Math.round(totalCost * 100) / 100,
      durationMs,
      query,
      searchId,
      timestamp: localNow(),
    };

    // Persist search to audit table
    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO skip_tracer_searches_v2
          (search_type, query_params, sources_queried, sources_responded, total_results, searched_by, cost_total, duration_ms, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        searchType,
        JSON.stringify(query),
        JSON.stringify(sourcesQueried),
        JSON.stringify(sourcesResponded),
        profiles.length,
        req.user?.userId ?? null,
        totalCost,
        durationMs,
        localNow(),
      );
    } catch (err) {
      console.error('[SkipTracer-v2] Failed to persist search:', err);
    }

    auditLog(req, 'skiptracer_search', 'skiptracer', searchId, `Skip Tracer v2 ${searchType} search: ${profiles.length} results from ${sourcesResponded.length}/${sourcesQueried.length} sources`);

    res.json(result);
  } catch (err) {
    console.error('[SkipTracer-v2] Search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ============================================================
// GET /sources — List all sources with status
// ============================================================

router.get('/sources', async (_req: Request, res: Response) => {
  try {
    const sources = getAllSources();

    const sourceList = await Promise.all(
      sources.map(async (s) => {
        const health = await s.healthCheck();
        return {
          name: s.name,
          displayName: s.displayName,
          category: s.category,
          costPerLookup: s.costPerLookup,
          configured: s.isConfigured(),
          enabled: s.isEnabled(),
          healthy: health.ok,
        };
      })
    );

    res.json(sourceList);
  } catch (err) {
    console.error('[SkipTracer-v2] Sources list error:', err);
    res.status(500).json({ error: 'Failed to list sources' });
  }
});

// ============================================================
// PUT /sources/:name/config — Configure a source (admin only)
// ============================================================

router.put('/sources/:name/config', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const { enabled, apiKey, config: sourceConfig } = req.body;
    const db = getDb();

    const source = getAllSources().find(s => s.name === name);
    if (!source) {
      res.status(404).json({ error: `Source "${name}" not found` });
      return;
    }

    if (typeof enabled === 'boolean') {
      db.prepare(
        `INSERT INTO system_config (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).run(`skipv2_${name}_enabled`, enabled ? '1' : '0', localNow());
    }

    if (typeof apiKey === 'string') {
      // Store API key encrypted (AES-256-GCM, same pattern as BaseDataSource)
      const key = crypto.createHash('sha256').update(config.jwt.secret).digest();
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      let encrypted = cipher.update(apiKey, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const authTag = cipher.getAuthTag().toString('hex');
      const encryptedValue = `${iv.toString('hex')}:${authTag}:${encrypted}`;

      db.prepare(
        `INSERT INTO system_config (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).run(`skipv2_${name}_api_key`, encryptedValue, localNow());
    }

    if (sourceConfig && typeof sourceConfig === 'object') {
      db.prepare(
        `INSERT INTO system_config (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).run(`skipv2_${name}_config`, JSON.stringify(sourceConfig), localNow());
    }

    auditLog(req, 'skiptracer_config_updated', 'integration', 0, `Skip Tracer v2 source "${name}" configuration updated`);

    res.json({ success: true });
  } catch (err) {
    console.error('[SkipTracer-v2] Source config error:', err);
    res.status(500).json({ error: 'Failed to update source configuration' });
  }
});

// ============================================================
// GET /dossiers — List saved dossiers (with search/pagination)
// ============================================================

router.get('/dossiers', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const q = (req.query.q as string) || '';
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;

    let sql = `
      SELECT d.*, u.full_name AS created_by_name
      FROM dossiers d
      LEFT JOIN users u ON u.id = d.created_by
      WHERE d.is_archived = 0
    `;
    const params: any[] = [];

    if (q) {
      sql += ` AND d.subject_name LIKE ?`;
      params.push(`%${q}%`);
    }

    sql += ` ORDER BY d.updated_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = db.prepare(sql).all(...params);

    // Get total count for pagination
    let countSql = `SELECT COUNT(*) as total FROM dossiers WHERE is_archived = 0`;
    const countParams: any[] = [];
    if (q) {
      countSql += ` AND subject_name LIKE ?`;
      countParams.push(`%${q}%`);
    }
    const { total } = db.prepare(countSql).get(...countParams) as { total: number };

    res.json({ dossiers: rows, total, limit, offset });
  } catch (err) {
    console.error('[SkipTracer-v2] Dossiers list error:', err);
    res.status(500).json({ error: 'Failed to list dossiers' });
  }
});

// ============================================================
// POST /dossiers — Save a dossier
// ============================================================

router.post('/dossiers', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      subjectName,
      profileSnapshot,
      notes,
      tags,
      linkedIncidentId,
      linkedCaseId,
      linkedCallId,
    } = req.body;

    if (!subjectName || !profileSnapshot) {
      res.status(400).json({ error: 'subjectName and profileSnapshot are required' });
      return;
    }

    const now = localNow();
    const result = db.prepare(`
      INSERT INTO dossiers (subject_name, profile_snapshot, notes, tags, linked_incident_id, linked_case_id, linked_call_id, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      subjectName,
      typeof profileSnapshot === 'string' ? profileSnapshot : JSON.stringify(profileSnapshot),
      notes || null,
      JSON.stringify(tags || []),
      linkedIncidentId || null,
      linkedCaseId || null,
      linkedCallId || null,
      req.user?.userId ?? null,
      now,
      now,
    );

    const id = result.lastInsertRowid;

    auditLog(req, 'CREATE', 'skiptracer', String(id), `Dossier created for "${subjectName}"`);

    res.json({ success: true, id });
  } catch (err) {
    console.error('[SkipTracer-v2] Dossier create error:', err);
    res.status(500).json({ error: 'Failed to create dossier' });
  }
});

// ============================================================
// GET /dossiers/:id — Get a saved dossier
// ============================================================

router.get('/dossiers/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;

    const dossier = db.prepare(`
      SELECT d.*, u.full_name AS created_by_name
      FROM dossiers d
      LEFT JOIN users u ON u.id = d.created_by
      WHERE d.id = ? AND d.is_archived = 0
    `).get(id);

    if (!dossier) {
      res.status(404).json({ error: 'Dossier not found' });
      return;
    }

    res.json(dossier);
  } catch (err) {
    console.error('[SkipTracer-v2] Dossier get error:', err);
    res.status(500).json({ error: 'Failed to get dossier' });
  }
});

// ============================================================
// DELETE /dossiers/:id — Archive (soft delete) a dossier
// ============================================================

router.delete('/dossiers/:id', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;

    const existing = db.prepare('SELECT id, subject_name FROM dossiers WHERE id = ?').get(id) as { id: number; subject_name: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Dossier not found' });
      return;
    }

    db.prepare('UPDATE dossiers SET is_archived = 1, updated_at = ? WHERE id = ?')
      .run(localNow(), id);

    auditLog(req, 'DELETE', 'skiptracer', String(id), `Dossier archived for "${existing.subject_name}"`);

    res.json({ success: true });
  } catch (err) {
    console.error('[SkipTracer-v2] Dossier delete error:', err);
    res.status(500).json({ error: 'Failed to archive dossier' });
  }
});

// ============================================================
// GET /history — Search history with pagination
// ============================================================

router.get('/history', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;

    const rows = db.prepare(`
      SELECT s.*, u.full_name AS searcher_name
      FROM skip_tracer_searches_v2 s
      LEFT JOIN users u ON u.id = s.searched_by
      ORDER BY s.created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    const { total } = db.prepare(
      'SELECT COUNT(*) as total FROM skip_tracer_searches_v2'
    ).get() as { total: number };

    res.json({ searches: rows, total, limit, offset });
  } catch (err) {
    console.error('[SkipTracer-v2] History error:', err);
    res.status(500).json({ error: 'Failed to get search history' });
  }
});

// ============================================================
// GET /stats — Usage statistics
// ============================================================

router.get('/stats', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    // Today = date portion of localNow
    const today = now.split(' ')[0] || now.split('T')[0];

    const { total_all } = db.prepare(
      'SELECT COUNT(*) as total_all FROM skip_tracer_searches_v2'
    ).get() as { total_all: number };

    const { total_today } = db.prepare(
      "SELECT COUNT(*) as total_today FROM skip_tracer_searches_v2 WHERE created_at >= ? || ' 00:00:00'"
    ).get(today) as { total_today: number };

    // Week = last 7 days
    const { total_week } = db.prepare(
      "SELECT COUNT(*) as total_week FROM skip_tracer_searches_v2 WHERE created_at >= datetime(?, '-7 days')"
    ).get(now) as { total_week: number };

    const { total_cost } = db.prepare(
      'SELECT COALESCE(SUM(cost_total), 0) as total_cost FROM skip_tracer_searches_v2'
    ).get() as { total_cost: number };

    // Top sources by frequency in sources_responded JSON arrays
    // SQLite doesn't have native JSON array iteration, so we do it in JS
    const allSearches = db.prepare(
      'SELECT sources_responded FROM skip_tracer_searches_v2'
    ).all() as Array<{ sources_responded: string }>;

    const sourceCounts: Record<string, number> = {};
    for (const row of allSearches) {
      try {
        const sources = JSON.parse(row.sources_responded);
        if (Array.isArray(sources)) {
          for (const s of sources) {
            sourceCounts[s] = (sourceCounts[s] || 0) + 1;
          }
        }
      } catch { /* skip malformed */ }
    }

    const topSources = Object.entries(sourceCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    res.json({
      totalSearches: {
        today: total_today,
        week: total_week,
        allTime: total_all,
      },
      totalCost: Math.round(total_cost * 100) / 100,
      topSources,
    });
  } catch (err) {
    console.error('[SkipTracer-v2] Stats error:', err);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

export default router;
