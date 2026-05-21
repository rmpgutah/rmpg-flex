import type { D1Database, KVNamespace } from '@cloudflare/workers-types';

interface Client {
  id: string;
  userId: number;
  username: string;
  role: string;
  readyState: number;
  send(data: string): void;
  close(): void;
}

const clients: Map<string, Client> = new Map();

export function handleWebSocketUpgrade(request: Request, env: { DB: D1Database; SESSIONS: KVNamespace }): Response {
  return new Response('WebSocket upgrade not available', { status: 426 });
}

export function getConnectedUserCount(): number {
  return clients.size;
}

export function broadcastPresence(): void {
  // stub
}
