// ============================================================
// RMPG Flex — ClearPath credential encryption (Worker-native)
// ============================================================
// AES-GCM-256 via Web Crypto (`crypto.subtle`) — no `node:*`, so it
// runs unchanged on Cloudflare Workers. Only the ClearPath *password*
// is encrypted at rest in `system_config`; account/user are stored plain.
//
// Stored format:  v1:<base64(iv)>:<base64(ciphertext||tag)>
//   - iv  = 12 random bytes (crypto.getRandomValues)
//   - the GCM auth tag is appended to the ciphertext by WebCrypto
//
// The key comes from env.CPG_ENC_KEY — a base64-encoded 32-byte key set
// via `wrangler secret put CPG_ENC_KEY`. If it is missing or the wrong
// length we throw CpgCryptoError so callers can surface a clear hint.
// ============================================================

export class CpgCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CpgCryptoError';
  }
}

const FORMAT_VERSION = 'v1';

function b64encode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Import the raw 32-byte AES-GCM key from a base64 secret. Throws a typed
 *  error (not a generic DOMException) when the secret is absent or malformed. */
async function importKey(keyB64: string | undefined): Promise<CryptoKey> {
  if (!keyB64) {
    throw new CpgCryptoError('CPG_ENC_KEY is not set (wrangler secret put CPG_ENC_KEY)');
  }
  let raw: Uint8Array;
  try {
    raw = b64decode(keyB64.trim());
  } catch {
    throw new CpgCryptoError('CPG_ENC_KEY is not valid base64');
  }
  if (raw.length !== 32) {
    throw new CpgCryptoError(`CPG_ENC_KEY must decode to 32 bytes (got ${raw.length})`);
  }
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Encrypt a plaintext secret. Returns `v1:<b64 iv>:<b64 ct+tag>`. */
export async function encryptSecret(plaintext: string, keyB64: string | undefined): Promise<string> {
  const key = await importKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ctBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${FORMAT_VERSION}:${b64encode(iv)}:${b64encode(new Uint8Array(ctBuf))}`;
}

/** Decrypt a `v1:iv:ct` blob. Throws CpgCryptoError on a tampered/garbled value. */
export async function decryptSecret(stored: string, keyB64: string | undefined): Promise<string> {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== FORMAT_VERSION) {
    throw new CpgCryptoError('Stored secret is not in the expected v1:iv:ct format');
  }
  const key = await importKey(keyB64);
  const iv = b64decode(parts[1]);
  const ct = b64decode(parts[2]);
  let plainBuf: ArrayBuffer;
  try {
    plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  } catch {
    throw new CpgCryptoError('Failed to decrypt ClearPath secret (bad key or tampered value)');
  }
  return new TextDecoder().decode(plainBuf);
}

/** True when a value looks like one of our encrypted blobs (vs a legacy plaintext). */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(`${FORMAT_VERSION}:`);
}
