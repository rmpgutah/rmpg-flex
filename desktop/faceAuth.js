// ============================================================
// RMPG Flex — Face Auth (embedding storage + verification)
//
// This module handles the STORAGE and COMPARISON of face embeddings
// only. Face detection and embedding extraction (using face-api.js)
// run in the renderer process (which has access to canvas + camera).
// The renderer sends a Float32Array(128) embedding via IPC; this
// module encrypts it and stores it in the local SQLite DB, then
// computes Euclidean distance for verification.
//
// All functions take their dependencies (db, safeStorage) as params
// so they can be unit-tested without Electron or SQLite.
// ============================================================

'use strict';

const MATCH_THRESHOLD = 0.45; // face-api.js default; lower = stricter

/**
 * Euclidean distance between two equal-length Float32Arrays.
 * Lower distance = more similar faces.
 * @throws {Error} if lengths differ
 */
function euclideanDistance(a, b) {
  if (a.length !== b.length) throw new Error(`euclideanDistance: length mismatch (${a.length} vs ${b.length})`);
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

/**
 * Factory that returns face auth operations bound to the given db + safeStorage.
 * @param {{ db: import('better-sqlite3').Database, safeStorage: Electron.SafeStorage }} deps
 */
function createFaceAuth({ db, safeStorage }) {
  // Ensure face_embedding column exists (idempotent — swallows duplicate column error)
  try {
    db.prepare('ALTER TABLE users ADD COLUMN face_embedding TEXT').run();
  } catch (err) {
    if (!/duplicate column/i.test(err.message)) throw err;
  }

  /**
   * Serialize Float32Array → JSON string → encrypt → store in users.face_embedding.
   */
  function storeEmbedding(userId, embedding) {
    if (!(embedding instanceof Float32Array)) throw new Error('embedding must be Float32Array');
    const json = JSON.stringify(Array.from(embedding));
    const encrypted = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(json).toString('base64')
      : Buffer.from(json).toString('base64'); // fallback: base64 only (no OS-level encryption)
    db.prepare('REPLACE INTO users (id, face_embedding) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET face_embedding=excluded.face_embedding')
      .run(userId, encrypted);
  }

  /**
   * Load, decrypt, and deserialize a stored embedding. Returns null if not enrolled.
   */
  function getEmbedding(userId) {
    const row = db.prepare('SELECT face_embedding FROM users WHERE id = ?').get(userId);
    if (!row || !row.face_embedding) return null;
    try {
      const json = safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(Buffer.from(row.face_embedding, 'base64'))
        : Buffer.from(row.face_embedding, 'base64').toString();
      return new Float32Array(JSON.parse(json));
    } catch {
      return null;
    }
  }

  /**
   * Delete a stored embedding.
   */
  function deleteEmbedding(userId) {
    db.prepare('UPDATE users SET face_embedding = NULL WHERE id = ?').run(userId);
  }

  /**
   * Compare a live embedding against the stored one for userId.
   * @returns {{ match: boolean, confidence: number, reason?: string }}
   */
  function verify(userId, liveEmbedding) {
    const stored = getEmbedding(userId);
    if (!stored) return { match: false, confidence: 0, reason: 'not_enrolled' };
    const dist = euclideanDistance(stored, liveEmbedding);
    const confidence = Math.max(0, 1 - dist / MATCH_THRESHOLD);
    return { match: dist < MATCH_THRESHOLD, confidence: Math.round(confidence * 100) / 100 };
  }

  return { storeEmbedding, getEmbedding, deleteEmbedding, verify, MATCH_THRESHOLD };
}

module.exports = { createFaceAuth, euclideanDistance, MATCH_THRESHOLD };
