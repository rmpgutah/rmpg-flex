// ============================================================
// RMPG Flex — Training Management (enhanced)
// ============================================================
// Spillman Flex Training parity: courses, enrollments,
// certification types, officer certs, firearms quals.
// Migration: 0047_spillman_modules.sql
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

import { log } from '../utils/logger';
const training = new Hono<Env>();

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

// ═══════════════════════════════════════════════════════════════
// COURSES
// ═══════════════════════════════════════════════════════════════

training.get('/courses', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query.bind(c.req);
    const conditions: string[] = ['1=1']; const params: unknown[] = [];
    if (q('category')) { conditions.push('category = ?'); params.push(q('category')); }
    if (q('is_active')) { conditions.push('is_active = ?'); params.push(q('is_active')); }
    if (q('is_mandatory')) { conditions.push('is_mandatory = ?'); params.push(q('is_mandatory')); }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const rows = await query<Record<string, unknown>>(db,
      `SELECT c.*, u.full_name as instructor_name FROM training_courses c LEFT JOIN users u ON c.instructor_id = u.id ${where} ORDER BY c.created_at DESC`, ...params);
    return c.json({ data: rows });
  } catch (err) {
    log.error('GET /courses failed', { src: 'src/routes/training.ts' }, err);
    return c.json({ error: 'Failed to list courses' }, 500);
  }
});

training.post('/courses', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, unknown>>();
    if (typeof b.course_name !== 'string' || !b.course_name.trim()) return c.json({ error: 'course_name required' }, 400);
    const result = await execute(db,
      `INSERT INTO training_courses (course_name, course_code, description, category, duration_hours, instructor_id, location, max_seats, is_mandatory, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      b.course_name, b.course_code ?? null, b.description ?? null, b.category ?? 'other',
      b.duration_hours ?? null, b.instructor_id ?? null, b.location ?? null, b.max_seats ?? null,
      b.is_mandatory ?? 0, b.is_active ?? 1,
    );
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM training_courses WHERE id = ?', newId);
    return c.json({ data: created }, 201);
  } catch (err) {
    log.error('POST /courses failed', { src: 'src/routes/training.ts' }, err);
    return c.json({ error: 'Failed to create course' }, 500);
  }
});

training.put('/courses/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const b = await c.req.json<Record<string, unknown>>();
    const updatable = new Set(['course_name','course_code','description','category','duration_hours','instructor_id','location','max_seats','is_mandatory','is_active']);
    const sets: string[] = []; const vals: unknown[] = [];
    for (const [k, v] of Object.entries(b)) { if (updatable.has(k)) { sets.push(`${k} = ?`); vals.push(v ?? null); } }
    if (sets.length === 0) return c.json({ error: 'No fields' }, 400);
    vals.push(id);
    await execute(db, `UPDATE training_courses SET ${sets.join(', ')} WHERE id = ?`, ...vals);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM training_courses WHERE id = ?', id);
    return c.json({ data: updated });
  } catch (err) {
    log.error('PUT /courses/:id failed', { src: 'src/routes/training.ts' }, err);
    return c.json({ error: 'Failed to update course' }, 500);
  }
});

training.delete('/courses/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
    const result = await execute(db, 'DELETE FROM training_courses WHERE id = ?', id);
    if (result.meta.changes === 0) return c.json({ error: 'Course not found', code: 'NOT_FOUND' }, 404);
    return c.json({ success: true });
  } catch (err) {
    log.error('DELETE /courses/:id failed', { src: 'src/routes/training.ts' }, err);
    return c.json({ error: 'Failed to delete course', code: 'DELETE_ERROR' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// ENROLLMENTS
// ═══════════════════════════════════════════════════════════════

training.get('/enrollments', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query.bind(c.req);
    const conditions: string[] = ['1=1']; const params: unknown[] = [];
    if (q('course_id')) { conditions.push('e.course_id = ?'); params.push(q('course_id')); }
    if (q('officer_id')) { conditions.push('e.officer_id = ?'); params.push(q('officer_id')); }
    if (q('status')) { conditions.push('e.status = ?'); params.push(q('status')); }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const rows = await query<Record<string, unknown>>(db,
      `SELECT e.*, c.course_name, u.full_name as officer_name
       FROM training_enrollments e
       LEFT JOIN training_courses c ON e.course_id = c.id
       LEFT JOIN users u ON e.officer_id = u.id
       ${where} ORDER BY e.created_at DESC`, ...params);
    return c.json({ data: rows });
  } catch (err) {
    log.error('GET /enrollments failed', { src: 'src/routes/training.ts' }, err);
    return c.json({ error: 'Failed to list enrollments' }, 500);
  }
});

training.post('/enrollments', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, unknown>>();
    if (!b.course_id) return c.json({ error: 'course_id required' }, 400);
    if (!b.officer_id) return c.json({ error: 'officer_id required' }, 400);
    const result = await execute(db,
      `INSERT INTO training_enrollments (course_id, officer_id, status, score, completed_date, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      b.course_id, b.officer_id, b.status ?? 'enrolled', b.score ?? null, b.completed_date ?? null, b.notes ?? null,
    );
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db,
      'SELECT e.*, c.course_name FROM training_enrollments e LEFT JOIN training_courses c ON e.course_id = c.id WHERE e.id = ?', newId);
    return c.json({ data: created }, 201);
  } catch (err) {
    log.error('POST /enrollments failed', { src: 'src/routes/training.ts' }, err);
    return c.json({ error: 'Failed to create enrollment' }, 500);
  }
});

training.put('/enrollments/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const b = await c.req.json<Record<string, unknown>>();
    const updatable = new Set(['status','score','completed_date','notes']);
    const sets: string[] = []; const vals: unknown[] = [];
    for (const [k, v] of Object.entries(b)) { if (updatable.has(k)) { sets.push(`${k} = ?`); vals.push(v ?? null); } }
    if (sets.length === 0) return c.json({ error: 'No fields' }, 400);
    vals.push(id);
    await execute(db, `UPDATE training_enrollments SET ${sets.join(', ')} WHERE id = ?`, ...vals);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM training_enrollments WHERE id = ?', id);
    return c.json({ data: updated });
  } catch (err) {
    log.error('PUT /enrollments/:id failed', { src: 'src/routes/training.ts' }, err);
    return c.json({ error: 'Failed to update enrollment' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// CERTIFICATION TYPES
// ═══════════════════════════════════════════════════════════════

training.get('/cert-types', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, 'SELECT * FROM certification_types WHERE is_active = 1 ORDER BY cert_name');
    return c.json({ data: rows });
  } catch (err) {
    log.error('GET /cert-types failed', { src: 'src/routes/training.ts' }, err);
    return c.json({ error: 'Failed to list cert types' }, 500);
  }
});

training.post('/cert-types', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, unknown>>();
    if (typeof b.cert_name !== 'string' || !b.cert_name.trim()) return c.json({ error: 'cert_name required' }, 400);
    const result = await execute(db,
      `INSERT INTO certification_types (cert_name, issuing_body, description, renewal_period_months) VALUES (?, ?, ?, ?)`,
      b.cert_name, b.issuing_body ?? null, b.description ?? null, b.renewal_period_months ?? null);
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM certification_types WHERE id = ?', newId);
    return c.json({ data: created }, 201);
  } catch (err) {
    log.error('POST /cert-types failed', { src: 'src/routes/training.ts' }, err);
    return c.json({ error: 'Failed to create cert type' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// OFFICER CERTIFICATIONS
// ═══════════════════════════════════════════════════════════════

training.get('/certs', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query.bind(c.req);
    const conditions: string[] = ['1=1']; const params: unknown[] = [];
    if (q('officer_id')) { conditions.push('oc.officer_id = ?'); params.push(q('officer_id')); }
    if (q('status')) { conditions.push('oc.status = ?'); params.push(q('status')); }
    if (q('expiring') === 'true') { conditions.push("oc.expiration_date >= date('now') AND oc.expiration_date <= date('now','+60 days')"); }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const rows = await query<Record<string, unknown>>(db,
      `SELECT oc.*, ct.cert_name, u.full_name as officer_name
       FROM officer_certifications oc
       LEFT JOIN certification_types ct ON oc.cert_type_id = ct.id
       LEFT JOIN users u ON oc.officer_id = u.id
       ${where} ORDER BY oc.expiration_date ASC`, ...params);
    return c.json({ data: rows });
  } catch (err) {
    log.error('GET /certs failed', { src: 'src/routes/training.ts' }, err);
    return c.json({ error: 'Failed to list certifications' }, 500);
  }
});

training.post('/certs', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, unknown>>();
    if (!b.officer_id) return c.json({ error: 'officer_id required' }, 400);
    if (!b.cert_type_id) return c.json({ error: 'cert_type_id required' }, 400);
    const result = await execute(db,
      `INSERT INTO officer_certifications (officer_id, cert_type_id, cert_number, issued_date, expiration_date, status, document_url, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      b.officer_id, b.cert_type_id, b.cert_number ?? null, b.issued_date ?? null, b.expiration_date ?? null,
      b.status ?? 'active', b.document_url ?? null, b.notes ?? null);
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db,
      'SELECT oc.*, ct.cert_name FROM officer_certifications oc LEFT JOIN certification_types ct ON oc.cert_type_id = ct.id WHERE oc.id = ?', newId);
    return c.json({ data: created }, 201);
  } catch (err) {
    log.error('POST /certs failed', { src: 'src/routes/training.ts' }, err);
    return c.json({ error: 'Failed to record certification' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// FIREARMS QUALIFICATIONS
// ═══════════════════════════════════════════════════════════════

training.get('/firearms', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query.bind(c.req);
    const conditions: string[] = ['1=1']; const params: unknown[] = [];
    if (q('officer_id')) { conditions.push('fq.officer_id = ?'); params.push(q('officer_id')); }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const rows = await query<Record<string, unknown>>(db,
      `SELECT fq.*, u.full_name as officer_name, ro.full_name as range_officer_name
       FROM firearms_qualifications fq
       LEFT JOIN users u ON fq.officer_id = u.id
       LEFT JOIN users ro ON fq.range_officer_id = ro.id
       ${where} ORDER BY fq.qualification_date DESC`, ...params);
    return c.json({ data: rows });
  } catch (err) {
    log.error('GET /firearms failed', { src: 'src/routes/training.ts' }, err);
    return c.json({ error: 'Failed to list firearm quals' }, 500);
  }
});

training.post('/firearms', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, unknown>>();
    if (!b.officer_id) return c.json({ error: 'officer_id required' }, 400);
    if (!b.qualification_date) return c.json({ error: 'qualification_date required' }, 400);
    const result = await execute(db,
      `INSERT INTO firearms_qualifications (officer_id, weapon_type, course_name, qualification_date, score, max_score, pass_fail, range_officer_id, ammo_used, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      b.officer_id, b.weapon_type ?? null, b.course_name ?? null, b.qualification_date,
      b.score ?? null, b.max_score ?? 100, b.pass_fail ?? null, b.range_officer_id ?? null, b.ammo_used ?? null, b.notes ?? null);
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM firearms_qualifications WHERE id = ?', newId);
    return c.json({ data: created }, 201);
  } catch (err) {
    log.error('POST /firearms failed', { src: 'src/routes/training.ts' }, err);
    return c.json({ error: 'Failed to record qualification' }, 500);
  }
});

training.get('/stats', async (c) => {
  try {
    const db = getDb(c.env);
    const courses = (await queryFirst<{ count: number }>(db, 'SELECT COUNT(*) as count FROM training_courses'))?.count ?? 0;
    const enrollments = (await queryFirst<{ count: number }>(db, 'SELECT COUNT(*) as count FROM training_enrollments'))?.count ?? 0;
    const activeCerts = (await queryFirst<{ count: number }>(db, "SELECT COUNT(*) as count FROM officer_certifications WHERE status = 'active'"))?.count ?? 0;
    const expiringCerts = (await queryFirst<{ count: number }>(db, "SELECT COUNT(*) as count FROM officer_certifications WHERE expiration_date >= date('now') AND expiration_date <= date('now','+30 days')"))?.count ?? 0;
    return c.json({ courses, enrollments, active_certs: activeCerts, expiring_certs: expiringCerts });
  } catch (err) {
    log.error('GET /stats failed', { src: 'src/routes/training.ts' }, err);
    return c.json({ courses: 0, enrollments: 0, active_certs: 0, expiring_certs: 0 });
  }
});

export default training;
