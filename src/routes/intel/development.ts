// ============================================================
// RMPG Flex — Intel Development Cycle routes (Wave 1)
// ============================================================
// Mounted by intel.ts at /api/intel/reports and /api/intel/sources.
// Keeps the 44KB intel.ts from growing. Auth: /api/intel is already
// auth:'required' in routesConfig.ts; handlers add role gates.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst, execute } from '../../utils/db';
import { requireRole } from '../../middleware/auth';
import {
  canTransition, nextReportNumber, computeReviewDate, gradeLabel, confidenceScore,
  type IntelReport,
} from '../../utils/intelDevelopment';
import { recordAudit } from '../../utils/auditLog';

const operational = requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher');
const supervisorPlus = requireRole('admin', 'manager', 'supervisor');

const isSup = (c: any) =>
  ['admin', 'manager', 'supervisor'].includes(String((c.get('user') as { role?: string })?.role || ''));

/** Strip the restricted body + source identity for unauthorized viewers. */
function redact(r: any, sup: boolean, viewerId: number | null): any {
  if (sup || r.submitted_by === viewerId) return r;
  const { raw_narrative, source_id, source_type, ...safe } = r;
  return { ...safe, source_id: null, source_type: null, raw_narrative: null, _redacted: true };
}

export const intelReports = new Hono<Env>();

// POST /api/intel/reports — submit a raw report
intelReports.post('/', operational, async (c) => {
  const db = getDb(c.env);
  const userId = (c.get('userId') as number | undefined) ?? null;
  const b = await c.req.json().catch(() => ({}));
  if (!b.title || !String(b.title).trim()) return c.json({ error: 'title required' }, 400);
  const year = new Date().getUTCFullYear();
  const cnt = await queryFirst<{ n: number }>(db,
    `SELECT COUNT(*) AS n FROM intel_reports WHERE report_number LIKE ?`, `INT-${year}-%`);
  const report_number = nextReportNumber(year, (cnt?.n || 0) + 1);
  const res = await execute(db,
    `INSERT INTO intel_reports
       (report_number, title, status, source_id, source_type, raw_narrative,
        threat_level, classification, submitted_by)
     VALUES (?, ?, 'submitted', ?, ?, ?, ?, ?, ?)`,
    report_number, String(b.title).trim(), b.source_id || null, b.source_type || null,
    b.raw_narrative || null, b.threat_level || 'low', b.classification || null, userId);
  return c.json({ success: true, id: res.meta?.last_row_id, report_number });
});

// GET /api/intel/reports?status=&threat=&mine=1&retention=
intelReports.get('/', operational, async (c) => {
  const db = getDb(c.env);
  const userId = (c.get('userId') as number | undefined) ?? null;
  const sup = isSup(c);
  const where: string[] = [];
  const args: unknown[] = [];
  const status = c.req.query('status');
  if (status) { where.push('status = ?'); args.push(status); }
  const threat = c.req.query('threat');
  if (threat) { where.push('threat_level = ?'); args.push(threat); }
  const retention = c.req.query('retention');
  if (retention) { where.push('retention_status = ?'); args.push(retention); }
  // Officers see disseminated products + their own drafts; supervisors see all.
  if (!sup) { where.push("(status = 'disseminated' OR submitted_by = ?)"); args.push(userId); }
  if (c.req.query('mine')) { where.push('submitted_by = ?'); args.push(userId); }
  const sql = `SELECT * FROM intel_reports ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY created_at DESC LIMIT 200`;
  const rows = await query<any>(db, sql, ...args);
  return c.json(rows.map((r) => ({
    ...redact(r, sup, userId),
    grade_label: gradeLabel(r.source_reliability, r.info_credibility),
    confidence: confidenceScore(r.source_reliability, r.info_credibility),
  })));
});

// GET /api/intel/reports/:id
intelReports.get('/:id', operational, async (c) => {
  const db = getDb(c.env);
  const userId = (c.get('userId') as number | undefined) ?? null;
  const sup = isSup(c);
  const id = Number(c.req.param('id'));
  const r = await queryFirst<any>(db, 'SELECT * FROM intel_reports WHERE id = ?', id);
  if (!r) return c.json({ error: 'not found' }, 404);
  if (!sup && r.status !== 'disseminated' && r.submitted_by !== userId)
    return c.json({ error: 'forbidden' }, 403);
  const links = await query<any>(db,
    'SELECT * FROM intel_report_links WHERE report_id = ? ORDER BY id', id);
  const dissem = sup
    ? await query<any>(db, 'SELECT * FROM intel_dissemination_log WHERE report_id = ? ORDER BY id DESC', id)
    : [];
  return c.json({
    ...redact(r, sup, userId),
    grade_label: gradeLabel(r.source_reliability, r.info_credibility),
    confidence: confidenceScore(r.source_reliability, r.info_credibility),
    links, dissemination: dissem,
  });
});

async function audit(c: any, userId: number | null, action: string, id: number, details: unknown, entityType = 'intel_report') {
  await recordAudit(c, { action, entityType, entityId: String(id), details: JSON.stringify(details), actorId: userId });
}

async function loadReport(db: any, id: number): Promise<IntelReport | null> {
  return await queryFirst<IntelReport>(db, 'SELECT * FROM intel_reports WHERE id = ?', id);
}

// POST /:id/evaluate { source_reliability, info_credibility, handling_code }
intelReports.post('/:id/evaluate', supervisorPlus, async (c) => {
  const db = getDb(c.env); const userId = (c.get('userId') as number | undefined) ?? null;
  const id = Number(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  const r = await loadReport(db, id);
  if (!r) return c.json({ error: 'not found' }, 404);
  const RELIABILITY_CODES = ['A', 'B', 'C', 'D', 'E', 'F'];
  const HANDLING_CODES = ['H1', 'H2', 'H3', 'H4', 'H5'];
  if (!RELIABILITY_CODES.includes(String(b.source_reliability)))
    return c.json({ error: 'source_reliability must be A–F' }, 400);
  if (!(Number(b.info_credibility) >= 1 && Number(b.info_credibility) <= 6))
    return c.json({ error: 'info_credibility must be 1–6' }, 400);
  if (!HANDLING_CODES.includes(String(b.handling_code)))
    return c.json({ error: 'handling_code must be H1–H5' }, 400);
  const merged = { ...r, source_reliability: b.source_reliability, info_credibility: b.info_credibility, handling_code: b.handling_code } as IntelReport;
  const gate = canTransition(merged, 'graded', String((c.get('user') as { role?: string })?.role || ''));
  if (!gate.ok) return c.json({ error: gate.reason }, 422);
  await execute(db,
    `UPDATE intel_reports SET source_reliability=?, info_credibility=?, handling_code=?,
       status='graded', evaluated_by=?, evaluated_at=datetime('now'), updated_at=datetime('now') WHERE id=?`,
    b.source_reliability, b.info_credibility, b.handling_code, userId, id);
  await audit(c, userId,'evaluate', id, { grade: `${b.source_reliability}${b.info_credibility}`, handling_code: b.handling_code });
  return c.json({ success: true });
});

// POST /:id/analyze { sanitized_narrative, assessment, criminal_predicate, threat_level? }
intelReports.post('/:id/analyze', supervisorPlus, async (c) => {
  const db = getDb(c.env); const userId = (c.get('userId') as number | undefined) ?? null;
  const id = Number(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  const r = await loadReport(db, id);
  if (!r) return c.json({ error: 'not found' }, 404);
  const merged = { ...r, sanitized_narrative: b.sanitized_narrative, assessment: b.assessment, criminal_predicate: b.criminal_predicate } as IntelReport;
  const gate = canTransition(merged, 'analyzed', String((c.get('user') as { role?: string })?.role || ''));
  if (!gate.ok) return c.json({ error: gate.reason }, 422);
  await execute(db,
    `UPDATE intel_reports SET sanitized_narrative=?, assessment=?, criminal_predicate=?,
       threat_level=COALESCE(?, threat_level), status='analyzed',
       analyzed_by=?, analyzed_at=datetime('now'), updated_at=datetime('now') WHERE id=?`,
    b.sanitized_narrative, b.assessment, b.criminal_predicate, b.threat_level || null, userId, id);
  await audit(c, userId,'analyze', id, { threat_level: b.threat_level });
  return c.json({ success: true });
});

// POST /:id/disseminate { recipient_user_ids?: number[] }
intelReports.post('/:id/disseminate', supervisorPlus, async (c) => {
  const db = getDb(c.env); const userId = (c.get('userId') as number | undefined) ?? null;
  const id = Number(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  const r = await loadReport(db, id);
  if (!r) return c.json({ error: 'not found' }, 404);
  const gate = canTransition(r, 'disseminated', String((c.get('user') as { role?: string })?.role || ''));
  if (!gate.ok) return c.json({ error: gate.reason }, 422);
  const reviewDate = computeReviewDate(new Date().toISOString(), r.handling_code || 'H1');
  await execute(db,
    `UPDATE intel_reports SET status='disseminated', disseminated_by=?, disseminated_at=datetime('now'),
       review_date=?, retention_status='active', updated_at=datetime('now') WHERE id=?`,
    userId, reviewDate, id);
  // Inbox: notify chosen recipients (or all supervisors+ by default).
  const recipients: number[] = Array.isArray(b.recipient_user_ids) && b.recipient_user_ids.length
    ? b.recipient_user_ids
    : (await query<any>(db, "SELECT id FROM users WHERE role IN ('admin','manager','supervisor') AND status='active'")).map((u) => u.id);
  const priority = r.threat_level === 'critical' || r.threat_level === 'high' ? 'high' : 'normal';
  for (const rid of recipients) {
    try {
      await execute(db,
        `INSERT INTO notifications (user_id, type, priority, title, message, entity_type, entity_id, created_at)
         VALUES (?, 'intel_product', ?, ?, ?, 'intel_report', ?, datetime('now'))`,
        rid, priority, `INTEL: ${r.title}`, r.sanitized_narrative || '', id);
      await execute(db,
        `INSERT INTO intel_dissemination_log (report_id, recipient_type, recipient_id, channel, disseminated_by)
         VALUES (?, 'user', ?, 'inbox', ?)`, id, rid, userId);
    } catch (e: any) { console.error('[intel-dev] notify failed:', e?.message); }
  }
  // Index the SANITIZED product into FTS so it appears in federated search.
  try {
    await execute(db,
      `INSERT INTO intel_index (entity_type, entity_id, label, body, identifiers)
       VALUES ('intel_report', ?, ?, ?, ?)`,
      id, `${r.report_number} ${r.title}`, r.sanitized_narrative || '', r.report_number || '');
  } catch (e: any) { console.error('[intel-dev] fts index failed:', e?.message); }
  await audit(c, userId,'disseminate', id, { recipients: recipients.length, review_date: reviewDate });
  return c.json({ success: true, recipients: recipients.length, review_date: reviewDate });
});

// POST /:id/recall { reason }
intelReports.post('/:id/recall', supervisorPlus, async (c) => {
  const db = getDb(c.env); const userId = (c.get('userId') as number | undefined) ?? null;
  const id = Number(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  const r = await loadReport(db, id);
  if (!r) return c.json({ error: 'not found' }, 404);
  const merged = { ...r, recalled_reason: b.reason } as IntelReport;
  const gate = canTransition(merged, 'recalled', String((c.get('user') as { role?: string })?.role || ''));
  if (!gate.ok) return c.json({ error: gate.reason }, 422);
  await execute(db,
    `UPDATE intel_reports SET status='recalled', recalled_reason=?, updated_at=datetime('now') WHERE id=?`,
    b.reason, id);
  try { await execute(db, "DELETE FROM intel_index WHERE entity_type='intel_report' AND entity_id=?", id); } catch { /* fts optional */ }
  await audit(c, userId,'recall', id, { reason: b.reason });
  return c.json({ success: true });
});

// POST /:id/reject { reason }
intelReports.post('/:id/reject', supervisorPlus, async (c) => {
  const db = getDb(c.env); const userId = (c.get('userId') as number | undefined) ?? null;
  const id = Number(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  const r = await loadReport(db, id);
  if (!r) return c.json({ error: 'not found' }, 404);
  const merged = { ...r, rejected_reason: b.reason } as IntelReport;
  const gate = canTransition(merged, 'rejected', String((c.get('user') as { role?: string })?.role || ''));
  if (!gate.ok) return c.json({ error: gate.reason }, 422);
  await execute(db,
    `UPDATE intel_reports SET status='rejected', rejected_reason=?, updated_at=datetime('now') WHERE id=?`,
    b.reason, id);
  await audit(c, userId,'reject', id, { reason: b.reason });
  return c.json({ success: true });
});

// POST /:id/links { entity_type, entity_id, role }
intelReports.post('/:id/links', supervisorPlus, async (c) => {
  const db = getDb(c.env); const userId = (c.get('userId') as number | undefined) ?? null;
  const id = Number(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  if (!b.entity_type || !b.entity_id) return c.json({ error: 'entity_type + entity_id required' }, 400);
  await execute(db,
    `INSERT OR IGNORE INTO intel_report_links (report_id, entity_type, entity_id, role, added_by)
     VALUES (?, ?, ?, ?, ?)`,
    id, b.entity_type, Number(b.entity_id), b.role || 'mentioned', userId);
  return c.json({ success: true });
});

// DELETE /:id/links/:linkId
intelReports.delete('/:id/links/:linkId', supervisorPlus, async (c) => {
  const db = getDb(c.env);
  const r = await execute(db, 'DELETE FROM intel_report_links WHERE id = ? AND report_id = ?',
    Number(c.req.param('linkId')), Number(c.req.param('id')));
  return r.meta?.changes ? c.json({ success: true }) : c.json({ error: 'not found' }, 404);
});

// POST /:id/share { recipient_label, reason, recipient_type } — external/client share
intelReports.post('/:id/share', supervisorPlus, async (c) => {
  const db = getDb(c.env); const userId = (c.get('userId') as number | undefined) ?? null;
  const id = Number(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  const r = await loadReport(db, id);
  if (!r) return c.json({ error: 'not found' }, 404);
  if (r.status !== 'disseminated') return c.json({ error: 'only disseminated products can be shared' }, 422);
  if (!['H2', 'H3', 'H4'].includes(String(r.handling_code)))
    return c.json({ error: `handling code ${r.handling_code} does not permit external sharing` }, 422);
  if (!b.recipient_label) return c.json({ error: 'recipient_label required' }, 400);
  await execute(db,
    `INSERT INTO intel_dissemination_log (report_id, recipient_type, recipient_label, channel, reason, disseminated_by)
     VALUES (?, ?, ?, 'external_export', ?, ?)`,
    id, b.recipient_type || 'agency', b.recipient_label, b.reason || null, userId);
  await audit(c, userId,'share_external', id, { recipient: b.recipient_label, handling_code: r.handling_code });
  return c.json({ success: true });
});

export const intelSources = new Hono<Env>();

const sourceVisible = (s: any, sup: boolean) =>
  (sup || !s.restricted) ? s : { ...s, true_identity_person_id: null, notes_restricted: null, _restricted: true };

// GET /api/intel/sources
intelSources.get('/', operational, async (c) => {
  const db = getDb(c.env);
  const rows = await query<any>(db, 'SELECT * FROM intel_sources ORDER BY created_at DESC LIMIT 200');
  return c.json(rows.map((s) => sourceVisible(s, isSup(c))));
});

// POST /api/intel/sources
intelSources.post('/', supervisorPlus, async (c) => {
  const db = getDb(c.env); const userId = (c.get('userId') as number | undefined) ?? null;
  const b = await c.req.json().catch(() => ({}));
  if (!b.source_type) return c.json({ error: 'source_type required' }, 400);
  const year = new Date().getUTCFullYear();
  const cnt = await queryFirst<{ n: number }>(db,
    'SELECT COUNT(*) AS n FROM intel_sources WHERE source_code LIKE ?', `SRC-${year}-%`);
  const source_code = `SRC-${year}-${String((cnt?.n || 0) + 1).padStart(3, '0')}`;
  const res = await execute(db,
    `INSERT INTO intel_sources
       (source_code, source_type, display_label, true_identity_person_id, handler_user_id,
        reliability_grade, status, restricted, notes_restricted, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    source_code, b.source_type, b.display_label || null, b.true_identity_person_id || null,
    b.handler_user_id || null, b.reliability_grade || null,
    b.restricted === false ? 0 : 1, b.notes_restricted || null, userId);
  await audit(c, userId,'source_create', Number(res.meta?.last_row_id) || 0, { source_code, source_type: b.source_type, restricted: b.restricted === false ? 0 : 1 }, 'intel_source');
  return c.json({ success: true, id: res.meta?.last_row_id, source_code });
});

// GET /api/intel/sources/:id
intelSources.get('/:id', operational, async (c) => {
  const db = getDb(c.env);
  const s = await queryFirst<any>(db, 'SELECT * FROM intel_sources WHERE id = ?', Number(c.req.param('id')));
  if (!s) return c.json({ error: 'not found' }, 404);
  return c.json(sourceVisible(s, isSup(c)));
});

// PUT /api/intel/sources/:id
intelSources.put('/:id', supervisorPlus, async (c) => {
  const db = getDb(c.env);
  const userId = (c.get('userId') as number | undefined) ?? null;
  const id = Number(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  const allowed = ['display_label', 'handler_user_id', 'status', 'restricted', 'notes_restricted', 'reliability_grade'];
  const sets: string[] = []; const args: unknown[] = [];
  for (const k of allowed) if (k in b) { sets.push(`${k} = ?`); args.push(b[k]); }
  if (!sets.length) return c.json({ error: 'no editable fields' }, 400);
  sets.push("updated_at = datetime('now')");
  args.push(id);
  await execute(db, `UPDATE intel_sources SET ${sets.join(', ')} WHERE id = ?`, ...args);
  await audit(c, userId,'source_update', id, { fields: Object.keys(b), restricted_changed: 'restricted' in b, status_changed: 'status' in b }, 'intel_source');
  return c.json({ success: true });
});

// POST /api/intel/sources/:id/reliability { new_grade, reason }
intelSources.post('/:id/reliability', supervisorPlus, async (c) => {
  const db = getDb(c.env); const userId = (c.get('userId') as number | undefined) ?? null;
  const id = Number(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  const s = await queryFirst<any>(db, 'SELECT reliability_grade FROM intel_sources WHERE id = ?', id);
  if (!s) return c.json({ error: 'not found' }, 404);
  await execute(db,
    `INSERT INTO intel_source_reliability_log (source_id, old_grade, new_grade, reason, changed_by)
     VALUES (?, ?, ?, ?, ?)`, id, s.reliability_grade || null, b.new_grade, b.reason || null, userId);
  await execute(db,
    "UPDATE intel_sources SET reliability_grade = ?, updated_at = datetime('now') WHERE id = ?", b.new_grade, id);
  await audit(c, userId,'source_reliability', id, { new_grade: b.new_grade }, 'intel_source');
  return c.json({ success: true });
});
