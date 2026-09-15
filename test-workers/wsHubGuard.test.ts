// /api/ws must fail fast when the DispatchHub DO is not bound.
//
// wrangler.toml has no `HUB` binding (only ALERT_HUB / VOICE_HUB, which speak a
// different protocol), so `env.HUB.idFromName` threw inside the authenticate
// handler: the client got no reply, waited out its 15 s connect timeout and
// reconnected forever, and the URL-token path 500'd. Both paths now degrade
// explicitly so the client falls back to polling immediately.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { sign } from 'hono/jwt';
import { execute } from '../src/utils/db';
import { handleWebSocket } from '../src/routes/ws';

const JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod';
let token = '';

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, username TEXT, role TEXT, full_name TEXT, status TEXT DEFAULT 'active'
  )`);
  await execute(db, "INSERT OR REPLACE INTO users (id, username, role, full_name, status) VALUES (77, 'wsuser', 'dispatcher', 'WS User', 'active')");
  token = await sign({ sub: '77', userId: 77, username: 'wsuser', role: 'dispatcher', type: 'access', exp: Math.floor(Date.now() / 1000) + 600 }, JWT_SECRET);
});

// env without HUB — mirrors the live wrangler.toml, which binds no DispatchHub.
function hublessEnv() {
  const e = { ...(env as unknown as Record<string, unknown>), JWT_SECRET };
  delete (e as { HUB?: unknown }).HUB;
  return e as unknown as Parameters<typeof handleWebSocket>[1];
}

const upgradeHeaders = { Upgrade: 'websocket', Connection: 'Upgrade' };

describe('/api/ws without a DispatchHub binding', () => {
  it('URL-token path returns 503 instead of throwing a 500', async () => {
    const res = await handleWebSocket(new Request(`https://x/api/ws?token=${token}`, { headers: upgradeHeaders }), hublessEnv());
    expect(res.status).toBe(503);
  });

  it('URL-token path still 401s a bad token before touching the hub', async () => {
    const res = await handleWebSocket(new Request('https://x/api/ws?token=garbage', { headers: upgradeHeaders }), hublessEnv());
    expect(res.status).toBe(401);
  });

  it('message-auth path answers authenticate with auth_error and closes 1011', async () => {
    const res = await handleWebSocket(new Request('https://x/api/ws', { headers: upgradeHeaders }), hublessEnv());
    expect(res.status).toBe(101);
    const ws = (res as unknown as { webSocket: WebSocket | null }).webSocket;
    expect(ws).toBeTruthy();
    ws!.accept();

    const events = new Promise<{ message: unknown; close: { code: number; reason: string } }>((resolve, reject) => {
      let message: unknown = null;
      const timer = setTimeout(() => reject(new Error('no reply from /api/ws within 4s')), 4000);
      ws!.addEventListener('message', (e) => { message = JSON.parse(String((e as MessageEvent).data)); });
      ws!.addEventListener('close', (e) => { clearTimeout(timer); resolve({ message, close: { code: (e as CloseEvent).code, reason: (e as CloseEvent).reason } }); });
    });
    ws!.send(JSON.stringify({ type: 'authenticate', token }));

    const { message, close } = await events;
    expect(message).toEqual({ type: 'auth_error', message: 'Dispatch hub unavailable' });
    expect(close.code).toBe(1011);
  });
});
