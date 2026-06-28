import { describe, it, expect } from 'vitest';
import { signEdgePayload, verifyEdgeSignature } from '../src/utils/edgeHmac';

describe('edge HMAC', () => {
  const secret = 'test-secret';
  it('verifies a signature it produced (roundtrip)', async () => {
    const ts = 1_700_000_000;
    const body = '{"plate":"5KJH345"}';
    const sig = await signEdgePayload(secret, ts, body);
    expect(sig.startsWith('sha256=')).toBe(true);
    const ok = await verifyEdgeSignature({ secret, timestamp: ts, body, signature: sig, nowSec: ts + 10 });
    expect(ok).toBe(true);
  });
  it('rejects a tampered body', async () => {
    const ts = 1_700_000_000;
    const sig = await signEdgePayload(secret, ts, 'a');
    expect(await verifyEdgeSignature({ secret, timestamp: ts, body: 'b', signature: sig, nowSec: ts })).toBe(false);
  });
  it('rejects a stale timestamp (outside replay window)', async () => {
    const ts = 1_700_000_000;
    const sig = await signEdgePayload(secret, ts, 'a');
    expect(await verifyEdgeSignature({ secret, timestamp: ts, body: 'a', signature: sig, nowSec: ts + 10_000 })).toBe(false);
  });
});
