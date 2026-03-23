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
import { saveToPeopleIndex } from './scheduler';
import type { SearchQuery, UnifiedSearchResult, DossierProfile } from './types';

const router = Router();
router.use(authenticateToken);

// Lazy table init — called on first request, not at import time
let tablesInitialized = false;
function ensureTables() {
  if (!tablesInitialized) {
    ensureSkipTracerV2Tables();
    tablesInitialized = true;
  }
}
router.use((_req, _res, next) => { ensureTables(); next(); });

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
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  address?: string;
  type?: string;
}): { query: SearchQuery; searchType: string } {
  const { q, name, firstName, lastName, phone, email, address, type } = params;

  // Explicit field params take precedence
  if (firstName && lastName) {
    return { query: { name: `${firstName} ${lastName}`, firstName, lastName }, searchType: 'name' };
  }
  if (firstName) return { query: { name: firstName, firstName }, searchType: 'name' };
  if (lastName) return { query: { name: lastName, lastName }, searchType: 'name' };
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
    const { q, name, firstName, lastName, phone, email, address, type, categories } = req.query as Record<string, string | undefined>;

    if (!q && !name && !firstName && !lastName && !phone && !email && !address) {
      res.status(400).json({ error: 'At least one search parameter is required (q, name, firstName, lastName, phone, email, or address)', code: 'AT_LEAST_ONE_SEARCH' });
      return;
    }

    const { query, searchType } = buildSearchQuery({ q, name, firstName, lastName, phone, email, address, type });
    let sources = getEnabledSources();

    // Filter by category if specified (e.g. ?categories=court,registry)
    if (categories) {
      const allowed = categories.split(',').map(c => c.trim().toLowerCase());
      sources = sources.filter(s => allowed.includes(s.category));
    }
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

    // Background-save resolved profiles to people_index
    for (const profile of profiles) {
      try { saveToPeopleIndex(profile); } catch (e) { /* non-critical */ }
    }

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
    res.status(500).json({ error: 'Search failed', code: 'SEARCH_FAILED' });
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
    res.status(500).json({ error: 'Failed to list sources', code: 'FAILED_TO_LIST_SOURCES' });
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
    res.status(500).json({ error: 'Failed to update source configuration', code: 'FAILED_TO_UPDATE_SOURCE' });
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
    res.status(500).json({ error: 'Failed to list dossiers', code: 'FAILED_TO_LIST_DOSSIERS' });
  }
});

// ============================================================
// POST /dossiers — Save a dossier
// ============================================================

router.post('/dossiers', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
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
      res.status(400).json({ error: 'subjectName and profileSnapshot are required', code: 'SUBJECTNAME_AND_PROFILESNAPSHOT_ARE' });
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

    const id = Number(result.lastInsertRowid);

    auditLog(req, 'CREATE', 'skiptracer', String(id), `Dossier created for "${subjectName}"`);

    const dossier = db.prepare(`
      SELECT d.*, u.full_name AS created_by_name
      FROM dossiers d
      LEFT JOIN users u ON u.id = d.created_by
      WHERE d.id = ?
    `).get(id);

    res.json(dossier || { success: true, id });
  } catch (err) {
    console.error('[SkipTracer-v2] Dossier create error:', err);
    res.status(500).json({ error: 'Failed to create dossier', code: 'FAILED_TO_CREATE_DOSSIER' });
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
      res.status(404).json({ error: 'Dossier not found', code: 'DOSSIER_NOT_FOUND' });
      return;
    }

    res.json(dossier);
  } catch (err) {
    console.error('[SkipTracer-v2] Dossier get error:', err);
    res.status(500).json({ error: 'Failed to get dossier', code: 'FAILED_TO_GET_DOSSIER' });
  }
});

// ============================================================
// PUT /dossiers/:id — Update a dossier (notes, tags, links)
// ============================================================

router.put('/dossiers/:id', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { notes, tags, linkedIncidentId, linkedCaseId, linkedCallId } = req.body;

    const existing = db.prepare('SELECT id FROM dossiers WHERE id = ? AND is_archived = 0').get(id);
    if (!existing) {
      res.status(404).json({ error: 'Dossier not found', code: 'DOSSIER_NOT_FOUND' });
      return;
    }

    const updates: string[] = [];
    const params: any[] = [];

    if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
    if (tags !== undefined) { updates.push('tags = ?'); params.push(JSON.stringify(tags)); }
    if (linkedIncidentId !== undefined) { updates.push('linked_incident_id = ?'); params.push(linkedIncidentId || null); }
    if (linkedCaseId !== undefined) { updates.push('linked_case_id = ?'); params.push(linkedCaseId || null); }
    if (linkedCallId !== undefined) { updates.push('linked_call_id = ?'); params.push(linkedCallId || null); }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update', code: 'NO_FIELDS_TO_UPDATE' });
      return;
    }

    updates.push('updated_at = ?');
    params.push(localNow());
    params.push(id);

    db.prepare(`UPDATE dossiers SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const updated = db.prepare('SELECT * FROM dossiers WHERE id = ?').get(id);
    res.json(updated);
  } catch (err) {
    console.error('[SkipTracer-v2] Dossier update error:', err);
    res.status(500).json({ error: 'Failed to update dossier', code: 'FAILED_TO_UPDATE_DOSSIER' });
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
      res.status(404).json({ error: 'Dossier not found', code: 'DOSSIER_NOT_FOUND' });
      return;
    }

    db.prepare('UPDATE dossiers SET is_archived = 1, updated_at = ? WHERE id = ?')
      .run(localNow(), id);

    auditLog(req, 'DELETE', 'skiptracer', String(id), `Dossier archived for "${existing.subject_name}"`);

    res.json({ success: true });
  } catch (err) {
    console.error('[SkipTracer-v2] Dossier delete error:', err);
    res.status(500).json({ error: 'Failed to archive dossier', code: 'FAILED_TO_ARCHIVE_DOSSIER' });
  }
});

// ============================================================
// GET /history — Search history with pagination
// ============================================================

router.get('/history', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    const q = (req.query.q as string) || '';

    let whereSql = '';
    const whereParams: any[] = [];
    if (q) {
      whereSql = ' WHERE s.query_params LIKE ?';
      whereParams.push(`%${q}%`);
    }

    const rows = db.prepare(`
      SELECT s.*, u.full_name AS searcher_name
      FROM skip_tracer_searches_v2 s
      LEFT JOIN users u ON u.id = s.searched_by
      ${whereSql}
      ORDER BY s.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...whereParams, limit, offset);

    const { total } = db.prepare(
      `SELECT COUNT(*) as total FROM skip_tracer_searches_v2 s${whereSql}`
    ).get(...whereParams) as { total: number };

    res.json({ searches: rows, total, limit, offset });
  } catch (err) {
    console.error('[SkipTracer-v2] History error:', err);
    res.status(500).json({ error: 'Failed to get search history', code: 'FAILED_TO_GET_SEARCH' });
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

    // Searches by day for the last 7 days
    const searchesByDay: Array<{ date: string; count: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const dayRow = db.prepare(
        `SELECT COUNT(*) as cnt FROM skip_tracer_searches_v2
         WHERE date(created_at) = date(?, '-${i} days')`
      ).get(today) as { cnt: number };
      // Compute the date string
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      searchesByDay.push({ date: dateStr, count: dayRow.cnt });
    }

    res.json({
      totalSearches: {
        today: total_today,
        week: total_week,
        allTime: total_all,
      },
      totalCost: Math.round(total_cost * 100) / 100,
      topSources,
      searchesByDay,
    });
  } catch (err) {
    console.error('[SkipTracer-v2] Stats error:', err);
    res.status(500).json({ error: 'Failed to get statistics', code: 'FAILED_TO_GET_STATISTICS' });
  }
});

// ============================================================
// GET /dossiers/:id/pdf — Export dossier as PDF
// ============================================================

router.get('/dossiers/:id/pdf', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;

    const dossier = db.prepare(`
      SELECT d.*, u.full_name AS created_by_name
      FROM dossiers d
      LEFT JOIN users u ON u.id = d.created_by
      WHERE d.id = ? AND d.is_archived = 0
    `).get(id) as any;

    if (!dossier) {
      res.status(404).json({ error: 'Dossier not found', code: 'DOSSIER_NOT_FOUND' });
      return;
    }

    let profile: DossierProfile;
    try {
      profile = JSON.parse(dossier.profile_snapshot);
    } catch {
      res.status(500).json({ error: 'Invalid profile snapshot data', code: 'INVALID_PROFILE_SNAPSHOT_DATA' });
      return;
    }

    const generatedBy = (req.user as any)?.fullName || (req.user as any)?.username || 'Unknown';
    const generatedAt = localNow();

    // Build PDF with jsPDF
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 15;
    const contentWidth = pageWidth - margin * 2;
    let y = margin;

    const checkPage = (needed: number) => {
      if (y + needed > doc.internal.pageSize.getHeight() - margin) {
        doc.addPage();
        y = margin;
      }
    };

    const addSectionHeader = (title: string) => {
      checkPage(14);
      y += 4;
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(26, 90, 158); // brand blue
      doc.text(title.toUpperCase(), margin, y);
      y += 1;
      doc.setDrawColor(26, 90, 158);
      doc.setLineWidth(0.5);
      doc.line(margin, y, margin + contentWidth, y);
      y += 5;
      doc.setTextColor(0, 0, 0);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
    };

    const addField = (label: string, value: string | undefined | null) => {
      if (!value) return;
      checkPage(6);
      doc.setFont('helvetica', 'bold');
      doc.text(`${label}: `, margin, y);
      const labelWidth = doc.getTextWidth(`${label}: `);
      doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(value, contentWidth - labelWidth);
      doc.text(lines, margin + labelWidth, y);
      y += lines.length * 4 + 1;
    };

    const addListItems = (items: string[]) => {
      for (const item of items) {
        checkPage(5);
        const lines = doc.splitTextToSize(`  - ${item}`, contentWidth - 4);
        doc.text(lines, margin + 2, y);
        y += lines.length * 4 + 0.5;
      }
    };

    // ── Title ──
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(26, 90, 158);
    doc.text('RMPG FLEX \u2014 SKIP TRACE DOSSIER', pageWidth / 2, y, { align: 'center' });
    y += 8;
    doc.setDrawColor(26, 90, 158);
    doc.setLineWidth(1);
    doc.line(margin, y, margin + contentWidth, y);
    y += 6;

    // ── Meta info ──
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(80, 80, 80);
    doc.text(`Subject: ${dossier.subject_name}`, margin, y); y += 4;
    doc.text(`Generated: ${generatedAt}`, margin, y); y += 4;
    doc.text(`Generated By: ${generatedBy}`, margin, y); y += 4;
    if (dossier.notes) {
      doc.text(`Notes: ${dossier.notes}`, margin, y); y += 4;
    }
    y += 2;
    doc.setTextColor(0, 0, 0);

    // ── Identity ──
    addSectionHeader('Identity');
    const fullName = [profile.firstName, profile.middleName, profile.lastName, profile.suffix].filter(Boolean).join(' ');
    addField('Name', fullName || dossier.subject_name);
    addField('Date of Birth', profile.dob);
    addField('Age', profile.age?.toString());
    addField('Gender', profile.gender);
    addField('SSN (last 4)', profile.ssn_last4);
    if (profile.aliases && profile.aliases.length > 0) {
      addField('Aliases', profile.aliases.join(', '));
    }
    addField('Confidence', `${(profile.confidenceScore * 100).toFixed(0)}%`);
    addField('Sources', profile.sources?.join(', '));

    // ── Addresses ──
    if (profile.addresses?.length) {
      addSectionHeader(`Addresses (${profile.addresses.length})`);
      for (const addr of profile.addresses) {
        checkPage(10);
        const line = [addr.street, addr.street2, addr.city, addr.state, addr.zip].filter(Boolean).join(', ');
        addField(addr.type || 'Address', line);
        if (addr.source) { addField('  Source', addr.source); }
      }
    }

    // ── Phones ──
    if (profile.phones?.length) {
      addSectionHeader(`Phone Numbers (${profile.phones.length})`);
      for (const ph of profile.phones) {
        addField(ph.type || 'Phone', `${ph.number}${ph.carrier ? ` (${ph.carrier})` : ''}${ph.lineStatus ? ` [${ph.lineStatus}]` : ''}`);
      }
    }

    // ── Emails ──
    if (profile.emails?.length) {
      addSectionHeader(`Email Addresses (${profile.emails.length})`);
      for (const em of profile.emails) {
        addField(em.type || 'Email', em.address);
      }
    }

    // ── Associates ──
    if (profile.associates?.length) {
      addSectionHeader(`Associates (${profile.associates.length})`);
      for (const a of profile.associates) {
        addField(a.relationship || 'Associate', `${a.name}${a.phone ? ` | ${a.phone}` : ''}`);
      }
    }

    // ── Court Records ──
    if (profile.courtRecords?.length) {
      addSectionHeader(`Court Records (${profile.courtRecords.length})`);
      for (const cr of profile.courtRecords) {
        checkPage(14);
        addField('Case', `${cr.caseNumber} (${cr.court}, ${cr.state})`);
        addField('  Type', cr.caseType);
        addField('  Status', cr.status);
        if (cr.charges?.length) { addField('  Charges', cr.charges.join('; ')); }
        addField('  Filed', cr.filingDate);
        addField('  Disposition', cr.disposition);
      }
    }

    // ── Businesses ──
    if (profile.businesses?.length) {
      addSectionHeader(`Business Records (${profile.businesses.length})`);
      for (const b of profile.businesses) {
        addField('Business', `${b.name} (${b.state}) — ${b.status || 'unknown'}`);
        addField('  Role', b.role);
      }
    }

    // ── Registry / Watchlist ──
    if (profile.watchlistFlags?.length) {
      addSectionHeader(`Watchlist / Registry Flags (${profile.watchlistFlags.length})`);
      for (const w of profile.watchlistFlags) {
        addField(w.listName, `${w.matchType || ''} match${w.details ? ` — ${w.details}` : ''}`);
      }
    }

    if (profile.sexOffenderRecords?.length) {
      addSectionHeader(`Sex Offender Registry (${profile.sexOffenderRecords.length})`);
      for (const so of profile.sexOffenderRecords) {
        addField('Registry', `${so.registryState} — Tier ${so.tier || 'N/A'}`);
        if (so.offenses?.length) addField('  Offenses', so.offenses.join('; '));
      }
    }

    if (profile.custodyRecords?.length) {
      addSectionHeader(`Custody Records (${profile.custodyRecords.length})`);
      for (const c of profile.custodyRecords) {
        addField('Facility', `${c.facility} (${c.facilityState})`);
        addField('  Status', c.status);
        addField('  Booking', c.bookingDate);
      }
    }

    // ── Vehicles ──
    if (profile.vehicles?.length) {
      addSectionHeader(`Vehicles (${profile.vehicles.length})`);
      for (const v of profile.vehicles) {
        addField('Vehicle', [v.year, v.make, v.model, v.color].filter(Boolean).join(' '));
        addField('  Plate', v.plate ? `${v.plate} (${v.plateState || ''})` : undefined);
        addField('  VIN', v.vin);
      }
    }

    // ── Property ──
    if (profile.propertyRecords?.length) {
      addSectionHeader(`Property Records (${profile.propertyRecords.length})`);
      for (const p of profile.propertyRecords) {
        addField('Address', `${p.address}, ${p.city}, ${p.state} ${p.zip}`);
        addField('  Type', p.propertyType);
        addField('  Value', p.marketValue ? `$${p.marketValue.toLocaleString()}` : undefined);
      }
    }

    // ── Licenses ──
    if (profile.licenses?.length) {
      addSectionHeader(`Licenses (${profile.licenses.length})`);
      for (const l of profile.licenses) {
        addField(l.type, `${l.state} — ${l.status || 'unknown'}${l.expirationDate ? ` (exp: ${l.expirationDate})` : ''}`);
      }
    }

    // ── Footer ──
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setTextColor(150, 150, 150);
      doc.text(
        `RMPG Flex Skip Trace Dossier — Page ${i} of ${pageCount} — CONFIDENTIAL LAW ENFORCEMENT`,
        pageWidth / 2,
        doc.internal.pageSize.getHeight() - 5,
        { align: 'center' }
      );
    }

    const pdfBuffer = Buffer.from(doc.output('arraybuffer'));
    const safeName = dossier.subject_name.replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '_');

    auditLog(req, 'EXPORT', 'skiptracer', String(id), `Dossier PDF exported for "${dossier.subject_name}"`);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Dossier_${safeName}_${generatedAt.split(' ')[0] || generatedAt}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('[SkipTracer-v2] PDF export error:', err);
    res.status(500).json({ error: 'Failed to export dossier PDF', code: 'FAILED_TO_EXPORT_DOSSIER' });
  }
});

export default router;
