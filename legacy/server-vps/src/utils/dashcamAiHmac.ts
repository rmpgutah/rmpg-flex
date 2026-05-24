// ============================================================
// dashcam-ai HMAC verification
// ============================================================
// Verifies signed POSTs from the Jetson edge runner. The runner
// signs `timestamp + "\n" + raw-body` with a shared secret using
// HMAC-SHA256, sends the result in X-Dashcam-Signature, and the
// timestamp in X-Dashcam-Timestamp. We reject any payload whose
// signature is missing/malformed/wrong, or whose timestamp falls
// outside the replay window — using a constant-time compare so
// attackers can't probe for valid signatures via response timing.
//
// The shared secret is in env DASHCAM_FORWARD_SECRET. Per
// CLAUDE.md gotcha #1, this is intentionally separate from
// JWT_SECRET so it can be rotated without breaking TOTP.

import crypto from 'crypto';

/** Replay window in seconds — payload timestamp must be within ±this of now. */
export const REPLAY_WINDOW_SEC = 300;

const SIG_PREFIX = 'sha256=';

export type VerifyReason =
  | 'missing_signature'
  | 'malformed_signature'
  | 'missing_timestamp'
  | 'invalid_timestamp'
  | 'timestamp_expired'
  | 'timestamp_in_future'
  | 'signature_mismatch';

export interface VerifyInput {
  body: Buffer;
  timestamp: string | undefined;
  signature: string | undefined;
  secret: string;
  /** Override 'now' for tests. Seconds since epoch. */
  nowSec?: number;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: VerifyReason };

export function verifyDashcamSignature(input: VerifyInput): VerifyResult {
  if (!input.signature) return { ok: false, reason: 'missing_signature' };
  if (!input.signature.startsWith(SIG_PREFIX)) {
    return { ok: false, reason: 'malformed_signature' };
  }

  if (input.timestamp == null) return { ok: false, reason: 'missing_timestamp' };
  const ts = Number(input.timestamp);
  if (!Number.isFinite(ts) || !Number.isInteger(ts)) {
    return { ok: false, reason: 'invalid_timestamp' };
  }

  const now = input.nowSec ?? Math.floor(Date.now() / 1000);
  if (ts < now - REPLAY_WINDOW_SEC) return { ok: false, reason: 'timestamp_expired' };
  if (ts > now + REPLAY_WINDOW_SEC) return { ok: false, reason: 'timestamp_in_future' };

  const provided = input.signature.slice(SIG_PREFIX.length);
  const expected = computeSignatureHex(input.secret, ts, input.body);

  // Constant-time compare. Mismatched lengths must not throw and
  // must produce the same response shape so attackers can't infer
  // length via error type.
  const a = Buffer.from(provided, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return { ok: false, reason: 'signature_mismatch' };
  if (!crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'signature_mismatch' };

  return { ok: true };
}

/** Compute the HMAC-SHA256 hex digest over `${ts}\n<body>` with the secret. */
export function computeSignatureHex(secret: string, ts: number, body: Buffer): string {
  const h = crypto.createHmac('sha256', secret);
  h.update(String(ts));
  h.update('\n');
  h.update(body);
  return h.digest('hex');
}
