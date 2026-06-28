// ============================================================
// Short-lived HMAC-signed resource access.
//
// Server half of client/src/utils/signedUrls.ts — that util has
// been calling POST /api/auth/sign-urls since it shipped, but the
// endpoint never existed, so every media element fell back to
// embedding the full session JWT in ?token= (leaks into CF tail
// logs, proxy access logs, browser history).
//
// A signature grants GET access to ONE resource (`type:id`) until
// `exp`. It carries no session — the issuing endpoint enforces the
// caller's read scope at sign time. Signed with JWT_SECRET under a
// distinct context prefix so a signature can never be confused with
// (or replayed as) a JWT, and vice versa.
// ============================================================

export interface SignedResourceParams {
  sig: string;
  exp: number; // unix seconds
  nonce: string;
}

const CONTEXT = 'rmpg-signed-access:v1';

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const buf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function signResource(
  secret: string,
  type: string,
  id: string,
  ttlSeconds = 24 * 60 * 60,
): Promise<SignedResourceParams> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const nonceBytes = new Uint8Array(12);
  crypto.getRandomValues(nonceBytes);
  const nonce = Array.from(nonceBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  const sig = await hmacHex(secret, `${CONTEXT}:${type}:${id}:${exp}:${nonce}`);
  return { sig, exp, nonce };
}

// Derived shared secret for internal DO→Worker callbacks (/__welfare-fire).
// Sending the raw JWT_SECRET in a header meant any leak of that header value
// (logging, debugging, proxy capture) handed out the JWT-signing key itself.
// The derived value authorizes ONLY the callback — it can't sign tokens.
export async function doCallbackToken(secret: string): Promise<string> {
  return hmacHex(secret, 'rmpg-do-callback:v1');
}

// Constant-time string equality (hex/ascii inputs).
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifySignedResource(
  secret: string,
  type: string,
  id: string,
  params: { sig?: string | null; exp?: string | number | null; nonce?: string | null },
): Promise<boolean> {
  const { sig, nonce } = params;
  const exp = Number(params.exp);
  if (!sig || !nonce || !Number.isFinite(exp)) return false;
  if (Math.floor(Date.now() / 1000) > exp) return false;
  const expected = await hmacHex(secret, `${CONTEXT}:${type}:${id}:${exp}:${nonce}`);
  if (sig.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
