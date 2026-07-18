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

import { webcrypto } from 'node:crypto';

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

/** Fetch `byteLength` quantum-random bytes from ANU QRNG. Never throws —
 *  returns null on any failure (network, timeout, non-OK, malformed body)
 *  so the caller can fall back to local CSPRNG bytes alone. */
export async function fetchQrngBytes(byteLength) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QRNG_TIMEOUT_MS);
  try {
    const url = `${QRNG_URL}?length=${byteLength}&type=uint8`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const json = await res.json();
    return parseQrngResponse(json, byteLength);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** HKDF-combine local CSPRNG bytes with QRNG bytes (RFC 5869) — one
 *  `deriveBits` call performs the full Extract-then-Expand. `qrngBytes`
 *  becomes the extract-phase salt; when null (QRNG unreachable), an empty
 *  salt is used instead — still a fully valid HKDF derivation from
 *  `localBytes` alone, matching src/utils/pdfSign.ts's existing pattern. */
export async function combineEntropy(localBytes, qrngBytes, byteLength) {
  const { subtle } = webcrypto;
  const ikm = await subtle.importKey('raw', localBytes, 'HKDF', false, ['deriveBits']);
  const salt = qrngBytes ?? new Uint8Array();
  const bits = await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode(HKDF_INFO) },
    ikm,
    byteLength * 8,
  );
  return new Uint8Array(bits);
}
