// ============================================================
// dashcam-ai HMAC verifier tests
// ============================================================
// The Jetson edge runner POSTs event payloads signed with a
// shared secret. The server must reject any payload whose
// signature is missing, malformed, or doesn't match — and must
// do so in constant time to avoid leaking signature bytes via
// response-time side channels.
//
// Header format (GitHub-style): X-Dashcam-Signature: sha256=<hexdigest>
// Algorithm:                    HMAC-SHA256 over the raw request body
// Replay protection:            X-Dashcam-Timestamp header,
//                                rejected if older than REPLAY_WINDOW_SEC

import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  verifyDashcamSignature,
  REPLAY_WINDOW_SEC,
  type VerifyReason,
  type VerifyResult,
} from '../dashcamAiHmac';

const SECRET = 'test-shared-secret-must-be-32-chars-minimum';
const RAW = Buffer.from(JSON.stringify({ event_type: 'fcw', unit_id: 7 }));

function sign(body: Buffer, ts: number, secret = SECRET): string {
  const h = crypto.createHmac('sha256', secret);
  h.update(String(ts));
  h.update('\n');
  h.update(body);
  return 'sha256=' + h.digest('hex');
}

/** Assert result is a rejection with the given reason. Type-guards
 *  the discriminated union so .reason is reachable. */
function expectRejection(result: VerifyResult, reason: VerifyReason): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toBe(reason);
}

describe('verifyDashcamSignature — happy path', () => {
  it('accepts a valid signature with current timestamp', () => {
    const ts = Math.floor(Date.now() / 1000);
    const sig = sign(RAW, ts);
    const result = verifyDashcamSignature({
      body: RAW,
      timestamp: String(ts),
      signature: sig,
      secret: SECRET,
    });
    expect(result.ok).toBe(true);
  });
});

describe('verifyDashcamSignature — rejection cases', () => {
  it('rejects when signature header is missing', () => {
    const ts = Math.floor(Date.now() / 1000);
    const result = verifyDashcamSignature({
      body: RAW,
      timestamp: String(ts),
      signature: undefined,
      secret: SECRET,
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('missing_signature');
  });

  it('rejects when timestamp header is missing', () => {
    const ts = Math.floor(Date.now() / 1000);
    const result = verifyDashcamSignature({
      body: RAW,
      timestamp: undefined,
      signature: sign(RAW, ts),
      secret: SECRET,
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('missing_timestamp');
  });

  it('rejects when signature is wrong', () => {
    const ts = Math.floor(Date.now() / 1000);
    const result = verifyDashcamSignature({
      body: RAW,
      timestamp: String(ts),
      signature: 'sha256=' + 'a'.repeat(64),
      secret: SECRET,
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('signature_mismatch');
  });

  it('rejects when signed with the wrong secret', () => {
    const ts = Math.floor(Date.now() / 1000);
    const sigWithBadSecret = sign(RAW, ts, 'attacker-guessed-secret');
    const result = verifyDashcamSignature({
      body: RAW,
      timestamp: String(ts),
      signature: sigWithBadSecret,
      secret: SECRET,
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('signature_mismatch');
  });

  it('rejects when body has been tampered with', () => {
    const ts = Math.floor(Date.now() / 1000);
    const sig = sign(RAW, ts);
    const tampered = Buffer.from(JSON.stringify({ event_type: 'fcw', unit_id: 999 }));
    const result = verifyDashcamSignature({
      body: tampered,
      timestamp: String(ts),
      signature: sig,
      secret: SECRET,
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('signature_mismatch');
  });

  it('rejects when timestamp is malformed (non-numeric)', () => {
    const ts = Math.floor(Date.now() / 1000);
    const result = verifyDashcamSignature({
      body: RAW,
      timestamp: 'not-a-number',
      signature: sign(RAW, ts),
      secret: SECRET,
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('invalid_timestamp');
  });

  it('rejects signature header missing the sha256= prefix', () => {
    const ts = Math.floor(Date.now() / 1000);
    const sig = sign(RAW, ts).replace('sha256=', '');
    const result = verifyDashcamSignature({
      body: RAW,
      timestamp: String(ts),
      signature: sig,
      secret: SECRET,
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('malformed_signature');
  });
});

describe('verifyDashcamSignature — replay-attack protection', () => {
  it('rejects timestamps older than REPLAY_WINDOW_SEC', () => {
    const old = Math.floor(Date.now() / 1000) - REPLAY_WINDOW_SEC - 5;
    const sig = sign(RAW, old);
    const result = verifyDashcamSignature({
      body: RAW,
      timestamp: String(old),
      signature: sig,
      secret: SECRET,
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('timestamp_expired');
  });

  it('rejects timestamps too far in the future (clock-skew abuse)', () => {
    const far = Math.floor(Date.now() / 1000) + REPLAY_WINDOW_SEC + 5;
    const sig = sign(RAW, far);
    const result = verifyDashcamSignature({
      body: RAW,
      timestamp: String(far),
      signature: sig,
      secret: SECRET,
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('timestamp_in_future');
  });

  it('accepts timestamps within ±REPLAY_WINDOW_SEC', () => {
    const within = Math.floor(Date.now() / 1000) - REPLAY_WINDOW_SEC + 10;
    const sig = sign(RAW, within);
    const result = verifyDashcamSignature({
      body: RAW,
      timestamp: String(within),
      signature: sig,
      secret: SECRET,
    });
    expect(result.ok).toBe(true);
  });
});

describe('verifyDashcamSignature — timing-safe', () => {
  // We can't reliably assert constant time in a unit test, but we can
  // assert the implementation uses the right primitive by checking that
  // strings of equal length but wrong content all produce the same
  // 'signature_mismatch' reason and don't throw on length-mismatch.
  it('handles signatures of wrong byte length without throwing', () => {
    const ts = Math.floor(Date.now() / 1000);
    expect(() =>
      verifyDashcamSignature({
        body: RAW,
        timestamp: String(ts),
        signature: 'sha256=deadbeef',
        secret: SECRET,
      }),
    ).not.toThrow();
  });
});
