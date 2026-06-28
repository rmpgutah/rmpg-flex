// DispatchHub — single Durable Object that owns every connected client.
//
// Routes never touch this directly. They call helpers in src/lib/broadcast.ts
// which fetch() this DO's internal endpoints. Clients connect via /api/ws
// (see src/routes/ws.ts) which JWT-verifies in the Worker layer, then
// forwards the upgrade request here with identity in X-Client-* headers.

import type { DurableObjectState } from '@cloudflare/workers-types';

interface ClientMeta {
  userId: number;
  username: string;
  role: string;
  fullName: string;
  connectedAt: number;
  lastPong: number;
  channels: Set<string>;
}

const DEFAULT_CHANNELS = ['dispatch', 'unit', 'presence', 'panic', 'voice'];
const PONG_TIMEOUT_MS = 60_000; // sweep clients that haven't ponged in 60s
const REPLAY_WINDOW_MS = 5 * 60_000; // 5 min — targeted messages replayed on reconnect

interface RetainedMessage {
  userId: number;
  ts: number;
  message: any;
}

export class DispatchHub {
  private state: DurableObjectState;
  private clients: Map<WebSocket, ClientMeta> = new Map();
  private sweepHandle: number | null = null;
  // Ring of targeted (sendToUser/sendToRole) messages for reconnect
  // replay. Channel broadcasts are NOT retained — officers re-sync
  // from screen state, matching Spillman behavior.
  private retained: RetainedMessage[] = [];

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // ── WebSocket upgrade (forwarded from /api/ws after JWT verify) ──
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleUpgrade(request);
    }

    // ── Internal RPC endpoints (called by src/lib/broadcast.ts) ──
    if (request.method === 'POST') {
      if (url.pathname === '/broadcast') return this.rpcBroadcast(request);
      if (url.pathname === '/send-to-user') return this.rpcSendToUser(request);
      if (url.pathname === '/send-to-role') return this.rpcSendToRole(request);
    }
    if (request.method === 'GET' && url.pathname === '/presence') {
      return this.rpcPresence();
    }

    return new Response('Not Found', { status: 404 });
  }

  // ─────────────────────────────────────────────────────────────────
  // WebSocket lifecycle
  // ─────────────────────────────────────────────────────────────────

  private handleUpgrade(request: Request): Response {
    const userId = Number(request.headers.get('X-Client-User-Id'));
    const username = request.headers.get('X-Client-Username') || '';
    const role = request.headers.get('X-Client-Role') || '';
    const fullName = request.headers.get('X-Client-Full-Name') || '';

    if (!userId || !username) {
      return new Response('Missing identity headers', { status: 400 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    server.accept();

    const meta: ClientMeta = {
      userId,
      username,
      role,
      fullName,
      connectedAt: Date.now(),
      lastPong: Date.now(),
      channels: new Set(DEFAULT_CHANNELS),
    };
    this.clients.set(server, meta);

    server.addEventListener('message', (event) => this.onMessage(server, event));
    server.addEventListener('close', () => this.onClose(server));
    server.addEventListener('error', () => this.onClose(server));

    // Send immediate authenticated ack matching the existing client
    // protocol (client expects { type:'authenticated', userId, role }
    // — see client/src/context/WebSocketContext.tsx).
    this.safeSend(server, { type: 'authenticated', userId, role });

    // Reconnect replay: deliver any targeted messages from the last
    // REPLAY_WINDOW_MS that haven't expired. Wrap each so the client
    // can distinguish replay from live (UI may want to suppress
    // tones for replayed alerts).
    this.replayTo(server, userId);

    // Broadcast presence so other dispatchers see the new connection.
    this.broadcastPresence();
    this.ensureSweep();

    return new Response(null, { status: 101, webSocket: client });
  }

  private onMessage(ws: WebSocket, event: MessageEvent): void {
    const meta = this.clients.get(ws);
    if (!meta) return;

    let msg: any;
    try {
      msg = JSON.parse(typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer));
    } catch {
      return;
    }

    if (msg.type === 'ping') {
      meta.lastPong = Date.now();
      this.safeSend(ws, { type: 'pong', ts: meta.lastPong });
      return;
    }
    if (msg.type === 'pong') {
      meta.lastPong = Date.now();
      return;
    }
    if (msg.type === 'subscribe' && typeof msg.channel === 'string') {
      meta.channels.add(msg.channel);
      return;
    }
    if (msg.type === 'unsubscribe' && typeof msg.channel === 'string') {
      meta.channels.delete(msg.channel);
      return;
    }
    // Re-auth frame from client reconnect — already authenticated at
    // upgrade time, so just ack.
    if (msg.type === 'authenticate') {
      this.safeSend(ws, { type: 'authenticated', userId: meta.userId, role: meta.role });
      return;
    }
  }

  private onClose(ws: WebSocket): void {
    if (this.clients.delete(ws)) {
      this.broadcastPresence();
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // RPC: broadcast / direct / role-targeted / presence
  // ─────────────────────────────────────────────────────────────────

  private async rpcBroadcast(request: Request): Promise<Response> {
    const { channel, message } = await request.json<{ channel: string; message: any }>();
    let count = 0;
    for (const [ws, meta] of this.clients) {
      if (channel === '__all__' || meta.channels.has(channel)) {
        if (this.safeSend(ws, message)) count++;
      }
    }
    return Response.json({ delivered: count });
  }

  private async rpcSendToUser(request: Request): Promise<Response> {
    const { userIds, message } = await request.json<{ userIds: number[]; message: any }>();
    const targets = new Set(userIds);
    const now = Date.now();
    // Retain for reconnect replay BEFORE delivery — even if the
    // user is offline right now they'll catch it on next connect
    // within REPLAY_WINDOW_MS.
    for (const userId of userIds) {
      this.retained.push({ userId, ts: now, message });
    }
    this.pruneRetained(now);
    let count = 0;
    for (const [ws, meta] of this.clients) {
      if (targets.has(meta.userId) && this.safeSend(ws, message)) count++;
    }
    return Response.json({ delivered: count });
  }

  private async rpcSendToRole(request: Request): Promise<Response> {
    const { roles, message } = await request.json<{ roles: string[]; message: any }>();
    const targets = new Set(roles);
    const now = Date.now();
    let count = 0;
    // Retain per-user so each role member's replay is correct.
    for (const [ws, meta] of this.clients) {
      if (targets.has(meta.role)) {
        this.retained.push({ userId: meta.userId, ts: now, message });
        if (this.safeSend(ws, message)) count++;
      }
    }
    this.pruneRetained(now);
    return Response.json({ delivered: count });
  }

  // ─────────────────────────────────────────────────────────────────
  // Replay
  // ─────────────────────────────────────────────────────────────────

  private replayTo(ws: WebSocket, userId: number): void {
    const cutoff = Date.now() - REPLAY_WINDOW_MS;
    for (const r of this.retained) {
      if (r.userId !== userId) continue;
      if (r.ts < cutoff) continue;
      // Wrap so client knows this came from replay. UI can use
      // `replayed: true` to suppress emergency tones (tone fired
      // live; we don't want a delayed second siren).
      this.safeSend(ws, { ...r.message, replayed: true, replayedFromTs: r.ts });
    }
  }

  private pruneRetained(now: number): void {
    const cutoff = now - REPLAY_WINDOW_MS;
    // Single-pass filter — retained is bounded by traffic in 5 min,
    // typically dozens of entries, not thousands.
    let write = 0;
    for (let read = 0; read < this.retained.length; read++) {
      if (this.retained[read].ts >= cutoff) {
        this.retained[write++] = this.retained[read];
      }
    }
    this.retained.length = write;
  }

  private rpcPresence(): Response {
    const seen = new Set<number>();
    const users: any[] = [];
    for (const [, meta] of this.clients) {
      if (seen.has(meta.userId)) continue;
      seen.add(meta.userId);
      users.push({
        userId: meta.userId,
        username: meta.username,
        role: meta.role,
        fullName: meta.fullName,
        connectedAt: meta.connectedAt,
      });
    }
    return Response.json({ users, count: users.length });
  }

  // ─────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────

  private safeSend(ws: WebSocket, payload: any): boolean {
    try {
      if (ws.readyState === WebSocket.READY_STATE_OPEN) {
        ws.send(JSON.stringify(payload));
        return true;
      }
    } catch { /* connection dying */ }
    return false;
  }

  private broadcastPresence(): void {
    const presence = this.rpcPresence();
    presence.json().then((body: any) => {
      const msg = { type: 'presence', ...body };
      for (const ws of this.clients.keys()) this.safeSend(ws, msg);
    }).catch(() => {});
  }

  // Sweep clients that haven't ponged recently. Cloudflare DO timers
  // hibernate the instance — we use setInterval since this DO is
  // non-hibernating and active as long as WS clients exist.
  private ensureSweep(): void {
    if (this.sweepHandle !== null) return;
    this.sweepHandle = setInterval(() => {
      if (this.clients.size === 0) {
        clearInterval(this.sweepHandle!);
        this.sweepHandle = null;
        return;
      }
      const cutoff = Date.now() - PONG_TIMEOUT_MS;
      for (const [ws, meta] of this.clients) {
        if (meta.lastPong < cutoff) {
          try { ws.close(1000, 'idle'); } catch { /* noop */ }
          this.clients.delete(ws);
        }
      }
    }, 15_000) as unknown as number;
  }
}
