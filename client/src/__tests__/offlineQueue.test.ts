import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import {
  enqueueOperation,
  getQueuedOperations,
  removeOperation,
  incrementRetries,
  drainQueue,
  _closeQueueDb,
  MAX_RETRIES,
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

  it('throws when method is GET', async () => {
    await expect(
      enqueueOperation({ method: 'GET', path: '/api/a', body: {}, headers: {} }),
    ).rejects.toThrow(/cannot be queued/);
  });

  it('throws when method is HEAD', async () => {
    await expect(
      enqueueOperation({ method: 'HEAD', path: '/api/a', body: {}, headers: {} }),
    ).rejects.toThrow(/cannot be queued/);
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

describe('drainQueue', () => {
  it('replays a queued op and removes it on success', async () => {
    await enqueueOperation({ method: 'POST', path: '/api/a', body: { x: 1 }, headers: {} });
    const fetcher = vi.fn().mockResolvedValue(undefined);

    await drainQueue(fetcher);

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith('/api/a', expect.objectContaining({ method: 'POST' }));
    expect(await getQueuedOperations()).toHaveLength(0);
  });

  it('increments retries on failure and keeps the op in the queue', async () => {
    await enqueueOperation({ method: 'PATCH', path: '/api/b', body: {}, headers: {} });
    const fetcher = vi.fn().mockRejectedValue(new Error('network error'));

    await drainQueue(fetcher);

    const ops = await getQueuedOperations();
    expect(ops).toHaveLength(1);
    expect(ops[0].retries).toBe(1);
  });

  it('skips ops with retries >= MAX_RETRIES — does not call fetcher and does not increment', async () => {
    await enqueueOperation({ method: 'PUT', path: '/api/c', body: {}, headers: {} });
    const [op] = await getQueuedOperations();
    // Manually push retries to MAX_RETRIES
    for (let i = 0; i < MAX_RETRIES; i++) {
      await incrementRetries(op.id);
    }
    const fetcher = vi.fn().mockResolvedValue(undefined);

    await drainQueue(fetcher);

    expect(fetcher).not.toHaveBeenCalled();
    const ops = await getQueuedOperations();
    // Op is still present and retries have NOT increased further
    expect(ops).toHaveLength(1);
    expect(ops[0].retries).toBe(MAX_RETRIES);
  });

  it('failedOps: ops with retries >= MAX_RETRIES remain in the DB for manual review', async () => {
    await enqueueOperation({ method: 'DELETE', path: '/api/d', body: {}, headers: {} });
    const [op] = await getQueuedOperations();
    for (let i = 0; i < MAX_RETRIES; i++) {
      await incrementRetries(op.id);
    }

    const all = await getQueuedOperations();
    const failed = all.filter(o => o.retries >= MAX_RETRIES);
    expect(failed).toHaveLength(1);
    expect(failed[0].path).toBe('/api/d');
  });
});
