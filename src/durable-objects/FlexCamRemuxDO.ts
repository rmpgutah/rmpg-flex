// FlexCamRemuxDO — one instance per footage_request_id, keyed
// idFromName('rmx-' + id). SQLite-backed; alarm-driven; bounded
// retries (3 attempts, exponential backoff 1s/2s/4s).
//
// Storage shape: a single 'state' blob:
//   { state, requestId, attempts, lastError? }
//
// Mirrors the WelfareWatchDO pattern for storage + alarm wiring.

import type { Bindings } from '../types';

type RemuxState = 'queued' | 'working' | 'ready' | 'failed';

interface RemuxBlob {
  state: RemuxState;
  requestId: number;
  attempts: number;
  lastError?: { code: string; message: string };
}

const MAX_ATTEMPTS = 3;

export class FlexCamRemuxDO {
  private state: DurableObjectState;
  private env: Bindings;

  constructor(state: DurableObjectState, env: Bindings) {
    this.state = state;
    this.env = env;
  }

  async enqueue(requestId: number): Promise<{ state: RemuxState; requestId: number }> {
    const cur = await this.state.storage.get<RemuxBlob>('state');
    if (cur && (cur.state === 'working' || cur.state === 'queued')) {
      return { state: cur.state, requestId: cur.requestId };
    }
    const blob: RemuxBlob = { state: 'queued', requestId, attempts: 0 };
    await this.state.storage.put('state', blob);
    await this.state.storage.setAlarm(Date.now() + 1000); // new-date-ok
    await this.markDb('queued', requestId, null);
    return { state: 'queued', requestId };
  }

  async status(): Promise<RemuxBlob | null> {
    return (await this.state.storage.get<RemuxBlob>('state')) ?? null;
  }

  async alarm(): Promise<void> {
    const blob = await this.state.storage.get<RemuxBlob>('state');
    if (!blob) return;
    if (blob.state === 'ready' || blob.state === 'failed') return;

    const working: RemuxBlob = { ...blob, state: 'working' };
    await this.state.storage.put('state', working);
    await this.markDb('working', blob.requestId, null);

    // Snapshot the chunk list at job start.
    const rows = await this.env.DB.prepare(
      `SELECT seq, r2_key FROM footage_chunks
        WHERE request_id = ? AND status = 'downloaded' AND r2_key IS NOT NULL
        ORDER BY seq`,
    ).bind(blob.requestId).all<{ seq: number; r2_key: string }>();
    const chunks = rows.results ?? [];
    const mergedKey = `flexcam/trips/merged/${blob.requestId}.mp4`;

    // Dynamic import so vi.doMock() in tests can intercept (per Tasks 9-10 pattern).
    const concat = await import('../utils/footage/concat');
    const result = await concat.remuxMp4ToFmp4(this.env, mergedKey, chunks);

    if (result.state === 'ready') {
      try {
        await this.env.DB.prepare(
          `UPDATE footage_requests SET
             merged_r2_key = ?,
             merged_sha256 = ?,
             merged_status = 'ready',
             remux_state = 'ready',
             remux_finished_at = ?
           WHERE id = ?`,
        ).bind(mergedKey, result.sha256 ?? null, Date.now(), blob.requestId).run(); // new-date-ok
      } catch { /* non-fatal */ }
      await this.logCustody('remux_complete', blob.requestId, JSON.stringify({ sha256: result.sha256, skipped: result.skipped }));
      const done: RemuxBlob = { ...blob, state: 'ready' };
      await this.state.storage.put('state', done);
      return;
    }

    // Failure path: retry up to MAX_ATTEMPTS.
    const nextAttempts = blob.attempts + 1;
    if (nextAttempts < MAX_ATTEMPTS) {
      const backoffMs = 1000 * Math.pow(2, nextAttempts - 1); // 1s, 2s, 4s
      const requeued: RemuxBlob = {
        state: 'queued',
        requestId: blob.requestId,
        attempts: nextAttempts,
        lastError: { code: result.errorCode ?? 'unknown', message: result.errorMessage ?? '' },
      };
      await this.state.storage.put('state', requeued);
      await this.state.storage.setAlarm(Date.now() + backoffMs); // new-date-ok
      await this.markDb('queued', blob.requestId, JSON.stringify(requeued.lastError));
    } else {
      const lastError = { code: result.errorCode ?? 'unknown', message: result.errorMessage ?? '' };
      const failed: RemuxBlob = {
        state: 'failed',
        requestId: blob.requestId,
        attempts: nextAttempts,
        lastError,
      };
      await this.state.storage.put('state', failed);
      await this.markDb('failed', blob.requestId, JSON.stringify(lastError));
      await this.logCustody('remux_failed', blob.requestId, lastError.message);
    }
  }

  // HTTP entry so the Worker route can call DO via fetch RPC.
  // (Cloudflare DOs only expose fetch() across the wire, not arbitrary methods.)
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/enqueue' && req.method === 'POST') {
      const body = await req.json<{ requestId: number }>();
      const result = await this.enqueue(body.requestId);
      return Response.json(result);
    }
    if (url.pathname === '/status') {
      return Response.json(await this.status());
    }
    return new Response('Not found', { status: 404 });
  }

  private async markDb(state: RemuxState, requestId: number, errorText: string | null): Promise<void> {
    try {
      await this.env.DB.prepare(
        `UPDATE footage_requests SET
           remux_state = ?,
           remux_attempts = COALESCE(remux_attempts, 0) + CASE WHEN ? = 'working' THEN 0 ELSE 1 END,
           remux_started_at = COALESCE(remux_started_at, ?),
           remux_error = ?
         WHERE id = ?`,
      ).bind(state, state, Date.now(), errorText, requestId).run(); // new-date-ok
    } catch { /* schema may lack columns in early environments; non-fatal */ }
  }

  private async logCustody(action: string, requestId: number, detail: string): Promise<void> {
    try {
      await this.env.DB.prepare(
        `INSERT INTO footage_custody_log (footage_request_id, action, detail) VALUES (?, ?, ?)`,
      ).bind(requestId, action, detail).run();
    } catch { /* non-fatal */ }
  }
}
