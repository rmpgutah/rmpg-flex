import { openDB, type IDBPDatabase } from 'idb';
import { useEffect, useCallback } from 'react';

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

export async function enqueueOperation(
  op: Omit<QueuedOperation, 'id' | 'timestamp' | 'retries'>,
): Promise<void> {
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

export function useOfflineQueue(): void {
  const drain = useCallback(async () => {
    if (!navigator.onLine) return;
    const { apiFetch } = await import('./useApi');
    const ops = await getQueuedOperations();
    for (const op of ops) {
      try {
        await (apiFetch as Function)(op.path, {
          method: op.method,
          body: op.body !== undefined ? JSON.stringify(op.body) : undefined,
          headers: { 'Content-Type': 'application/json', ...op.headers },
          _skipQueue: true,
        });
        await removeOperation(op.id);
      } catch {
        await incrementRetries(op.id);
      }
    }
  }, []);

  useEffect(() => {
    window.addEventListener('online', drain);
    window.addEventListener('focus', drain);
    const interval = setInterval(drain, 30_000);
    void drain();
    return () => {
      window.removeEventListener('online', drain);
      window.removeEventListener('focus', drain);
      clearInterval(interval);
    };
  }, [drain]);
}
