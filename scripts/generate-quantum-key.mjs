#!/usr/bin/env node
// ============================================================
// scripts/generate-quantum-key.mjs
// ============================================================
// Local, operator-run CLI: mixes local CSPRNG bytes with quantum-sourced
// randomness (ANU QRNG) via HKDF, for provisioning/rotating a long-lived
// RMPG secret (PDF_SIGNING_KEY, CPG_ENC_KEY, EMAIL_CRED_KEY, etc).
//
// This is defense-in-depth against a compromised/backdoored local RNG and
// gives auditable entropy provenance — it is NOT a defense against quantum
// computers (that's src/utils/pdfSign.ts's ML-DSA-87/SLH-DSA-256f signing).
// See docs/superpowers/specs/2026-07-18-qrng-entropy-augmentation-design.md.
//
// Usage:
//   node scripts/generate-quantum-key.mjs 32 | wrangler secret put PDF_SIGNING_KEY
//
// stdout carries ONLY the base64 key — safe to pipe directly into
// `wrangler secret put`. All human-readable output goes to stderr.
//
// Fails open: if the QRNG fetch is unreachable/times out/malformed, falls
// back to local CSPRNG bytes alone (still a fully valid, secure key) and
// warns on stderr — never blocks, never produces a weaker result.
// ============================================================

const QRNG_URL = 'https://qrng.anu.edu.au/API/jsonI.php';
const QRNG_TIMEOUT_MS = 5000;
const HKDF_INFO = 'rmpg-quantum-key-v1';

/** Validate + extract an ANU QRNG `uint8` response. Returns null on any
 *  malformed/unexpected shape rather than throwing, so callers can treat
 *  "couldn't parse" the same as "network failed" (fall back to local-only). */
export function parseQrngResponse(json, expectedLength) {
  if (!json || json.success !== true) return null;
  if (!Array.isArray(json.data) || json.data.length !== expectedLength) return null;
  if (!json.data.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) return null;
  return new Uint8Array(json.data);
}
