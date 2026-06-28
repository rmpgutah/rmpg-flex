// walletToken — pure sign/verify for the rotating officer-ID QR token.
//
// Token format:  `${walletId}.${exp}.${sig}`
//   • walletId — the officer_credentials.wallet_id (opaque uuid)
//   • exp      — unix seconds the token stops being accepted
//   • sig      — base64url( HMAC-SHA256(secret, `${walletId}.${exp}`) )
//
// The displayed QR is regenerated every ~30s; tokens carry a short TTL (60s) so
// a shared screenshot stops verifying quickly. Verification is online: a valid
// signature only proves the QR was minted by us — the route handler still checks
// live D1 status (credential + officer) before trusting it. No I/O here, so the
// logic is fully unit-testable.

const DEFAULT_TTL_SEC = 60;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function base64url(bytes: ArrayBuffer): string {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return base64url(sig);
}

// Constant-time string compare — avoids leaking signature bytes via timing.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signWalletToken(
  walletId: string,
  secret: string,
  opts?: { nowSec?: number; ttlSec?: number },
): Promise<string> {
  const now = opts?.nowSec ?? nowSeconds();
  const exp = now + (opts?.ttlSec ?? DEFAULT_TTL_SEC);
  const payload = `${walletId}.${exp}`;
  const sig = await hmac(secret, payload);
  return `${payload}.${sig}`;
}

export interface WalletTokenResult {
  valid: boolean;
  walletId?: string;
  reason?: 'malformed' | 'bad_signature' | 'expired';
}

export async function verifyWalletToken(
  token: string,
  secret: string,
  opts?: { nowSec?: number },
): Promise<WalletTokenResult> {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    return { valid: false, reason: 'malformed' };
  }
  const [walletId, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp)) return { valid: false, reason: 'malformed' };

  // Integrity before time: a forged token must fail as bad_signature, not leak
  // that it was "merely expired".
  const expected = await hmac(secret, `${walletId}.${expStr}`);
  if (!safeEqual(sig, expected)) return { valid: false, reason: 'bad_signature' };

  const now = opts?.nowSec ?? nowSeconds();
  if (now > exp) return { valid: false, reason: 'expired' };

  return { valid: true, walletId };
}
