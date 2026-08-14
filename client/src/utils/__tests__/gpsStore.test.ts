import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  writeFix, loadUnsynced, markSynced, pruneOld,
  migrateFromLocalStorage, _resetDbForTests, type GpsFixInput,
} from '../gpsStore';

const fix1: GpsFixInput = { ts: 1000, lat: 40.7, lng: -111.9, accuracy: 5, heading: null, speed: 2.5, source: 'gps' };
const fix2: GpsFixInput = { ts: 2000, lat: 40.8, lng: -111.8, accuracy: 8, heading: 90, speed: 0, source: 'wifi' };

beforeEach(async () => {
  // Reset the module-level DB cache and delete the underlying store
  _resetDbForTests();
  indexedDB.deleteDatabase('rmpg-gps');
});

describe('writeFix / loadUnsynced', () => {
  it('returns an id and the fix appears in loadUnsynced', async () => {
    const id = await writeFix(fix1);
    expect(typeof id).toBe('number');
    const rows = await loadUnsynced();
    expect(rows).toHaveLength(1);
    expect(rows[0].lat).toBe(40.7);
    expect(rows[0].synced).toBe(0);
  });
});

describe('markSynced', () => {
  it('marks fixes so they no longer appear in loadUnsynced', async () => {
    const id = await writeFix(fix1);
    await writeFix(fix2);
    await markSynced([id]);
    const rows = await loadUnsynced();
    expect(rows).toHaveLength(1);
    expect(rows[0].ts).toBe(2000);
  });
});

describe('pruneOld', () => {
  it('deletes synced fixes older than 72h, keeps recent ones', async () => {
    const OLD = Date.now() - 73 * 60 * 60 * 1000;
    const id = await writeFix({ ...fix1, ts: OLD });
    await markSynced([id]);
    await writeFix(fix2); // recent, unsynced — must survive
    await pruneOld();
    const rows = await loadUnsynced();
    expect(rows).toHaveLength(1);
    expect(rows[0].ts).toBe(fix2.ts);
  });
});

describe('migrateFromLocalStorage', () => {
  it('moves LS points to IDB and removes the LS key', async () => {
    const points = [
      { lat: 40.7, lng: -111.9, accuracy: 5, heading: null, speed: 1, timestamp: new Date(5000).toISOString(), source: 'gps' },
    ];
    localStorage.setItem('rmpg_gps_failover_queue', JSON.stringify(points));
    await migrateFromLocalStorage();
    expect(localStorage.getItem('rmpg_gps_failover_queue')).toBeNull();
    const rows = await loadUnsynced();
    expect(rows).toHaveLength(1);
    expect(rows[0].ts).toBe(5000);
  });
});
