// Offline capture for the signing form.
//
// The failure this guards is specific: the form loads on a doorstep, the
// person ticks seven statements and signs, and the submit fails because
// the signal dropped. Losing that means asking an already-irritated
// stranger to do the whole thing again.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  enqueueSubmission, getQueued, clearQueued, flushQueued, setQueueStore,
  type QueuedSubmission, type QueueStore,
} from '../serveReceiptQueue';

/** In-memory stand-in for IndexedDB — the queue takes a storage seam so
 *  these can run without a browser database or a new dependency. */
function memoryStore(): QueueStore {
  const m = new Map<string, QueuedSubmission>();
  return {
    async get(t) { return m.get(t) ?? null; },
    async put(e) { m.set(e.token, e); },
    async del(t) { m.delete(t); },
  };
}

const TOKEN = 'tok-abc-123';
const PAYLOAD = { recipient_name: 'Jane Doe', recipient_signature: 'data:image/png;base64,AAA' };

function mockFetch(status: number, body: unknown, throws = false) {
  return vi.fn(async () => {
    if (throws) throw new TypeError('Failed to fetch');
    return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
  });
}

describe('serveReceiptQueue', () => {
  beforeEach(() => { setQueueStore(memoryStore()); });
  afterEach(() => { vi.unstubAllGlobals(); setQueueStore(null); });

  it('persists a submission before any network is attempted', async () => {
    await enqueueSubmission(TOKEN, PAYLOAD);
    const q = await getQueued(TOKEN);
    expect(q?.payload).toEqual(PAYLOAD);
    expect(q?.attempts).toBe(0);
  });

  it('keys by token, so one signing link holds at most one submission', async () => {
    await enqueueSubmission(TOKEN, PAYLOAD);
    await enqueueSubmission(TOKEN, { ...PAYLOAD, recipient_name: 'Corrected Name' });
    const q = await getQueued(TOKEN);
    expect((q?.payload as any).recipient_name).toBe('Corrected Name');
  });

  it('clears the queue once the server has it', async () => {
    vi.stubGlobal('fetch', mockFetch(201, { ok: true, receipt_id: 7 }));
    await enqueueSubmission(TOKEN, PAYLOAD);
    const r = await flushQueued(TOKEN);
    expect(r.status).toBe('sent');
    expect(await getQueued(TOKEN)).toBeNull();
  });

  it('KEEPS the submission when the network is unreachable', async () => {
    // The whole point. Dropping it here is the data loss this exists to
    // prevent.
    vi.stubGlobal('fetch', mockFetch(0, null, true));
    await enqueueSubmission(TOKEN, PAYLOAD);
    expect((await flushQueued(TOKEN)).status).toBe('offline');
    expect(await getQueued(TOKEN)).not.toBeNull();
  });

  it('keeps it through a 5xx, which is the server having a bad moment', async () => {
    vi.stubGlobal('fetch', mockFetch(503, { error: 'unavailable' }));
    await enqueueSubmission(TOKEN, PAYLOAD);
    expect((await flushQueued(TOKEN)).status).toBe('offline');
    expect(await getQueued(TOKEN)).not.toBeNull();
  });

  it('treats already_signed as done rather than retrying forever', async () => {
    // A replay lost a race, or the officer recorded it. The goal was a
    // record existing, not this particular request winning.
    vi.stubGlobal('fetch', mockFetch(409, { ok: false, code: 'already_signed' }));
    await enqueueSubmission(TOKEN, PAYLOAD);
    expect((await flushQueued(TOKEN)).status).toBe('already_signed');
    expect(await getQueued(TOKEN)).toBeNull();
  });

  it('stops retrying a submission the server refused on the merits', async () => {
    // Retrying forever will never make an incomplete submission complete,
    // and a silent infinite loop is worse than saying so.
    vi.stubGlobal('fetch', mockFetch(400, { ok: false, code: 'incomplete', message: 'A signature is required' }));
    await enqueueSubmission(TOKEN, PAYLOAD);
    const r = await flushQueued(TOKEN);
    expect(r.status).toBe('rejected');
    expect(r.status === 'rejected' && r.message).toBe('A signature is required');
    expect(await getQueued(TOKEN)).toBeNull();
  });

  it('reports nothing to do on an empty queue', async () => {
    expect((await flushQueued(TOKEN)).status).toBe('nothing');
  });

  it('counts attempts so a stuck item is diagnosable', async () => {
    vi.stubGlobal('fetch', mockFetch(0, null, true));
    await enqueueSubmission(TOKEN, PAYLOAD);
    await flushQueued(TOKEN);
    await flushQueued(TOKEN);
    expect((await getQueued(TOKEN))?.attempts).toBe(2);
  });
});
