// @ts-nocheck
// ============================================================
// RMPG Flex — WebSocket Handler (Cloudflare Workers)
// ============================================================
// Manages WebSocket connections for real-time dispatch updates,
// presence tracking, and GPS broadcasts.
// Connections are stored in a global Map (per-ISOLATE).
// ============================================================

import { jwtVerify } from 'jose';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../worker';

export interface WsClient {
  ws: WebSocket;
  userId: number;
  username: string;
  role: string;
  fullName: string;
  connectedAt: string;
  lastPong: number;
  channels: Set<string>;
}

const clients = new Map<number, WsClient[]>();
let clientIdCounter = 0;

function getClientKey(userId: number): string {
  return `ws:${userId}`;
}

async function authenticate(token: string, env: Env): Promise<{ userId: number; username: string; role: string; fullName: string } | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(env.JWT_SECRET));
    return { userId: payload.userId as number, username: payload.username as string, role: payload.role as string, fullName: (payload.fullName as string) || '' };
  } catch {
    return null;
  }
}

export function broadcast(channel: string, type: string, data: any): void {
  const message = JSON.stringify({ type, ...data });
  for (const [, userClients] of clients) {
    for (const client of userClients) {
      if (client.channels.has(channel) || channel === '__all__') {
        try {
          client.ws.send(message);
        } catch { /* ignore */ }
      }
    }
  }
}

export function broadcastDispatchUpdate(data: any): void {
  broadcast('dispatch', 'dispatch_update', data);
}

// ── Per-user targeted delivery (Spillman parity) ──
// Powers welfare prompts and premise auto-push. Per-isolate scope
// matches the rest of this module — same caveat as broadcast(),
// fine for the alert use case where the officer's MDT lives in
// one isolate at a time.
export function sendToUser(userId: number, type: string, data: any): number {
  const userClients = clients.get(userId);
  if (!userClients || userClients.length === 0) return 0;
  const message = JSON.stringify({ type, ...data });
  let delivered = 0;
  for (const client of userClients) {
    try {
      if (client.ws.readyState === WebSocket.READY_STATE_OPEN) {
        client.ws.send(message);
        delivered++;
      }
    } catch { /* connection in flight — ignore */ }
  }
  return delivered;
}

export function broadcastToUsers(userIds: number[], type: string, data: any): number {
  let total = 0;
  for (const userId of userIds) total += sendToUser(userId, type, data);
  return total;
}

export function broadcastUnitUpdate(data: any): void {
  broadcast('dispatch', 'unit_update', data);
}

export function broadcastPresence(): void {
  const users: any[] = [];
  for (const [userId, userClients] of clients) {
    for (const c of userClients) {
      if (c.ws.readyState === WebSocket.READY_STATE_OPEN) {
        users.push({ userId: c.userId, username: c.username, role: c.role, fullName: c.fullName, connectedAt: c.connectedAt });
        break;
      }
    }
  }
  const presenceMsg = JSON.stringify({ type: 'presence', users, count: users.length });
  for (const [, userClients] of clients) {
    for (const client of userClients) {
      try {
        if (client.ws.readyState === WebSocket.READY_STATE_OPEN) {
          client.ws.send(presenceMsg);
        }
      } catch { /* ignore */ }
    }
  }
}

export function getConnectedUserCount(): number {
  let count = 0;
  for (const [, userClients] of clients) {
    for (const c of userClients) {
      if (c.ws.readyState === WebSocket.READY_STATE_OPEN) count++;
    }
  }
  return count;
}

export function handleWebSocketUpgrade(request: Request, env: Env): Response {
  const upgradeHeader = request.headers.get('Upgrade');
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
    return new Response('Expected WebSocket upgrade', { status: 426 });
  }

  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);

  server.accept();

  let authenticated = false;
  let clientInfo: { userId: number; username: string; role: string; fullName: string } | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const safeSend = (ws: WebSocket, msg: string) => {
    try { if (ws.readyState === WebSocket.READY_STATE_OPEN) ws.send(msg); } catch { /* ignore */ }
  };

  const cleanup = () => {
    closed = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (clientInfo) {
      const userClients = clients.get(clientInfo.userId);
      if (userClients) {
        const idx = userClients.findIndex(c => c.ws === server);
        if (idx >= 0) userClients.splice(idx, 1);
        if (userClients.length === 0) clients.delete(clientInfo.userId);
      }
    }
    setTimeout(() => broadcastPresence(), 100);
  };

  server.addEventListener('message', async (event: MessageEvent) => {
    if (closed) return;

    try {
      const message = JSON.parse(event.data as string);
      const { type, data } = message;

      if (type === 'authenticate' || type === 'auth') {
        const token = message.token || (message as any).accessToken;
        if (!token) {
          safeSend(server, JSON.stringify({ type: 'error', error: 'No token provided' }));
          return;
        }
        clientInfo = await authenticate(token, env);
        if (!clientInfo) {
          safeSend(server, JSON.stringify({ type: 'error', error: 'Invalid token' }));
          return;
        }
        authenticated = true;

        const existing = clients.get(clientInfo.userId) || [];
        existing.push({
          ws: server,
          userId: clientInfo.userId,
          username: clientInfo.username,
          role: clientInfo.role,
          fullName: clientInfo.fullName,
          connectedAt: new Date().toISOString(),
          lastPong: Date.now(),
          channels: new Set(['dispatch', 'alerts', 'presence']),
        });
        clients.set(clientInfo.userId, existing);

        safeSend(server, JSON.stringify({ type: 'authenticated', userId: clientInfo.userId, username: clientInfo.username, role: clientInfo.role, fullName: clientInfo.fullName }));
        setTimeout(() => broadcastPresence(), 100);
        return;
      }

      if (!authenticated) {
        safeSend(server, JSON.stringify({ type: 'error', error: 'Not authenticated' }));
        return;
      }

      switch (type) {
        case 'ping': {
          safeSend(server, JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
          break;
        }
        case 'subscribe': {
          if (clientInfo) {
            const userClients = clients.get(clientInfo.userId);
            if (userClients) {
              const idx = userClients.findIndex(c => c.ws === server);
              if (idx >= 0 && message.channel) userClients[idx].channels.add(message.channel);
            }
          }
          break;
        }
        case 'unsubscribe': {
          if (clientInfo) {
            const userClients = clients.get(clientInfo.userId);
            if (userClients) {
              const idx = userClients.findIndex(c => c.ws === server);
              if (idx >= 0 && message.channel) userClients[idx].channels.delete(message.channel);
            }
          }
          break;
        }
        default: {
          safeSend(server, JSON.stringify({ type: 'error', error: `Unknown message type: ${type}` }));
        }
      }
    } catch {
      safeSend(server, JSON.stringify({ type: 'error', error: 'Invalid JSON' }));
    }
  });

  server.addEventListener('close', () => cleanup());
  server.addEventListener('error', () => cleanup());

  // Heartbeat: ping every 30s, expect pong within 10s
  heartbeatTimer = setInterval(() => {
    if (closed) return;
    try {
      if (server.readyState === WebSocket.READY_STATE_OPEN) {
        server.send(JSON.stringify({ type: 'ping' }));
      }
    } catch {
      cleanup();
    }
  }, 30000);

  // Connection timeout: close if not authenticated within 15s
  const authTimeout = setTimeout(() => {
    if (!authenticated && !closed) {
      safeSend(server, JSON.stringify({ type: 'error', error: 'Authentication timeout' }));
      try { server.close(4001, 'Authentication timeout'); } catch { /* ignore */ }
      cleanup();
    }
  }, 15000);

  server.addEventListener('close', () => clearTimeout(authTimeout));

  return new Response(null, { status: 101, webSocket: client });
}
