// ============================================================
// Howen dashcam integration — devices + recent events
// ============================================================
// Live D1 tables (confirmed 2026-05-27):
//   howen_devices (id, device_id, imei, iccid, label, unit_id, vehicle_id,
//                  plate_number, is_active, last_connection_at,
//                  created_at, updated_at)
//   howen_events  (id, device_id, event_type, severity, event_at, created_at)
//
// DashcamPage expects:
//   GET /howen/status              → device-health rollup
//   GET /howen/devices?page&limit  → { devices, total, page }
//   GET /howen/devices/:id         → single device with join
//   GET /howen/events?limit        → { events }
//
// Writes (provisioning, polling triggers) are NOT implemented here —
// device onboarding still flows through the legacy poller. This file
// covers only the read paths that the prod console log showed 500ing.

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst } from '../utils/db';

const howen = new Hono<Env>();

// GET /api/howen/status — device-fleet rollup tile.
howen.get('/status', async (c) => {
  try {
    const db = getDb(c.env);
    const counts = await queryFirst<Record<string, number>>(db, `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN last_connection_at IS NOT NULL
                  AND datetime(last_connection_at) >= datetime('now', '-15 minutes')
                 THEN 1 ELSE 0 END) AS online
      FROM howen_devices
    `);
    return c.json({
      total_devices: counts?.total ?? 0,
      active_devices: counts?.active ?? 0,
      online_devices: counts?.online ?? 0,
      // Legacy field aliases — DashcamPage's status panel reads either.
      total: counts?.total ?? 0,
      online: counts?.online ?? 0,
    });
  } catch (err) {
    return c.json({ total_devices: 0, active_devices: 0, online_devices: 0 }, 200);
  }
});

// GET /api/howen/devices?page=1&limit=50&search=...
// Response shape mirrors what DashcamPage's fetchDevices reads:
// `{ devices, total, page }`.
howen.get('/devices', async (c) => {
  try {
    const db = getDb(c.env);
    const { page: pageParam, limit: limitParam, search } = c.req.query();
    const page = Math.max(1, parseInt(pageParam || '1', 10));
    const limit = Math.min(200, Math.max(1, parseInt(limitParam || '50', 10)));
    const offset = (page - 1) * limit;

    // Always qualify with `d.` because the SELECT joins fleet_vehicles
    // which also has a `plate_number` column (ambiguity would error).
    let where = 'WHERE 1=1';
    const params: unknown[] = [];
    if (search?.trim()) {
      where += ' AND (d.label LIKE ? OR d.imei LIKE ? OR d.plate_number LIKE ? OR d.device_id LIKE ?)';
      const s = `%${search.trim()}%`;
      params.push(s, s, s, s);
    }

    const [{ total }] = await query<{ total: number }>(db, `
      SELECT COUNT(*) AS total FROM howen_devices d ${where}
    `, ...params);

    const devices = await query<Record<string, unknown>>(db, `
      SELECT
        d.*,
        u.call_sign AS unit_call_sign,
        fv.vehicle_number AS vehicle_number_display
      FROM howen_devices d
      LEFT JOIN units u ON u.id = d.unit_id
      LEFT JOIN fleet_vehicles fv ON fv.id = d.vehicle_id
      ${where}
      ORDER BY d.last_connection_at DESC NULLS LAST, d.id DESC
      LIMIT ? OFFSET ?
    `, ...params, limit, offset);

    return c.json({ devices, total, page });
  } catch (err) {
    console.error('GET /howen/devices error:', err);
    return c.json({ devices: [], total: 0, page: 1 }, 200);
  }
});

// GET /api/howen/devices/:id — single device + last-known assignment.
howen.get('/devices/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const device = await queryFirst<Record<string, unknown>>(db, `
      SELECT
        d.*,
        u.call_sign AS unit_call_sign,
        fv.vehicle_number AS vehicle_number_display,
        fv.make AS vehicle_make,
        fv.model AS vehicle_model
      FROM howen_devices d
      LEFT JOIN units u ON u.id = d.unit_id
      LEFT JOIN fleet_vehicles fv ON fv.id = d.vehicle_id
      WHERE d.id = ?
    `, id);
    if (!device) return c.json({ error: 'Device not found' }, 404);
    return c.json(device);
  } catch (err) {
    return c.json({ error: 'Failed to get device' }, 500);
  }
});

// GET /api/howen/events?limit=20 — recent device events.
// DashcamPage reads `{ events }`.
howen.get('/events', async (c) => {
  try {
    const db = getDb(c.env);
    const { limit: limitParam, device_id, severity } = c.req.query();
    const limit = Math.min(200, Math.max(1, parseInt(limitParam || '50', 10)));

    let where = 'WHERE 1=1';
    const params: unknown[] = [];
    if (device_id) { where += ' AND e.device_id = ?'; params.push(device_id); }
    if (severity) { where += ' AND e.severity = ?'; params.push(severity); }

    const events = await query<Record<string, unknown>>(db, `
      SELECT
        e.*,
        d.label AS device_label,
        d.plate_number,
        d.imei
      FROM howen_events e
      LEFT JOIN howen_devices d ON d.id = e.device_id OR d.device_id = e.device_id
      ${where}
      ORDER BY COALESCE(e.event_at, e.created_at) DESC, e.id DESC LIMIT ?
    `, ...params, limit);

    return c.json({ events });
  } catch (err) {
    console.error('GET /howen/events error:', err);
    return c.json({ events: [] }, 200);
  }
});

export default howen;
