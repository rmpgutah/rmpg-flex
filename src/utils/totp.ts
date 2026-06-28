// ============================================================
// RMPG Flex — TOTP (RFC 6238) + backup codes for the Workers runtime
// ============================================================
// Pure WebCrypto — no npm deps. Powers /api/auth/totp/* + /2fa/* enrollment
// and the login-time verification gate in src/routes/auth.ts.
//
// Secret storage contract (live `users` columns, VPS-era, reused):
//   totp_pending_secret  base32 secret awaiting first verification
//   totp_secret_enc      AES-256-GCM(secret) once enabled — key derived from
//                        JWT_SECRET via SHA-256 (per-deployment secret; HKDF
//                        would add nothing here since there's a single key).
//                        Format: base64(iv) + ':' + base64(ciphertext).
//   totp_backup_codes    JSON array of sha256-hex HASHES of unused codes
//                        (the /2fa/status endpoint counts array length, so
//                        hashed storage keeps that contract intact).
// ============================================================

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32_ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** 20 random bytes → base32 (standard authenticator-app secret size). */
export function generateTotpSecret(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

async function hotp(secret: Uint8Array, counter: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    secret as unknown as ArrayBuffer & Uint8Array,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const msg = new ArrayBuffer(8);
  const view = new DataView(msg);
  // JS bitwise ops are 32-bit — split the counter manually.
  view.setUint32(0, Math.floor(counter / 0x100000000));
  view.setUint32(4, counter >>> 0);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const offset = mac[mac.length - 1] & 0x0f;
  const code =
    (((mac[offset] & 0x7f) << 24) |
      ((mac[offset + 1] & 0xff) << 16) |
      ((mac[offset + 2] & 0xff) << 8) |
      (mac[offset + 3] & 0xff)) %
    1_000_000;
  return String(code).padStart(6, '0');
}

/**
 * Verify a 6-digit TOTP code against a base32 secret. Accepts ±`window`
 * 30-second periods of clock drift (default ±1 → 90s tolerance).
 */
export async function verifyTotpCode(secretB32: string, code: string, window = 1): Promise<boolean> {
  const normalized = (code || '').replace(/\D/g, '');
  if (normalized.length !== 6) return false;
  const secret = base32Decode(secretB32);
  if (!secret.length) return false;
  const counter = Math.floor(Date.now() / 1000 / 30);
  for (let i = -window; i <= window; i++) {
    if ((await hotp(secret, counter + i)) === normalized) return true;
  }
  return false;
}

/** otpauth:// provisioning URL for authenticator apps. */
export function buildOtpauthUrl(secretB32: string, accountName: string, issuer = 'RMPG Flex'): string {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// ── Secret encryption at rest (AES-256-GCM, key from JWT_SECRET) ──
async function aesKey(jwtSecret: string): Promise<CryptoKey> {
  const keyBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`rmpg-totp:${jwtSecret}`));
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function encryptTotpSecret(secretB32: string, jwtSecret: string): Promise<string> {
  const key = await aesKey(jwtSecret);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as ArrayBuffer & Uint8Array },
    key,
    new TextEncoder().encode(secretB32),
  ));
  return `${b64(iv)}:${b64(ct)}`;
}

/** Returns null when the blob can't be decrypted (e.g. a VPS-era secret
 *  encrypted with the old, lost key — callers surface TOTP_DECRYPT_ERROR). */
export async function decryptTotpSecret(blob: string, jwtSecret: string): Promise<string | null> {
  try {
    const [ivB64, ctB64] = blob.split(':');
    if (!ivB64 || !ctB64) return null;
    const key = await aesKey(jwtSecret);
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(ivB64) as unknown as ArrayBuffer & Uint8Array },
      key,
      unb64(ctB64) as unknown as ArrayBuffer & Uint8Array,
    );
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

// ── Backup codes ────────────────────────────────────────────
/** Generate `count` human-typeable backup codes (XXXX-XXXX, A–Z/2–9 only —
 *  no 0/O/1/I lookalikes). */
export function generateBackupCodes(count = 10): string[] {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
    codes.push(`${chars.slice(0, 4)}-${chars.slice(4)}`);
  }
  return codes;
}

/** Canonical form used for hashing/comparison: uppercase, A–Z/2–9 only. */
export function normalizeBackupCode(code: string): string {
  return (code || '').toUpperCase().replace(/[^A-Z2-9]/g, '');
}

export async function hashBackupCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizeBackupCode(code)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
