// Route-level tests (Miniflare/workerd) for the AI Dev Chat endpoints and the
// usage-metering endpoints in src/routes/ai.ts.
//
// Before 2026-09-15 AIDevChatPanel called four endpoints that did not exist
// (POST /dev-chat/chat, POST /dev-chat/chat/stream, GET+DELETE
// /dev-chat/history/:id) and GET /stats /activity /dev-chat/history returned
// hardcoded stubs. These tests pin the real contracts the panel parses.
//
// The AI binding is absent in this pool, so the provider chain always fails —
// which is exactly the degradation path worth pinning: a clean error payload,
// never an unhandled 500, and never a silent empty bubble.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { execute, query, queryFirst } from '../src/utils/db';
import ai from '../src/routes/ai';

type User = { id: number; role: string; username: string; full_name: string };

function appAs(user: User) {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: User; userId: number } }>();
  app.use('*', async (c, next) => { c.set('user', user); c.set('userId', user.id); await next(); });
  app.route('/api/ai', ai);
  return app;
}

const ADMIN: User = { id: 91, role: 'admin', username: 'adm', full_name: 'Ada Min' };
const OFFICER: User = { id: 92, role: 'officer', username: 'off', full_name: 'Olive Officer' };
const db = () => (env as unknown as { DB: D1Database }).DB;

async function call(user: User, path: string, init?: RequestInit) {
  const res = await appAs(user).request(`/api/ai${path}`, init, env as unknown as Record<string, unknown>);
  return res;
}
async function json(user: User, path: string, init?: RequestInit) {
  const res = await call(user, path, init);
  return { status: res.status, body: await res.json() as any };
}
const post = (user: User, path: string, body: unknown) => json(user, path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

beforeAll(async () => {
  await execute(db(), `CREATE TABLE IF NOT EXISTS system_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT, config_key TEXT, config_value TEXT,
    category TEXT, is_active INTEGER DEFAULT 1)`);
  await execute(db(), `CREATE TABLE IF NOT EXISTS ai_activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, task_type TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'workers-ai', model TEXT,
    latency_ms INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'success',
    prompt_preview TEXT, error TEXT, user_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  await execute(db(), `CREATE TABLE IF NOT EXISTS ai_dev_chat_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, session_key TEXT NOT NULL UNIQUE, user_id INTEGER,
    title TEXT, message_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  await execute(db(), `CREATE TABLE IF NOT EXISTS ai_dev_chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL, role TEXT NOT NULL,
    content TEXT NOT NULL, provider TEXT, latency_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
});

beforeEach(async () => {
  await execute(db(), `DELETE FROM ai_dev_chat_messages`);
  await execute(db(), `DELETE FROM ai_dev_chat_sessions`);
  await execute(db(), `DELETE FROM ai_activity_log`);
});

describe('POST /ai/dev-chat/chat', () => {
  it('rejects a blank message with 400 rather than calling a provider', async () => {
    const { status, body } = await post(ADMIN, '/dev-chat/chat', { message: '   ', sessionId: 's1' });
    expect(status).toBe(400);
    expect(body.code).toBe('CHAT_NO_MESSAGE');
  });

  it('requires a sessionId so the turn can be persisted', async () => {
    const { status, body } = await post(ADMIN, '/dev-chat/chat', { message: 'hello' });
    expect(status).toBe(400);
    expect(body.code).toBe('CHAT_NO_SESSION');
  });

  it('is closed to non-admin roles', async () => {
    const { status } = await post(OFFICER, '/dev-chat/chat', { message: 'hi', sessionId: 's1' });
    expect(status).toBe(403);
  });

  it('persists the user turn and returns a structured error when every provider fails', async () => {
    // No AI binding and no stored keys in this pool → the whole chain fails.
    const { status, body } = await post(ADMIN, '/dev-chat/chat', { message: 'why is CAD slow', sessionId: 's1' });
    expect(status).toBe(502);
    expect(body.code).toBe('CHAT_PROVIDER_FAILED');
    expect(typeof body.error).toBe('string');

    // The user's message is still recorded — losing it would silently drop
    // what the admin typed the moment a provider hiccups.
    const msgs = await query<{ role: string; content: string }>(db(),
      `SELECT role, content FROM ai_dev_chat_messages ORDER BY id`);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ role: 'user', content: 'why is CAD slow' });
  });

  it('logs the failed call to ai_activity_log with status=error', async () => {
    await post(ADMIN, '/dev-chat/chat', { message: 'hello', sessionId: 's1' });
    const row = await queryFirst<{ task_type: string; status: string; user_id: number }>(db(),
      `SELECT task_type, status, user_id FROM ai_activity_log ORDER BY id DESC LIMIT 1`);
    expect(row).toMatchObject({ task_type: 'dev-chat', status: 'error', user_id: ADMIN.id });
  });

  it('reuses one session row across turns instead of forking a new one', async () => {
    await post(ADMIN, '/dev-chat/chat', { message: 'first', sessionId: 'same' });
    await post(ADMIN, '/dev-chat/chat', { message: 'second', sessionId: 'same' });
    const rows = await query(db(), `SELECT id FROM ai_dev_chat_sessions WHERE session_key = 'same'`);
    expect(rows).toHaveLength(1);
  });
});

describe('POST /ai/dev-chat/chat/stream', () => {
  it('responds as an SSE stream terminated by a done frame', async () => {
    const res = await call(ADMIN, '/dev-chat/chat/stream', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello', sessionId: 's-stream' }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text();
    // Every frame the panel parses is `data: <json>`.
    const frames = text.split('\n').filter((l) => l.startsWith('data: '))
      .map((l) => JSON.parse(l.slice(6)));
    expect(frames.length).toBeGreaterThan(0);
    // Provider chain fails in this pool → an error frame, then a done frame.
    expect(frames.some((f) => typeof f.error === 'string')).toBe(true);
    expect(frames[frames.length - 1].done).toBe(true);
  });

  it('rejects a blank message with a normal 400 JSON body, not a stream', async () => {
    const res = await call(ADMIN, '/dev-chat/chat/stream', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '', sessionId: 's1' }),
    });
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/json');
  });
});

describe('GET /ai/dev-chat/history', () => {
  it('returns [] when there are no sessions', async () => {
    const { status, body } = await json(ADMIN, '/dev-chat/history');
    expect(status).toBe(200);
    expect(body).toEqual([]);
  });

  it('returns the ChatSession shape the panel renders', async () => {
    await post(ADMIN, '/dev-chat/chat', { message: 'how do warrants sync', sessionId: 'sess-a' });
    const { body } = await json(ADMIN, '/dev-chat/history');
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      session_id: 'sess-a',
      first_message: 'how do warrants sync',
      message_count: 1,
    });
    expect(typeof body[0].started_at).toBe('string');
    expect(typeof body[0].last_message).toBe('string');
  });

  it('scopes sessions to the requesting user', async () => {
    await post(ADMIN, '/dev-chat/chat', { message: 'mine', sessionId: 'sess-admin' });
    const other: User = { id: 99, role: 'admin', username: 'o', full_name: 'Other Admin' };
    const { body } = await json(other, '/dev-chat/history');
    expect(body).toEqual([]);
  });
});

describe('GET/DELETE /ai/dev-chat/history/:sessionId', () => {
  it('returns that session\'s messages in order', async () => {
    await post(ADMIN, '/dev-chat/chat', { message: 'first q', sessionId: 'sess-b' });
    await post(ADMIN, '/dev-chat/chat', { message: 'second q', sessionId: 'sess-b' });
    const { status, body } = await json(ADMIN, '/dev-chat/history/sess-b');
    expect(status).toBe(200);
    expect(body.map((m: any) => m.content)).toEqual(['first q', 'second q']);
  });

  it('404s for an unknown session rather than returning an empty list', async () => {
    const { status } = await json(ADMIN, '/dev-chat/history/nope');
    expect(status).toBe(404);
  });

  it('will not read another user\'s session', async () => {
    await post(ADMIN, '/dev-chat/chat', { message: 'private', sessionId: 'sess-c' });
    const other: User = { id: 98, role: 'admin', username: 'o2', full_name: 'Other' };
    const { status } = await json(other, '/dev-chat/history/sess-c');
    expect(status).toBe(404);
  });

  it('deletes the session and its messages', async () => {
    await post(ADMIN, '/dev-chat/chat', { message: 'bye', sessionId: 'sess-d' });
    const { status } = await json(ADMIN, '/dev-chat/history/sess-d', { method: 'DELETE' });
    expect(status).toBe(200);
    expect(await query(db(), `SELECT id FROM ai_dev_chat_sessions WHERE session_key = 'sess-d'`)).toHaveLength(0);
    expect(await query(db(), `SELECT id FROM ai_dev_chat_messages`)).toHaveLength(0);
  });

  it('will not delete another user\'s session', async () => {
    await post(ADMIN, '/dev-chat/chat', { message: 'keep', sessionId: 'sess-e' });
    const other: User = { id: 97, role: 'admin', username: 'o3', full_name: 'Other' };
    const { status } = await json(other, '/dev-chat/history/sess-e', { method: 'DELETE' });
    expect(status).toBe(404);
    expect(await query(db(), `SELECT id FROM ai_dev_chat_sessions WHERE session_key = 'sess-e'`)).toHaveLength(1);
  });
});

describe('GET /ai/stats and /ai/activity — real data, not stubs', () => {
  it('counts logged activity instead of returning hardcoded zeros', async () => {
    await execute(db(), `INSERT INTO ai_activity_log (task_type, provider, latency_ms, status, prompt_preview)
      VALUES ('narrative', 'workers-ai', 100, 'success', 'a'),
             ('analyze', 'workers-ai', 300, 'success', 'b'),
             ('narrative', 'openai', 50, 'error', 'c')`);
    const { status, body } = await json(ADMIN, '/stats');
    expect(status).toBe(200);
    expect(body.totalRequests).toBe(3);
    expect(body.requestsToday).toBe(3);
    // Average is over successful calls only — a fast failure must not flatter it.
    expect(body.avgResponseMs).toBe(200);
  });

  it('returns recent rows in the ActivityEntry shape, newest first', async () => {
    await execute(db(), `INSERT INTO ai_activity_log (task_type, provider, latency_ms, status, prompt_preview)
      VALUES ('older', 'workers-ai', 1, 'success', 'x'), ('newer', 'workers-ai', 2, 'success', 'y')`);
    const { body } = await json(ADMIN, '/activity?limit=5');
    expect(body[0].task_type).toBe('newer');
    expect(body[0]).toHaveProperty('prompt_preview');
    expect(body[0]).toHaveProperty('created_at');
  });

  it('caps an absurd limit rather than trusting the query string', async () => {
    const { status, body } = await json(ADMIN, '/activity?limit=99999');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('AI usage metering middleware', () => {
  it('records a row for a metered AI endpoint', async () => {
    // /narrative rejects short notes with 400 — still a real AI request the
    // admin should see in the activity feed, with an honest error status.
    await post(ADMIN, '/narrative', { notes: 'short' });
    const row = await queryFirst<{ task_type: string; status: string }>(db(),
      `SELECT task_type, status FROM ai_activity_log ORDER BY id DESC LIMIT 1`);
    expect(row?.task_type).toBe('narrative');
    expect(row?.status).toBe('error');
  });

  it('captures a prompt preview from the request body', async () => {
    await post(ADMIN, '/smart-search', { query: 'blue sedan near 900 south', searchType: 'vehicles' });
    const row = await queryFirst<{ task_type: string; prompt_preview: string }>(db(),
      `SELECT task_type, prompt_preview FROM ai_activity_log ORDER BY id DESC LIMIT 1`);
    expect(row?.task_type).toBe('smart-search');
    expect(row?.prompt_preview).toContain('blue sedan');
  });

  it('does NOT meter plain config reads', async () => {
    await json(ADMIN, '/config');
    expect(await query(db(), `SELECT id FROM ai_activity_log`)).toHaveLength(0);
  });

  it('does not double-count dev-chat, which meters itself', async () => {
    await post(ADMIN, '/dev-chat/chat', { message: 'hi', sessionId: 'meter-1' });
    const rows = await query(db(), `SELECT id FROM ai_activity_log WHERE task_type = 'dev-chat'`);
    expect(rows).toHaveLength(1);
  });
});
