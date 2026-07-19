import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import stubs from '../src/routes/stubs';

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { userId: number } }>();
app.use('*', async (c, next) => { c.set('userId', 42); await next(); });
app.route('/api', stubs);

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS user_preferences (
    user_id INTEGER PRIMARY KEY,
    font_scale REAL, compact_mode INTEGER, show_map_labels INTEGER,
    default_map_style TEXT, dispatch_sort TEXT, dispatch_show_cleared INTEGER,
    theme_preference TEXT,
    desktop_layout_json TEXT, desktop_wallpaper TEXT, desktop_widgets_json TEXT,
    desktop_accent TEXT, desktop_notes_json TEXT,
    updated_at TEXT
  )`);
});

describe('PUT/GET /api/preferences — desktop layout fields', () => {
  it('persists and reads back desktop_layout_json, desktop_wallpaper, desktop_widgets_json', async () => {
    const putRes = await app.request('/api/preferences', {
      method: 'PUT',
      body: JSON.stringify({
        desktop_layout_json: JSON.stringify([{ path: '/dispatch', x: 20, y: 20 }]),
        desktop_wallpaper: 'slate',
        desktop_widgets_json: JSON.stringify(['clock', 'ops-summary']),
      }),
    }, env as unknown as Record<string, unknown>);
    expect(putRes.status).toBe(200);
    const putBody = await putRes.json() as { success: boolean; preferences: Record<string, unknown> };
    expect(putBody.success).toBe(true);
    expect(putBody.preferences.desktop_wallpaper).toBe('slate');

    const getRes = await app.request('/api/preferences', {}, env as unknown as Record<string, unknown>);
    const getBody = await getRes.json() as Record<string, unknown>;
    expect(getBody.desktop_wallpaper).toBe('slate');
    expect(JSON.parse(getBody.desktop_widgets_json as string)).toEqual(['clock', 'ops-summary']);
  });

  it('persists and reads back desktop_accent and desktop_notes_json', async () => {
    const putRes = await app.request('/api/preferences', {
      method: 'PUT',
      body: JSON.stringify({
        desktop_accent: 'amber',
        desktop_notes_json: JSON.stringify([{ id: 'n1', x: 40, y: 40, width: 180, height: 140, text: 'Check plate ABC123', color: 'amber' }]),
      }),
    }, env as unknown as Record<string, unknown>);
    expect(putRes.status).toBe(200);

    const getRes = await app.request('/api/preferences', {}, env as unknown as Record<string, unknown>);
    const getBody = await getRes.json() as Record<string, unknown>;
    expect(getBody.desktop_accent).toBe('amber');
    expect(JSON.parse(getBody.desktop_notes_json as string)[0].text).toBe('Check plate ABC123');
  });
});
