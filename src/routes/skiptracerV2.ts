// ============================================================
// RMPG Flex — Skip Tracker 3.5 (skiptracer-v2)
// ============================================================
// Replaces the stubs mount at /api/skiptracer-v2. Backs SkipTracerV2Page
// (/microbilt) and AdminSkipTracerV2Tab. Combines local RMS, open-source
// enrichment adapters (shared with /api/enrichment), and optional RapidAPI.
// ============================================================

import { Hono } from 'hono';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute, columnExists } from '../utils/db';
import { dbErrorResponse } from '../utils/dbErrors';
import { recordAudit } from '../utils/auditLog';
import { requireRole } from '../middleware/auth';
import { ensureSkipTracerV2Schema } from '../utils/skiptracerV2/schema';
import {
  parseSearchParams, runSkipTracerSearch, detectSearchTypeFromParams,
} from '../utils/skiptracerV2/search';
import { listSourceInfo, upsertSourceConfig } from '../utils/skiptracerV2/sources';

const skiptracerV2 = new Hono<Env>();

const adminOnly = requireRole('admin');

function actorId(c: { get: (k: 'user') => { id?: number; user_id?: number; userId?: number } | undefined }): number | null {
  const u = c.get('user');
  return u?.id ?? u?.user_id ?? u?.userId ?? null;
}

async function profileSnapshotColumn(db: D1Database): Promise<'profile_snapshot' | 'search_results'> {
  return (await columnExists(db, 'skiptracer_dossiers', 'profile_snapshot'))
    ? 'profile_snapshot'
    : 'search_results';
}

skiptracerV2.get('/status', async (c) => {
  try {
    await ensureSkipTracerV2Schema(c.env.DB);
    return c.json({ status: 'idle', enabled: true });
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to get skiptracer v2 status', 'STATUS_ERROR');
  }
});

skiptracerV2.get('/sources', async (c) => {
  try {
    await ensureSkipTracerV2Schema(c.env.DB);
    const sources = await listSourceInfo(c.env.DB, c.env as Record<string, unknown>);
    return c.json(sources);
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to list skiptracer sources', 'SOURCES_ERROR');
  }
});

skiptracerV2.put('/sources/:name/config', adminOnly, async (c) => {
  try {
    await ensureSkipTracerV2Schema(c.env.DB);
    const body = await c.req.json<{ enabled?: boolean; apiKey?: string }>();
    const name = c.req.param('name');
    if (!name) return c.json({ error: 'Missing source name' }, 400);
    await upsertSourceConfig(c.env.DB, name, body);
    return c.json({ ok: true });
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to update source config', 'CONFIG_ERROR');
  }
});

skiptracerV2.get('/stats', async (c) => {
  try {
    await ensureSkipTracerV2Schema(c.env.DB);
    const db = getDb(c.env);
    const today = (await queryFirst<{ n: number }>(db,
      `SELECT COUNT(*) as n FROM skip_tracer_searches_v
       WHERE created_at >= date('now')`))?.n ?? 0;
    const week = (await queryFirst<{ n: number }>(db,
      `SELECT COUNT(*) as n FROM skip_tracer_searches_v
       WHERE created_at >= date('now', '-7 days')`))?.n ?? 0;
    const allTime = (await queryFirst<{ n: number }>(db,
      `SELECT COUNT(*) as n FROM skip_tracer_searches_v`))?.n ?? 0;
    const costRow = await queryFirst<{ total: number }>(db,
      `SELECT COALESCE(SUM(cost_total), 0) as total FROM skip_tracer_searches_v`);
    const topSources = await query<{ name: string; count: number }>(db,
      `SELECT json_each.value as name, COUNT(*) as count
         FROM skip_tracer_searches_v, json_each(sources_responded)
        GROUP BY json_each.value
        ORDER BY count DESC
        LIMIT 8`);

    return c.json({
      totalSearches: { today, week, allTime },
      totalCost: costRow?.total ?? 0,
      topSources,
    });
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to get skiptracer stats', 'STATS_ERROR');
  }
});

skiptracerV2.get('/history', async (c) => {
  try {
    await ensureSkipTracerV2Schema(c.env.DB);
    const db = getDb(c.env);
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '50', 10) || 50));
    const rows = await query<Record<string, unknown>>(db,
      `SELECT s.id, s.search_type, s.query_params, s.sources_queried, s.sources_responded,
              s.total_results, s.cost_total, s.duration_ms, s.created_at,
              u.full_name AS searcher_name
         FROM skip_tracer_searches_v s
         LEFT JOIN users u ON u.id = s.searcher_id
        ORDER BY s.created_at DESC
        LIMIT ?`, limit);
    return c.json({ searches: rows });
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to load search history', 'HISTORY_ERROR');
  }
});

skiptracerV2.get('/search', async (c) => {
  const t0 = Date.now();
  try {
    await ensureSkipTracerV2Schema(c.env.DB);
    const params = parseSearchParams(new URL(c.req.url).searchParams);
    const hasQuery = params.q.trim() || params.firstName || params.lastName;
    if (!hasQuery) return c.json({ error: 'Missing search query', code: 'BAD_REQUEST' }, 400);

    const outcome = await runSkipTracerSearch(
      c.env.DB,
      c.env as Record<string, unknown>,
      params,
      actorId(c),
    );
    const durationMs = Date.now() - t0;
    const queryParams = JSON.stringify({
      q: params.q,
      firstName: params.firstName,
      lastName: params.lastName,
      dob: params.dob,
      city: params.city,
      state: params.state,
      ssn_last4: params.ssn_last4,
      address: params.address,
      engine: params.engine,
      categories: params.categories,
    });

    const ins = await execute(c.env.DB,
      `INSERT INTO skip_tracer_searches_v
         (search_type, query_params, sources_queried, sources_responded, total_results, searcher_id, cost_total, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      detectSearchTypeFromParams(params),
      queryParams,
      JSON.stringify(outcome.sourcesQueried),
      JSON.stringify(outcome.sourcesResponded),
      outcome.profiles.length,
      actorId(c),
      outcome.totalCost,
      durationMs,
    );

    await recordAudit(c, {
      action: 'SKIPTRACER_V2_SEARCH',
      entityType: 'skiptracer',
      details: { hits: outcome.profiles.length, engine: params.engine },
      actorId: actorId(c),
    });

    return c.json({
      profiles: outcome.profiles,
      sourcesQueried: outcome.sourcesQueried,
      sourcesResponded: outcome.sourcesResponded,
      sourcesFailed: outcome.sourcesFailed,
      totalResults: outcome.profiles.length,
      totalCost: outcome.totalCost,
      durationMs,
      searchId: String(ins.meta.last_row_id ?? ''),
      matchTier: outcome.matchTier,
      anchors: outcome.anchors,
    });
  } catch (err) {
    return dbErrorResponse(c, err, 'Search failed', 'SEARCH_ERROR');
  }
});

skiptracerV2.get('/dossiers', async (c) => {
  try {
    await ensureSkipTracerV2Schema(c.env.DB);
    const db = getDb(c.env);
    const snapshotCol = await profileSnapshotColumn(db);
    const q = (c.req.query('q') || '').trim();
    const conditions = ['1=1'];
    const binds: unknown[] = [];
    if (q) {
      conditions.push('(subject_name LIKE ? OR notes LIKE ?)');
      const wild = `%${q.slice(0, 48)}%`;
      binds.push(wild, wild);
    }
    const rows = await query<Record<string, unknown>>(db,
      `SELECT sd.id, sd.subject_name, sd.${snapshotCol} AS profile_snapshot, sd.notes, sd.tags,
              sd.created_at, sd.updated_at, u.full_name AS created_by_name
         FROM skiptracer_dossiers sd
         LEFT JOIN users u ON sd.created_by = u.id
        WHERE ${conditions.join(' AND ')}
        ORDER BY sd.updated_at DESC, sd.id DESC
        LIMIT 100`, ...binds);
    return c.json({ dossiers: rows });
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to list dossiers', 'DOSSIERS_ERROR');
  }
});

skiptracerV2.post('/dossiers', async (c) => {
  try {
    await ensureSkipTracerV2Schema(c.env.DB);
    const body = await c.req.json<{
      subjectName?: string;
      profileSnapshot?: unknown;
      notes?: string;
      tags?: string[] | string;
      linkedIncidentId?: string;
      linkedCaseId?: string;
    }>();
    const db = getDb(c.env);
    const snapshotCol = await profileSnapshotColumn(db);
    const name = (body.subjectName || 'Unknown').trim();
    const snapshot = body.profileSnapshot ? JSON.stringify(body.profileSnapshot) : null;
    const tags = Array.isArray(body.tags) ? JSON.stringify(body.tags) : (body.tags ?? null);

    if (body.linkedIncidentId || body.linkedCaseId) {
      const id = body.linkedIncidentId || body.linkedCaseId;
      await execute(db,
        `UPDATE skiptracer_dossiers SET
           linked_incident_id = COALESCE(?, linked_incident_id),
           linked_case_id = COALESCE(?, linked_case_id),
           updated_at = datetime('now')
         WHERE id = (SELECT MAX(id) FROM skiptracer_dossiers WHERE created_by = ?)`,
        body.linkedIncidentId ?? null,
        body.linkedCaseId ?? null,
        actorId(c),
      );
      return c.json({ ok: true, linked: id });
    }

    const ins = await execute(db,
      `INSERT INTO skiptracer_dossiers (subject_name, ${snapshotCol}, notes, tags, created_by, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      name, snapshot, body.notes ?? null, tags, actorId(c),
    );
    const dossierId = ins.meta.last_row_id as number;
    return c.json({ ok: true, id: dossierId, dossierId });
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to save dossier', 'DOSSIER_SAVE_ERROR');
  }
});

skiptracerV2.put('/dossiers/:id', async (c) => {
  try {
    await ensureSkipTracerV2Schema(c.env.DB);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
    const body = await c.req.json<{
      notes?: string;
      profileSnapshot?: unknown;
      tags?: string[];
      linkedIncidentId?: string;
      linkedCaseId?: string;
    }>();
    const sets: string[] = ["updated_at = datetime('now')"];
    const binds: unknown[] = [];
    if (body.notes !== undefined) { sets.push('notes = ?'); binds.push(body.notes); }
    if (body.tags !== undefined) { sets.push('tags = ?'); binds.push(JSON.stringify(body.tags)); }
    if (body.profileSnapshot !== undefined) {
      const snapshotCol = await profileSnapshotColumn(c.env.DB);
      sets.push(`${snapshotCol} = ?`);
      binds.push(JSON.stringify(body.profileSnapshot));
    }
    if (body.linkedIncidentId !== undefined) {
      sets.push('linked_incident_id = ?');
      binds.push(body.linkedIncidentId || null);
    }
    if (body.linkedCaseId !== undefined) {
      sets.push('linked_case_id = ?');
      binds.push(body.linkedCaseId || null);
    }
    binds.push(id);
    await execute(c.env.DB, `UPDATE skiptracer_dossiers SET ${sets.join(', ')} WHERE id = ?`, ...binds);
    return c.json({ ok: true });
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to update dossier', 'DOSSIER_UPDATE_ERROR');
  }
});

skiptracerV2.get('/dossiers/:id/pdf', async (c) => {
  try {
    await ensureSkipTracerV2Schema(c.env.DB);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
    const snapshotCol = await profileSnapshotColumn(c.env.DB);
    const row = await queryFirst<{ subject_name: string; notes: string | null; profile_snapshot: string | null }>(
      c.env.DB,
      `SELECT subject_name, notes, ${snapshotCol} AS profile_snapshot FROM skiptracer_dossiers WHERE id = ?`, id,
    );
    if (!row) return c.json({ error: 'not found' }, 404);

    let profile: Record<string, unknown> = {};
    if (row.profile_snapshot) {
      try { profile = JSON.parse(row.profile_snapshot); } catch { /* empty profile */ }
    }

    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const page = doc.addPage([612, 792]);
    let y = 740;
    const navy = rgb(0.13, 0.25, 0.37);

    page.drawText('RMPG Flex — Skip Trace Dossier', { x: 40, y, size: 16, font: bold, color: navy });
    y -= 24;
    page.drawText(`Dossier #${id} — ${row.subject_name}`, { x: 40, y, size: 12, font, color: rgb(0.1, 0.1, 0.1) });
    y -= 20;
    const fullName = String(profile.fullName ?? profile.Name ?? row.subject_name);
    page.drawText(`Subject: ${fullName.slice(0, 90)}`, { x: 40, y, size: 10, font });
    y -= 14;
    if (profile.dob) { page.drawText(`DOB: ${String(profile.dob)}`, { x: 40, y, size: 10, font }); y -= 14; }
    if (row.notes) {
      y -= 8;
      page.drawText('Notes', { x: 40, y, size: 11, font: bold, color: navy });
      y -= 14;
      for (const line of row.notes.split('\n').slice(0, 8)) {
        page.drawText(line.slice(0, 95), { x: 40, y, size: 9, font });
        y -= 12;
      }
    }

    const bytes = await doc.save();
    return new Response(bytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="dossier_${id}.pdf"`,
      },
    });
  } catch (err) {
    return dbErrorResponse(c, err, 'PDF export failed', 'PDF_ERROR');
  }
});

export default skiptracerV2;
