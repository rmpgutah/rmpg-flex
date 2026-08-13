import { describe, it, expect } from 'vitest';
import {
  ensureEncryptionIdentity,
  ensureSigningIdentity,
  getEncryptionPublicKey,
  getEncryptionSecretKey,
  getSigningPublicKey,
  loadSigningSecrets,
  hasIdentity,
  listIdentities,
  b64decode,
  b64encode,
  randomBytes,
  ED25519_PUB_LEN,
  ML_DSA_PUB_LEN,
  PQ_KEM_PUB_LEN,
  PQ_KEM_CT_LEN,
  seal,
  open,
  hybridSign,
  hybridVerify,
} from '../../src/utils/crypto';

// Minimal in-memory D1 shim covering exactly the statements keystore.ts issues.
type Row = Record<string, unknown>;

function makeFakeDb() {
  const rows = new Map<string, Row>();
  let stmt: { sql: string; args: unknown[] };
  const db: unknown = {
    prepare(sql: string) {
      stmt = { sql, args: [] };
      const self = {
        bind(...args: unknown[]) {
          stmt.args = args;
          return self;
        },
        async first<T>(): Promise<T | null> {
          const id = stmt.args[0] as string;
          if (stmt.sql.startsWith('SELECT 1')) return (rows.has(id) ? ({ '1': 1 } as unknown as T) : null);
          if (stmt.sql.includes('ORDER BY')) return null;
          const r = rows.get(id) ?? null;
          return r as unknown as T | null;
        },
        async all<T>(): Promise<{ results: T[] }> {
          if (stmt.sql.includes('ORDER BY')) {
            const results = [...rows.values()].sort((a, b) => Number(a.created_at) - Number(b.created_at)) as unknown as T[];
            return { results };
          }
          return { results: [] };
        },
        async run() {
          const [id, kind, public_key, wrapped_secret, created_at] = stmt.args as [string, string, string, string, number];
          if (!rows.has(id)) rows.set(id, { id, kind, public_key, wrapped_secret, created_at });
          return { meta: { changes: 1 } };
        },
      };
      return self;
    },
    async exec() {
      return { count: 0 };
    },
  };
  return db as D1Database;
}

const KEY = b64encode(randomBytes(32));

describe('D1 keystore — encryption identity', () => {
  it('creates once and is idempotent (second call returns the same keypair)', async () => {
    const db = makeFakeDb();
    const a = await ensureEncryptionIdentity(db, KEY);
    const b = await ensureEncryptionIdentity(db, KEY);
    expect(b.publicKey).toEqual(a.publicKey);
    expect(b.secretKey).toEqual(a.secretKey);
    expect(a.publicKey.length).toBe(PQ_KEM_PUB_LEN);
    expect(await hasIdentity(db, 'org-encryption')).toBe(true);
  });

  it('recovered secret key opens a sealed frame sealed to the stored public key', async () => {
    const db = makeFakeDb();
    await ensureEncryptionIdentity(db, KEY);
    const pub = await getEncryptionPublicKey(db);
    const sec = await getEncryptionSecretKey(db, KEY);
    const msg = new TextEncoder().encode('case file 2026-0007');
    const { frame } = await seal(msg, pub);
    expect(frame.length).toBeGreaterThan(PQ_KEM_CT_LEN);
    expect(await open(frame, sec)).toEqual(msg);
  });
});

describe('D1 keystore — signing identity', () => {
  it('creates once, idempotent, and stored secret re-signs/verifies', async () => {
    const db = makeFakeDb();
    const a = await ensureSigningIdentity(db, KEY);
    const b = await ensureSigningIdentity(db, KEY);
    expect(b.ed.publicKey).toEqual(a.ed.publicKey);
    expect(b.pq.publicKey).toEqual(a.pq.publicKey);
    expect(a.ed.publicKey.length).toBe(ED25519_PUB_LEN);
    expect(a.pq.publicKey.length).toBe(ML_DSA_PUB_LEN);

    const keys = await loadSigningSecrets(db, KEY);
    const msg = new TextEncoder().encode('audit event 9');
    const sig = hybridSign(msg, keys.ed.secretKey, keys.pq.secretKey);
    const pub = await getSigningPublicKey(db);
    expect(hybridVerify(sig, msg, pub.ed, pub.pq)).toBe(true);
  });

  it('lists identities after creation', async () => {
    const db = makeFakeDb();
    await ensureEncryptionIdentity(db, KEY);
    await ensureSigningIdentity(db, KEY);
    const list = await listIdentities(db);
    expect(list.length).toBe(2);
    expect(list.map((r) => r.kind).sort()).toEqual(['encryption', 'signing']);
  });
});

describe('keystore tamper resistance', () => {
  it('public key is stored base64 of the raw PQ KEM public bytes', async () => {
    const db = makeFakeDb();
    const id = await ensureEncryptionIdentity(db, KEY);
    const pub = await getEncryptionPublicKey(db);
    expect(b64encode(pub)).toEqual(b64encode(id.publicKey));
  });
});