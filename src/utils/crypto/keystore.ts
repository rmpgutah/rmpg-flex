// ============================================================
// RMPG Flex — D1 keystore for post-quantum identities
// ------------------------------------------------------------
// Persists long-term org crypto identities (one envelope-encryption
// identity, one signing identity). Public halves are stored in the
// clear; secret halves are AES-256-GCM-wrapped by env.RMPG_PQ_MASTER_KEY
// (the same master KEK used by envelope.ts) and stored as `enc-v2:iv:ct`
// strings — so leaking the D1 row alone is NOT enough to recover secrets.
//
// Schema: migration 0206_crypto_identities.sql (crypto_identities table).
// Idempotent create: PRIMARY KEY id keeps a single canonical row per
// logical identity; ensure*Identity() returns the existing keypair if a
// row already exists rather than silently minting a second.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { KeyStoreError } from './errors';

import {
  ed25519Keygen,
  ED25519_PUB_LEN,
  ED25519_SEC_LEN,
  kemKeygen,
  ML_DSA_PUB_LEN,
  ML_DSA_SEC_LEN,
  mlDsaKeygen,
  PQ_KEM_PUB_LEN,
  PQ_KEM_SEC_LEN,
} from './postquantum';
import { b64decode, b64encode, concatBytes, utf8 } from './primitives';
import { decryptBytes, encryptBytes } from './envelope';

// ── Key-substitution defense ─────────────────────────────────
// The wrapped_secret is bound to its identity id + kind via AES-GCM AAD.
// An attacker with D1 write access who pastes identity A's wrapped_secret
// into identity B's row will fail AEAD verification at unwrap time because
// the AAD ("keystore:<id>:<kind>") differs. Without this binding, the
// substituted secret would unwrap cleanly (same master key) and produce a
// VALID but WRONG key — silent key-substitution, which for a signing
// identity means an attacker could inject their own key by swapping rows.
function identityBindAad(id: string, kind: string): Uint8Array {
  return utf8(`keystore:${id}:${kind}`);
}

export const ENCRYPTION_ID = 'org-encryption';
export const SIGNING_ID = 'org-signing';

interface IdentityRow {
  kind: string;
  public_key: string;
  wrapped_secret: string;
}

async function getRow(db: D1Database, id: string): Promise<IdentityRow> {
  const row = await db
    .prepare('SELECT kind, public_key, wrapped_secret FROM crypto_identities WHERE id = ?')
    .bind(id)
    .first<IdentityRow>();
  if (!row) throw new KeyStoreError(`crypto identity '${id}' not found in keystore`);
  return row;
}

export async function hasIdentity(db: D1Database, id: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM crypto_identities WHERE id = ?')
    .bind(id)
    .first<{ '1': number }>();
  return !!row;
}

// ── Encryption identity (hybrid KEM) ─────────────────────────

export interface EncryptionIdentity {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

async function readEncryptionIdentityRow(
  db: D1Database,
  id: string,
  masterKeyB64: string | undefined,
): Promise<EncryptionIdentity> {
  const row = await db
    .prepare('SELECT public_key, wrapped_secret FROM crypto_identities WHERE id = ?')
    .bind(id)
    .first<IdentityRow>();
  if (!row) throw new KeyStoreError(`encryption identity '${id}' not found in keystore`);
  const publicKey = b64decode(row.public_key);
  const secretKey = await decryptBytes(row.wrapped_secret, masterKeyB64, identityBindAad(id, 'encryption'));
  if (publicKey.length !== PQ_KEM_PUB_LEN || secretKey.length !== PQ_KEM_SEC_LEN) {
    throw new KeyStoreError(`encryption identity '${id}' has corrupt key material`);
  }
  return { publicKey, secretKey };
}

export async function ensureEncryptionIdentity(
  db: D1Database,
  masterKeyB64: string | undefined,
  id: string = ENCRYPTION_ID,
): Promise<EncryptionIdentity> {
  // TOCTOU-safe: SELECT-then-INSERT OR IGNORE can race two concurrent
  // provisions. The loser's INSERT is ignored (PRIMARY KEY), but the
  // loser would otherwise return its LOCALLY-generated keypair — whose
  // public key does NOT match the row that actually landed. Anyone who
  // then sealed to the loser's local pubkey would produce frames the
  // stored-secret holder can never open. Re-read after the INSERT and
  // return the row that actually won, so both racers converge.
  const existing = await db
    .prepare('SELECT public_key, wrapped_secret FROM crypto_identities WHERE id = ?')
    .bind(id)
    .first<IdentityRow>();
  if (existing) return readEncryptionIdentityRow(db, id, masterKeyB64);

  const kp = kemKeygen();
  const inserted = await upsertIdentity(db, id, 'encryption', kp.publicKey, kp.secretKey, masterKeyB64);
  if (!inserted) {
    // Lost the race — another provisioner's row landed. Return theirs.
    return readEncryptionIdentityRow(db, id, masterKeyB64);
  }
  return kp;
}

export async function getEncryptionPublicKey(
  db: D1Database,
  id: string = ENCRYPTION_ID,
): Promise<Uint8Array> {
  const row = await getRow(db, id);
  if (row.kind !== 'encryption') throw new KeyStoreError(`identity '${id}' is not an encryption identity`);
  const pub = b64decode(row.public_key);
  if (pub.length !== PQ_KEM_PUB_LEN) throw new KeyStoreError('encryption public key has bad length');
  return pub;
}

export async function getEncryptionSecretKey(
  db: D1Database,
  masterKeyB64: string | undefined,
  id: string = ENCRYPTION_ID,
): Promise<Uint8Array> {
  const row = await getRow(db, id);
  if (row.kind !== 'encryption') throw new KeyStoreError(`identity '${id}' is not an encryption identity`);
  return decryptBytes(row.wrapped_secret, masterKeyB64, identityBindAad(id, 'encryption'));
}

// ── Signing identity (Ed25519 + ML-DSA-65) ───────────────────

export interface SigningIdentityKeys {
  ed: { publicKey: Uint8Array; secretKey: Uint8Array };
  pq: { publicKey: Uint8Array; secretKey: Uint8Array };
}

export interface SigningPublicKey {
  ed: Uint8Array;
  pq: Uint8Array;
}

async function upsertIdentity(
  db: D1Database,
  id: string,
  kind: 'encryption' | 'signing',
  publicKey: Uint8Array,
  secretKey: Uint8Array,
  masterKeyB64: string | undefined,
): Promise<boolean> {
  // Returns true iff a NEW row was actually inserted (changes > 0). With
  // `INSERT OR IGNORE` a concurrent provisioner's existing row makes this
  // INSERT a no-op — the caller uses the return value to detect the lost
  // race and re-read the winning row (see ensure*Identity).
  const wrapped = await encryptBytes(secretKey, masterKeyB64, identityBindAad(id, kind));
  const res = await db
    .prepare(
      'INSERT OR IGNORE INTO crypto_identities (id, kind, public_key, wrapped_secret, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(id, kind, b64encode(publicKey), wrapped, Date.now())
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

async function readSigningIdentityRow(
  db: D1Database,
  id: string,
  masterKeyB64: string | undefined,
): Promise<SigningIdentityKeys> {
  const row = await db
    .prepare('SELECT public_key, wrapped_secret FROM crypto_identities WHERE id = ?')
    .bind(id)
    .first<IdentityRow>();
  if (!row) throw new KeyStoreError(`signing identity '${id}' not found in keystore`);
  return unwrapSigningRowFull(row, id, masterKeyB64);
}

export async function ensureSigningIdentity(
  db: D1Database,
  masterKeyB64: string | undefined,
  id: string = SIGNING_ID,
): Promise<SigningIdentityKeys> {
  // TOCTOU-safe (see ensureEncryptionIdentity for the race + fix rationale).
  const existing = await db
    .prepare('SELECT public_key, wrapped_secret FROM crypto_identities WHERE id = ?')
    .bind(id)
    .first<IdentityRow>();
  if (existing) return readSigningIdentityRow(db, id, masterKeyB64);

  const edKp = ed25519Keygen();
  const pqKp = mlDsaKeygen();
  const pub = concatBytes(edKp.publicKey, pqKp.publicKey);
  const sec = concatBytes(edKp.secretKey, pqKp.secretKey);
  const inserted = await upsertIdentity(db, id, 'signing', pub, sec, masterKeyB64);
  if (!inserted) {
    // Lost the race; return the winning row's keypair.
    return readSigningIdentityRow(db, id, masterKeyB64);
  }
  return { ed: edKp, pq: pqKp };
}

async function unwrapSigningRowFull(
  row: IdentityRow,
  id: string,
  masterKeyB64: string | undefined,
): Promise<SigningIdentityKeys> {
  const pub = b64decode(row.public_key);
  if (pub.length !== ED25519_PUB_LEN + ML_DSA_PUB_LEN) {
    throw new KeyStoreError(`signing identity '${id}' has corrupt public material`);
  }
  const sec = await decryptBytes(row.wrapped_secret, masterKeyB64, identityBindAad(id, 'signing'));
  if (sec.length !== ED25519_SEC_LEN + ML_DSA_SEC_LEN) {
    throw new KeyStoreError(`signing identity '${id}' has corrupt secret material`);
  }
  return {
    ed: {
      publicKey: pub.subarray(0, ED25519_PUB_LEN) as Uint8Array,
      secretKey: sec.subarray(0, ED25519_SEC_LEN) as Uint8Array,
    },
    pq: {
      publicKey: pub.subarray(ED25519_PUB_LEN) as Uint8Array,
      secretKey: sec.subarray(ED25519_SEC_LEN) as Uint8Array,
    },
  };
}

export async function loadSigningSecrets(
  db: D1Database,
  masterKeyB64: string | undefined,
  id: string = SIGNING_ID,
): Promise<SigningIdentityKeys> {
  const row = await getRow(db, id);
  if (row.kind !== 'signing') throw new KeyStoreError(`identity '${id}' is not a signing identity`);
  return unwrapSigningRowFull(row, id, masterKeyB64);
}

export async function getSigningPublicKey(
  db: D1Database,
  id: string = SIGNING_ID,
): Promise<SigningPublicKey> {
  const row = await getRow(db, id);
  if (row.kind !== 'signing') throw new KeyStoreError(`identity '${id}' is not a signing identity`);
  const pub = b64decode(row.public_key);
  if (pub.length !== ED25519_PUB_LEN + ML_DSA_PUB_LEN) {
    throw new KeyStoreError('signing public key has bad length');
  }
  return {
    ed: pub.subarray(0, ED25519_PUB_LEN) as Uint8Array,
    pq: pub.subarray(ED25519_PUB_LEN) as Uint8Array,
  };
}

export async function listIdentities(db: D1Database): Promise<{ id: string; kind: string; created_at: number }[]> {
  const res = await db
    .prepare('SELECT id, kind, created_at FROM crypto_identities ORDER BY created_at ASC')
    .all<{ id: string; kind: string; created_at: number }>();
  return res.results ?? [];
}

// ── Master-key rotation: re-wrap every secret under a NEW KEK ─────────
//
// Rotation model: every secret half in crypto_identities is AES-GCM-wrapped
// by the CURRENT RMPG_PQ_MASTER_KEY. Rotating the KEK means:
//   1. unwrap each row's secret under the OLD key
//   2. re-wrap it under the NEW key (a fresh IV per row)
//   3. UPDATE the row in a single D1 batch so a partial failure leaves
//      the table consistent (either all rows use the new key or, on
//      failure, none do — the old key still opens the unwrapped rows we
//      didn't get to).
//
// Caller contract: set the NEW RMPG_PQ_MASTER_KEY in the Worker secret
// store first, then run this with `oldKeyB64` = the outgoing key. After
// a successful rotation the old key can be destroyed. If the old key is
// already unavailable, rotation is impossible — those rows are gone
// (intentional crypto-shred; that's the security property).
//
// NOTE: this re-wraps the ORG identities only. Per-record DEK rows
// (file_encryption_keys, encryptedR2.ts) wrap DEKs under a DIFFERENT
// secret (FILE_ENCRYPTION_KEK) and are out of scope here — rotate that
// secret via its own path.

export interface RotationResult {
  rowsRewrapped: number;
  ids: string[];
}

export async function rotateMasterKey(
  db: D1Database,
  oldKeyB64: string | undefined,
  newKeyB64: string | undefined,
): Promise<RotationResult> {
  if (!newKeyB64) throw new KeyStoreError('new RMPG_PQ_MASTER_KEY not set');
  const rows = await db
    .prepare('SELECT id, wrapped_secret, public_key, kind FROM crypto_identities')
    .all<{ id: string; wrapped_secret: string; public_key: string; kind: string }>();
  if (!rows.results.length) return { rowsRewrapped: 0, ids: [] };

  const statements: D1PreparedStatement[] = [];
  const ids: string[] = [];
  for (const row of rows.results) {
    // Step 1: unwrap under OLD key (throws if oldKeyB64 is wrong/gone — fail
    // closed, don't silently skip a row and leave the table half-rotated).
    const secretPlain = await decryptBytes(row.wrapped_secret, oldKeyB64, identityBindAad(row.id, row.kind));
    // Step 2: re-wrap under NEW key (preserve the same identity-binding AAD).
    const newWrapped = await encryptBytes(secretPlain, newKeyB64, identityBindAad(row.id, row.kind));
    statements.push(
      db.prepare('UPDATE crypto_identities SET wrapped_secret = ? WHERE id = ?').bind(newWrapped, row.id),
    );
    ids.push(row.id);
  }

  // Step 3: apply as a single batch — D1 runs all statements in one
  // transaction; on failure none land and the caller keeps the old key.
  await db.batch(statements);

  return { rowsRewrapped: statements.length, ids };
}

import type { D1PreparedStatement } from '@cloudflare/workers-types';

// ── Per-officer identities (RBAC-scoped org sub-identities) ───────────
//
// The crypto_identities table's PRIMARY KEY is `id TEXT`, so it already
// supports `officer-<n>` rows alongside the single `org-encryption`/
// `org-signing` org rows. Each officer holds their own hybrid KEM
// keypair so that evidence sealed FROM an officer's device carries that
// officer's identity binding, and seals TO a specific officer can be
// opened only by that officer (not by admins who only hold the org
// master KEK). Admins can provision & revoke; the officer's key never
// leaves the keystore unless the officer authenticates and the Worker
// returns the unwrapped secret to a client-side sealing session.

export const OFFICER_PREFIX = 'officer-';

function officerIdFromUserId(userId: number | string): string {
  return `${OFFICER_PREFIX}${userId}`;
}

/** Provision (or return the existing) per-officer encryption identity.
 *  Officer sub-identities use the same hybrid KEM as the org identity so
 *  sealing/sealing-back works with one code path. */
export async function ensureOfficerEncryptionIdentity(
  db: D1Database,
  masterKeyB64: string | undefined,
  userId: number | string,
): Promise<EncryptionIdentity> {
  return ensureEncryptionIdentity(db, masterKeyB64, officerIdFromUserId(userId));
}

export async function getOfficerEncryptionPublicKey(db: D1Database, userId: number | string): Promise<Uint8Array> {
  return getEncryptionPublicKey(db, officerIdFromUserId(userId));
}

export async function getOfficerEncryptionSecretKey(
  db: D1Database,
  masterKeyB64: string | undefined,
  userId: number | string,
): Promise<Uint8Array> {
  return getEncryptionSecretKey(db, masterKeyB64, officerIdFromUserId(userId));
}

/** Provision (or return the existing) per-officer signing identity. */
export async function ensureOfficerSigningIdentity(
  db: D1Database,
  masterKeyB64: string | undefined,
  userId: number | string,
): Promise<SigningIdentityKeys> {
  return ensureSigningIdentity(db, masterKeyB64, officerIdFromUserId(userId));
}

export async function loadOfficerSigningSecrets(
  db: D1Database,
  masterKeyB64: string | undefined,
  userId: number | string,
): Promise<SigningIdentityKeys> {
  return loadSigningSecrets(db, masterKeyB64, officerIdFromUserId(userId));
}

export async function getOfficerSigningPublicKey(
  db: D1Database,
  userId: number | string,
): Promise<SigningPublicKey> {
  return getSigningPublicKey(db, officerIdFromUserId(userId));
}

/** Admin: revoke (crypto-shred) one officer's identity by deleting its
 *  wrapped_secret row. Once the row is gone, no one — not even a holder
 *  of RMPG_PQ_MASTER_KEY — can recover that officer's secret. Any
 *  evidence sealed TO that officer becomes permanently unreadable, and
 *  any signature FROM that officer can no longer have its secret half
 *  re-used (its PUBLIC key stays verifiable forever in existing audit
 *  rows — verifiability is unaffected by revocation; only NEW signing
 *  ability is destroyed). */
export async function revokeOfficerIdentity(db: D1Database, userId: number | string): Promise<boolean> {
  const r = await db
    .prepare('DELETE FROM crypto_identities WHERE id = ?')
    .bind(officerIdFromUserId(userId))
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

export async function listOfficerIdentities(db: D1Database): Promise<{ id: string; kind: string; created_at: number }[]> {
  const res = await db
    .prepare("SELECT id, kind, created_at FROM crypto_identities WHERE id LIKE ? ORDER BY created_at ASC")
    .bind(`${OFFICER_PREFIX}%`)
    .all<{ id: string; kind: string; created_at: number }>();
  return res.results ?? [];
}

export function isOfficerIdentityId(id: string): boolean {
  return id.startsWith(OFFICER_PREFIX);
}

export function userIdFromOfficerIdentityId(id: string): number | null {
  if (!isOfficerIdentityId(id)) return null;
  const raw = id.slice(OFFICER_PREFIX.length);
  const n = Number(raw);
  return Number.isFinite(n) && raw === String(n) ? n : null;
}