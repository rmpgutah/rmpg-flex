// ============================================================
// retryTransient — one silent retry to ride out a transient blip
//
// Field devices run on cellular and routinely hit brief dead-zone
// hiccups: a dropped connection, an ERR_CONNECTION_REFUSED, or a
// spurious edge 404 that vanishes a second later. apiFetch already
// retries network throws + 5xx a few times, but a one-off 4xx/edge
// blip on a record-list GET is NOT retried and dead-ends the tab.
//
// withOneRetry wraps a read so a single transient failure self-heals
// before the UI surfaces an error. It does NOT mask a genuine error:
// a real failure still throws — just ~delayMs later, after one retry.
// Use ONLY for idempotent reads (GET list fetches), never mutations.
// ============================================================

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Run `fn`; if it throws, wait `delayMs` and run it once more. The second
 * failure propagates to the caller. Returns the first successful result.
 */
export async function withOneRetry<T>(fn: () => Promise<T>, delayMs = 800): Promise<T> {
  try {
    return await fn();
  } catch {
    await sleep(delayMs);
    return await fn();
  }
}
