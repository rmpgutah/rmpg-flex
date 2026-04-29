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
import {
  signEvidencePayload,
  verifyEvidenceSignature,
  type Ed25519Keypair,
} from './evidenceSigner';

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

export interface RecordEvidenceOptions {
  /** Ed25519 keypair to sign the entry with. Public key is stored in
   *  `signer` for self-contained verification; signature in
   *  `signature`. Optional — when omitted, both columns stay NULL
   *  (back-compat with PR #392's unsigned entries). */
  keypair?: Ed25519Keypair;
}

/**
 * Append a new evidence row, linking prev_hash_id to the most
 * recent prior entry of the same artifact_type. Optionally signs
 * a canonical payload with an Ed25519 keypair so a single-host
 * compromise can't silently rewrite history (Phase 4).
 */
export function recordEvidence(
  input: RecordEvidenceInput,
  dbHandle?: Database,
  options?: RecordEvidenceOptions,
): RecordEvidenceResult {
  const db = dbHandle ?? getDb();

  const prev = db.prepare(
    `SELECT id FROM evidence_hashes
     WHERE artifact_type = ?
     ORDER BY id DESC
     LIMIT 1`,
  ).get(input.artifact_type) as { id: number } | undefined;
  const prevId = prev?.id ?? null;

  // Sign canonical payload if keypair provided. The fields signed
  // are exactly the immutable evidence fields — anything mutable
  // (like notes added later for analyst review) is excluded so a
  // late-stage notes update doesn't invalidate the signature.
  let signer = input.signer ?? null;
  let signature = input.signature ?? null;
  if (options?.keypair) {
    signer = options.keypair.publicKey;
    signature = signEvidencePayload(options.keypair.privateKey, {
      artifact_type: input.artifact_type,
      artifact_id: input.artifact_id,
      sha256: input.sha256,
      captured_at: input.captured_at,
      prev_hash_id: prevId,
    });
  }

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
    signer,
    signature,
    prevId,
    input.notes ?? null,
  );

  return { id: Number(result.lastInsertRowid), prev_hash_id: prevId };
}

export interface ChainAudit {
  ok: boolean;
  checked: number;
  broken_at_id: number | null;
  /** When verifySignatures=true: how many signatures were checked + valid */
  signatures_verified?: number;
  /** When verifySignatures=true: number of rows with NULL signature
   *  (indicates legacy / unsigned entries — chain may still link
   *  but cryptographic non-repudiation is missing). */
  unsigned_count?: number;
  /** When ok=false and broken_at_id has a signature mismatch (vs
   *  a chain-link mismatch), this flag distinguishes the failure
   *  mode. Useful for the audit-dashboard so it can show "data
   *  tampered" vs "row deleted". */
  signature_failure?: boolean;
}

export interface VerifyChainOptions {
  /** When true, also verify each row's Ed25519 signature against
   *  the provided publicKey. Failures count as broken-chain. */
  verifySignatures?: boolean;
  /** Public key to verify signatures with. Required when
   *  verifySignatures=true. In production this should match the
   *  EVIDENCE_SIGNING_PUBLIC_KEY env var; in court-defense
   *  scenarios it's the key embedded in the prosecutor export. */
  publicKey?: string;
}

/**
 * Walk the prev_hash_id chain for the given artifact_type from
 * oldest to newest, asserting every prev_hash_id resolves to an
 * existing row of the same artifact_type. A broken link (deleted
 * or rewritten interior row) is flagged. Optionally also verifies
 * Ed25519 signatures over each entry's canonical payload.
 */
export function verifyEvidenceChain(
  artifactType: string,
  dbHandle?: Database,
  options?: VerifyChainOptions,
): ChainAudit {
  const db = dbHandle ?? getDb();
  const rows = db.prepare(
    `SELECT id, artifact_type, artifact_id, sha256, captured_at,
            prev_hash_id, signer, signature
     FROM evidence_hashes
     WHERE artifact_type = ?
     ORDER BY id ASC`,
  ).all(artifactType) as Array<{
    id: number;
    artifact_type: string;
    artifact_id: number;
    sha256: string;
    captured_at: string;
    prev_hash_id: number | null;
    signer: string | null;
    signature: string | null;
  }>;

  if (rows.length === 0) {
    return { ok: true, checked: 0, broken_at_id: null };
  }

  const wantSig = !!options?.verifySignatures;
  const pubKey = options?.publicKey;
  let signaturesVerified = 0;
  let unsignedCount = 0;

  // First entry must have prev_hash_id NULL.
  if (rows[0].prev_hash_id !== null) {
    return { ok: false, checked: 1, broken_at_id: rows[0].id };
  }

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];

    // Chain-link check (skip first row — already validated above)
    if (i > 0) {
      const expectedPrev = rows[i - 1].id;
      if (r.prev_hash_id !== expectedPrev) {
        return {
          ok: false,
          checked: i + 1,
          broken_at_id: r.id,
          signatures_verified: signaturesVerified,
          unsigned_count: unsignedCount,
        };
      }
    }

    // Signature check (opt-in)
    if (wantSig) {
      if (!r.signature) {
        unsignedCount++;
      } else if (pubKey) {
        const ok = verifyEvidenceSignature(pubKey, {
          artifact_type: r.artifact_type,
          artifact_id: r.artifact_id,
          sha256: r.sha256,
          captured_at: r.captured_at,
          prev_hash_id: r.prev_hash_id,
        }, r.signature);
        if (!ok) {
          return {
            ok: false,
            checked: i + 1,
            broken_at_id: r.id,
            signature_failure: true,
            signatures_verified: signaturesVerified,
            unsigned_count: unsignedCount,
          };
        }
        signaturesVerified++;
      }
    }
  }

  return {
    ok: !wantSig || unsignedCount === 0,
    checked: rows.length,
    broken_at_id: null,
    signatures_verified: signaturesVerified,
    unsigned_count: unsignedCount,
  };
}
