import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emailSendRateLimit } from '../src/routes/email';

function fakeKv(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
  } as unknown as KVNamespace;
}

function fakeContext(userId: number | undefined, kv: KVNamespace) {
  const vars: Record<string, unknown> = { userId };
  return {
    get: (k: string) => vars[k],
    env: { KV: kv },
    req: { url: 'https://api.rmpgutah.us/api/email/send' },
    json: (body: unknown, status?: number) => ({ body, status: status ?? 200 }),
  } as any;
}

describe('emailSendRateLimit', () => {
  it('allows the request through when under the limit', async () => {
    const kv = fakeKv();
    const c = fakeContext(42, kv);
    const next = vi.fn(async () => {});
    const result = await emailSendRateLimit(c, next);
    expect(next).toHaveBeenCalledOnce();
    expect(result).toBeUndefined();
  });

  it('blocks with 429 once the per-user window limit (20/5min) is exceeded', async () => {
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - (now % 300);
    const kv = fakeKv({ [`rl:email-send:42:${windowStart}`]: '20' });
    const c = fakeContext(42, kv);
    const next = vi.fn(async () => {});
    const result = await c.constructor === Object ? null : null; // placeholder unused
    const res = await emailSendRateLimit(c, next);
    expect(next).not.toHaveBeenCalled();
    expect(res).toEqual({ body: { error: 'Too many emails sent. Slow down and try again shortly.', code: 'EMAIL_RATE_LIMITED' }, status: 429 });
  });

  it('is a no-op (passes through) when there is no authenticated userId', async () => {
    const kv = fakeKv();
    const c = fakeContext(undefined, kv);
    const next = vi.fn(async () => {});
    await emailSendRateLimit(c, next);
    expect(next).toHaveBeenCalledOnce();
  });
});
