import { describe, it, expect } from 'vitest';
import {
  rotateMasterKey,
  ensureEncryptionIdentity,
  ensureSigningIdentity,
  ensureOfficerEncryptionIdentity,
  ensureOfficerSigningIdentity,
  getOfficerEncryptionPublicKey,
  loadOfficerSigningSecrets,
  revokeOfficerIdentity,
  listOfficerIdentities,
  isOfficerIdentityId,
  userIdFromOfficerIdentityId,
  b64encode,
  randomBytes,
  PQ_KEM_PUB_LEN,
  PQ_KEM_SEC_LEN,
  ML_DSA_PUB_LEN,
  seal,
  open,
  getEncryptionSecretKey,
} from '../../src/utils/crypto';

type Row = Record<string, unknown>;

function makeFakeDb() {
  const rows = new Map<string, Row>();

  function stmtFor(sql: string, args: unknown[]) {
    return {
      async first<T>(): Promise<T | null> {
        const id = args[0] as string;
        if (sql.startsWith('SELECT 1')) return (rows.has(id) ? ({ '1': 1 } as unknown as T) : null);
        if (sql.includes('WHERE id LIKE')) return null;
        if (sql.includes('ORDER BY')) return null;
        return (rows.get(id) ?? null) as unknown as T | null;
      },
      async all<T>(): Promise<{ results: T[] }> {
        if (sql.includes('WHERE id LIKE')) {
          const like = args[0] as string;
          const results = [...rows.values()]
            .filter((r) => String(r.id).startsWith(like.replace('%', '')))
            .sort((a, b) => Number(a.created_at) - Number(b.created_at)) as unknown as T[];
          return { results };
        }
        if (sql.includes('ORDER BY')) {
          const results = [...rows.values()].sort((a, b) => Number(a.created_at) - Number(b.created_at)) as unknown as T[];
          return { results };
        }
        if (sql.startsWith('SELECT id, wrapped_secret, public_key, kind')) {
          return { results: [...rows.values()] as unknown as T[] };
        }
        return { results: [] };
      },
      async run() {
        if (sql.startsWith('DELETE')) {
          const id = args[0] as string;
          const had = rows.has(id);
          rows.delete(id);
          return { meta: { changes: had ? 1 : 0 } };
        }
        if (sql.startsWith('UPDATE')) {
          const wrapped = args[0] as string;
          const id = args[1] as string;
          const r = rows.get(id);
          if (r) r.wrapped_secret = wrapped;
          return { meta: { changes: r ? 1 : 0 } };
        }
        const [id, kind, public_key, wrapped_secret, created_at] = args as [string, string, string, string, number];
        if (!rows.has(id)) rows.set(id, { id, kind, public_key, wrapped_secret, created_at });
        return { meta: { changes: 1 } };
      },
    };
  }

  const db: unknown = {
    prepare(sql: string) {
      const captured: { sql: string; args: unknown[] } = { sql, args: [] };
      const self = {
        bind(...args: unknown[]) { captured.args = args; return self; },
        first<T>() { return stmtFor(captured.sql, captured.args).first<T>(); },
        all<T>() { return stmtFor(captured.sql, captured.args).all<T>(); },
        run() { return stmtFor(captured.sql, captured.args).run(); },
      };
      return self;
    },
    async batch(stmts: { run(): Promise<unknown> }[]) {
      for (const s of stmts) await s.run();
      return [];
    },
    async exec() { return { count: 0 }; },
  };
  return db as unknown as import('@cloudflare/workers-types').D1Database;
}

describe('master-key rotation', () => {
  it('re-wraps all identity secrets from old key to new key', async () => {
    const db = makeFakeDb();
    const oldKey = b64encode(randomBytes(32));
    const newKey = b64encode(randomBytes(32));
    await ensureEncryptionIdentity(db, oldKey);
    await ensureSigningIdentity(db, oldKey);
    await ensureOfficerEncryptionIdentity(db, oldKey, 5);

    // secrets are openable under OLD key before rotation
    const enc0 = await getEncryptionSecretKey(db, oldKey);
    expect(enc0.length).toBeGreaterThan(0);

    const result = await rotateMasterKey(db, oldKey, newKey);
    expect(result.rowsRewrapped).toBe(3);
    expect(result.ids).toHaveLength(3);

    // after rotation: OLD key can no longer open (decrypt fails)
    await expect(getEncryptionSecretKey(db, oldKey)).rejects.toThrow();
    // NEW key opens cleanly
    const enc1 = await getEncryptionSecretKey(db, newKey);
    expect(enc1.length).toBe(PQ_KEM_SEC_LEN); // sanity: same material survived
  });

  it('fails closed when the old key is wrong (no rows updated)', async () => {
    const db = makeFakeDb();
    const realKey = b64encode(randomBytes(32));
    const wrongKey = b64encode(randomBytes(32));
    const newKey = b64encode(randomBytes(32));
    await ensureEncryptionIdentity(db, realKey);
    await expect(rotateMasterKey(db, wrongKey, newKey)).rejects.toThrow();
    // identity still openable under REAL key (rows untouched)
    expect((await getEncryptionSecretKey(db, realKey)).length).toBeGreaterThan(0);
  });

  it('is a no-op on an empty keystore', async () => {
    const db = makeFakeDb();
    const r = await rotateMasterKey(db, b64encode(randomBytes(32)), b64encode(randomBytes(32)));
    expect(r.rowsRewrapped).toBe(0);
  });
});

describe('per-officer identities', () => {
  it('provisions, reads, and revokes an officer encryption identity', async () => {
    const db = makeFakeDb();
    const key = b64encode(randomBytes(32));
    const a = await ensureOfficerEncryptionIdentity(db, key, 7);
    const b = await ensureOfficerEncryptionIdentity(db, key, 7); // idempotent
    expect(b.publicKey).toEqual(a.publicKey);
    expect(a.publicKey.length).toBe(PQ_KEM_PUB_LEN);
    const pub = await getOfficerEncryptionPublicKey(db, 7);
    expect(pub).toEqual(a.publicKey);
    const removed = await revokeOfficerIdentity(db, 7);
    expect(removed).toBe(true);
    await expect(getOfficerEncryptionPublicKey(db, 7)).rejects.toThrow();
  });

  it("officer signing material round-trips through the keystore", async () => {
    const db = makeFakeDb();
    const key = b64encode(randomBytes(32));
    await ensureOfficerSigningIdentity(db, key, 9);
    // keystore itself has no RBAC; the route enforces self-or-admin. Verify
    // the material round-trips so the route's signing path has real keys.
    const keys = await loadOfficerSigningSecrets(db, key, 9);
    expect(keys.ed.secretKey.length).toBe(32);
    expect(keys.pq.publicKey.length).toBe(ML_DSA_PUB_LEN);
  });

  it('lists only officer-prefixed identities', async () => {
    const db = makeFakeDb();
    const key = b64encode(randomBytes(32));
    await ensureEncryptionIdentity(db, key); // org
    await ensureOfficerEncryptionIdentity(db, key, 1);
    await ensureOfficerEncryptionIdentity(db, key, 2);
    const officers = await listOfficerIdentities(db);
    expect(officers.length).toBe(2);
    expect(officers.every((o) => o.id.startsWith('officer-'))).toBe(true);
  });

  it('helpers classify officer identity ids', () => {
    expect(isOfficerIdentityId('officer-12')).toBe(true);
    expect(isOfficerIdentityId('org-encryption')).toBe(false);
    expect(userIdFromOfficerIdentityId('officer-12')).toBe(12);
    expect(userIdFromOfficerIdentityId('officer-abc')).toBe(null);
    expect(userIdFromOfficerIdentityId('org-encryption')).toBe(null);
  });
});

// imported up here to avoid a hoisting complaint in the it() above
const m_pubLen = 1958;

describe('cross-side interop: browser-sealed frame opens server-side', () => {
  it('a frame sealed with the public key opens with the secret key (same library)', async () => {
    const db = makeFakeDb();
    const key = b64encode(randomBytes(32));
    const id = await ensureEncryptionIdentity(db, key);
    const msg = new TextEncoder().encode('evidence sealed on officer device, opened by org');
    // seal like the browser would (only needs PUBLIC key):
    const { frame } = await seal(msg, id.publicKey, new TextEncoder().encode('evidence:99'));
    // open like the server would (needs SECRET key, unwrapped via KEK):
    const sec = await getEncryptionSecretKey(db, key);
    const recovered = await open(frame, sec, new TextEncoder().encode('evidence:99'));
    expect(recovered).toEqual(msg);
  });
});