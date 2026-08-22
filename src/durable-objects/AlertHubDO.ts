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
import { getDb, queryFirst, execute } from '../utils/db';

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
  level?: number;     // escalation level (1 = initial; bumped while unacked)
}

const REMINDER_INTERVAL_MS = 15_000;   // re-broadcast unacked panics this often
const REMINDER_MAX_MS = 5 * 60_000;    // stop nagging after 5 min (call card carries it)
// Spillman parity: an UNACKNOWLEDGED emergency escalates. Level 1 at
// activation, level 2 after 60s without dispatcher ack, level 3 after 180s.
// Each bump persists to panic_alerts.escalation_level and broadcasts a
// panic_escalated frame (consoles render the level; voice re-announces).
const ESCALATION_STEPS_MS = [60_000, 180_000];
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

    // Sockets that never authenticate must not linger — without this, an
    // attacker can hold unauthenticated connections open indefinitely.
    setTimeout(() => {
      const meta = this.conns.get(server);
      if (meta && !meta.authenticated) {
        try { (server as any).close(4001, 'Authentication timeout'); } catch { /* already closed */ }
        this.conns.delete(server);
      }
    }, 10_000);

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
        // that comes online during an emergency alarms immediately. Reconcile
        // against D1 first, so a panic resolved by a direct DB write (which
        // never fired the resolve emit) is evicted instead of replaying forever.
        await this.reconcileActive();
        for (const a of this.active.values()) this.send(ws, a.payload);
      } catch {
        this.send(ws, { type: 'alerts_auth_error' });
      }
      return;
    }
  }

  // Worker route handlers call this (via /emit) to fan an event to the whole
  // fleet. Two classes of caller:
  //   • Officer-safety (type:'panic_alert')  — fanned out AND driven through the
  //     forced-ack lifecycle below (persist + re-broadcast until acknowledged).
  //   • Lightweight live updates (e.g. type:'unit_position', action:'gps_update'
  //     from src/routes/dispatch/gps.ts) — fanned out fire-and-forget; the
  //     lifecycle block is skipped (the `body.type !== 'panic_alert'` early
  //     return). This is how the map gets live unit-pin/heading movement without
  //     waiting on the ~7s board poll, since the rewrite's own /api/ws socket map
  //     is empty (the live /api/ws lives on the legacy worker).
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
      this.active.set(panicId, { panicId, payload: frame, acked: false, firstAt: Date.now(), level: 1 });
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

  // Self-heal against D1 (the source of truth). A panic resolved/cancelled
  // directly in the DB — bypassing the resolve emit that would have called
  // handleEmit('panic_resolved') — leaves a "zombie" entry here that the
  // mid-incident-join replay (and any future reminder) would re-send to every
  // new console forever. Evict any persisted panic the DB no longer holds in an
  // open ('active'|'acknowledged') state. Only evicts DB-confirmed-closed
  // alerts, so a genuinely live emergency is never dropped.
  private async reconcileActive(): Promise<void> {
    if (this.active.size === 0) return;
    let changed = false;
    const db = getDb(this.env as any);
    for (const id of [...this.active.keys()]) {
      try {
        const row = await queryFirst<{ status: string }>(
          db, 'SELECT status FROM panic_alerts WHERE id = ?', id,
        );
        if (!row || (row.status !== 'active' && row.status !== 'acknowledged')) {
          this.active.delete(id);
          changed = true;
        }
      } catch {
        // Transient DB error — keep the entry so we never drop a live alarm.
      }
    }
    if (changed) await this.persist();
  }

  // Schedule the next reminder sweep if any panic still needs nagging.
  private async armReminder(): Promise<void> {
    const needs = [...this.active.values()].some(a => !a.acked && (Date.now() - a.firstAt) < REMINDER_MAX_MS);
    if (!needs) return;
    const existing = await this.state.storage.getAlarm();
    if (existing == null) await this.state.storage.setAlarm(Date.now() + REMINDER_INTERVAL_MS);
  }

  // DO alarm — re-broadcast every unacked, not-yet-expired panic so the
  // alarm persists agency-wide until a dispatcher acknowledges it, and
  // escalate panics that nobody has acknowledged (Spillman: an unanswered
  // emergency gets louder, not quieter).
  async alarm(): Promise<void> {
    // Drop any panic the DB has since closed before nagging the fleet again.
    await this.reconcileActive();
    let stillNagging = false;
    let levelsChanged = false;
    for (const a of this.active.values()) {
      if (a.acked) continue;
      const elapsed = Date.now() - a.firstAt;
      if (elapsed >= REMINDER_MAX_MS) continue;

      // Escalation sweep — bump the level when an unacked panic crosses a
      // threshold. Best-effort D1 write; the broadcast is what consoles react
      // to, and reconcileActive keeps D1 the source of truth for liveness.
      const targetLevel = 1 + ESCALATION_STEPS_MS.filter((ms) => elapsed >= ms).length;
      if (targetLevel > (a.level ?? 1)) {
        a.level = targetLevel;
        levelsChanged = true;
        try {
          await execute(
            getDb(this.env as any),
            // MAX() keeps the write monotonic — the per-minute D1 sweep
            // (panicEscalationSweep) also raises this column with faster
            // semantics; without the guard this write could downgrade it.
            'UPDATE panic_alerts SET escalation_level = MAX(escalation_level, ?), updated_at = datetime(\'now\') WHERE id = ? AND status = \'active\'',
            targetLevel, a.panicId,
          );
        } catch (err) {
          console.error('[AlertHubDO] escalation_level write failed (non-fatal)', err);
        }
        this.broadcast({
          type: 'panic_alert',
          action: 'panic_escalated',
          panic_id: a.panicId,
          panic: { id: a.panicId, panic_id: a.panicId, escalation_level: targetLevel },
        });
      }

      this.broadcast(a.payload);
      stillNagging = true;
    }
    if (levelsChanged) await this.persist();
    if (stillNagging) await this.state.storage.setAlarm(Date.now() + REMINDER_INTERVAL_MS);
  }
}
