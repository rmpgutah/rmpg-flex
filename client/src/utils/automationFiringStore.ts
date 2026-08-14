import { openDB, type IDBPDatabase } from 'idb';

export interface ClientFiringRecord {
  rule_id: number;
  rule_name: string;
  trigger_type: string;
  action_type: string;
  trigger_lat: number;
  trigger_lng: number;
  fired_at: string; // ISO string
  context: Record<string, unknown>;
}

interface StoredFiring extends ClientFiringRecord {
  id: number;
  synced: 0 | 1;
}

const DB_NAME = 'rmpg-automations';
const STORE = 'firings';
const PRUNE_AGE_MS = 72 * 60 * 60 * 1000;

let _db: IDBPDatabase | null = null;

/** Reset the cached DB handle — call this in test beforeEach before deleteDatabase. */
export function _resetDbForTests(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

async function getDb(): Promise<IDBPDatabase> {
  if (!_db) {
    _db = await openDB(DB_NAME, 1, {
      upgrade(db) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('ts', 'ts');
        store.createIndex('synced', 'synced');
      },
    });
  }
  return _db;
}

export async function queueClientFiring(firing: ClientFiringRecord): Promise<void> {
  const db = await getDb();
  await db.add(STORE, { ...firing, ts: new Date(firing.fired_at).getTime(), synced: 0 });
}

/** Alias for queueClientFiring — preferred name used by sw.js and useGpsTracking. */
export const writeFiring = queueClientFiring;

export async function loadUnsynced(): Promise<StoredFiring[]> {
  const db = await getDb();
  return db.getAllFromIndex(STORE, 'synced', 0) as Promise<StoredFiring[]>;
}

export async function markFiringsSynced(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDb();
  const tx = db.transaction(STORE, 'readwrite');
  await Promise.all(
    ids.map(async (id) => {
      const rec = await tx.store.get(id) as StoredFiring | undefined;
      if (rec) await tx.store.put({ ...rec, synced: 1 });
    }),
  );
  await tx.done;
}

export async function pruneOldFirings(): Promise<void> {
  const db = await getDb();
  const cutoff = Date.now() - PRUNE_AGE_MS;
  const tx = db.transaction(STORE, 'readwrite');
  const index = tx.store.index('ts');
  let cursor = await index.openCursor(IDBKeyRange.upperBound(cutoff));
  while (cursor) {
    if ((cursor.value as StoredFiring).synced === 1) await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}
