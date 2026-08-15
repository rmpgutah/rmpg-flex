'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFaceAuth, euclideanDistance } = require('../faceAuth');

// ── euclideanDistance ─────────────────────────────────────────
test('euclideanDistance: identical vectors → 0', () => {
  const v = new Float32Array([1, 2, 3, 4]);
  assert.equal(euclideanDistance(v, v), 0);
});

test('euclideanDistance: known distance', () => {
  const a = new Float32Array([0, 0]);
  const b = new Float32Array([3, 4]);
  assert.ok(Math.abs(euclideanDistance(a, b) - 5) < 0.001);
});

test('euclideanDistance: mismatched lengths → throws', () => {
  assert.throws(
    () => euclideanDistance(new Float32Array([1, 2]), new Float32Array([1, 2, 3])),
    /length/i
  );
});

// ── storeEmbedding / getEmbedding ────────────────────────────
function makeStubs() {
  const store = new Map();
  const db = {
    prepare: (sql) => ({
      run: (...args) => { store.set(args[0], args[1]); },
      get: (id) => store.has(id) ? { face_embedding: store.get(id) } : null,
      run_delete: (id) => store.delete(id),
    }),
  };
  // Simulate prepare returning different statement shapes:
  db.prepare = (sql) => {
    if (sql.includes('INSERT') || sql.includes('UPDATE') || sql.includes('REPLACE')) {
      return { run: (id, enc) => enc !== undefined ? store.set(id, enc) : store.delete(id) };
    }
    if (sql.includes('SELECT')) {
      return { get: (id) => store.has(id) ? { face_embedding: store.get(id) } : null };
    }
    if (sql.includes('DELETE')) {
      return { run: (id) => store.delete(id) };
    }
    return { run: () => {}, get: () => null };
  };
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from('ENC:' + s),
    decryptString: (b) => b.toString().replace(/^ENC:/, ''),
  };
  return { db, safeStorage };
}

test('storeEmbedding + getEmbedding round-trip', () => {
  const { db, safeStorage } = makeStubs();
  const fa = createFaceAuth({ db, safeStorage });
  const embedding = new Float32Array(128).fill(0.5);
  fa.storeEmbedding(42, embedding);
  const retrieved = fa.getEmbedding(42);
  assert.ok(retrieved instanceof Float32Array);
  assert.equal(retrieved.length, 128);
  assert.ok(Math.abs(retrieved[0] - 0.5) < 0.001);
});

test('getEmbedding returns null when userId not enrolled', () => {
  const { db, safeStorage } = makeStubs();
  const fa = createFaceAuth({ db, safeStorage });
  assert.equal(fa.getEmbedding(999), null);
});

test('deleteEmbedding removes stored embedding', () => {
  const { db, safeStorage } = makeStubs();
  const fa = createFaceAuth({ db, safeStorage });
  fa.storeEmbedding(7, new Float32Array(128).fill(0.1));
  fa.deleteEmbedding(7);
  assert.equal(fa.getEmbedding(7), null);
});

test('verify: returns match=true when distance below threshold', () => {
  const { db, safeStorage } = makeStubs();
  const fa = createFaceAuth({ db, safeStorage });
  const stored = new Float32Array(128).fill(0.5);
  fa.storeEmbedding(1, stored);
  const live = new Float32Array(128).fill(0.501); // tiny delta
  const result = fa.verify(1, live);
  assert.equal(result.match, true);
  assert.equal(typeof result.confidence, 'number');
});

test('verify: returns match=false when distance above threshold', () => {
  const { db, safeStorage } = makeStubs();
  const fa = createFaceAuth({ db, safeStorage });
  const stored = new Float32Array(128).fill(0.0);
  fa.storeEmbedding(1, stored);
  const live = new Float32Array(128).fill(1.0); // very different
  const result = fa.verify(1, live);
  assert.equal(result.match, false);
});

test('verify: returns match=false with reason=not_enrolled when no embedding stored', () => {
  const { db, safeStorage } = makeStubs();
  const fa = createFaceAuth({ db, safeStorage });
  const result = fa.verify(99, new Float32Array(128));
  assert.equal(result.match, false);
  assert.equal(result.reason, 'not_enrolled');
});
