import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute, ensureNavFavoritesColumns } from '../utils/db';

const navFavorites = new Hono<Env>();

interface FavoriteRow {
  id: number;
  user_id: number;
  label: string;
  lat: number;
  lng: number;
  address: string | null;
  is_staging: number | null;
  created_at: string;
}

// GET /api/nav/favorites — this user's saved destinations, newest first.
// ?staging=true restricts to favorites flagged as parking/staging spots.
navFavorites.get('/', async (c) => {
  const db = getDb(c.env);
  await ensureNavFavoritesColumns(db);
  const userId = (c.get('userId') as number | undefined) ?? null;
  const stagingOnly = c.req.query('staging') === 'true';
  const sql = stagingOnly
    ? 'SELECT * FROM nav_favorites WHERE user_id = ? AND is_staging = 1 ORDER BY created_at DESC'
    : 'SELECT * FROM nav_favorites WHERE user_id = ? ORDER BY created_at DESC';
  const rows = await query<FavoriteRow>(db, sql, userId);
  return c.json(rows);
});

// POST /api/nav/favorites — save a new favorite.
navFavorites.post('/', async (c) => {
  const db = getDb(c.env);
  await ensureNavFavoritesColumns(db);
  const userId = (c.get('userId') as number | undefined) ?? null;
  const body = await c.req.json<{ label: string; lat: number; lng: number; address?: string; is_staging?: boolean }>();
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  if (!label || typeof body.lat !== 'number' || typeof body.lng !== 'number') {
    return c.json({ error: 'label, lat, lng are required' }, 400);
  }
  if (body.lat < -90 || body.lat > 90 || body.lng < -180 || body.lng > 180) {
    return c.json({ error: 'lat must be in [-90, 90] and lng must be in [-180, 180]' }, 400);
  }
  const isStaging = body.is_staging === true ? 1 : 0;
  const result = await execute(db,
    'INSERT INTO nav_favorites (user_id, label, lat, lng, address, is_staging) VALUES (?, ?, ?, ?, ?, ?)',
    userId, label, body.lat, body.lng, body.address ?? null, isStaging);
  return c.json({ success: true, id: result.meta.last_row_id });
});

// DELETE /api/nav/favorites/:id — remove a favorite (owner only).
navFavorites.delete('/:id', async (c) => {
  const db = getDb(c.env);
  const userId = (c.get('userId') as number | undefined) ?? null;
  const id = Number(c.req.param('id'));
  if (!id || !Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
  const row = await queryFirst<{ user_id: number }>(db, 'SELECT user_id FROM nav_favorites WHERE id = ?', id);
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (row.user_id !== userId) return c.json({ error: 'Not authorized' }, 403);
  await execute(db, 'DELETE FROM nav_favorites WHERE id = ?', id);
  return c.json({ success: true });
});

export default navFavorites;
