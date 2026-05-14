// ============================================================
// evidenceSigner — Ed25519 signing for evidence_hashes entries
// ============================================================
// Each evidence_hashes row is signed at write time with a server
// Ed25519 private key over a stable, canonicalized payload. The
// public key is published in the prosecutor export so external
// reviewers can independently verify each entry without trusting
// the database — a single host compromise can write rows but
// can't forge signatures.
//
// Why Ed25519 over RSA: 64-byte signatures vs 256, ~10× faster
// on x86, ~50× faster on ARM, no padding-oracle pitfalls. Native
// in Node 16+ via crypto.sign('Ed25519', ...).
//
// Key management:
//   - generateEd25519Keypair() emits base64 strings (env-friendly)
//   - In production: set EVIDENCE_SIGNING_PRIVATE_KEY +
//     EVIDENCE_SIGNING_PUBLIC_KEY in server/.env, distinct from
//     JWT_SECRET so neither rotation breaks the other
//   - For dev: a runtime-generated keypair is used if env unset
//     (logged with a warning — not a production-acceptable mode
//     because new keys per restart break verification of old rows)

import crypto from 'crypto';

export interface EvidencePayload {
  artifact_type: string;
  artifact_id: number;
  sha256: string;
  captured_at: string;
  prev_hash_id: number | null;
}

export interface Ed25519Keypair {
  /** Base64-encoded SPKI DER public key */
  publicKey: string;
  /** Base64-encoded PKCS8 DER private key */
  privateKey: string;
}

/**
 * Generate a fresh Ed25519 keypair, base64-encoded for storage
 * in env vars. The DER format used (SPKI / PKCS8) is the format
 * Node's crypto.sign / crypto.verify expect when invoked with
 * crypto.createPublicKey / crypto.createPrivateKey.
 */
export function generateEd25519Keypair(): Ed25519Keypair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  };
}

/**
 * Canonicalize the payload to a stable string. RFC 8785 (JCS) is
 * the gold standard but overkill here — our payload is a flat
 * 5-field record with primitive values. We sort keys, then
 * JSON.stringify with no whitespace. Equivalent to JCS for our
 * shape, plus zero dependencies.
 */
export function canonicalizeEvidencePayload(p: EvidencePayload): string {
  const ordered = {
    artifact_id: p.artifact_id,
    artifact_type: p.artifact_type,
    captured_at: p.captured_at,
    prev_hash_id: p.prev_hash_id ?? null,
    sha256: p.sha256,
  };
  return JSON.stringify(ordered);
}

/**
 * Sign a canonical evidence payload. Returns base64 signature
 * (64 bytes raw → 88 chars base64).
 */
export function signEvidencePayload(privateKeyB64: string, payload: EvidencePayload): string {
  const keyDer = Buffer.from(privateKeyB64, 'base64');
  const privateKey = crypto.createPrivateKey({ key: keyDer, format: 'der', type: 'pkcs8' });
  const message = Buffer.from(canonicalizeEvidencePayload(payload), 'utf8');
  // Ed25519 needs a single-shot sign (no streaming) so we pass
  // null algorithm + the key directly.
  const sig = crypto.sign(null, message, privateKey);
  return sig.toString('base64');
}

/**
 * Verify a signature. Returns true on match, false on any
 * mismatch (tampered payload, wrong key, malformed signature).
 * Never throws — invalid inputs return false so callers can
 * use a single boolean check.
 */
export function verifyEvidenceSignature(
  publicKeyB64: string,
  payload: EvidencePayload,
  signatureB64: string,
): boolean {
  try {
    const keyDer = Buffer.from(publicKeyB64, 'base64');
    const publicKey = crypto.createPublicKey({ key: keyDer, format: 'der', type: 'spki' });
    const message = Buffer.from(canonicalizeEvidencePayload(payload), 'utf8');
    const sig = Buffer.from(signatureB64, 'base64');
    if (sig.length !== 64) return false; // Ed25519 sigs are exactly 64 bytes
    return crypto.verify(null, message, publicKey, sig);
  } catch {
    return false;
  }
}

/**
 * Load the configured signing keypair from environment variables.
 * Returns null if either var is unset or empty — caller decides
 * whether to fail-loud (production) or generate ephemeral
 * (dev mode with warning).
 */
export function loadKeypairFromEnv(env: NodeJS.ProcessEnv = process.env): Ed25519Keypair | null {
  const privateKey = env.EVIDENCE_SIGNING_PRIVATE_KEY;
  const publicKey = env.EVIDENCE_SIGNING_PUBLIC_KEY;
  if (!privateKey || !publicKey) return null;
  return { privateKey, publicKey };
}
