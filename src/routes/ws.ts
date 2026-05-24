// /api/ws upgrade — verifies JWT in the Worker layer, then forwards
// the Upgrade request to the DispatchHub Durable Object with verified
// identity headers. JWT comes from ?token=… query (the legacy form)
// OR from a message-based auth frame the client sends right after
// connect. We support both — the client picked message-based 2026-04-15
// but allow both so a mis-versioned officer MDT can still connect.

import { jwtVerify } from 'jose';
import { getDb, queryFirst } from '../utils/db';

interface Bindings {
  DB: D1Database;
  KV: KVNamespace;
  HUB: DurableObjectNamespace;
  JWT_SECRET: string;
}

interface JwtPayload {
  user_id?: number;
  userId?: number;
  username?: string;
  role?: string;
  full_name?: string;
}

interface UserRow {
  id: number;
  username: string;
  role: string;
  full_name: string;
  status: string;
}

async function verifyAndLookup(token: string, env: Bindings): Promise<UserRow | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(env.JWT_SECRET));
    const jwt = payload as unknown as JwtPayload;
    const userId = jwt.user_id ?? jwt.userId;
    if (!userId) return null;
    const db = getDb(env);
    const user = await queryFirst<UserRow>(
      db,
      'SELECT id, username, role, full_name, status FROM users WHERE id = ? AND status = ?',
      userId, 'active'
    );
    return user ?? null;
  } catch {
    return null;
  }
}

function forwardToHub(request: Request, env: Bindings, user: UserRow): Promise<Response> {
  const id = env.HUB.idFromName('global');
  const stub = env.HUB.get(id);
  // Strip the original Upgrade-bound headers and rebuild a fresh
  // request with identity headers the DO trusts.
  const upgradeHeaders = new Headers();
  upgradeHeaders.set('Upgrade', 'websocket');
  upgradeHeaders.set('X-Client-User-Id', String(user.id));
  upgradeHeaders.set('X-Client-Username', user.username);
  upgradeHeaders.set('X-Client-Role', user.role);
  upgradeHeaders.set('X-Client-Full-Name', user.full_name || '');
  return stub.fetch('https://hub.internal/ws', {
    method: 'GET',
    headers: upgradeHeaders,
  });
}

/**
 * Two paths:
 *  - URL-token (?token=…) → verify & forward immediately
 *  - Message-based → accept WS in a tiny proxy here, await first frame,
 *    verify, then forward by establishing a fresh WS to the DO and
 *    pumping bytes. This is heavy — but the modern client (post-2026-04-15)
 *    uses message-based auth so we have to support it.
 *
 * The implementation: we forward immediately even without a token,
 * because the DO upgrade now requires identity headers. To bridge,
 * we keep a thin proxy WS open here that intercepts the first
 * 'authenticate' frame, verifies, then opens the DO upgrade and
 * relays frames in both directions.
 */
export async function handleWebSocket(request: Request, env: Bindings): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/ws') return new Response('Not Found', { status: 404 });
  if (request.headers.get('Upgrade') !== 'websocket') {
    return new Response('Expected WebSocket', { status: 426 });
  }

  // ── Fast path: URL token (legacy or testing) ──
  const urlToken = url.searchParams.get('token');
  if (urlToken) {
    const user = await verifyAndLookup(urlToken, env);
    if (!user) return new Response('Unauthorized', { status: 401 });
    return forwardToHub(request, env, user);
  }

  // ── Message-based auth path: accept WS at the edge, wait for the
  // authenticate frame, then forward to the DO. ──
  const pair = new WebSocketPair();
  const clientSide = pair[0];
  const edgeSide = pair[1];
  edgeSide.accept();

  // 5s window to receive the auth frame, then close.
  const authTimer = setTimeout(() => {
    try { edgeSide.send(JSON.stringify({ type: 'auth_error', message: 'Auth timeout' })); } catch {}
    try { edgeSide.close(4002, 'Auth timeout'); } catch {}
  }, 5000);

  let authed = false;
  let hubSide: WebSocket | null = null;

  edgeSide.addEventListener('message', async (event) => {
    if (authed && hubSide) {
      try { hubSide.send(event.data as any); } catch {}
      return;
    }
    let msg: any;
    try {
      msg = JSON.parse(typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer));
    } catch {
      return;
    }
    if (msg.type !== 'authenticate' || typeof msg.token !== 'string') return;

    const user = await verifyAndLookup(msg.token, env);
    if (!user) {
      try { edgeSide.send(JSON.stringify({ type: 'auth_error', message: 'Invalid token' })); } catch {}
      try { edgeSide.close(4002, 'Auth failed'); } catch {}
      clearTimeout(authTimer);
      return;
    }

    clearTimeout(authTimer);

    // Open a WS to the DO, then bridge frames.
    const id = env.HUB.idFromName('global');
    const stub = env.HUB.get(id);
    const upgradeHeaders = new Headers();
    upgradeHeaders.set('Upgrade', 'websocket');
    upgradeHeaders.set('X-Client-User-Id', String(user.id));
    upgradeHeaders.set('X-Client-Username', user.username);
    upgradeHeaders.set('X-Client-Role', user.role);
    upgradeHeaders.set('X-Client-Full-Name', user.full_name || '');
    const resp = await stub.fetch('https://hub.internal/ws', {
      method: 'GET',
      headers: upgradeHeaders,
    });
    const ws = (resp as any).webSocket as WebSocket | null;
    if (!ws) {
      try { edgeSide.close(1011, 'Hub unavailable'); } catch {}
      return;
    }
    ws.accept();
    hubSide = ws;
    authed = true;

    ws.addEventListener('message', (e) => {
      try { edgeSide.send((e as MessageEvent).data as any); } catch {}
    });
    ws.addEventListener('close', () => {
      try { edgeSide.close(); } catch {}
    });
    ws.addEventListener('error', () => {
      try { edgeSide.close(1011, 'Hub error'); } catch {}
    });
  });

  edgeSide.addEventListener('close', () => {
    clearTimeout(authTimer);
    if (hubSide) { try { hubSide.close(); } catch {} }
  });
  edgeSide.addEventListener('error', () => {
    clearTimeout(authTimer);
    if (hubSide) { try { hubSide.close(); } catch {} }
  });

  return new Response(null, { status: 101, webSocket: clientSide });
}
