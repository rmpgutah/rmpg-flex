import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.get('/', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT * FROM geofence_zones WHERE is_active = 1 ORDER BY created_at DESC LIMIT 500'
  ).all();
  return c.json(rows.results);
});

app.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{
    zone_name: string;
    zone_type?: string;
    geojson_data: string;
    color?: string;
    description?: string;
  }>();

  if (!body.zone_name || !body.geojson_data) {
    return c.json({ error: 'zone_name and geojson_data are required' }, 400);
  }
  try {
    JSON.parse(body.geojson_data);
  } catch {
    return c.json({ error: 'invalid_geojson' }, 400);
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO geofence_zones (zone_name, zone_type, geojson_data, color, description, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    body.zone_name,
    body.zone_type ?? 'alert',
    body.geojson_data,
    body.color ?? '#d9bd72',
    body.description ?? null,
    user.id
  ).run();

  return c.json({ success: true, id: result.meta.last_row_id }, 201);
});

app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{
    zone_name?: string;
    zone_type?: string;
    geojson_data?: string;
    color?: string;
    description?: string;
  }>();

  await c.env.DB.prepare(
    `UPDATE geofence_zones
     SET zone_name    = COALESCE(?, zone_name),
         zone_type    = COALESCE(?, zone_type),
         geojson_data = COALESCE(?, geojson_data),
         color        = COALESCE(?, color),
         description  = COALESCE(?, description),
         updated_at   = datetime('now')
     WHERE id = ?`
  ).bind(
    body.zone_name ?? null,
    body.zone_type ?? null,
    body.geojson_data ?? null,
    body.color ?? null,
    body.description ?? null,
    id
  ).run();

  return c.json({ success: true });
});

app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  await c.env.DB.prepare(
    `UPDATE geofence_zones SET is_active = 0, updated_at = datetime('now') WHERE id = ?`
  ).bind(id).run();
  return c.json({ success: true });
});

export default app;
