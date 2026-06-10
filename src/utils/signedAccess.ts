// ============================================================
// RMPG Flex — Signed resource access (HMAC URL signing)
// ============================================================
// Server half of client/src/utils/signedUrls.ts. Media elements
// (<video>, <img>) can't carry an Authorization header, so instead
// of leaking the session JWT into the URL (?token=...) the client
// POSTs /api/auth/sign-urls and gets back short-lived, resource-
// scoped HMAC params: ?sig=<hex>&exp=<unix>&nonce=<hex>.
//
// Message format: `res:<type>:<id>:<exp>:<nonce>`
// Key: JWT_SECRET (same secret, different message domain — the
// `res:` prefix prevents cross-protocol confusion with the
// `file:` messages used by uploads.ts hmacSign).
// ============================================================

const TTL_SECONDS_DEFAULT = 86400; // 24 h — client refreshes its cache at 12 h

export interface SignedResourceParams {
  sig: string;
  exp: number;
  nonce: string;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const buf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function signResource(
  secret: string,
  type: string,
  id: string,
  ttlSeconds = TTL_SECONDS_DEFAULT,
): Promise<SignedResourceParams> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const nonceBytes = crypto.getRandomValues(new Uint8Array(8));
  const nonce = Array.from(nonceBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  const sig = await hmacHex(secret, `res:${type}:${id}:${exp}:${nonce}`);
  return { sig, exp, nonce };
}

// Verifies sig/exp/nonce query params for one resource. Constant-time
// signature compare; expired or malformed params fail closed.
export async function verifySignedResource(
  secret: string,
  type: string,
  id: string,
  params: { sig?: string; exp?: string; nonce?: string },
): Promise<boolean> {
  const { sig, exp, nonce } = params;
  if (!sig || !exp || !nonce) return false;
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || Date.now() / 1000 > expNum) return false;
  const expected = await hmacHex(secret, `res:${type}:${id}:${expNum}:${nonce}`);
  if (sig.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
