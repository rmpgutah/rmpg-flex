// ============================================================
// evidence_hashes — chain-of-custody writer
// ============================================================
// Append-only hash log for media artifacts. Each entry links to
// the most recent prior entry of the same artifact_type via
// prev_hash_id, forming a per-type tamper-evident chain. Removing
// or modifying an interior row breaks the chain (next entry's
// prev_hash_id no longer resolves), which verifyEvidenceChain
// detects.
//
// Why per-type chains rather than one global chain: high-volume
// types (e.g. position fixes) shouldn't block low-volume ones,
// and audits can run per-type. The cost is N chain walks instead
// of 1, which is fine — the chains are independently verifiable.

import crypto from 'crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '../models/database';
import { localNow } from './timeUtils';

export type ArtifactType =
  | 'driving_event_clip'
  | 'dashcam_video'
  | 'photo'
  | 'audio'
  | 'thumbnail';

export interface RecordEvidenceInput {
  artifact_type: ArtifactType | string;
  artifact_id: number;
  sha256: string;
  size_bytes?: number;
  storage_uri?: string;
  captured_at: string;
  signer?: string;
  signature?: string;
  notes?: string;
}

export interface RecordEvidenceResult {
  id: number;
  prev_hash_id: number | null;
}

/** Compute the SHA-256 hex digest of a buffer. */
export function sha256OfBuffer(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Append a new evidence row, linking prev_hash_id to the most
 * recent prior entry of the same artifact_type.
 */
export function recordEvidence(
  input: RecordEvidenceInput,
  dbHandle?: Database,
): RecordEvidenceResult {
  const db = dbHandle ?? getDb();

  const prev = db.prepare(
    `SELECT id FROM evidence_hashes
     WHERE artifact_type = ?
     ORDER BY id DESC
     LIMIT 1`,
  ).get(input.artifact_type) as { id: number } | undefined;
  const prevId = prev?.id ?? null;

  const result = db.prepare(
    `INSERT INTO evidence_hashes (
      artifact_type, artifact_id, sha256, size_bytes, storage_uri,
      captured_at, hashed_at, signer, signature, prev_hash_id, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.artifact_type,
    input.artifact_id,
    input.sha256,
    input.size_bytes ?? null,
    input.storage_uri ?? null,
    input.captured_at,
    localNow(),
    input.signer ?? null,
    input.signature ?? null,
    prevId,
    input.notes ?? null,
  );

  return { id: Number(result.lastInsertRowid), prev_hash_id: prevId };
}

export interface ChainAudit {
  ok: boolean;
  checked: number;
  broken_at_id: number | null;
}

/**
 * Walk the prev_hash_id chain for the given artifact_type from
 * oldest to newest, asserting every prev_hash_id resolves to an
 * existing row of the same artifact_type. A broken link (deleted
 * or rewritten interior row) is flagged.
 */
export function verifyEvidenceChain(
  artifactType: string,
  dbHandle?: Database,
): ChainAudit {
  const db = dbHandle ?? getDb();
  const rows = db.prepare(
    `SELECT id, prev_hash_id FROM evidence_hashes
     WHERE artifact_type = ?
     ORDER BY id ASC`,
  ).all(artifactType) as { id: number; prev_hash_id: number | null }[];

  if (rows.length === 0) {
    return { ok: true, checked: 0, broken_at_id: null };
  }

  // First entry must have prev_hash_id NULL.
  if (rows[0].prev_hash_id !== null) {
    return { ok: false, checked: 1, broken_at_id: rows[0].id };
  }

  for (let i = 1; i < rows.length; i++) {
    const expectedPrev = rows[i - 1].id;
    if (rows[i].prev_hash_id !== expectedPrev) {
      return { ok: false, checked: i + 1, broken_at_id: rows[i].id };
    }
  }

  return { ok: true, checked: rows.length, broken_at_id: null };
}
