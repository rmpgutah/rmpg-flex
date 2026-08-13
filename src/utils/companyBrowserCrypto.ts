// AES-GCM helpers for at-rest encryption of Company Browser bookmarks/history
// (user_preferences.browser_bookmarks_json / browser_history_json).
//
// Structurally identical to src/utils/emailCrypto.ts, but with its own
// fallback key derivation so this feature never ends up sharing the exact
// derived key emailCrypto.ts's own JWT_SECRET-only fallback produces — see
// getKey() below for why the domain-separation string matters.
//
// Key source:
//   1. If env.COMPANY_BROWSER_DATA_KEY is set (base64 of >=32 random bytes), use it.
//   2. Otherwise derive a stable key from SHA-256(JWT_SECRET + '|company-browser-data-v1').
// This makes the feature work out-of-the-box (JWT_SECRET is always present)
// while letting ops rotate to a dedicated key without a code change.
// Rotating COMPANY_BROWSER_DATA_KEY invalidates previously-stored bookmarks/
// history — decryptBrowserData degrades to null (not a thrown error) in
// that case, matching this module's documented failure behavior.

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

async function getKey(env: { COMPANY_BROWSER_DATA_KEY?: string; JWT_SECRET: string }): Promise<CryptoKey> {
  let raw: Uint8Array;
  if (env.COMPANY_BROWSER_DATA_KEY) {
    raw = b64decode(env.COMPANY_BROWSER_DATA_KEY).slice(0, 32);
    if (raw.length < 32) {
      const hash = await crypto.subtle.digest('SHA-256', raw);
      raw = new Uint8Array(hash);
    }
  } else {
    // Domain-separated from emailCrypto.ts's own fallback (which hashes bare
    // JWT_SECRET) — appending this literal tag means the two features never
    // derive the same key from the same root secret.
    const hash = await crypto.subtle.digest('SHA-256', enc.encode(`${env.JWT_SECRET}|company-browser-data-v1`));
    raw = new Uint8Array(hash);
  }
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// Stored form: "v1:" + base64(iv || ciphertext+tag)
export async function encryptBrowserData(env: { COMPANY_BROWSER_DATA_KEY?: string; JWT_SECRET: string }, plaintext: string): Promise<string> {
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

export async function decryptBrowserData(env: { COMPANY_BROWSER_DATA_KEY?: string; JWT_SECRET: string }, stored: string): Promise<string | null> {
  if (!stored.startsWith('v1:')) {
    // Legacy plaintext from the pre-encryption version of this feature —
    // best effort: return as-is so existing bookmarks/history aren't wiped.
    return stored;
  }
  try {
    const key = await getKey(env);
    const raw = b64decode(stored.slice(3));
    const iv = raw.slice(0, 12);
    const ct = raw.slice(12);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return dec.decode(pt);
  } catch {
    // Corrupted ciphertext or a key that no longer matches (e.g. after a
    // COMPANY_BROWSER_DATA_KEY rotation) — degrade to "no data" rather than
    // 500ing the whole /preferences response.
    return null;
  }
}
