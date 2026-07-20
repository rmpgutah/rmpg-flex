import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import stubs from '../src/routes/stubs';
import type { Env } from '../src/types';

function buildApp(userId: number | null) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    if (userId != null) c.set('userId', userId);
    await next();
  });
  app.route('/', stubs);

  const rows = new Map<number, Record<string, unknown>>();
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first() {
              if (sql.includes('SELECT * FROM user_preferences')) {
                return rows.get(args[0] as number) ?? null;
              }
              return null;
            },
            async run() {
              if (sql.includes('INSERT OR IGNORE INTO user_preferences')) {
                const id = args[0] as number;
                if (!rows.has(id)) rows.set(id, { user_id: id });
              }
              if (sql.includes('UPDATE user_preferences SET')) {
                const id = args[args.length - 1] as number;
                const row = rows.get(id) ?? { user_id: id };
                const setPart = sql.split('SET ')[1].split(", updated_at")[0];
                const cols = setPart.split(', ').map((c) => c.split(' = ')[0].trim());
                cols.forEach((col, i) => { row[col] = args[i]; });
                rows.set(id, row);
              }
              return { success: true };
            },
          };
        },
      };
    },
  };

  const env: any = { DB: db };
  return (path: string, init?: RequestInit) => app.request(path, init, env);
}

describe('PUT /preferences — browser bookmarks/history', () => {
  it('round-trips browser_bookmarks_json and browser_history_json', async () => {
    const request = buildApp(1);
    const bookmarks = JSON.stringify([{ id: 'b1', url: 'https://example.com', title: 'Example' }]);
    const history = JSON.stringify([{ url: 'https://example.com', title: 'Example', visitedAt: '2026-07-20T00:00:00Z' }]);

    const putRes = await request('/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ browser_bookmarks_json: bookmarks, browser_history_json: history }),
    });
    expect(putRes.status).toBe(200);
    const putBody = await putRes.json() as { preferences: Record<string, unknown> };
    expect(putBody.preferences.browser_bookmarks_json).toBe(bookmarks);
    expect(putBody.preferences.browser_history_json).toBe(history);

    const getRes = await request('/preferences');
    const getBody = await getRes.json() as Record<string, unknown>;
    expect(getBody.browser_bookmarks_json).toBe(bookmarks);
    expect(getBody.browser_history_json).toBe(history);
  });

  it('defaults both to null for a user with no saved row', async () => {
    const request = buildApp(999);
    const res = await request('/preferences');
    const body = await res.json() as Record<string, unknown>;
    expect(body.browser_bookmarks_json).toBeNull();
    expect(body.browser_history_json).toBeNull();
  });
});
