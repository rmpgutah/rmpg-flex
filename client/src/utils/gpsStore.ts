import { openDB, type IDBPDatabase } from 'idb';

export interface GpsFixInput {
  ts: number;
  lat: number;
  lng: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  source: string;
}

export interface StoredFix extends GpsFixInput {
  id: number;
  synced: 0 | 1;
}

const DB_NAME = 'rmpg-gps';
const STORE = 'fixes';
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

export async function writeFix(fix: GpsFixInput): Promise<number> {
  const db = await getDb();
  return db.add(STORE, { ...fix, synced: 0 }) as Promise<number>;
}

export async function loadUnsynced(): Promise<StoredFix[]> {
  const db = await getDb();
  return db.getAllFromIndex(STORE, 'synced', 0) as Promise<StoredFix[]>;
}

export async function markSynced(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDb();
  const tx = db.transaction(STORE, 'readwrite');
  await Promise.all(
    ids.map(async (id) => {
      const fix = await tx.store.get(id) as StoredFix | undefined;
      if (fix) await tx.store.put({ ...fix, synced: 1 });
    }),
  );
  await tx.done;
}

export async function pruneOld(): Promise<void> {
  const db = await getDb();
  const cutoff = Date.now() - PRUNE_AGE_MS;
  const tx = db.transaction(STORE, 'readwrite');
  const index = tx.store.index('ts');
  let cursor = await index.openCursor(IDBKeyRange.upperBound(cutoff));
  while (cursor) {
    if ((cursor.value as StoredFix).synced === 1) await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function migrateFromLocalStorage(): Promise<void> {
  const LS_KEY = 'rmpg_gps_failover_queue';
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return;
  try {
    const points = JSON.parse(raw) as Array<{
      lat: number; lng: number; accuracy: number | null;
      heading: number | null; speed: number | null;
      timestamp: string; source: string;
    }>;
    if (!Array.isArray(points) || points.length === 0) {
      localStorage.removeItem(LS_KEY);
      return;
    }
    const db = await getDb();
    const tx = db.transaction(STORE, 'readwrite');
    for (const p of points) {
      await tx.store.add({
        ts: new Date(p.timestamp).getTime(),
        lat: p.lat, lng: p.lng,
        accuracy: p.accuracy, heading: p.heading,
        speed: p.speed, source: p.source, synced: 0,
      });
    }
    await tx.done;
    localStorage.removeItem(LS_KEY);
  } catch {
    // Non-fatal — stale LS data just stays until next attempt
  }
}
