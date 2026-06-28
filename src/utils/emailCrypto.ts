// AES-GCM helpers for at-rest encryption of Microsoft 365 OAuth secrets
// stored in D1 (`system_config` rows under category='integrations').
//
// Key source:
//   1. If env.EMAIL_CRED_KEY is set (base64 of >=32 random bytes), use it.
//   2. Otherwise derive a stable key from env.JWT_SECRET via SHA-256.
// This makes the integration work out-of-the-box (JWT_SECRET is always
// present) while letting ops rotate to a dedicated key without a code
// change. Rotating EMAIL_CRED_KEY invalidates stored secrets, which is
// the desired behavior for credential rotation.

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function getKey(env: { EMAIL_CRED_KEY?: string; JWT_SECRET: string }): Promise<CryptoKey> {
  let raw: Uint8Array;
  if (env.EMAIL_CRED_KEY) {
    raw = b64decode(env.EMAIL_CRED_KEY).slice(0, 32);
    if (raw.length < 32) {
      // Pad short keys via SHA-256 so we always have 32 bytes
      const hash = await crypto.subtle.digest('SHA-256', raw);
      raw = new Uint8Array(hash);
    }
  } else {
    const hash = await crypto.subtle.digest('SHA-256', enc.encode(env.JWT_SECRET));
    raw = new Uint8Array(hash);
  }
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// Stored form: "v1:" + base64(iv || ciphertext+tag)
export async function encryptSecret(env: { EMAIL_CRED_KEY?: string; JWT_SECRET: string }, plaintext: string): Promise<string> {
  const key = await getKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext)),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return `v1:${b64encode(out)}`;
}

export async function decryptSecret(env: { EMAIL_CRED_KEY?: string; JWT_SECRET: string }, stored: string): Promise<string> {
  if (!stored.startsWith('v1:')) {
    // Legacy plaintext or alt scheme — best effort: return as-is so we
    // don't 500 on an old row. Real ciphertexts always carry the v1: tag.
    return stored;
  }
  const key = await getKey(env);
  const raw = b64decode(stored.slice(3));
  const iv = raw.slice(0, 12);
  const ct = raw.slice(12);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return dec.decode(pt);
}
