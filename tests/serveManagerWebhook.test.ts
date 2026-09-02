// ServeManager webhook HMAC + payload parsing.
// SM's documented algorithm (https://www.servemanager.com/api, Authenticating
// Requests) is Base64(HMAC-SHA256(secret, Base64(raw_body))), delivered in
// X-SM-HMAC-SHA256 — not GitHub-style sha256=<hex> of the raw body.
import { createHmac } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  computeServeManagerSignature,
  extractServeManagerJobIds,
  normalizeServeManagerSignature,
  readServeManagerSignatureHeader,
  verifyWebhookSignature,
} from '../src/utils/serveManagerClient';

const SECRET = 'wVCznzpLkFXiWYsHZtMBoxT2';
const BODY = '{"meta":{"webhook_name":"RMPG Flex"},"data":[{"type":"job","id":736182,"job_id":736182,"webhook_events":[{"event":"jobs:updated"}]}]}';

function opensslServeManagerSig(payload: string, secret: string): string {
  const hashedPayload = Buffer.from(payload, 'utf8').toString('base64');
  return createHmac('sha256', secret).update(hashedPayload).digest('base64');
}

describe('normalizeServeManagerSignature', () => {
  it('strips the documented x-sm-hmac-sha256= prefix', () => {
    expect(normalizeServeManagerSignature('x-sm-hmac-sha256=4UtWp1PHwF+VnIvzg0nVQpDq9BqMbLTAhJu5IWN0hUo='))
      .toBe('4UtWp1PHwF+VnIvzg0nVQpDq9BqMbLTAhJu5IWN0hUo=');
  });

  it('accepts a bare Base64 digest', () => {
    expect(normalizeServeManagerSignature('4UtWp1PHwF+VnIvzg0nVQpDq9BqMbLTAhJu5IWN0hUo='))
      .toBe('4UtWp1PHwF+VnIvzg0nVQpDq9BqMbLTAhJu5IWN0hUo=');
  });

  it('returns null for empty input', () => {
    expect(normalizeServeManagerSignature(null)).toBeNull();
    expect(normalizeServeManagerSignature('   ')).toBeNull();
  });
});

describe('readServeManagerSignatureHeader', () => {
  it('prefers X-SM-HMAC-SHA256 over the legacy GitHub-style header', () => {
    const headers: Record<string, string> = {
      'X-SM-HMAC-SHA256': 'real',
      'X-ServeManager-Signature': 'stale',
    };
    expect(readServeManagerSignatureHeader((name) => headers[name])).toBe('real');
  });

  it('falls back to X-ServeManager-Signature when SM header is absent', () => {
    const headers: Record<string, string> = { 'X-ServeManager-Signature': 'legacy' };
    expect(readServeManagerSignatureHeader((name) => headers[name])).toBe('legacy');
  });
});

describe('verifyWebhookSignature (ServeManager algorithm)', () => {
  it('accepts a signature computed the same way as SM\'s Ruby example', async () => {
    const sig = opensslServeManagerSig(BODY, SECRET);
    expect(await computeServeManagerSignature(BODY, SECRET)).toBe(sig);
    expect(await verifyWebhookSignature(BODY, sig, SECRET)).toBe(true);
    expect(await verifyWebhookSignature(BODY, `x-sm-hmac-sha256=${sig}`, SECRET)).toBe(true);
  });

  it('rejects the wrong secret', async () => {
    const sig = opensslServeManagerSig(BODY, SECRET);
    expect(await verifyWebhookSignature(BODY, sig, 'other-secret')).toBe(false);
  });

  it('rejects GitHub-style hex HMAC of the raw body (the previous verifier)', async () => {
    const githubHex = createHmac('sha256', SECRET).update(BODY).digest('hex');
    expect(await verifyWebhookSignature(BODY, `sha256=${githubHex}`, SECRET)).toBe(false);
    expect(await verifyWebhookSignature(BODY, githubHex, SECRET)).toBe(false);
  });

  it('rejects a missing header or secret', async () => {
    expect(await verifyWebhookSignature(BODY, null, SECRET)).toBe(false);
    expect(await verifyWebhookSignature(BODY, opensslServeManagerSig(BODY, SECRET), '')).toBe(false);
  });

  it('matches OpenSSL on a payload with non-ASCII bytes', async () => {
    const unicode = '{"note":"café — 日本語"}';
    const sig = opensslServeManagerSig(unicode, SECRET);
    expect(await verifyWebhookSignature(unicode, sig, SECRET)).toBe(true);
  });
});

describe('extractServeManagerJobIds', () => {
  it('reads job ids from SM\'s batched data[] envelope', () => {
    const payload = {
      meta: { webhook_name: 'RMPG Flex' },
      data: [
        { type: 'note', id: 1962368, job_id: 736182 },
        { type: 'job', id: 736182, servemanager_job_number: '3679689' },
      ],
    };
    expect(extractServeManagerJobIds(payload).sort()).toEqual([736182]);
  });

  it('reads a legacy single-object data.id shape', () => {
    expect(extractServeManagerJobIds({ event: 'jobs:updated', data: { id: 99 } })).toEqual([99]);
    expect(extractServeManagerJobIds({ data: { job: { id: 12 } } })).toEqual([12]);
  });

  it('returns [] for empty / unrelated payloads', () => {
    expect(extractServeManagerJobIds(null)).toEqual([]);
    expect(extractServeManagerJobIds({ data: [{ type: 'invoice', id: 1 }] })).toEqual([]);
  });
});
