import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  queueClientFiring, writeFiring, loadUnsynced, markFiringsSynced, pruneOldFirings,
  _resetDbForTests, type ClientFiringRecord,
} from '../automationFiringStore';

const firing1: ClientFiringRecord = {
  rule_id: 1,
  rule_name: 'Speed Alert',
  trigger_type: 'speed_threshold',
  action_type: 'notify_officer',
  trigger_lat: 40.7,
  trigger_lng: -111.9,
  fired_at: new Date(1000).toISOString(),
  context: { speed: 30, accuracy: 5 },
};

const firing2: ClientFiringRecord = {
  rule_id: 2,
  rule_name: 'No Movement',
  trigger_type: 'no_movement',
  action_type: 'notify_officer',
  trigger_lat: 40.8,
  trigger_lng: -111.8,
  fired_at: new Date(2000).toISOString(),
  context: { speed: 0, accuracy: 8 },
};

beforeEach(async () => {
  _resetDbForTests();
  indexedDB.deleteDatabase('rmpg-automations');
});

describe('writeFiring (alias for queueClientFiring)', () => {
  it('stores a firing via the writeFiring alias', async () => {
    await writeFiring(firing1);
    const rows = await loadUnsynced();
    expect(rows).toHaveLength(1);
    expect(rows[0].rule_id).toBe(1);
    expect(rows[0].synced).toBe(0);
  });
});

describe('queueClientFiring / loadUnsynced', () => {
  it('stores a firing and returns it in loadUnsynced with synced=0', async () => {
    await queueClientFiring(firing1);
    const rows = await loadUnsynced();
    expect(rows).toHaveLength(1);
    expect(rows[0].rule_id).toBe(1);
    expect(rows[0].rule_name).toBe('Speed Alert');
    expect(rows[0].synced).toBe(0);
  });

  it('stores multiple firings', async () => {
    await queueClientFiring(firing1);
    await queueClientFiring(firing2);
    const rows = await loadUnsynced();
    expect(rows).toHaveLength(2);
  });
});

describe('markFiringsSynced', () => {
  it('marks the specified firing synced so it no longer appears in loadUnsynced', async () => {
    await queueClientFiring(firing1);
    await queueClientFiring(firing2);
    const rows = await loadUnsynced();
    const id1 = rows.find((r) => r.rule_id === 1)!.id;
    await markFiringsSynced([id1]);
    const remaining = await loadUnsynced();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].rule_id).toBe(2);
  });

  it('is a no-op for an empty ids array', async () => {
    await queueClientFiring(firing1);
    await markFiringsSynced([]);
    const rows = await loadUnsynced();
    expect(rows).toHaveLength(1);
  });
});

describe('pruneOldFirings', () => {
  it('deletes synced firings older than 72h and keeps recent ones', async () => {
    const oldFiredAt = new Date(Date.now() - 73 * 60 * 60 * 1000).toISOString();
    await queueClientFiring({ ...firing1, fired_at: oldFiredAt });
    const [old] = await loadUnsynced();
    await markFiringsSynced([old.id]);

    // Recent unsynced firing — must survive
    await queueClientFiring(firing2);

    await pruneOldFirings();
    const remaining = await loadUnsynced();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].rule_id).toBe(2);
  });

  it('does not delete unsynced old firings', async () => {
    const oldFiredAt = new Date(Date.now() - 73 * 60 * 60 * 1000).toISOString();
    await queueClientFiring({ ...firing1, fired_at: oldFiredAt });
    // Not marked synced
    await pruneOldFirings();
    const rows = await loadUnsynced();
    expect(rows).toHaveLength(1);
  });
});
