// ============================================================
// evidence_hashes — chain-of-custody writer tests
// ============================================================
// Records a SHA-256 hash for every media artifact (dashcam clip,
// audio, photo) and links each new entry to the most recent
// prior entry of the same artifact_type via prev_hash_id, forming
// a tamper-evident chain per type.
//
// Verifies:
//   1. sha256OfBuffer: deterministic hex digest
//   2. recordEvidence: writes a row with hash + size
//   3. prev_hash_id links to most recent prior entry of same type
//   4. Different artifact_types form independent chains
//   5. verifyEvidenceChain detects a broken chain
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  sha256OfBuffer,
  recordEvidence,
  verifyEvidenceChain,
} from '../evidenceHasher';
import {
  generateEd25519Keypair,
  verifyEvidenceSignature,
} from '../evidenceSigner';

type Db = ReturnType<typeof Database>;

function makeDb(): Db {
  const db = new Database(':memory:');
  db.prepare(`
    CREATE TABLE evidence_hashes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artifact_type TEXT NOT NULL,
      artifact_id INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      size_bytes INTEGER,
      storage_uri TEXT,
      captured_at TEXT NOT NULL,
      hashed_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      signer TEXT,
      signature TEXT,
      prev_hash_id INTEGER,
      notes TEXT
    )
  `).run();
  return db;
}

describe('sha256OfBuffer', () => {
  it('produces a stable 64-char hex digest', () => {
    const a = sha256OfBuffer(Buffer.from('hello world'));
    const b = sha256OfBuffer(Buffer.from('hello world'));
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different digests for different inputs', () => {
    const a = sha256OfBuffer(Buffer.from('hello'));
    const b = sha256OfBuffer(Buffer.from('world'));
    expect(a).not.toBe(b);
  });

  it('matches the canonical SHA-256 of "abc"', () => {
    // FIPS 180-2 test vector
    const known = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    expect(sha256OfBuffer(Buffer.from('abc'))).toBe(known);
  });
});

describe('recordEvidence — single insert', () => {
  let db: Db;
  beforeEach(() => { db = makeDb(); });

  it('writes a row with the provided hash and metadata', () => {
    const result = recordEvidence({
      artifact_type: 'driving_event_clip',
      artifact_id: 42,
      sha256: 'a'.repeat(64),
      size_bytes: 1024,
      storage_uri: 's3://flex-evidence/clip-1.mp4',
      captured_at: '2026-04-28 12:00:00',
    }, db as any);

    expect(result.id).toBeGreaterThan(0);
    expect(result.prev_hash_id).toBeNull();

    const row = db.prepare('SELECT * FROM evidence_hashes WHERE id = ?').get(result.id) as any;
    expect(row.artifact_type).toBe('driving_event_clip');
    expect(row.artifact_id).toBe(42);
    expect(row.sha256).toBe('a'.repeat(64));
    expect(row.size_bytes).toBe(1024);
    expect(row.storage_uri).toBe('s3://flex-evidence/clip-1.mp4');
    expect(row.captured_at).toBe('2026-04-28 12:00:00');
    expect(row.prev_hash_id).toBeNull();
  });
});

describe('recordEvidence — chain linkage', () => {
  let db: Db;
  beforeEach(() => { db = makeDb(); });

  it('links second entry to first via prev_hash_id (same artifact_type)', () => {
    const first = recordEvidence({
      artifact_type: 'driving_event_clip',
      artifact_id: 1,
      sha256: 'a'.repeat(64),
      size_bytes: 100,
      captured_at: '2026-04-28 12:00:00',
    }, db as any);
    const second = recordEvidence({
      artifact_type: 'driving_event_clip',
      artifact_id: 2,
      sha256: 'b'.repeat(64),
      size_bytes: 200,
      captured_at: '2026-04-28 12:00:01',
    }, db as any);

    expect(first.prev_hash_id).toBeNull();
    expect(second.prev_hash_id).toBe(first.id);
  });

  it('keeps independent chains per artifact_type', () => {
    const clip1 = recordEvidence({
      artifact_type: 'driving_event_clip',
      artifact_id: 1, sha256: 'a'.repeat(64),
      captured_at: '2026-04-28 12:00:00',
    }, db as any);
    const audio1 = recordEvidence({
      artifact_type: 'audio',
      artifact_id: 1, sha256: 'b'.repeat(64),
      captured_at: '2026-04-28 12:00:01',
    }, db as any);
    const clip2 = recordEvidence({
      artifact_type: 'driving_event_clip',
      artifact_id: 2, sha256: 'c'.repeat(64),
      captured_at: '2026-04-28 12:00:02',
    }, db as any);
    const audio2 = recordEvidence({
      artifact_type: 'audio',
      artifact_id: 2, sha256: 'd'.repeat(64),
      captured_at: '2026-04-28 12:00:03',
    }, db as any);

    // Each type's second entry links to its own first, NOT
    // across types.
    expect(clip1.prev_hash_id).toBeNull();
    expect(audio1.prev_hash_id).toBeNull();
    expect(clip2.prev_hash_id).toBe(clip1.id);
    expect(audio2.prev_hash_id).toBe(audio1.id);
  });
});

describe('verifyEvidenceChain', () => {
  let db: Db;
  beforeEach(() => { db = makeDb(); });

  it('reports a clean chain for sequential inserts', () => {
    recordEvidence({ artifact_type: 'driving_event_clip', artifact_id: 1, sha256: 'a'.repeat(64), captured_at: 't' }, db as any);
    recordEvidence({ artifact_type: 'driving_event_clip', artifact_id: 2, sha256: 'b'.repeat(64), captured_at: 't' }, db as any);
    recordEvidence({ artifact_type: 'driving_event_clip', artifact_id: 3, sha256: 'c'.repeat(64), captured_at: 't' }, db as any);

    const audit = verifyEvidenceChain('driving_event_clip', db as any);
    expect(audit.ok).toBe(true);
    expect(audit.checked).toBe(3);
    expect(audit.broken_at_id).toBeNull();
  });

  it('detects a deleted middle row (broken chain)', () => {
    const r1 = recordEvidence({ artifact_type: 'driving_event_clip', artifact_id: 1, sha256: 'a'.repeat(64), captured_at: 't' }, db as any);
    const r2 = recordEvidence({ artifact_type: 'driving_event_clip', artifact_id: 2, sha256: 'b'.repeat(64), captured_at: 't' }, db as any);
    recordEvidence({ artifact_type: 'driving_event_clip', artifact_id: 3, sha256: 'c'.repeat(64), captured_at: 't' }, db as any);

    // Tamper: remove the middle row so r3.prev_hash_id dangles
    db.prepare('DELETE FROM evidence_hashes WHERE id = ?').run(r2.id);

    const audit = verifyEvidenceChain('driving_event_clip', db as any);
    expect(audit.ok).toBe(false);
    expect(audit.broken_at_id).toBeGreaterThan(r1.id);
  });

  it('treats an empty chain as ok', () => {
    const audit = verifyEvidenceChain('driving_event_clip', db as any);
    expect(audit.ok).toBe(true);
    expect(audit.checked).toBe(0);
  });
});

describe('recordEvidence — Ed25519 signing (Phase 4)', () => {
  let db: Db;
  beforeEach(() => { db = makeDb(); });

  it('writes signer + signature when keypair provided', () => {
    const kp = generateEd25519Keypair();
    const result = recordEvidence({
      artifact_type: 'driving_event_clip',
      artifact_id: 1,
      sha256: 'a'.repeat(64),
      captured_at: '2026-04-28 12:00:00',
    }, db as any, { keypair: kp });

    const row = db.prepare('SELECT * FROM evidence_hashes WHERE id = ?').get(result.id) as any;
    expect(row.signer).toBe(kp.publicKey);
    expect(row.signature).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(row.signature.length).toBeGreaterThan(80); // Ed25519 sig in base64 ≈ 88 chars
  });

  it('produced signature verifies against the same public key', () => {
    const kp = generateEd25519Keypair();
    const result = recordEvidence({
      artifact_type: 'driving_event_clip',
      artifact_id: 42,
      sha256: 'd'.repeat(64),
      captured_at: '2026-04-28 12:00:00',
    }, db as any, { keypair: kp });

    const row = db.prepare('SELECT * FROM evidence_hashes WHERE id = ?').get(result.id) as any;
    const ok = verifyEvidenceSignature(kp.publicKey, {
      artifact_type: row.artifact_type,
      artifact_id: row.artifact_id,
      sha256: row.sha256,
      captured_at: row.captured_at,
      prev_hash_id: row.prev_hash_id,
    }, row.signature);
    expect(ok).toBe(true);
  });

  it('skips signing when no keypair provided (back-compat)', () => {
    const result = recordEvidence({
      artifact_type: 'driving_event_clip',
      artifact_id: 1,
      sha256: 'a'.repeat(64),
      captured_at: '2026-04-28 12:00:00',
    }, db as any);

    const row = db.prepare('SELECT * FROM evidence_hashes WHERE id = ?').get(result.id) as any;
    expect(row.signer).toBeNull();
    expect(row.signature).toBeNull();
  });
});

describe('verifyEvidenceChain — signature verification (Phase 4)', () => {
  let db: Db;
  beforeEach(() => { db = makeDb(); });

  it('opt-in signature checks pass for properly-signed entries', () => {
    const kp = generateEd25519Keypair();
    recordEvidence({ artifact_type: 'driving_event_clip', artifact_id: 1, sha256: 'a'.repeat(64), captured_at: 't' }, db as any, { keypair: kp });
    recordEvidence({ artifact_type: 'driving_event_clip', artifact_id: 2, sha256: 'b'.repeat(64), captured_at: 't' }, db as any, { keypair: kp });

    const audit = verifyEvidenceChain('driving_event_clip', db as any, { verifySignatures: true, publicKey: kp.publicKey });
    expect(audit.ok).toBe(true);
    expect(audit.signatures_verified).toBe(2);
  });

  it('detects tampered sha256 even when chain links survive', () => {
    const kp = generateEd25519Keypair();
    const r1 = recordEvidence({ artifact_type: 'driving_event_clip', artifact_id: 1, sha256: 'a'.repeat(64), captured_at: 't' }, db as any, { keypair: kp });
    recordEvidence({ artifact_type: 'driving_event_clip', artifact_id: 2, sha256: 'b'.repeat(64), captured_at: 't' }, db as any, { keypair: kp });

    // Tamper: change the sha256 on row 1, but leave the chain intact
    db.prepare('UPDATE evidence_hashes SET sha256 = ? WHERE id = ?').run('z'.repeat(64), r1.id);

    const audit = verifyEvidenceChain('driving_event_clip', db as any, { verifySignatures: true, publicKey: kp.publicKey });
    expect(audit.ok).toBe(false);
    expect(audit.broken_at_id).toBe(r1.id);
    expect(audit.signature_failure).toBe(true);
  });

  it('reports unsigned entries when verifySignatures=true', () => {
    // First entry unsigned (legacy) — chain link is fine but signature missing
    recordEvidence({ artifact_type: 'driving_event_clip', artifact_id: 1, sha256: 'a'.repeat(64), captured_at: 't' }, db as any);
    const kp = generateEd25519Keypair();
    recordEvidence({ artifact_type: 'driving_event_clip', artifact_id: 2, sha256: 'b'.repeat(64), captured_at: 't' }, db as any, { keypair: kp });

    const audit = verifyEvidenceChain('driving_event_clip', db as any, { verifySignatures: true, publicKey: kp.publicKey });
    expect(audit.ok).toBe(false);
    expect(audit.unsigned_count).toBe(1);
  });
});
