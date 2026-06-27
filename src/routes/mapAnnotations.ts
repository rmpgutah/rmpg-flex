import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.get('/', async (c) => {
  const bbox = c.req.query('bbox');
  let sql = 'SELECT a.*, u.full_name as creator_name FROM map_annotations a LEFT JOIN users u ON a.created_by = u.id WHERE a.is_active = 1';
  const params: (string | number)[] = [];

  if (bbox) {
    const [w, s, e, n] = bbox.split(',').map(Number);
    if (w && s && e && n) {
      sql += ' AND a.lng BETWEEN ? AND ? AND a.lat BETWEEN ? AND ?';
      params.push(w, e, s, n);
    }
  }
  sql += ' ORDER BY a.created_at DESC';

  const rows = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json(rows.results);
});

app.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{
    title: string;
    body?: string;
    color?: string;
    icon?: string;
    lat: number;
    lng: number;
    call_id?: number;
    expires_at?: string;
  }>();

  if (!body.title || body.lat === undefined || body.lng === undefined) {
    return c.json({ error: 'title, lat, and lng are required' }, 400);
  }
  if (Math.abs(body.lat) > 90 || Math.abs(body.lng) > 180) {
    return c.json({ error: 'invalid_coordinates' }, 400);
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO map_annotations (title, body, color, icon, lat, lng, created_by, call_id, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    body.title,
    body.body ?? null,
    body.color ?? '#d4a017',
    body.icon ?? 'pin',
    body.lat,
    body.lng,
    user.id,
    body.call_id ?? null,
    body.expires_at ?? null
  ).run();

  return c.json({ success: true, id: result.meta.last_row_id }, 201);
});

app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{
    title?: string; body?: string; color?: string; icon?: string; expires_at?: string;
  }>();

  await c.env.DB.prepare(
    `UPDATE map_annotations
     SET title      = COALESCE(?, title),
         body       = COALESCE(?, body),
         color      = COALESCE(?, color),
         icon       = COALESCE(?, icon),
         expires_at = COALESCE(?, expires_at),
         updated_at = datetime('now')
     WHERE id = ?`
  ).bind(
    body.title ?? null, body.body ?? null, body.color ?? null,
    body.icon ?? null, body.expires_at ?? null, id
  ).run();

  return c.json({ success: true });
});

app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  await c.env.DB.prepare(
    `UPDATE map_annotations SET is_active = 0, updated_at = datetime('now') WHERE id = ?`
  ).bind(id).run();
  return c.json({ success: true });
});

export default app;
