import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import {
  enqueueOperation,
  getQueuedOperations,
  removeOperation,
  incrementRetries,
  _closeQueueDb,
} from '../hooks/useOfflineQueue';

beforeEach(async () => {
  _closeQueueDb();
  await deleteDB('rmpg_offline_queue');
});

describe('enqueueOperation', () => {
  it('adds an operation with id, timestamp, retries=0', async () => {
    await enqueueOperation({ method: 'POST', path: '/api/dispatch/calls', body: { type: 'Test' }, headers: {} });
    const ops = await getQueuedOperations();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ method: 'POST', path: '/api/dispatch/calls', retries: 0 });
    expect(typeof ops[0].id).toBe('string');
    expect(ops[0].timestamp).toBeGreaterThan(0);
  });

  it('returns multiple operations sorted by timestamp', async () => {
    await enqueueOperation({ method: 'POST', path: '/api/a', body: {}, headers: {} });
    await enqueueOperation({ method: 'PATCH', path: '/api/b', body: {}, headers: {} });
    const ops = await getQueuedOperations();
    expect(ops).toHaveLength(2);
    expect(ops[0].path).toBe('/api/a');
    expect(ops[1].path).toBe('/api/b');
  });
});

describe('removeOperation', () => {
  it('removes the operation by id', async () => {
    await enqueueOperation({ method: 'POST', path: '/api/a', body: {}, headers: {} });
    const [op] = await getQueuedOperations();
    await removeOperation(op.id);
    expect(await getQueuedOperations()).toHaveLength(0);
  });

  it('is a no-op for unknown id', async () => {
    await expect(removeOperation('does-not-exist')).resolves.toBeUndefined();
  });
});

describe('incrementRetries', () => {
  it('increments retries from 0 to 1', async () => {
    await enqueueOperation({ method: 'POST', path: '/api/a', body: {}, headers: {} });
    const [op] = await getQueuedOperations();
    await incrementRetries(op.id);
    const [updated] = await getQueuedOperations();
    expect(updated.retries).toBe(1);
  });

  it('increments retries multiple times', async () => {
    await enqueueOperation({ method: 'POST', path: '/api/a', body: {}, headers: {} });
    const [op] = await getQueuedOperations();
    await incrementRetries(op.id);
    await incrementRetries(op.id);
    await incrementRetries(op.id);
    const [updated] = await getQueuedOperations();
    expect(updated.retries).toBe(3);
  });
});
