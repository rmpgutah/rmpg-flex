// ============================================================
// RMPG Flex — VoiceHubDO (Durable Object, radio/panic voice hub)
// ============================================================
// Cloudflare Workers run in many isolated V8 instances with no
// shared memory, so the per-isolate WebSocket Map in routes/ws.ts
// CANNOT fan voice out to every unit on a channel — two officers
// can land on different isolates and never hear each other.
//
// A Durable Object is the fix: exactly ONE instance exists per
// room name globally, so every socket for a channel attaches to
// the same object and relay is trivial in-memory.
//
//   Room naming (set by the worker via idFromName):
//     radio-<channelId>   — a radio channel room
//     panic-<panicId>     — a single panic incident's audio room
//
// Half-duplex like a real radio: one transmitter at a time. The
// DO also RECORDS the active transmitter's Opus/WebM chunks and,
// on key-up, concatenates them, stores the clip in R2 (UPLOADS),
// and writes the row that makes it replayable:
//   • radio → radio_transmissions.audio_url
//   • panic → panic_alerts.audio_file_id / audio_duration_seconds
//     (wired in Stage 4; Stage 1 persists radio).
//
// Auth: message-based, mirroring routes/ws.ts. The socket connects
// with no URL token (no JWT in logs/referrers — the 2026-04-15
// policy) and sends an `authenticate` frame the DO verifies with
// jose against env.JWT_SECRET. Only authenticated sockets relay.
// ============================================================

import { jwtVerify } from 'jose';
import { getDb, queryFirst, execute } from '../utils/db';

interface VoiceEnv {
  DB: D1Database;
  UPLOADS: R2Bucket;
  KV: KVNamespace;
  JWT_SECRET: string;
}

interface ConnMeta {
  userId: number;
  username: string;
  fullName: string;
  role: string;
  unitLabel: string | null;
  authenticated: boolean;
}

interface ActiveTx {
  ws: WebSocket;
  userId: number;
  unitLabel: string | null;
  chunks: Uint8Array[];
  bytes: number;
  startedAt: number;
}

// Don't persist sub-second key-fumbles or empty carriers; a real
// transmission is at least this big once Opus-compressed.
const MIN_CLIP_BYTES = 1024;

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class VoiceHubDO {
  state: DurableObjectState;
  env: VoiceEnv;
  conns = new Map<WebSocket, ConnMeta>();
  activeTx: ActiveTx | null = null;
  kind: 'radio' | 'panic' = 'radio';
  refId = 0; // channel_id for radio, panic_id for panic

  constructor(state: DurableObjectState, env: VoiceEnv) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // Room identity travels in the query the worker forwarded
    // (?room=radio-5). It's not sensitive — it's just a channel id —
    // so it's fine in the URL; identity (who you are) is the JWT frame.
    const room = url.searchParams.get('room') || '';
    const m = room.match(/^(radio|panic)-(\d+)$/);
    if (!m) return new Response('Bad room', { status: 400 });
    this.kind = m[1] as 'radio' | 'panic';
    this.refId = Number(m[2]);

    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const pair = new (globalThis as any).WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    (server as any).accept();
    this.conns.set(server, {
      userId: 0, username: '', fullName: '', role: '', unitLabel: null, authenticated: false,
    });

    server.addEventListener('message', (ev: MessageEvent) => {
      this.onMessage(server, ev).catch((err) => console.error('[VoiceHubDO] msg', err));
    });
    server.addEventListener('close', () => this.onClose(server));
    server.addEventListener('error', () => this.onClose(server));

    return new Response(null, { status: 101, webSocket: client });
  }

  private send(ws: WebSocket, obj: unknown): void {
    try { if ((ws as any).readyState === 1) ws.send(JSON.stringify(obj)); } catch { /* in-flight */ }
  }

  // Relay to everyone in the room except the originator.
  private relay(from: WebSocket, obj: unknown): void {
    const msg = JSON.stringify(obj);
    for (const [ws, meta] of this.conns) {
      if (ws === from || !meta.authenticated) continue;
      try { if ((ws as any).readyState === 1) ws.send(msg); } catch { /* ignore */ }
    }
  }

  private broadcast(obj: unknown): void {
    const msg = JSON.stringify(obj);
    for (const [ws, meta] of this.conns) {
      if (!meta.authenticated) continue;
      try { if ((ws as any).readyState === 1) ws.send(msg); } catch { /* ignore */ }
    }
  }

  private presenceCount(): number {
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

    // ── Authentication gate ──
    if (msg.type === 'authenticate') {
      if (meta.authenticated) return;
      try {
        const secret = new TextEncoder().encode(this.env.JWT_SECRET);
        const { payload } = await jwtVerify(msg.token, secret);
        const p = payload as unknown as { user_id?: number; userId?: number };
        const claimed = p.user_id ?? p.userId; // accept both claim names ([[feedback-jwt-claim-naming-mismatch]])
        if (claimed == null) { this.send(ws, { type: 'error', code: 'AUTH_FAILED' }); return; }

        const db = getDb(this.env as any);
        const user = await queryFirst<{ id: number; username: string; role: string; full_name: string; status: string }>(
          db, 'SELECT id, username, role, full_name, status FROM users WHERE id = ? AND status = ?', claimed, 'active',
        );
        if (!user) { this.send(ws, { type: 'error', code: 'AUTH_FAILED' }); return; }

        // Resolve the officer's unit call-sign once for transmit labels.
        const unit = await queryFirst<{ call_sign: string }>(
          db, 'SELECT call_sign FROM units WHERE officer_id = ? LIMIT 1', user.id,
        );
        meta.userId = user.id;
        meta.username = user.username;
        meta.fullName = user.full_name;
        meta.role = user.role;
        meta.unitLabel = unit?.call_sign ?? null;
        meta.authenticated = true;

        this.send(ws, { type: 'voice_ready', room: `${this.kind}-${this.refId}`, members: this.presenceCount() });
        this.broadcast({ type: 'voice_presence', members: this.presenceCount() });
      } catch {
        this.send(ws, { type: 'error', code: 'AUTH_FAILED' });
      }
      return;
    }

    if (!meta.authenticated) { this.send(ws, { type: 'error', code: 'NOT_AUTHENTICATED' }); return; }

    // ── PTT key-down ──
    if (msg.type === 'transmit_start') {
      if (this.activeTx && this.activeTx.ws !== ws) {
        // Half-duplex: someone already holds the channel.
        this.send(ws, { type: 'voice_busy', user_id: this.activeTx.userId });
        return;
      }
      this.activeTx = { ws, userId: meta.userId, unitLabel: meta.unitLabel, chunks: [], bytes: 0, startedAt: Date.now() };
      this.relay(ws, {
        type: 'radio_transmit_start',
        user_id: meta.userId, unit_label: meta.unitLabel, full_name: meta.fullName,
        room: `${this.kind}-${this.refId}`,
      });
      return;
    }

    // ── Audio chunk (base64 webm/opus) ──
    if (msg.type === 'audio') {
      if (!this.activeTx || this.activeTx.ws !== ws || typeof msg.chunk !== 'string') return;
      try {
        const bytes = b64ToBytes(msg.chunk);
        this.activeTx.chunks.push(bytes);
        this.activeTx.bytes += bytes.length;
      } catch { /* bad chunk — drop */ }
      this.relay(ws, { type: 'radio_audio', user_id: meta.userId, chunk: msg.chunk });
      return;
    }

    // ── PTT key-up ──
    if (msg.type === 'transmit_end') {
      if (!this.activeTx || this.activeTx.ws !== ws) return;
      this.relay(ws, { type: 'radio_transmit_end', user_id: meta.userId });
      const finished = this.activeTx;
      this.activeTx = null;
      // Persist in the background so the socket isn't blocked on R2/D1.
      this.state.waitUntil(
        this.persist(finished, typeof msg.transcript === 'string' ? msg.transcript : null)
          .catch((err) => console.error('[VoiceHubDO] persist', err)),
      );
      return;
    }
  }

  private onClose(ws: WebSocket): void {
    const meta = this.conns.get(ws);
    this.conns.delete(ws);
    // If the talker dropped mid-transmission, salvage what we have.
    if (this.activeTx && this.activeTx.ws === ws) {
      const finished = this.activeTx;
      this.activeTx = null;
      this.broadcast({ type: 'radio_transmit_end', user_id: finished.userId });
      this.state.waitUntil(this.persist(finished, null).catch(() => {}));
    }
    if (meta?.authenticated) this.broadcast({ type: 'voice_presence', members: this.presenceCount() });
  }

  // Concatenate the buffered clip, store it in R2, and write the row
  // that makes it replayable. Radio persists today; panic in Stage 4.
  private async persist(tx: ActiveTx, transcript: string | null): Promise<void> {
    if (tx.bytes < MIN_CLIP_BYTES) return; // glitch / empty carrier — skip
    const durationSec = Math.max(0, Math.round((Date.now() - tx.startedAt) / 1000));

    const blob = new Uint8Array(tx.bytes);
    let off = 0;
    for (const c of tx.chunks) { blob.set(c, off); off += c.length; }

    const db = getDb(this.env as any);

    if (this.kind === 'radio') {
      // INSERT first to mint the id, then key the R2 object by it so the
      // serve route (GET /api/radio/transmissions/:id/audio) is a pure
      // id→key map with no extra column needed.
      const res = await execute(
        db,
        `INSERT INTO radio_transmissions (channel_id, user_id, unit_label, transmitted_at, duration_seconds, transcript)
         VALUES (?, ?, ?, datetime('now'), ?, ?)`,
        this.refId, tx.userId, tx.unitLabel, durationSec, transcript,
      );
      const id = Number(res.meta.last_row_id);
      const key = `radio-audio/${id}.webm`;
      await this.env.UPLOADS.put(key, blob, { httpMetadata: { contentType: 'audio/webm' } });
      const audioUrl = `/api/radio/transmissions/${id}/audio`;
      await execute(db, 'UPDATE radio_transmissions SET audio_url = ? WHERE id = ?', audioUrl, id);

      // Tell the room a recording is ready so feeds can show a play button
      // without waiting for the 5s poll.
      const row = await queryFirst(
        db,
        `SELECT t.*, ch.name AS channel_name, u.full_name AS user_name
         FROM radio_transmissions t
         LEFT JOIN radio_channels ch ON ch.id = t.channel_id
         LEFT JOIN users u ON u.id = t.user_id
         WHERE t.id = ?`,
        id,
      );
      this.broadcast({ type: 'radio_recorded', transmission: row });
    }
    // kind === 'panic' persistence is wired in Stage 4 (audio_file_id +
    // audio_duration_seconds on panic_alerts).
  }
}
