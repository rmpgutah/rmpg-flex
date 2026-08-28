// ============================================================
// RMPG Flex — Envelope-encrypted R2 access
// ============================================================
// Wraps R2Bucket.put()/.get() so every consumer of a protected prefix gets
// AES-GCM encryption at rest automatically — the encryption step is
// structurally unavoidable rather than a convention callers must remember.
//
// Envelope model: each file gets a fresh random 256-bit Data Encryption Key
// (DEK). The DEK is itself AES-GCM-wrapped by a master Key-Encryption-Key
// and stored in the file_encryption_keys D1 table alongside the file's R2
// key — never in R2 object metadata. Deleting that D1 row ("crypto-shredding")
// permanently destroys access to that one file without touching any other
// file or the R2 object itself.
//
// KEK resolution (always encrypts — never plaintext):
//   1. Dedicated env.FILE_ENCRYPTION_KEK (base64 32 bytes) when set.
//   2. Else SHA-256("rmpg-flex-file-kek-v1:" + JWT_SECRET) — same pattern as
//      pdfSign.ts. Uploads keep working when the dedicated secret was never
//      provisioned. A malformed dedicated KEK does NOT fall back (would
//      silently mint a second wrapping key and brick existing ciphertext).
//
// Fails CLOSED when neither secret is usable: FileEncryptionError rather
// than storing/serving plaintext. Pass the Worker env object (not just the
// KEK string) so the JWT fallback can run. Reads try every usable historical
// KEK (dedicated, previous dedicated, JWT-derived, previous JWT) and re-wrap
// only the D1 DEK row — R2 file bytes are never rewritten.
//
// See docs/superpowers/specs/2026-07-18-file-encryption-at-rest-design.md.
// ============================================================

export class FileEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileEncryptionError';
  }
}

const ALGORITHM_VERSION = 'file-enc-v1';

const FILE_ENCRYPTION_KEYS_DDL = `CREATE TABLE IF NOT EXISTS file_encryption_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  r2_key TEXT NOT NULL UNIQUE,
  wrapped_dek TEXT NOT NULL,
  dek_iv TEXT NOT NULL,
  file_iv TEXT NOT NULL,
  algorithm_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

let _keysTableEnsured = false;

/** Idempotent CREATE TABLE — deploy.yml applies migrations continue-on-error,
 *  so 0194 can be missing on live D1 while the Worker still encrypts. */
async function ensureKeysTable(db: D1Database): Promise<void> {
  if (_keysTableEnsured) return;
  await db.prepare(FILE_ENCRYPTION_KEYS_DDL).run();
  _keysTableEnsured = true;
}

/** @internal — test-only reset of the per-isolate CREATE TABLE cache. */
export function _resetKeysTableEnsuredForTest(): void {
  _keysTableEnsured = false;
}

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

/** Worker env (or a subset) so put/get can fall back to JWT_SECRET. */
export type FileKekEnv = {
  FILE_ENCRYPTION_KEK?: string;
  /** Previous dedicated KEK — decrypt/unwrap only; never used to wrap new files. */
  FILE_ENCRYPTION_KEK_PREVIOUS?: string;
  JWT_SECRET?: string;
  /** Previous JWT — decrypt/unwrap of JWT-derived envelopes only. */
  JWT_SECRET_PREVIOUS?: string;
};

export type FileKekSource = string | undefined | FileKekEnv;

const FILE_KEK_DERIVE_PREFIX = 'rmpg-flex-file-kek-v1:';

function snapshotKekSource(source: FileKekSource): FileKekSource {
  if (source && typeof source === 'object') {
    return {
      FILE_ENCRYPTION_KEK: source.FILE_ENCRYPTION_KEK,
      FILE_ENCRYPTION_KEK_PREVIOUS: source.FILE_ENCRYPTION_KEK_PREVIOUS,
      JWT_SECRET: source.JWT_SECRET,
      JWT_SECRET_PREVIOUS: source.JWT_SECRET_PREVIOUS,
    };
  }
  return source;
}

async function jwtDerivedKekB64(jwt: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${FILE_KEK_DERIVE_PREFIX}${jwt}`),
  );
  return bytesToBase64(new Uint8Array(digest));
}

function dedicatedKekB64OrNull(kekB64: string | undefined): string | null {
  if (!kekB64?.trim()) return null;
  try {
    decodeDedicatedKekBytes(kekB64);
    return kekB64.trim();
  } catch {
    return null;
  }
}

/** KEKs that may unwrap an existing DEK. Order: current dedicated, previous
 *  dedicated, JWT-derived, previous-JWT-derived. Malformed dedicated values
 *  are skipped so JWT-wrapped files stay readable. */
async function unwrapKekB64Candidates(source: FileKekSource): Promise<string[]> {
  const snap = snapshotKekSource(source);
  const out: string[] = [];
  const add = (v: string | null | undefined) => {
    if (v && !out.includes(v)) out.push(v);
  };
  if (snap && typeof snap === 'object') {
    add(dedicatedKekB64OrNull(snap.FILE_ENCRYPTION_KEK));
    add(dedicatedKekB64OrNull(snap.FILE_ENCRYPTION_KEK_PREVIOUS));
    if (snap.JWT_SECRET?.trim()) add(await jwtDerivedKekB64(snap.JWT_SECRET.trim()));
    if (snap.JWT_SECRET_PREVIOUS?.trim()) add(await jwtDerivedKekB64(snap.JWT_SECRET_PREVIOUS.trim()));
  } else if (typeof snap === 'string') {
    add(dedicatedKekB64OrNull(snap));
  }
  return out;
}

async function importKekBytes(raw: BufferSource): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function decodeDedicatedKekBytes(kekB64: string): Uint8Array {
  let raw: Uint8Array;
  try {
    raw = base64ToBytes(kekB64.trim());
  } catch {
    throw new FileEncryptionError('FILE_ENCRYPTION_KEK is not valid base64');
  }
  if (raw.length !== 32) {
    throw new FileEncryptionError(`FILE_ENCRYPTION_KEK must decode to 32 bytes (got ${raw.length})`);
  }
  return raw;
}

async function importKek(kekB64: string | undefined): Promise<CryptoKey> {
  if (!kekB64) {
    throw new FileEncryptionError('File encryption is not configured');
  }
  return importKekBytes(decodeDedicatedKekBytes(kekB64));
}

async function kekB64FromSource(source: FileKekSource): Promise<string> {
  const snap = snapshotKekSource(source);
  if (snap && typeof snap === 'object') {
    const dedicated = snap.FILE_ENCRYPTION_KEK?.trim();
    if (dedicated) return dedicated;
    const jwt = snap.JWT_SECRET?.trim();
    if (jwt) return jwtDerivedKekB64(jwt);
    throw new FileEncryptionError('File encryption is not configured');
  }
  if (!snap) throw new FileEncryptionError('File encryption is not configured');
  return snap;
}

interface EncryptionKeyRow {
  wrapped_dek: string;
  dek_iv: string;
  file_iv: string;
}

/** Encrypt `bytes` with a fresh random per-file DEK, wrap the DEK with the
 *  KEK, write the ciphertext to R2 and the wrapped key to D1. */
export async function putEncrypted(
  bucket: R2Bucket,
  db: D1Database,
  kek: FileKekSource,
  key: string,
  bytes: ArrayBuffer | Uint8Array,
  opts?: { httpMetadata?: R2HTTPMetadata },
): Promise<void> {
  const kekKey = await importKek(await kekB64FromSource(kek));
  await ensureKeysTable(db);

  const dekRaw = crypto.getRandomValues(new Uint8Array(32));
  const dek = await crypto.subtle.importKey('raw', dekRaw, { name: 'AES-GCM' }, false, ['encrypt']);

  const plainBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const fileIv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: fileIv }, dek, plainBytes);

  const dekIv = crypto.getRandomValues(new Uint8Array(12));
  const wrappedDek = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: dekIv }, kekKey, dekRaw);

  // Write the D1 row before the R2 object: if the INSERT fails (transient
  // error or an unexpected r2_key collision), nothing lands in R2 and the
  // caller gets a clean error to retry. The reverse order would risk an
  // orphaned R2 object with no key row — indistinguishable from a
  // deliberately crypto-shredded file. getDecrypted() checks bucket.get()
  // before it ever queries D1, so the failure mode this order leaves behind
  // (a D1 row with no R2 object) is harmless dead data, not silent evidence
  // loss.
  await db.prepare(
    `INSERT INTO file_encryption_keys (r2_key, wrapped_dek, dek_iv, file_iv, algorithm_version) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(r2_key) DO UPDATE SET
       wrapped_dek = excluded.wrapped_dek,
       dek_iv = excluded.dek_iv,
       file_iv = excluded.file_iv,
       algorithm_version = excluded.algorithm_version`,
  ).bind(
    key,
    bytesToBase64(new Uint8Array(wrappedDek)),
    bytesToBase64(dekIv),
    bytesToBase64(fileIv),
    ALGORITHM_VERSION,
  ).run();
  await bucket.put(key, ciphertext, opts);
}

/**
 * Fail closed on a dedicated FILE_ENCRYPTION_KEK that is present but unusable,
 * before any R2/D1 await. A throw after native I/O is reported by workerd as
 * an unhandled rejection even when the caller awaits and catches it (see
 * test-workers nsopw/intel malformed-KEK cases). JWT-only configs skip this
 * and still resolve in resolveKek().
 */
function assertDedicatedKekIfPresent(source: FileKekSource): void {
  const dedicated = source && typeof source === 'object'
    ? source.FILE_ENCRYPTION_KEK?.trim()
    : typeof source === 'string'
      ? source.trim()
      : undefined;
  if (!dedicated) return;
  decodeDedicatedKekBytes(dedicated);
}

/** Fetch and decrypt a file. Returns null if the R2 object doesn't exist,
 *  or if it exists but has no file_encryption_keys row (e.g. already
 *  crypto-shredded) — either way, there's nothing decryptable to return.
 *
 *  Unwrap tries every usable KEK (dedicated, previous dedicated, JWT-derived,
 *  previous JWT). R2 ciphertext is never rewritten. If unwrap succeeds with a
 *  non-preferred KEK, only the D1 wrapped_dek row is re-wrapped to the current
 *  preferred KEK so later reads don't need the old secret. */
export async function getDecrypted(
  bucket: R2Bucket,
  db: D1Database,
  kek: FileKekSource,
  key: string,
): Promise<{ bytes: Uint8Array; httpMetadata?: R2HTTPMetadata } | null> {
  const obj = await bucket.get(key);
  if (!obj) return null;

  let row: EncryptionKeyRow | null = null;
  try {
    row = await db.prepare(
      'SELECT wrapped_dek, dek_iv, file_iv FROM file_encryption_keys WHERE r2_key = ?',
    ).bind(key).first<EncryptionKeyRow>();
  } catch (err) {
    // If the migration hasn't been applied yet, the table doesn't exist.
    // Every file predates encryption in that case, so return null to let
    // callers fall back to the legacy plaintext path.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('no such table')) return null;
    throw err;
  }
  if (!row) return null;

  const candidates = await unwrapKekB64Candidates(kek);
  if (candidates.length === 0) {
    assertDedicatedKekIfPresent(kek);
    throw new FileEncryptionError('File encryption is not configured');
  }

  let dekRaw: Uint8Array | null = null;
  let usedKekB64: string | null = null;
  for (const kekB64 of candidates) {
    try {
      const kekKey = await importKek(kekB64);
      dekRaw = new Uint8Array(await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: base64ToBytes(row.dek_iv) }, kekKey, base64ToBytes(row.wrapped_dek),
      ));
      usedKekB64 = kekB64;
      break;
    } catch {
      // Wrong KEK — try the next historical wrapping key.
    }
  }
  if (!dekRaw || !usedKekB64) {
    throw new FileEncryptionError('Decryption failed — key may have changed');
  }

  const dek = await crypto.subtle.importKey('raw', dekRaw, { name: 'AES-GCM' }, false, ['decrypt']);

  const ciphertext = await obj.arrayBuffer();
  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(row.file_iv) }, dek, ciphertext,
  );

  try {
    const preferred = await kekB64FromSource(kek);
    if (preferred !== usedKekB64) {
      const wrapKey = await importKek(preferred);
      const newDekIv = crypto.getRandomValues(new Uint8Array(12));
      const newWrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: newDekIv }, wrapKey, dekRaw);
      await db.prepare(
        'UPDATE file_encryption_keys SET wrapped_dek = ?, dek_iv = ? WHERE r2_key = ?',
      ).bind(
        bytesToBase64(new Uint8Array(newWrapped)),
        bytesToBase64(newDekIv),
        key,
      ).run();
    }
  } catch {
    // Read succeeded. Never fail the officer-facing GET because re-wrap did not.
  }

  return { bytes: new Uint8Array(plainBuf), httpMetadata: obj.httpMetadata };
}

/** Crypto-shred: permanently destroy the ability to decrypt one file,
 *  without touching the R2 object or any other file's key.
 *
 *  WARNING: fieldPhotos.ts's `GET /file/*` route falls back to serving an
 *  object's raw R2 bytes whenever it has no key row here — that fallback
 *  exists for pre-encryption legacy uploads and assumes standalone
 *  crypto-shredding (calling this function WITHOUT also deleting the R2
 *  object) never happens. If you call this on its own, leaving the R2
 *  object in place, that route will serve the shredded object's raw
 *  ciphertext bytes instead of a clean 404. Always delete the R2 object
 *  in the same operation when you actually intend to shred. */
export async function deleteEncryptionKey(db: D1Database, key: string): Promise<void> {
  await db.prepare('DELETE FROM file_encryption_keys WHERE r2_key = ?').bind(key).run();
}
