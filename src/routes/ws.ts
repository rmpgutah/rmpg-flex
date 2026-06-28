import { jwtVerify } from 'jose';
import { getDb, queryFirst } from '../utils/db';

interface WsClient {
  userId: number;
  username: string;
  role: string;
  fullName: string;
  authenticated: boolean;
  joinedAt: number;
}

// Per-isolate connection registry — keyed by userId for targeted
// delivery (welfare prompts, premise auto-push, Spillman parity).
// Same trade-off as legacy server/src/worker-middleware/websocket.ts:
// cross-isolate fanout is best-effort; the alert use case (officer's
// MDT lives in one isolate at a time) works fine.
const wsClients = new Map<number, Set<any>>();

function registerClient(userId: number, ws: any): void {
  let set = wsClients.get(userId);
  if (!set) { set = new Set(); wsClients.set(userId, set); }
  set.add(ws);
}

function unregisterClient(userId: number, ws: any): void {
  const set = wsClients.get(userId);
  if (set) {
    set.delete(ws);
    if (set.size === 0) wsClients.delete(userId);
  }
}

export function sendToUser(userId: number, type: string, data: any): number {
  const set = wsClients.get(userId);
  if (!set || set.size === 0) return 0;
  const message = JSON.stringify({ type, ...data });
  let delivered = 0;
  for (const ws of set) {
    try {
      if ((ws as any).readyState === 1) {
        (ws as any).send(message);
        delivered++;
      }
    } catch { /* connection in flight — ignore */ }
  }
  return delivered;
}

export function broadcastAll(type: string, data: any): number {
  const message = JSON.stringify({ type, ...data });
  let delivered = 0;
  for (const set of wsClients.values()) {
    for (const ws of set) {
      try {
        if ((ws as any).readyState === 1) {
          (ws as any).send(message);
          delivered++;
        }
      } catch { /* ignore */ }
    }
  }
  return delivered;
}

interface Bindings {
  DB: D1Database;
  KV: KVNamespace;
  JWT_SECRET: string;
}

export async function handleWebSocket(request: Request, env: Bindings): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (url.pathname !== '/api/ws') {
      return new Response('Not Found', { status: 404 });
    }

    const secKey = request.headers.get('Sec-WebSocket-Key');
    if (!secKey) {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const WSPair = (globalThis as any).WebSocketPair;
    if (typeof WSPair !== 'function') {
      return new Response('WebSocketPair not available', { status: 500 });
    }

    let pair: any;
    try {
      pair = new WSPair();
    } catch (err) {
      return new Response('WebSocketPair create failed: ' + (err instanceof Error ? err.message : String(err)), { status: 500 });
    }

    const vals = Object.values(pair);
    if (vals.length !== 2) {
      return new Response('WebSocketPair invalid: ' + vals.length + ' values', { status: 500 });
    }
    const [client, server] = vals as [any, any];

    let clientInfo: WsClient | null = null;

    const safeSend = (data: string) => {
      try {
        if ((server as any).readyState === 1) {
          (server as any).send(data);
        }
      } catch {}
    };

    const closeWithError = (code: number, message: string) => {
      try {
        (server as any).close(code, message);
      } catch {}
    };

    const cleanup = () => {
      // cleared via addEventListener close/error
    };

    server.accept();

    server.addEventListener('message', async (event: any) => {
      try {
        const msg = JSON.parse(typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data));

        if (msg.type === 'authenticate' && !clientInfo?.authenticated) {
          try {
            const secret = new TextEncoder().encode(env.JWT_SECRET);
            const { payload } = await jwtVerify(msg.token, secret);
            // Accept both `user_id` (rewrite-issued) and `userId` (legacy-issued).
            // See [[feedback-jwt-claim-naming-mismatch]] memory + commit ce153cd5.
            const jwtPayload = payload as unknown as { user_id?: number; userId?: number; username: string; role: string };
            const claimedUserId = jwtPayload.user_id ?? jwtPayload.userId;
            if (claimedUserId == null) {
              safeSend(JSON.stringify({ type: 'error', code: 'AUTH_FAILED', message: 'Token missing user id claim' }));
              closeWithError(4002, 'Authentication failed');
              return;
            }

            const db = getDb(env);
            const user = await queryFirst<{
              id: number; username: string; role: string; full_name: string; status: string;
            }>(db, 'SELECT id, username, role, full_name, status FROM users WHERE id = ? AND status = ?', claimedUserId, 'active');

            if (!user) {
              safeSend(JSON.stringify({ type: 'error', code: 'AUTH_FAILED', message: 'User not found or inactive' }));
              closeWithError(4002, 'Authentication failed');
              return;
            }

            clientInfo = {
              userId: user.id,
              username: user.username,
              role: user.role,
              fullName: user.full_name,
              authenticated: true,
              joinedAt: Date.now(),
            };

            safeSend(JSON.stringify({ type: 'authenticated', userId: user.id, role: user.role }));

            // Register this WS in the per-isolate map so sendToUser
            // can target the officer for welfare/premise pushes.
            registerClient(user.id, server);

            await env.KV.put(`ws:user:${user.id}`, JSON.stringify({
              online: true, username: user.username, role: user.role, lastSeen: Date.now(),
            }), { expirationTtl: 300 });

            return;
          } catch (err) {
            safeSend(JSON.stringify({ type: 'error', code: 'AUTH_FAILED', message: 'Invalid token' }));
            closeWithError(4002, 'Authentication failed');
            return;
          }
        }

        if (!clientInfo?.authenticated) {
          safeSend(JSON.stringify({ type: 'error', code: 'NOT_AUTHENTICATED', message: 'Send authenticate first' }));
          return;
        }
      } catch {}
    });

    server.addEventListener('close', () => {
      cleanup();
      if (clientInfo?.userId) {
        unregisterClient(clientInfo.userId, server);
        env.KV.delete(`ws:user:${clientInfo.userId}`).catch(() => {});
      }
    });

    server.addEventListener('error', () => {
      cleanup();
      if (clientInfo?.userId) unregisterClient(clientInfo.userId, server);
    });

    return new Response(null, { status: 101, webSocket: client });
  } catch (err) {
    return new Response('Internal error: ' + (err instanceof Error ? err.message : String(err)), { status: 500 });
  }
}
