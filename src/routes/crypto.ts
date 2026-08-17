// ============================================================
// RMPG Flex — Post-quantum crypto administration & toolbox route
// ------------------------------------------------------------
// Mounted at /api/crypto (auth required) via routesConfig.ts. Admin/manager
// gated for key material & sealing/signing; verify is open to any
// authenticated user (public-key operation). 503 when RMPG_PQ_MASTER_KEY
// is unset. Runtime-reconciles the crypto_identities table (migration
// 0206 applies with continue-on-error deploy-side — see CLAUDE.md #4).
// ============================================================

import { Hono } from 'hono';
import { getDb } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { log } from '../utils/logger';

import {
  b64decode,
  b64encode,
  decryptField,
  encryptField,
  ensureEncryptionIdentity,
  ensureSigningIdentity,
  ensureOfficerEncryptionIdentity,
  ensureOfficerSigningIdentity,
  getEncryptionPublicKey,
  getEncryptionSecretKey,
  getOfficerEncryptionPublicKey,
  getOfficerSigningPublicKey,
  getSigningPublicKey,
  hasIdentity,
  hybridSign,
  hybridVerify,
  listIdentities,
  listOfficerIdentities,
  loadOfficerSigningSecrets,
  loadSigningSecrets,
  open,
  revokeOfficerIdentity,
  rotateMasterKey,
  seal,
} from '../utils/crypto';

interface CryptoBindings {
  DB: D1Database;
  RMPG_PQ_MASTER_KEY?: string;
  JWT_SECRET: string;
}

interface CryptoVars {
  user?: { id: number; role: string; username: string; full_name: string };
  userId?: number;
  traceId?: string;
}

const app = new Hono<{ Bindings: CryptoBindings; Variables: CryptoVars }>();

const SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS crypto_identities (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('encryption', 'signing')),
  public_key TEXT NOT NULL,
  wrapped_secret TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_crypto_identities_kind ON crypto_identities (kind);`;

async function ensureSchema(db: D1Database): Promise<void> {
  await db.exec(SCHEMA_SQL);
}

app.get('/health', async (c) => {
  const db = getDb(c.env);
  await ensureSchema(db);
  const keySet = !!c.env.RMPG_PQ_MASTER_KEY;
  const enc = await hasIdentity(db, 'org-encryption').catch(() => false);
  const sig = await hasIdentity(db, 'org-signing').catch(() => false);
  return c.json({ status: keySet ? 'ok' : 'degraded', masterKeySet: keySet, identities: { encryption: enc, signing: sig } });
});

// ── Identity management (admin only) ─────────────────────────

app.post('/identities/encryption', requireRole('admin'), async (c) => {
  if (!c.env.RMPG_PQ_MASTER_KEY) return c.json({ code: 'not_configured', error: 'RMPG_PQ_MASTER_KEY not set' }, 503);
  const db = getDb(c.env);
  await ensureSchema(db);
  const id = await ensureEncryptionIdentity(db, c.env.RMPG_PQ_MASTER_KEY);
  log.info('crypto: ensured encryption identity', { pubLen: id.publicKey.length });
  return c.json({ id: 'org-encryption', publicKey: b64encode(id.publicKey), algorithm: 'X25519+ML-KEM-768' });
});

app.post('/identities/signing', requireRole('admin'), async (c) => {
  if (!c.env.RMPG_PQ_MASTER_KEY) return c.json({ code: 'not_configured', error: 'RMPG_PQ_MASTER_KEY not set' }, 503);
  const db = getDb(c.env);
  await ensureSchema(db);
  const id = await ensureSigningIdentity(db, c.env.RMPG_PQ_MASTER_KEY);
  log.info('crypto: ensured signing identity', { edPubLen: id.ed.publicKey.length, pqPubLen: id.pq.publicKey.length });
  return c.json({
    id: 'org-signing',
    algorithms: ['Ed25519', 'ML-DSA-65'],
    publicKey: { ed25519: b64encode(id.ed.publicKey), mlDsa65: b64encode(id.pq.publicKey) },
  });
});

app.get('/identities', requireRole('admin', 'manager'), async (c) => {
  const db = getDb(c.env);
  await ensureSchema(db);
  const rows = await listIdentities(db);
  return c.json({ identities: rows });
});

// Public-key fetch — open to any authenticated user. The public key is
// PUBLIC by definition; this is the endpoint the officer's device calls
// to seal evidence locally (client-side seal — the Worker never sees the
// plaintext until an admin with the unwrapped secret calls /open).
app.get('/identities/encryption/public', async (c) => {
  const db = getDb(c.env);
  await ensureSchema(db);
  let pub;
  try {
    pub = await getEncryptionPublicKey(db);
  } catch {
    return c.json({ code: 'no_identity', error: 'org encryption identity not provisioned' }, 404);
  }
  // MITM defense: sign the encryption public key bytes with the org signing
  // identity so the client can verify the key wasn't swapped in transit. A
  // compromised Worker-runtime attacker who can swap the returned public key
  // would also need to re-sign it — but the signing secret is wrapped by
  // RMPG_PQ_MASTER_KEY (which they don't have). The client pins the signing
  // public key on first fetch (TOFU) so a MITM starting later can't swap both.
  let signature: string | undefined;
  let signingPub: { ed25519: string; mlDsa65: string } | undefined;
  try {
    const sigKeys = await loadSigningSecrets(db, c.env.RMPG_PQ_MASTER_KEY);
    const sigPub = await getSigningPublicKey(db);
    signature = b64encode(hybridSign(pub, sigKeys.ed.secretKey, sigKeys.pq.secretKey));
    signingPub = { ed25519: b64encode(sigPub.ed), mlDsa65: b64encode(sigPub.pq) };
  } catch {
    // No signing identity provisioned — return the key unsigned. The client
    // will seal without verification (and can warn the officer).
  }
  return c.json({
    id: 'org-encryption',
    publicKey: b64encode(pub),
    algorithm: 'X25519+ML-KEM-768',
    signature,
    signingPublicKey: signingPub,
  });
});

// ── Asymmetric sealed box (transit / E2E) ─────────────────────

app.post('/seal', requireRole('admin', 'manager'), async (c) => {
  if (!c.env.RMPG_PQ_MASTER_KEY) return c.json({ code: 'not_configured' }, 503);
  const db = getDb(c.env);
  await ensureSchema(db);
  const body = await c.req.json<{ plaintext?: string; aad?: string }>();
  // Note: an empty plaintext ("") is a legitimate seal target (sealing
  // zero bytes). Reject only the absent-field case, not empty string.
  if (body.plaintext == null) return c.json({ error: 'plaintext (base64) required' }, 400);
  const pub = await getEncryptionPublicKey(db);
  const aad = body.aad ? b64decode(body.aad) : undefined;
  const { frame } = await seal(b64decode(body.plaintext), pub, aad);
  return c.json({ frame: b64encode(frame) });
});

app.post('/open', requireRole('admin'), async (c) => {
  if (!c.env.RMPG_PQ_MASTER_KEY) return c.json({ code: 'not_configured' }, 503);
  const db = getDb(c.env);
  await ensureSchema(db);
  const body = await c.req.json<{ frame?: string; aad?: string }>();
  if (!body.frame) return c.json({ error: 'frame (base64) required' }, 400);
  const sec = await getEncryptionSecretKey(db, c.env.RMPG_PQ_MASTER_KEY);
  const aad = body.aad ? b64decode(body.aad) : undefined;
  const pt = await open(b64decode(body.frame), sec, aad);
  return c.json({ plaintext: b64encode(pt) });
});

// ── Hybrid signatures (evidence / audit-chain integrity) ───────

app.post('/sign', requireRole('admin'), async (c) => {
  if (!c.env.RMPG_PQ_MASTER_KEY) return c.json({ code: 'not_configured' }, 503);
  const db = getDb(c.env);
  await ensureSchema(db);
  const body = await c.req.json<{ message?: string }>();
  if (!body.message) return c.json({ error: 'message (base64) required' }, 400);
  const keys = await loadSigningSecrets(db, c.env.RMPG_PQ_MASTER_KEY);
  const sig = hybridSign(b64decode(body.message), keys.ed.secretKey, keys.pq.secretKey);
  return c.json({ signature: b64encode(sig), algorithms: ['Ed25519', 'ML-DSA-65'] });
});

app.post('/verify', async (c) => {
  const db = getDb(c.env);
  await ensureSchema(db);
  const body = await c.req.json<{ message?: string; signature?: string }>();
  if (!body.message || !body.signature) return c.json({ error: 'message + signature (base64) required' }, 400);
  let pub;
  try {
    pub = await getSigningPublicKey(db);
  } catch {
    return c.json({ valid: false, reason: 'no signing identity provisioned' }, 200);
  }
  const valid = hybridVerify(b64decode(body.signature), b64decode(body.message), pub.ed, pub.pq);
  return c.json({ valid });
});

// ── Symmetric field encryption (data-at-rest) ──────────────────

app.post('/field/encrypt', requireRole('admin', 'manager'), async (c) => {
  if (!c.env.RMPG_PQ_MASTER_KEY) return c.json({ code: 'not_configured' }, 503);
  const body = await c.req.json<{ plaintext?: string }>();
  if (body.plaintext == null) return c.json({ error: 'plaintext required' }, 400);
  const ciphertext = await encryptField(body.plaintext, c.env.RMPG_PQ_MASTER_KEY);
  return c.json({ ciphertext });
});

app.post('/field/decrypt', requireRole('admin', 'manager'), async (c) => {
  if (!c.env.RMPG_PQ_MASTER_KEY) return c.json({ code: 'not_configured' }, 503);
  const body = await c.req.json<{ ciphertext?: string }>();
  if (!body.ciphertext) return c.json({ error: 'ciphertext required' }, 400);
  const plaintext = await decryptField(body.ciphertext, c.env.RMPG_PQ_MASTER_KEY);
  return c.json({ plaintext });
});

// ── Master-key rotation (admin only) ────────────────────────────
//
// Re-wraps every crypto_identities secret half from the OLD master key
// to the NEW one. Caller MUST have already set the new RMPG_PQ_MASTER_KEY
// in the Worker secret store; they pass the OLD key in the request body
// so the Worker can unwrap with it one last time. After a 200 response,
// the old key can be destroyed.
//
// Fail closed: if the old key is wrong, decryptBytes throws and the
// batch never runs — the table is left intact under the old key.
app.post('/rotate-master-key', requireRole('admin'), async (c) => {
  if (!c.env.RMPG_PQ_MASTER_KEY) return c.json({ code: 'not_configured', error: 'new RMPG_PQ_MASTER_KEY not set' }, 503);
  const body = await c.req.json<{ oldKey?: string }>();
  if (!body.oldKey) return c.json({ error: 'oldKey (base64 32-byte previous RMPG_PQ_MASTER_KEY) required' }, 400);
  const db = getDb(c.env);
  await ensureSchema(db);
  let result;
  try {
    result = await rotateMasterKey(db, body.oldKey, c.env.RMPG_PQ_MASTER_KEY);
  } catch (err) {
    log.error('crypto: master-key rotation failed', {}, err as Error);
    return c.json({ code: 'rotation_failed', error: (err as Error).message }, 500);
  }
  log.info('crypto: master-key rotation complete', { rows: result.rowsRewrapped });
  return c.json({ ok: true, ...result });
});

// ── Per-officer identities (admin provisions; officer reads own) ───────
//
// Each officer can hold their own hybrid KEM + hybrid signing identity,
// stored as `officer-<userId>` rows. The officer's secret never leaves
// the keystore except to an authenticated same-user session that needs
// it for a server-side sign (post-quantum signatures can't be done in
// the browser yet — ML-DSA in noble IS pure-JS and could move client-side
// later, but today signing stays server-side). The officer's PUBLIC
// keys are fetchable by any authenticated user (for sealing TO that
// officer and verifying their signatures).

app.post('/officer/:userId/encryption', requireRole('admin'), async (c) => {
  if (!c.env.RMPG_PQ_MASTER_KEY) return c.json({ code: 'not_configured' }, 503);
  const userId = Number(c.req.param('userId'));
  if (!Number.isInteger(userId) || userId <= 0) return c.json({ error: 'invalid userId' }, 400);
  const db = getDb(c.env);
  await ensureSchema(db);
  const id = await ensureOfficerEncryptionIdentity(db, c.env.RMPG_PQ_MASTER_KEY, userId);
  log.info('crypto: ensured officer encryption identity', { userId });
  return c.json({ id: `officer-${userId}`, userId, publicKey: b64encode(id.publicKey), algorithm: 'X25519+ML-KEM-768' });
});

app.post('/officer/:userId/signing', requireRole('admin'), async (c) => {
  if (!c.env.RMPG_PQ_MASTER_KEY) return c.json({ code: 'not_configured' }, 503);
  const userId = Number(c.req.param('userId'));
  if (!Number.isInteger(userId) || userId <= 0) return c.json({ error: 'invalid userId' }, 400);
  const db = getDb(c.env);
  await ensureSchema(db);
  const id = await ensureOfficerSigningIdentity(db, c.env.RMPG_PQ_MASTER_KEY, userId);
  log.info('crypto: ensured officer signing identity', { userId });
  return c.json({
    id: `officer-${userId}`, userId, algorithms: ['Ed25519', 'ML-DSA-65'],
    publicKey: { ed25519: b64encode(id.ed.publicKey), mlDsa65: b64encode(id.pq.publicKey) },
  });
});

// Officer reads their OWN encryption public key (any authed user — public key).
app.get('/officer/:userId/encryption/public', async (c) => {
  const userId = Number(c.req.param('userId'));
  if (!Number.isInteger(userId) || userId <= 0) return c.json({ error: 'invalid userId' }, 400);
  const db = getDb(c.env);
  await ensureSchema(db);
  let pub;
  try {
    pub = await getOfficerEncryptionPublicKey(db, userId);
  } catch {
    return c.json({ code: 'no_identity', error: `officer-${userId} encryption identity not provisioned` }, 404);
  }
  return c.json({ id: `officer-${userId}`, userId, publicKey: b64encode(pub), algorithm: 'X25519+ML-KEM-768' });
});

// Officer signs with THEIR OWN identity (RBAC: the JWT user must match
// the :userId — an officer can't sign as another officer).
app.post('/officer/:userId/sign', async (c) => {
  if (!c.env.RMPG_PQ_MASTER_KEY) return c.json({ code: 'not_configured' }, 503);
  const userId = Number(c.req.param('userId'));
  const me = c.get('user') as { id: number; role: string } | undefined;
  if (!me) return c.json({ error: 'auth required' }, 401);
  // Self-or-admin: an officer signs as themselves; an admin may sign as
  // any officer (e.g. an automated audit-seal acting on behalf of a user).
  if (me.id !== userId && me.role !== 'admin') {
    return c.json({ error: 'forbidden: can only sign as yourself', code: 'FORBIDDEN' }, 403);
  }
  if (!Number.isInteger(userId) || userId <= 0) return c.json({ error: 'invalid userId' }, 400);
  const body = await c.req.json<{ message?: string }>();
  if (body.message == null) return c.json({ error: 'message (base64) required' }, 400);
  const db = getDb(c.env);
  await ensureSchema(db);
  const keys = await loadOfficerSigningSecrets(db, c.env.RMPG_PQ_MASTER_KEY, userId);
  const sig = hybridSign(b64decode(body.message), keys.ed.secretKey, keys.pq.secretKey);
  return c.json({ signature: b64encode(sig), signedBy: `officer-${userId}`, algorithms: ['Ed25519', 'ML-DSA-65'] });
});

// Anyone can verify an officer's signature (public-key op).
app.post('/officer/:userId/verify', async (c) => {
  const userId = Number(c.req.param('userId'));
  if (!Number.isInteger(userId) || userId <= 0) return c.json({ error: 'invalid userId' }, 400);
  const db = getDb(c.env);
  await ensureSchema(db);
  const body = await c.req.json<{ message?: string; signature?: string }>();
  if (!body.message || !body.signature) return c.json({ error: 'message + signature (base64) required' }, 400);
  let pub;
  try {
    pub = await getOfficerSigningPublicKey(db, userId);
  } catch {
    return c.json({ valid: false, reason: `officer-${userId} signing identity not provisioned` }, 200);
  }
  const valid = hybridVerify(b64decode(body.signature), b64decode(body.message), pub.ed, pub.pq);
  return c.json({ valid, verifiedAgainst: `officer-${userId}` });
});

// Admin lists all per-officer identities.
app.get('/officer', requireRole('admin', 'manager'), async (c) => {
  const db = getDb(c.env);
  await ensureSchema(db);
  const rows = await listOfficerIdentities(db);
  return c.json({ officers: rows });
});

// Admin revokes (crypto-shreds) an officer's identity.
app.delete('/officer/:userId', requireRole('admin'), async (c) => {
  const userId = Number(c.req.param('userId'));
  if (!Number.isInteger(userId) || userId <= 0) return c.json({ error: 'invalid userId' }, 400);
  const db = getDb(c.env);
  await ensureSchema(db);
  const removed = await revokeOfficerIdentity(db, userId);
  log.info('crypto: revoked officer identity', { userId, removed });
  return c.json({ ok: true, revoked: removed, userId });
});

export default app;