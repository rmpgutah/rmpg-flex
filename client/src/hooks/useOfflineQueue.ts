import { openDB, type IDBPDatabase } from 'idb';
import { useEffect, useCallback, useState } from 'react';

export interface QueuedOperation {
  id: string;
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
  timestamp: number;
  retries: number;
}

const DB_NAME = 'rmpg_offline_queue';
const STORE = 'operations';
export const MAX_RETRIES = 5;

const ALLOWED_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

let _db: IDBPDatabase | null = null;
let _seq = 0;

async function getQueueDb(): Promise<IDBPDatabase> {
  if (_db) return _db;
  _db = await openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp');
      }
    },
    blocked() { _db = null; },
    blocking() { _db?.close(); _db = null; },
  });
  return _db;
}

/** For testing only — close and clear the cached connection. */
export function _closeQueueDb(): void {
  _db?.close();
  _db = null;
  _seq = 0;
}

/**
 * Enqueue a mutation operation for later replay.
 * Throws if `method` is not one of POST / PATCH / PUT / DELETE.
 * GET requests must never be queued.
 */
export async function enqueueOperation(
  op: Omit<QueuedOperation, 'id' | 'timestamp' | 'retries'>,
): Promise<void> {
  if (!ALLOWED_METHODS.has(op.method.toUpperCase())) {
    throw new Error(
      `useOfflineQueue: method "${op.method}" cannot be queued; only POST/PATCH/PUT/DELETE are allowed`,
    );
  }
  const db = await getQueueDb();
  await db.add(STORE, {
    ...op,
    id: crypto.randomUUID(),
    timestamp: Date.now() * 1000 + (_seq++),
    retries: 0,
  });
}

export async function getQueuedOperations(): Promise<QueuedOperation[]> {
  const db = await getQueueDb();
  return db.getAllFromIndex(STORE, 'timestamp');
}

export async function removeOperation(id: string): Promise<void> {
  const db = await getQueueDb();
  await db.delete(STORE, id);
}

export async function incrementRetries(id: string): Promise<void> {
  const db = await getQueueDb();
  const tx = db.transaction(STORE, 'readwrite');
  const op = await tx.store.get(id);
  if (op) {
    op.retries += 1;
    await tx.store.put(op);
  }
  await tx.done;
}

type QueueFetcher = (
  path: string,
  options: { method: string; body?: string; headers: Record<string, string> },
) => Promise<unknown>;

/**
 * Replay queued operations using the provided fetcher.
 * Ops with retries >= MAX_RETRIES are skipped (not replayed, not incremented).
 * Exported for testing — the hook wraps this with the real apiFetch.
 */
export async function drainQueue(fetcher: QueueFetcher): Promise<void> {
  const ops = await getQueuedOperations();
  for (const op of ops) {
    if (op.retries >= MAX_RETRIES) continue;
    try {
      await fetcher(op.path, {
        method: op.method,
        body: op.body !== undefined ? JSON.stringify(op.body) : undefined,
        headers: { 'Content-Type': 'application/json', ...op.headers },
      });
      await removeOperation(op.id);
    } catch {
      await incrementRetries(op.id);
    }
  }
}

export function useOfflineQueue(): {
  enqueue: (op: Omit<QueuedOperation, 'id' | 'timestamp' | 'retries'>) => Promise<void>;
  drain: () => Promise<void>;
  pendingCount: number;
  failedOps: QueuedOperation[];
} {
  const [pendingCount, setPendingCount] = useState(0);
  const [failedOps, setFailedOps] = useState<QueuedOperation[]>([]);

  const syncState = useCallback(async () => {
    const ops = await getQueuedOperations();
    setPendingCount(ops.filter(op => op.retries < MAX_RETRIES).length);
    setFailedOps(ops.filter(op => op.retries >= MAX_RETRIES));
  }, []);

  const drain = useCallback(async () => {
    if (!navigator.onLine) return;
    const { apiFetch } = await import('./useApi');
    await drainQueue((path, opts) => apiFetch<unknown>(path, { ...opts, _skipQueue: true }));
    await syncState();
  }, [syncState]);

  const enqueue = useCallback(async (
    op: Omit<QueuedOperation, 'id' | 'timestamp' | 'retries'>,
  ) => {
    await enqueueOperation(op);
    await syncState();
  }, [syncState]);

  useEffect(() => {
    void syncState();
    window.addEventListener('online', drain);
    window.addEventListener('focus', drain);
    const interval = setInterval(drain, 30_000);
    void drain();
    return () => {
      window.removeEventListener('online', drain);
      window.removeEventListener('focus', drain);
      clearInterval(interval);
    };
  }, [drain, syncState]);

  return { enqueue, drain, pendingCount, failedOps };
}
