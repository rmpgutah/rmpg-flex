// Envelope encryption for individual D1 TEXT columns (email_messages.body_preview,
// email_scheduled.body/to_addresses/cc_addresses). Mirrors the envelope shape in
// src/utils/encryptedR2.ts (fresh per-value DEK wrapped by a master KEK) rather
// than emailCrypto.ts's single static-key approach, which is fine for a handful
// of OAuth secret rows but not a growing table of message content.
//
// Unlike encryptedR2.ts (one file_encryption_keys D1 row per R2 object), these
// are inline TEXT columns — the wrapped DEK and both IVs are packed into the
// stored string itself: v2:<b64 wrapped_dek>:<b64 dek_iv>:<b64 field_iv>:<b64 ciphertext>
//
// Fails CLOSED: a missing/malformed KEK throws EmailFieldEncryptionError rather
// than silently storing/returning plaintext — matches encryptedR2.ts's posture,
// not emailCrypto.ts's graceful JWT_SECRET fallback, because silently skipping
// encryption here would defeat the whole feature without anyone noticing.

export class EmailFieldEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailFieldEncryptionError';
  }
}

const STORED_PREFIX = 'v2:';

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKek(kekB64: string | undefined): Promise<CryptoKey> {
  if (!kekB64) {
    throw new EmailFieldEncryptionError('EMAIL_FIELD_ENCRYPTION_KEK is not set (wrangler secret put EMAIL_FIELD_ENCRYPTION_KEK)');
  }
  let raw: Uint8Array;
  try {
    raw = base64ToBytes(kekB64.trim());
  } catch {
    throw new EmailFieldEncryptionError('EMAIL_FIELD_ENCRYPTION_KEK is not valid base64');
  }
  if (raw.length !== 32) {
    throw new EmailFieldEncryptionError(`EMAIL_FIELD_ENCRYPTION_KEK must decode to 32 bytes (got ${raw.length})`);
  }
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export async function encryptField(env: { EMAIL_FIELD_ENCRYPTION_KEK?: string }, plaintext: string): Promise<string> {
  const kek = await importKek(env.EMAIL_FIELD_ENCRYPTION_KEK);

  const dekRaw = crypto.getRandomValues(new Uint8Array(32));
  const dek = await crypto.subtle.importKey('raw', dekRaw, { name: 'AES-GCM' }, false, ['encrypt']);

  const fieldIv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: fieldIv }, dek, enc.encode(plaintext)),
  );

  const dekIv = crypto.getRandomValues(new Uint8Array(12));
  const wrappedDek = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: dekIv }, kek, dekRaw),
  );

  return [
    STORED_PREFIX.slice(0, -1), // 'v2' (without trailing colon, added by join below)
    bytesToBase64(wrappedDek),
    bytesToBase64(dekIv),
    bytesToBase64(fieldIv),
    bytesToBase64(ciphertext),
  ].join(':');
}

export async function decryptFieldIfEncrypted(
  env: { EMAIL_FIELD_ENCRYPTION_KEK?: string },
  stored: string | null | undefined,
): Promise<string> {
  if (stored == null) return '';
  if (!stored.startsWith(STORED_PREFIX)) return stored;

  const parts = stored.slice(STORED_PREFIX.length).split(':');
  if (parts.length !== 4) {
    throw new EmailFieldEncryptionError('Malformed v2: encrypted field — expected 4 colon-delimited segments');
  }
  const [wrappedDekB64, dekIvB64, fieldIvB64, ciphertextB64] = parts;

  const kek = await importKek(env.EMAIL_FIELD_ENCRYPTION_KEK);
  const dekRaw = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(dekIvB64) }, kek, base64ToBytes(wrappedDekB64),
    ),
  );
  const dek = await crypto.subtle.importKey('raw', dekRaw, { name: 'AES-GCM' }, false, ['decrypt']);

  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(fieldIvB64) }, dek, base64ToBytes(ciphertextB64),
  );
  return dec.decode(plainBuf);
}
