// ============================================================
// RMPG Flex — WelfareWatchDO (Durable Object, DI-4 timer)
// ============================================================
// Spillman-style officer welfare watcher. The legacy Express
// server used setInterval + Map<userId, watch>. On Cloudflare
// Workers, in-memory state doesn't survive between requests —
// so we use a Durable Object with `state.storage.setAlarm()`
// to fire the same three-stage escalation:
//
//   Stage 1 (prompt): 15 min of silence on a P1/P2 onscene call
//                     → sendToUser welfare_check
//   Stage 2 (alert):  +2 min if not ack'd
//                     → broadcastAll welfare_alert
//   Stage 3 (emerg):  +5 min if still not ack'd
//                     → broadcastAll welfare_emergency
//
// One DO instance per officer (singleton via env.WELFARE_WATCH.idFromName(`u-${userId}`)).
// State persisted in DurableObjectStorage so a restart doesn't
// lose active watches.
// ============================================================

interface WatchState {
  user_id: number;
  call_sign: string | null;
  call_id: number | null;
  call_number: string | null;
  stage: 0 | 1 | 2 | 3;         // 0 = idle, 1/2/3 = escalation stage fired
  last_activity_at: number;     // epoch ms — bumped by recordActivity
  started_at: number;
  fired_at: number | null;      // ms when current stage fired (for next alarm offset)
}

const PROMPT_AFTER_MS    = 15 * 60 * 1000;  // 15 min
const ALERT_AFTER_MS     =  2 * 60 * 1000;  //  +2 min
const EMERGENCY_AFTER_MS =  5 * 60 * 1000;  //  +5 min

export class WelfareWatchDO {
  state: DurableObjectState;
  env: { JWT_SECRET: string; KV: KVNamespace };

  constructor(state: DurableObjectState, env: any) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = `${request.method} ${url.pathname}`;
    try {
      if (method === 'POST /start') return await this.handleStart(await request.json());
      if (method === 'POST /ack') return await this.handleAck();
      if (method === 'POST /activity') return await this.handleActivity();
      if (method === 'POST /help') return await this.handleHelp(await request.json());
      if (method === 'POST /stop') return await this.handleStop();
      if (method === 'GET /state') return await this.handleGetState();
      return new Response('Not Found', { status: 404 });
    } catch (err) {
      console.error('[WelfareWatchDO] error', err);
      return Response.json({ error: 'DO error', detail: (err as Error).message }, { status: 500 });
    }
  }

  private async getState(): Promise<WatchState | null> {
    return (await this.state.storage.get<WatchState>('watch')) ?? null;
  }

  private async setState(s: WatchState | null): Promise<void> {
    if (s == null) await this.state.storage.delete('watch');
    else await this.state.storage.put('watch', s);
  }

  // POST /start { user_id, call_sign, call_id, call_number }
  // Begin watching. Stage = 0. Alarm set for PROMPT_AFTER_MS from now.
  private async handleStart(body: any): Promise<Response> {
    const now = Date.now();
    const next: WatchState = {
      user_id: Number(body.user_id),
      call_sign: body.call_sign || null,
      call_id: body.call_id ?? null,
      call_number: body.call_number || null,
      stage: 0,
      last_activity_at: now,
      started_at: now,
      fired_at: null,
    };
    await this.setState(next);
    await this.state.storage.setAlarm(now + PROMPT_AFTER_MS);
    return Response.json({ success: true, started_at: now, next_alarm_in_ms: PROMPT_AFTER_MS });
  }

  // POST /ack — officer responded Code 4. Clear state + cancel alarm.
  private async handleAck(): Promise<Response> {
    await this.setState(null);
    await this.state.storage.deleteAlarm();
    return Response.json({ success: true, cleared: true });
  }

  // POST /activity — GPS ping, status change, etc. Bumps timer.
  private async handleActivity(): Promise<Response> {
    const s = await this.getState();
    if (!s) return Response.json({ success: true, ignored: 'no_active_watch' });
    const now = Date.now();
    s.last_activity_at = now;
    s.stage = 0;
    s.fired_at = null;
    await this.setState(s);
    await this.state.storage.setAlarm(now + PROMPT_AFTER_MS);
    return Response.json({ success: true, reset: true });
  }

  // POST /help { reason? } — officer pressed NEED HELP.
  // Skip the staged escalation; emit emergency now. Watch stays in
  // stage 3 (waiting for supervisor to clear via /ack).
  private async handleHelp(body: any): Promise<Response> {
    const s = await this.getState();
    if (!s) return Response.json({ success: true, ignored: 'no_active_watch' });
    s.stage = 3;
    s.fired_at = Date.now();
    await this.setState(s);
    // The DO can't directly call sendToUser/broadcastAll (those live in
    // the Worker module). The /help handler in welfare.ts already does
    // the broadcast — this just records the state transition.
    return Response.json({ success: true, escalated_to: 'emergency' });
  }

  private async handleStop(): Promise<Response> {
    await this.setState(null);
    await this.state.storage.deleteAlarm();
    return Response.json({ success: true });
  }

  private async handleGetState(): Promise<Response> {
    const s = await this.getState();
    return Response.json(s ?? { stage: 0, idle: true });
  }

  // alarm() — invoked by the Workers runtime at the time we set via
  // state.storage.setAlarm(). Drives the 3-stage escalation.
  async alarm(): Promise<void> {
    const s = await this.getState();
    if (!s) return;

    const now = Date.now();
    const silentMs = now - s.last_activity_at;

    if (s.stage === 0 && silentMs >= PROMPT_AFTER_MS) {
      // Stage 1 — prompt
      s.stage = 1;
      s.fired_at = now;
      await this.setState(s);
      await this.notifyWorker('prompt', s);
      await this.state.storage.setAlarm(now + ALERT_AFTER_MS);
      return;
    }
    if (s.stage === 1 && silentMs >= PROMPT_AFTER_MS + ALERT_AFTER_MS) {
      // Stage 2 — supervisor alert
      s.stage = 2;
      s.fired_at = now;
      await this.setState(s);
      await this.notifyWorker('alert', s);
      await this.state.storage.setAlarm(now + EMERGENCY_AFTER_MS);
      return;
    }
    if (s.stage === 2 && silentMs >= PROMPT_AFTER_MS + ALERT_AFTER_MS + EMERGENCY_AFTER_MS) {
      // Stage 3 — emergency
      s.stage = 3;
      s.fired_at = now;
      await this.setState(s);
      await this.notifyWorker('emergency', s);
      // No further alarm — waits for officer ack or supervisor stop
    }
  }

  // Calls back into the Worker via an internal RPC. The Worker
  // listens on /__welfare-fire (auth-gated by JWT_SECRET) and
  // routes the broadcast/sendToUser side-effects.
  private async notifyWorker(stage: 'prompt' | 'alert' | 'emergency', s: WatchState): Promise<void> {
    try {
      await fetch('https://api.rmpgutah.us/__welfare-fire', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-DO-Secret': this.env.JWT_SECRET,
        },
        body: JSON.stringify({ stage, watch: s }),
      });
    } catch {
      // best-effort — alarm will retry on next stage transition
    }
  }
}
