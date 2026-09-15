// ============================================================
// serveManagerClient — transport hardening + pagination safety
// ============================================================
// Four grounded defects this pins, all provable from the source as it
// stood before (no ServeManager spec needed to demonstrate any of them):
//
//  D1. SILENT PAGINATION TRUNCATION → PERMANENT JOB LOSS.
//      fetchRecentJobs capped the cursor walk at MAX_PAGES and, on hitting
//      the cap, returned the truncated list indistinguishably from a
//      complete one. pollServeManagerJobs then advanced
//      `servemanager_last_poll_at` to datetime('now'), so every job past the
//      cap was never fetched again. Loss was silent and unrecoverable.
//
//  D2. EVERY TRANSPORT FAILURE COLLAPSED TO `[]`.
//      An expired API key, a 500, or a network fault all returned an empty
//      array, which the poller reported as `{synced: 0}` with no `error`.
//      "ServeManager is down" and "no new jobs" were the same observation.
//
//  D3. NO TIMEOUT, NO RETRY, NO 429 HANDLING.
//      Every other integration client in this repo (Fleetio, Roboflow,
//      CarsXE) wraps fetch in an AbortController timeout with bounded
//      retries and typed errors. ServeManager had a bare fetch(), so a hung
//      connection stalled the cron Worker until the runtime killed it.
//
//  D4. The cursor advanced to wall-clock now() rather than to the watermark
//      actually observed in the data, so any job updated DURING a cycle fell
//      into the gap between fetch and cursor-write and was skipped forever.
//
// These are transport/bookkeeping properties, so they are exercised against
// an injected fetch rather than live ServeManager.
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import {
  smRequest,
  fetchRecentJobsWithKey,
  maxUpdatedAt,
  isRetryableStatus,
  ServeManagerHttpError,
  ServeManagerRateLimitError,
  ServeManagerTimeoutError,
  SM_MAX_PAGES,
  type SmJob,
} from '../src/utils/serveManagerClient';

const KEY = 'test-api-key';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A fetch stub that serves a scripted sequence of responses. */
function scriptedFetch(responses: Array<Response | (() => Promise<Response>)>) {
  const calls: string[] = [];
  let i = 0;
  const impl = vi.fn(async (input: any) => {
    calls.push(typeof input === 'string' ? input : String(input));
    const next = responses[Math.min(i, responses.length - 1)];
    i++;
    return typeof next === 'function' ? next() : next.clone();
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

function job(id: number, updatedAt?: string): SmJob {
  return { id, recipient: {}, updated_at: updatedAt } as SmJob;
}

// ── D3: typed errors, timeout, retry, 429 ────────────────────

describe('smRequest transport', () => {
  it('classifies retryable vs terminal statuses', () => {
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(502)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    // A bad credential must fail fast — retrying an expired key just burns
    // the budget and delays the operator seeing the real problem.
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(403)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
    // 429 is handled on its own path (ServeManagerRateLimitError), never as
    // an in-band retry — same reasoning as the Fleet.io client.
    expect(isRetryableStatus(429)).toBe(false);
  });

  it('retries a 5xx and succeeds on a later attempt', async () => {
    const { impl, calls } = scriptedFetch([
      jsonResponse({ error: 'boom' }, 500),
      jsonResponse({ data: { ok: true } }),
    ]);
    const out = await smRequest({
      path: '/account', apiKey: KEY, fetchImpl: impl, retryDelayMs: 0,
    });
    expect(out).toEqual({ data: { ok: true } });
    expect(calls).toHaveLength(2);
  });

  it('throws a typed ServeManagerHttpError once retries are exhausted', async () => {
    const { impl } = scriptedFetch([jsonResponse({ error: 'boom' }, 500)]);
    await expect(
      smRequest({ path: '/jobs', apiKey: KEY, fetchImpl: impl, retryDelayMs: 0, maxRetries: 1 }),
    ).rejects.toBeInstanceOf(ServeManagerHttpError);
  });

  it('does not retry a 401 — a bad key fails fast', async () => {
    const { impl, calls } = scriptedFetch([jsonResponse({ error: 'denied' }, 401)]);
    await expect(
      smRequest({ path: '/jobs', apiKey: KEY, fetchImpl: impl, retryDelayMs: 0 }),
    ).rejects.toBeInstanceOf(ServeManagerHttpError);
    expect(calls).toHaveLength(1);
  });

  it('surfaces 429 as ServeManagerRateLimitError without retrying', async () => {
    const res = new Response('slow down', { status: 429, headers: { 'retry-after': '30' } });
    const { impl, calls } = scriptedFetch([res]);
    const err = await smRequest({
      path: '/jobs', apiKey: KEY, fetchImpl: impl, retryDelayMs: 0,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ServeManagerRateLimitError);
    expect((err as ServeManagerRateLimitError).retryAfterSeconds).toBe(30);
    expect(calls).toHaveLength(1);
  });

  it('aborts a hung request and throws ServeManagerTimeoutError', async () => {
    const hang = () => new Promise<Response>((_res, rej) => {
      // Mirror what a real fetch does when its AbortSignal fires.
      setTimeout(() => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })), 5);
    });
    await expect(
      smRequest({
        path: '/jobs', apiKey: KEY, fetchImpl: hang as unknown as typeof fetch,
        timeoutMs: 1, retryDelayMs: 0, maxRetries: 0,
      }),
    ).rejects.toBeInstanceOf(ServeManagerTimeoutError);
  });

  it('sends HTTP Basic with the key as username and an empty password', async () => {
    let seenAuth: string | null = null;
    const impl = (async (_url: any, init: any) => {
      seenAuth = new Headers(init?.headers).get('authorization');
      return jsonResponse({ data: {} });
    }) as unknown as typeof fetch;
    await smRequest({ path: '/account', apiKey: KEY, fetchImpl: impl });
    expect(seenAuth).toBe(`Basic ${btoa(`${KEY}:`)}`);
  });

  it('never retries a POST — ServeManager has no idempotency key', async () => {
    const { impl, calls } = scriptedFetch([jsonResponse({ error: 'boom' }, 500)]);
    await expect(
      smRequest({
        path: '/jobs/1/attempts', apiKey: KEY, method: 'POST',
        body: { success: true }, fetchImpl: impl, retryDelayMs: 0,
      }),
    ).rejects.toBeInstanceOf(ServeManagerHttpError);
    expect(calls).toHaveLength(1);
  });
});

// ── D4: watermark derived from the data ──────────────────────

describe('maxUpdatedAt', () => {
  it('returns the latest updated_at across the batch', () => {
    expect(maxUpdatedAt([
      job(1, '2026-08-01T10:00:00Z'),
      job(2, '2026-08-03T09:00:00Z'),
      job(3, '2026-08-02T23:59:59Z'),
    ])).toBe('2026-08-03T09:00:00Z');
  });

  it('ignores missing and unparseable timestamps', () => {
    expect(maxUpdatedAt([job(1), job(2, 'not-a-date'), job(3, '2026-08-01T10:00:00Z')]))
      .toBe('2026-08-01T10:00:00Z');
  });

  it('returns null when nothing usable is present', () => {
    expect(maxUpdatedAt([])).toBeNull();
    expect(maxUpdatedAt([job(1), job(2)])).toBeNull();
  });

  // Ordering must be by instant, not by string — SM timestamps carry a zone
  // offset, so lexicographic comparison picks the wrong winner across zones.
  it('compares by instant rather than lexicographically', () => {
    expect(maxUpdatedAt([
      job(1, '2026-08-01T23:00:00-06:00'), // 2026-08-02T05:00Z — the later instant
      job(2, '2026-08-02T01:00:00Z'),
    ])).toBe('2026-08-01T23:00:00-06:00');
  });
});

// ── D1 + D2: pagination completeness and error propagation ───

describe('fetchRecentJobsWithKey', () => {
  it('follows links.next across pages and dedupes by job id', async () => {
    const { impl } = scriptedFetch([
      jsonResponse({ data: [job(1, '2026-08-01T00:00:00Z'), job(2, '2026-08-02T00:00:00Z')],
        links: { next: 'https://www.servemanager.com/api/jobs?page=2' } }),
      // job 2 repeats across the page boundary — must not be double-counted.
      jsonResponse({ data: [job(2, '2026-08-02T00:00:00Z'), job(3, '2026-08-03T00:00:00Z')],
        links: { next: null } }),
    ]);
    const out = await fetchRecentJobsWithKey(KEY, undefined, { fetchImpl: impl, retryDelayMs: 0 });
    expect(out.jobs.map((j) => j.id)).toEqual([1, 2, 3]);
    expect(out.complete).toBe(true);
    expect(out.error).toBeUndefined();
    expect(out.watermark).toBe('2026-08-03T00:00:00Z');
  });

  it('reports complete=false when the page cap is reached with more pages left', async () => {
    // Always answers with another `next`, so the walk can only end at the cap.
    const impl = (async () => jsonResponse({
      data: [job(1, '2026-08-01T00:00:00Z')],
      links: { next: 'https://www.servemanager.com/api/jobs?page=99' },
    })) as unknown as typeof fetch;
    const out = await fetchRecentJobsWithKey(KEY, undefined, {
      fetchImpl: impl, retryDelayMs: 0, maxPages: 3,
    });
    expect(out.complete).toBe(false);
    expect(out.error).toMatch(/page cap/i);
    // The jobs it did read are still returned — upserts are idempotent, so
    // processing them is strictly better than discarding the work.
    expect(out.jobs.length).toBeGreaterThan(0);
  });

  it('defaults to a page cap high enough not to bite in practice', () => {
    expect(SM_MAX_PAGES).toBeGreaterThanOrEqual(100);
  });

  it('returns partial jobs AND an error when a later page fails', async () => {
    const { impl } = scriptedFetch([
      jsonResponse({ data: [job(1, '2026-08-01T00:00:00Z')],
        links: { next: 'https://www.servemanager.com/api/jobs?page=2' } }),
      jsonResponse({ error: 'boom' }, 500),
    ]);
    const out = await fetchRecentJobsWithKey(KEY, undefined, {
      fetchImpl: impl, retryDelayMs: 0, maxRetries: 0,
    });
    expect(out.jobs.map((j) => j.id)).toEqual([1]);
    expect(out.complete).toBe(false);
    expect(out.error).toBeTruthy();
  });

  it('distinguishes a genuinely empty result from a failure', async () => {
    const { impl } = scriptedFetch([jsonResponse({ data: [], links: { next: null } })]);
    const out = await fetchRecentJobsWithKey(KEY, undefined, { fetchImpl: impl, retryDelayMs: 0 });
    expect(out.jobs).toEqual([]);
    expect(out.complete).toBe(true);
    expect(out.error).toBeUndefined();
    expect(out.watermark).toBeNull();
  });

  it('passes updated_since and the max per_page on the first request', async () => {
    const { impl, calls } = scriptedFetch([jsonResponse({ data: [], links: { next: null } })]);
    await fetchRecentJobsWithKey(KEY, '2026-08-01 00:00:00', { fetchImpl: impl, retryDelayMs: 0 });
    expect(calls[0]).toContain('per_page=100');
    expect(calls[0]).toContain('updated_since=');
  });

  it('tolerates a bare-array payload as well as the JSON:API envelope', async () => {
    const { impl } = scriptedFetch([jsonResponse([job(7, '2026-08-05T00:00:00Z')])]);
    const out = await fetchRecentJobsWithKey(KEY, undefined, { fetchImpl: impl, retryDelayMs: 0 });
    expect(out.jobs.map((j) => j.id)).toEqual([7]);
    expect(out.complete).toBe(true);
  });
});
