// ============================================================
// pdfSigner — Ed25519 signing for record/dispatch PDF payloads
// ============================================================
// Sister module to evidenceSigner.ts. Reuses the SAME server
// keypair (EVIDENCE_SIGNING_PRIVATE_KEY / EVIDENCE_SIGNING_PUBLIC_KEY
// in server/.env) but signs a different canonical payload shape:
//
//   { algorithm, case_number, form_key, payload_sha256, signed_at }
//
// The shape difference is deliberate — a signature minted for a
// PDF payload cannot be replayed against an evidence_hashes row
// because the canonical-JSON forms differ at the byte level, so
// crypto.verify rejects it. That cross-domain isolation is the
// reason we build a tiny wrapper here instead of stuffing PDF
// hashes into the evidence_hashes table.
//
// Why bind the form_key + case_number into the signed message:
// without that, a signature from one PDF (e.g. INC-001) could be
// presented alongside another PDF whose payload happens to have
// the same hash. Including the operational identifiers makes the
// signature forensically meaningful even if the rendered PDF
// itself were swapped.

import crypto from 'crypto';
import { loadKeypairFromEnv, type Ed25519Keypair } from './evidenceSigner';

export interface PdfSignaturePayload {
  /** Form key — e.g. 'incident', 'case', 'jail_booking', 'court_event'. */
  formKey: string;
  /** Operational identifier — case#, FI#, citation#, etc. */
  caseNumber: string;
  /** SHA-256 hex of the canonical-JSON record payload. */
  payloadHash: string;
  /** ISO 8601 timestamp when the signature was minted. */
  signedAt: string;
}

export interface PdfSignatureResult {
  /** Base64-encoded Ed25519 signature (88 chars). */
  signature: string;
  /** Base64-encoded SPKI DER public key for offline verification. */
  publicKey: string;
  /** Algorithm identifier — fixed 'Ed25519'. */
  algorithm: 'Ed25519';
  /** Echo of the signedAt timestamp the signature was minted over. */
  signedAt: string;
}

/**
 * Canonicalize a PDF payload to a stable string. Keys sorted
 * alphabetically, no whitespace. Two parties signing/verifying
 * the same logical payload MUST get byte-identical output.
 */
export function canonicalizePdfPayload(p: PdfSignaturePayload): string {
  const ordered = {
    algorithm: 'Ed25519' as const,
    case_number: p.caseNumber,
    form_key: p.formKey,
    payload_sha256: p.payloadHash,
    signed_at: p.signedAt,
  };
  return JSON.stringify(ordered);
}

/**
 * Sign a payload — returns base64 signature.
 * Throws if the private key is malformed; returns null if no
 * keypair is configured (caller decides what to do).
 */
export function signPdfPayload(
  privateKeyB64: string,
  payload: PdfSignaturePayload,
): string {
  const keyDer = Buffer.from(privateKeyB64, 'base64');
  const privateKey = crypto.createPrivateKey({ key: keyDer, format: 'der', type: 'pkcs8' });
  const message = Buffer.from(canonicalizePdfPayload(payload), 'utf8');
  return crypto.sign(null, message, privateKey).toString('base64');
}

/**
 * Verify a signature. Returns true on match, false on any
 * mismatch. Never throws.
 */
export function verifyPdfSignature(
  publicKeyB64: string,
  payload: PdfSignaturePayload,
  signatureB64: string,
): boolean {
  try {
    const keyDer = Buffer.from(publicKeyB64, 'base64');
    const publicKey = crypto.createPublicKey({ key: keyDer, format: 'der', type: 'spki' });
    const message = Buffer.from(canonicalizePdfPayload(payload), 'utf8');
    const sig = Buffer.from(signatureB64, 'base64');
    if (sig.length !== 64) return false;
    return crypto.verify(null, message, publicKey, sig);
  } catch {
    return false;
  }
}

/**
 * One-shot sign helper: load the keypair from env, sign the
 * payload, return the full result envelope. Returns null if no
 * keypair is configured — in that case the caller should respond
 * with a 503 so the client can render the PDF without a
 * signature trailer (graceful degradation).
 */
export function signPdfWithEnv(
  payload: PdfSignaturePayload,
): PdfSignatureResult | null {
  const kp: Ed25519Keypair | null = loadKeypairFromEnv();
  if (!kp) return null;
  const signature = signPdfPayload(kp.privateKey, payload);
  return {
    signature,
    publicKey: kp.publicKey,
    algorithm: 'Ed25519',
    signedAt: payload.signedAt,
  };
}
