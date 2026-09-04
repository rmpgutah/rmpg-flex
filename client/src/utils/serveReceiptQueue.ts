// ============================================================
// Offline capture for the Acknowledgement of Service.
//
// The failure this exists for is specific and common: the form loads on a
// doorstep, the person reads it, ticks seven statements and signs — and
// the submit fails because the signal dropped. Today that loses a
// signature already given, and the officer has to ask an already-irritated
// stranger to do the whole thing again.
//
// So the submission is written to IndexedDB BEFORE the network is
// attempted, and only cleared once the server has it. If the tab survives,
// a listener drains on reconnect. If the tab dies, the next load of that
// same token drains it.
//
// Why not the app's existing offline queue (client/src/services/
// offlineSync.ts → POST /api/offline/sync/push): that route is
// authenticated and re-dispatches through the root Hono app with the
// officer's JWT. The signing device is a member of the public's own phone
// and has no session at all — the token in the URL is the entire
// credential. This queue is therefore token-keyed and posts to the public
// endpoint directly.
//
// Safety: the token burns on the first SUCCESSFUL submission, server-side
// and conditionally, so a queued replay racing a live submit cannot
// double-record. The loser gets 409 already_signed, which this treats as
// success — the record exists, which is the thing that mattered.
// ============================================================

const DB_NAME = 'rmpg-serve-receipt';
const STORE = 'pending';
const DB_VERSION = 1;

export interface QueuedSubmission {
  /** The token IS the key: one pending submission per signing link, ever. */
  token: string;
  payload: unknown;
  queuedAt: number;
  attempts: number;
  lastError?: string;
}

/**
 * Storage seam.
 *
 * IndexedDB in the browser; swappable in tests, which is why this is an
 * interface rather than direct calls. Also the graceful path for private
 * browsing, where indexedDB.open can reject outright — a signer in a
 * private tab still gets a working form, just without the safety net.
 */
export interface QueueStore {
  get(token: string): Promise<QueuedSubmission | null>;
  put(entry: QueuedSubmission): Promise<void>;
  del(token: string): Promise<void>;
}

let store: QueueStore | null = null;

/** Test seam. Pass null to restore the IndexedDB-backed default. */
export function setQueueStore(s: QueueStore | null): void {
  store = s;
}

function memoryStore(): QueueStore {
  const m = new Map<string, QueuedSubmission>();
  return {
    async get(t) { return m.get(t) ?? null; },
    async put(e) { m.set(e.token, e); },
    async del(t) { m.delete(t); },
  };
}

function idbStore(): QueueStore {
  return {
    get: (t) => tx<QueuedSubmission | undefined>('readonly', (s2) => s2.get(t)).then((r) => r ?? null),
    put: (e) => tx('readwrite', (s2) => s2.put(e)).then(() => undefined),
    del: (t) => tx('readwrite', (s2) => s2.delete(t)).then(() => undefined),
  };
}

function activeStore(): QueueStore {
  if (store) return store;
  // No indexedDB at all (private mode, ancient browser): fall back to a
  // per-tab memory store. It survives a dropped request, which is the
  // common case, just not a closed tab.
  store = typeof indexedDB === 'undefined' ? memoryStore() : idbStore();
  return store;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'token' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  }));
}

/** Persist before the network is touched. */
export async function enqueueSubmission(token: string, payload: unknown): Promise<void> {
  await activeStore().put({ token, payload, queuedAt: Date.now(), attempts: 0 });
}

export async function getQueued(token: string): Promise<QueuedSubmission | null> {
  return activeStore().get(token);
}

export async function clearQueued(token: string): Promise<void> {
  await activeStore().del(token);
}

async function noteAttempt(entry: QueuedSubmission, error: string): Promise<void> {
  await activeStore().put({ ...entry, attempts: entry.attempts + 1, lastError: error });
}

/**
 * How long a queued signature stays worth replaying.
 *
 * Tokens expire (30 days by default) and can be revoked. A submission
 * that has sat longer than the token could possibly live will replay
 * into a 410 forever, and every one of those attempts is a stranger's
 * phone quietly waking up to POST a signature at a server that will
 * never take it. Ten days is inside the token's life with room to spare.
 */
const MAX_QUEUE_AGE_MS = 10 * 24 * 60 * 60 * 1000;

/**
 * Delay before the next attempt, in ms.
 *
 * Exponential with a ceiling. A flat 15s interval was polling a dead
 * network four times a minute indefinitely — on a phone, on someone
 * else's battery, for a signature they have already given and cannot
 * see. Backing off costs nothing: 'online' and 'focus' still fire
 * immediately when connectivity genuinely returns, so the timer is the
 * fallback rather than the mechanism.
 */
export function backoffMs(attempts: number): number {
  return Math.min(15_000 * 2 ** Math.max(0, attempts), 10 * 60 * 1000);
}

export type FlushResult =
  | { status: 'sent'; body: any }
  | { status: 'already_signed' }
  | { status: 'rejected'; message: string }
  | { status: 'offline'; retryInMs: number }
  | { status: 'expired' }
  | { status: 'nothing' };

/**
 * Try to deliver a queued submission.
 *
 * The four outcomes are deliberately distinct, because they call for
 * different things from the person holding the phone:
 *
 *   sent           done, show them the receipt
 *   already_signed the record exists — a replay lost a race, or the
 *                  officer recorded it. Clear and treat as done: the goal
 *                  was a record, not this particular request winning.
 *   rejected       the server refused it on the merits (incomplete, token
 *                  revoked). Retrying forever will never fix that, so
 *                  clear it and say so rather than looping silently.
 *   offline        still no signal. KEEP it and try again later.
 */
export async function flushQueued(token: string): Promise<FlushResult> {
  const entry = await getQueued(token);
  if (!entry) return { status: 'nothing' };

  // Past the point where the token could still be alive. Dropping it is
  // the honest outcome: the record was never made, and pretending a
  // months-old replay might still land keeps a phone retrying forever
  // while telling the officer nothing.
  if (Date.now() - entry.queuedAt > MAX_QUEUE_AGE_MS) {
    await clearQueued(token);
    return { status: 'expired' };
  }

  let res: Response;
  try {
    res = await fetch(`/api/serve-receipt/${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry.payload),
    });
  } catch (err) {
    await noteAttempt(entry, err instanceof Error ? err.message : 'network');
    return { status: 'offline', retryInMs: backoffMs(entry.attempts) };
  }

  const body = await res.json().catch(() => ({} as any));

  if (res.ok && body?.ok) {
    await clearQueued(token);
    return { status: 'sent', body };
  }
  // The token is gone — revoked, expired, or scan-capped. Retrying will
  // never fix that, and it is a different outcome from "refused on the
  // merits": nothing was wrong with the submission, it simply arrived
  // too late to be accepted.
  if (res.status === 410) {
    await clearQueued(token);
    return { status: 'expired' };
  }
  if (body?.code === 'already_signed') {
    await clearQueued(token);
    return { status: 'already_signed' };
  }
  // 5xx is the server having a bad moment, not a verdict on the
  // submission — keep it and retry. Anything else is a decision.
  if (res.status >= 500) {
    await noteAttempt(entry, `server ${res.status}`);
    return { status: 'offline', retryInMs: backoffMs(entry.attempts) };
  }
  await clearQueued(token);
  return { status: 'rejected', message: body?.message || 'This submission was not accepted.' };
}
