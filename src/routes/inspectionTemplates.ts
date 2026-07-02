// ============================================================
// RMPG Flex — Inspection-template admin routes (Fleet.io PR 6)
// ============================================================
// Mounted at /api/inspection-templates (auth: 'required'; mutations
// gated to admin / manager).
//
// Versioning rule: once a template has been used by ANY vehicle_inspections
// row, editing it forks a NEW row with version = old + 1 and `parent_template_id`
// pointing back at the prior version. The prior version stays untouched so
// historical inspections continue to read against the schema they were
// recorded under.
//
// Routes:
//   GET    /                 — list active templates (?vehicle_type_code=...)
//   GET    /:id              — fetch a template + parsed schema
//   POST   /                 — create a new template
//   PUT    /:id              — update; forks a new version if in-use
//   POST   /:id/deactivate   — mark inactive (active = 0); leaves the row in place
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { dbErrorResponse } from '../utils/dbErrors';
import {
  parseTemplateSchema,
  InvalidTemplateError,
  type InspectionTemplateSchema,
} from '../utils/inspectionTemplates';

const tmpl = new Hono<Env>();

const ADMIN_ROLES = ['admin', 'manager'] as const;

// ─── GET / — list ─────────────────────────────────────────

tmpl.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const vehicleTypeCode = c.req.query('vehicle_type_code');
    const includeInactive = c.req.query('include_inactive') === '1';
    const conds: string[] = [];
    const bindings: unknown[] = [];
    if (!includeInactive) conds.push('active = 1');
    if (vehicleTypeCode) {
      conds.push('(vehicle_type_code = ? OR vehicle_type_code IS NULL)');
      bindings.push(vehicleTypeCode);
    }
    const where = conds.length > 0 ? 'WHERE ' + conds.join(' AND ') : '';
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT id, name, description, active, version, parent_template_id,
              vehicle_type_code, created_by, created_at, updated_at
       FROM inspection_templates ${where}
       ORDER BY name, version DESC`,
      ...bindings,
    );
    return c.json({ count: rows.length, data: rows });
  } catch (err) {
    console.error('[inspectionTemplates] GET / failed', err);
    return dbErrorResponse(c, err, 'Failed', 'DB_ERROR');
  }
});

// ─── GET /:id — single template + parsed schema ───────────

tmpl.get('/:id{[0-9]+}', async (c) => {
  try {
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
    const db = getDb(c.env);
    const row = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM inspection_templates WHERE id = ?', id,
    );
    if (!row) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);
    let schema: InspectionTemplateSchema | { error: string };
    try {
      schema = parseTemplateSchema(row.schema_json);
    } catch (err) {
      schema = { error: err instanceof InvalidTemplateError ? err.message : 'Failed to parse schema' };
    }
    return c.json({ data: { ...row, schema } });
  } catch (err) {
    console.error('[inspectionTemplates] GET /:id failed', err);
    return dbErrorResponse(c, err, 'Failed', 'DB_ERROR');
  }
});

// ─── POST / — create v1 of a new template ─────────────────

tmpl.post('/', requireRole(...ADMIN_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const userId = (c.get('userId') as number | undefined) ?? null;
    const body = await c.req.json<Record<string, unknown>>();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return c.json({ error: 'name is required' }, 400);
    try {
      parseTemplateSchema(body.schema_json);
    } catch (err) {
      if (err instanceof InvalidTemplateError) {
        return c.json({ error: err.message, code: 'INVALID_SCHEMA' }, 400);
      }
      throw err;
    }
    const result = await execute(db,
      `INSERT INTO inspection_templates
         (name, description, schema_json, active, version,
          parent_template_id, vehicle_type_code, created_by)
       VALUES (?, ?, ?, 1, 1, NULL, ?, ?)`,
      name,
      typeof body.description === 'string' ? body.description : null,
      typeof body.schema_json === 'string' ? body.schema_json : JSON.stringify(body.schema_json ?? {}),
      typeof body.vehicle_type_code === 'string' ? body.vehicle_type_code : null,
      userId,
    );
    const created = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM inspection_templates WHERE id = ?', result.meta.last_row_id,
    );
    return c.json({ data: created }, 201);
  } catch (err) {
    console.error('[inspectionTemplates] POST / failed', err);
    return dbErrorResponse(c, err, 'Failed', 'DB_ERROR');
  }
});

// ─── PUT /:id — update; forks a NEW version when in-use ──

tmpl.put('/:id{[0-9]+}', requireRole(...ADMIN_ROLES), async (c) => {
  try {
    const id = parseInt(c.req.param("id") ?? "0", 10);
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
    const db = getDb(c.env);
    const userId = (c.get('userId') as number | undefined) ?? null;
    const existing = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM inspection_templates WHERE id = ?', id,
    );
    if (!existing) return c.json({ error: 'Not found' }, 404);

    // Is the template already in use? If so, fork a new version.
    const usage = await queryFirst<{ n: number }>(
      db, 'SELECT COUNT(*) AS n FROM vehicle_inspections WHERE template_id = ?', id,
    );
    const inUse = (usage?.n ?? 0) > 0;

    const body = await c.req.json<Record<string, unknown>>();
    if (body.schema_json !== undefined) {
      try { parseTemplateSchema(body.schema_json); }
      catch (err) {
        if (err instanceof InvalidTemplateError) {
          return c.json({ error: err.message, code: 'INVALID_SCHEMA' }, 400);
        }
        throw err;
      }
    }
    const newName: string = typeof body.name === 'string' ? body.name.trim() : (existing.name as string | undefined) ?? '';
    if (!newName) {
      return c.json({ error: 'name is required' }, 400);
    }
    const newDescription: string | null = typeof body.description === 'string' ? body.description : (existing.description as string | null | undefined) ?? null;
    const newSchemaJson: string = body.schema_json !== undefined
      ? (typeof body.schema_json === 'string' ? body.schema_json : JSON.stringify(body.schema_json))
      : (existing.schema_json as string | undefined) ?? '{}';
    const newVehicleType: string | null = typeof body.vehicle_type_code === 'string' ? body.vehicle_type_code : (existing.vehicle_type_code as string | null | undefined) ?? null;

    if (inUse) {
      // Fork — insert a new row pointing back at the prior version.
      const result = await execute(db,
        `INSERT INTO inspection_templates
           (name, description, schema_json, active, version, parent_template_id,
            vehicle_type_code, created_by)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
        newName, newDescription, newSchemaJson,
        Number(existing.version) + 1, id, newVehicleType, userId,
      );
      const forked = await queryFirst<Record<string, unknown>>(
        db, 'SELECT * FROM inspection_templates WHERE id = ?', result.meta.last_row_id,
      );
      return c.json({ data: forked, forked_from: id, action: 'forked_new_version' }, 201);
    }

    // Not in use — in-place update is safe.
    await execute(db,
      `UPDATE inspection_templates
         SET name = ?, description = ?, schema_json = ?, vehicle_type_code = ?,
             updated_at = datetime('now')
       WHERE id = ?`,
      newName, newDescription, newSchemaJson, newVehicleType, id,
    );
    const updated = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM inspection_templates WHERE id = ?', id,
    );
    return c.json({ data: updated, action: 'updated_in_place' });
  } catch (err) {
    console.error('[inspectionTemplates] PUT /:id failed', err);
    return dbErrorResponse(c, err, 'Failed', 'DB_ERROR');
  }
});

// ─── POST /:id/deactivate ────────────────────────────────

tmpl.post('/:id{[0-9]+}/deactivate', requireRole(...ADMIN_ROLES), async (c) => {
  try {
    const id = parseInt(c.req.param("id") ?? "0", 10);
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
    const db = getDb(c.env);
    const row = await queryFirst<{ id: number }>(db, 'SELECT id FROM inspection_templates WHERE id = ?', id);
    if (!row) return c.json({ error: 'Not found' }, 404);
    await execute(db, "UPDATE inspection_templates SET active = 0, updated_at = datetime('now') WHERE id = ?", id);
    return c.json({ success: true });
  } catch (err) {
    console.error('[inspectionTemplates] POST /:id/deactivate failed', err);
    return c.json({ error: 'Failed', code: 'DB_ERROR' }, 500);
  }
});

export default tmpl;
