// RMPG Flex — AlertHubDO (Durable Object, agency-wide officer-safety alert hub)
//
// WHY THIS EXISTS
// ───────────────
// The live /api/ws socket is owned by the LEGACY worker; every dispatch/unit
// broadcast that legacy emits reaches its connected clients. But the REWRITE
// worker (this one) keeps its own per-isolate client map, so anything the
// rewrite broadcasts (panic, welfare, anomalies…) lands in an isolate with no
// connected clients — dead. Both workers' in-memory maps are unreachable to
// each other and there is no shared bus between them.
//
// AlertHubDO is that shared bus. It is a SINGLE global Durable Object instance
// (idFromName('global')) that every client holds one WebSocket to — connected
// directly to api.rmpgutah.us/api/alerts-ws, the same way the voice hub
// bypasses the zone proxy. Because a DO is one object across the whole fleet,
// any rewrite route handler can broadcast to every connected client by calling
// the DO's /emit endpoint (env.ALERT_HUB.get(id).fetch(...)).
//
// This is what restores authentic Spillman Flex panic behaviour:
//   • Agency-wide instant alarm  — emit() fans to every connected console/MDT.
//   • Forced acknowledgment      — an active panic is persisted + re-broadcast
//                                  on a DO alarm() every REMINDER_INTERVAL_MS
//                                  until a dispatcher acknowledges it.
//   • Mid-incident join          — a console that connects DURING an emergency
//                                  immediately replays all active panics.
//
// Auth: identical message-frame JWT gate to VoiceHubDO — connect, then send
// { type:'authenticate', token }. Only authenticated sockets receive alerts.

import { jwtVerify } from 'jose';
import { getDb, queryFirst } from '../utils/db';

interface AlertEnv {
  DB: D1Database;
  JWT_SECRET: string;
}

interface ConnMeta {
  userId: number;
  role: string;
  authenticated: boolean;
}

// An active panic we keep re-broadcasting until acknowledged.
interface ActivePanic {
  panicId: number;
  payload: unknown;   // the exact { type:'panic_alert', action, panic } frame
  acked: boolean;     // true once any dispatcher acknowledges — silences reminders
  firstAt: number;    // epoch ms of activation — bounds how long we nag
}

const REMINDER_INTERVAL_MS = 15_000;   // re-broadcast unacked panics this often
const REMINDER_MAX_MS = 5 * 60_000;    // stop nagging after 5 min (call card carries it)
const STORAGE_KEY = 'active_panics';

export class AlertHubDO {
  state: DurableObjectState;
  env: AlertEnv;
  conns = new Map<WebSocket, ConnMeta>();
  // Mirrored to state.storage so a hibernation/eviction doesn't drop an
  // in-flight emergency — reloaded in the constructor.
  active = new Map<number, ActivePanic>();

  constructor(state: DurableObjectState, env: AlertEnv) {
    this.state = state;
    this.env = env;
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<Record<string, ActivePanic>>(STORAGE_KEY);
      if (stored) for (const v of Object.values(stored)) this.active.set(v.panicId, v);
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // ── Internal broadcast entrypoint (Worker → DO). Never routed from a
    // public request; only reachable via env.ALERT_HUB.get(id).fetch(). ──
    if (url.pathname.endsWith('/emit')) {
      let body: { type?: string; action?: string; panic_id?: number; data?: Record<string, unknown> } = {};
      try { body = await request.json(); } catch { /* empty */ }
      await this.handleEmit(body);
      return new Response(JSON.stringify({ ok: true, members: this.authedCount() }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    // ── Client WebSocket upgrade ──
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }
    const pair = new (globalThis as any).WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    (server as any).accept();
    this.conns.set(server, { userId: 0, role: '', authenticated: false });

    server.addEventListener('message', (ev: MessageEvent) => {
      this.onMessage(server, ev).catch((err) => console.error('[AlertHubDO] msg', err));
    });
    server.addEventListener('close', () => this.conns.delete(server));
    server.addEventListener('error', () => this.conns.delete(server));

    return new Response(null, { status: 101, webSocket: client });
  }

  private send(ws: WebSocket, obj: unknown): void {
    try { if ((ws as any).readyState === 1) ws.send(JSON.stringify(obj)); } catch { /* in-flight */ }
  }

  private broadcast(obj: unknown): void {
    const msg = JSON.stringify(obj);
    for (const [ws, meta] of this.conns) {
      if (!meta.authenticated) continue;
      try { if ((ws as any).readyState === 1) ws.send(msg); } catch { /* ignore */ }
    }
  }

  private authedCount(): number {
    let n = 0;
    for (const meta of this.conns.values()) if (meta.authenticated) n++;
    return n;
  }

  private async onMessage(ws: WebSocket, ev: MessageEvent): Promise<void> {
    let msg: any;
    try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer)); }
    catch { return; }
    const meta = this.conns.get(ws);
    if (!meta) return;

    if (msg.type === 'ping') { this.send(ws, { type: 'pong' }); return; }

    // ── Authentication gate (same contract as the main WS + voice hub) ──
    if (msg.type === 'authenticate') {
      if (meta.authenticated) return;
      try {
        const { payload } = await jwtVerify(msg.token, new TextEncoder().encode(this.env.JWT_SECRET));
        const p = payload as unknown as { user_id?: number; userId?: number };
        const claimed = p.user_id ?? p.userId; // accept both claim names
        if (claimed == null) { this.send(ws, { type: 'alerts_auth_error' }); return; }
        const db = getDb(this.env as any);
        const user = await queryFirst<{ id: number; role: string }>(
          db, 'SELECT id, role FROM users WHERE id = ? AND status = ?', claimed, 'active',
        );
        if (!user) { this.send(ws, { type: 'alerts_auth_error' }); return; }
        meta.userId = user.id;
        meta.role = user.role;
        meta.authenticated = true;
        this.send(ws, { type: 'alerts_ready' });
        // Mid-incident join: replay every still-active panic so a console
        // that comes online during an emergency alarms immediately.
        for (const a of this.active.values()) this.send(ws, a.payload);
      } catch {
        this.send(ws, { type: 'alerts_auth_error' });
      }
      return;
    }
  }

  // Worker route handlers call this (via /emit) to fan an officer-safety
  // event to the whole fleet and drive the forced-ack lifecycle.
  private async handleEmit(body: { type?: string; action?: string; panic_id?: number; data?: Record<string, unknown> }): Promise<void> {
    const frame = { type: body.type, ...(body.data || {}) };
    // Always fan the event out immediately.
    this.broadcast(frame);

    // ── Forced-ack lifecycle (panic only) ──
    const action = body.action || (body.data?.action as string | undefined);
    const panicId = body.panic_id
      ?? (body.data?.panic as { id?: number } | undefined)?.id
      ?? (body.data?.panic_id as number | undefined);
    if (body.type !== 'panic_alert' || panicId == null) return;

    if (action === 'panic_activated') {
      this.active.set(panicId, { panicId, payload: frame, acked: false, firstAt: Date.now() });
      await this.persist();
      await this.armReminder();
    } else if (action === 'panic_acknowledged') {
      // Ack SILENCES the reminder but keeps the unit emergent (Spillman:
      // the unit stays in emergency until resolve/cancel/false-alarm).
      const a = this.active.get(panicId);
      if (a) { a.acked = true; await this.persist(); }
    } else if (action === 'panic_resolved' || action === 'panic_cancelled' || action === 'panic_false_alarm') {
      this.active.delete(panicId);
      await this.persist();
    }
  }

  private async persist(): Promise<void> {
    const obj: Record<string, ActivePanic> = {};
    for (const [k, v] of this.active) obj[String(k)] = v;
    await this.state.storage.put(STORAGE_KEY, obj);
  }

  // Schedule the next reminder sweep if any panic still needs nagging.
  private async armReminder(): Promise<void> {
    const needs = [...this.active.values()].some(a => !a.acked && (Date.now() - a.firstAt) < REMINDER_MAX_MS);
    if (!needs) return;
    const existing = await this.state.storage.getAlarm();
    if (existing == null) await this.state.storage.setAlarm(Date.now() + REMINDER_INTERVAL_MS);
  }

  // DO alarm — re-broadcast every unacked, not-yet-expired panic so the
  // alarm persists agency-wide until a dispatcher acknowledges it.
  async alarm(): Promise<void> {
    let stillNagging = false;
    for (const a of this.active.values()) {
      if (a.acked) continue;
      if ((Date.now() - a.firstAt) >= REMINDER_MAX_MS) continue;
      this.broadcast(a.payload);
      stillNagging = true;
    }
    if (stillNagging) await this.state.storage.setAlarm(Date.now() + REMINDER_INTERVAL_MS);
  }
}
