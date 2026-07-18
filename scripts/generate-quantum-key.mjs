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
// "Quantum" here means quantum-SOURCED randomness (QRNG) as an entropy
// input, not quantum-resistant/post-quantum cryptography.
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

import { randomBytes, webcrypto } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const { subtle } = webcrypto;

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
  const ikm = await subtle.importKey('raw', localBytes, 'HKDF', false, ['deriveBits']);
  const salt = qrngBytes ?? new Uint8Array();
  const bits = await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode(HKDF_INFO) },
    ikm,
    byteLength * 8,
  );
  return new Uint8Array(bits);
}

/** Draw local CSPRNG bytes, attempt the QRNG mix, and return the final
 *  key plus whether the QRNG source was actually used. */
export async function generateQuantumKey(byteLength) {
  const localBytes = new Uint8Array(randomBytes(byteLength));
  const qrngBytes = await fetchQrngBytes(byteLength);
  const combined = await combineEntropy(localBytes, qrngBytes, byteLength);
  return { combined, qrngUsed: qrngBytes !== null };
}

/** All CLI logic, I/O-free: takes argv (without the `node script.mjs`
 *  prefix), returns what to print and what exit code to use. The real
 *  `main()` below is the only thing that touches process.stdout/stderr/exit. */
export async function runCli(argv) {
  const byteLengthArg = argv[0];
  const byteLength = Number(byteLengthArg);
  if (!byteLengthArg || !Number.isInteger(byteLength) || byteLength <= 0) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: 'Usage: node scripts/generate-quantum-key.mjs <byteLength>\n'
        + 'Example: node scripts/generate-quantum-key.mjs 32\n',
    };
  }

  const { combined, qrngUsed } = await generateQuantumKey(byteLength);
  const base64 = Buffer.from(combined).toString('base64');

  const stderrLines = [];
  if (!qrngUsed) {
    stderrLines.push('QRNG unreachable — using local CSPRNG only; re-run to retry the mix.');
  }
  stderrLines.push(
    `[${new Date().toISOString()}] Generated ${byteLength}-byte key. `
    + `QRNG mix: ${qrngUsed ? 'yes' : 'no (local-only fallback)'}.`,
  );

  return { exitCode: 0, stdout: `${base64}\n`, stderr: `${stderrLines.join('\n')}\n` };
}

async function main() {
  const { exitCode, stdout, stderr } = await runCli(process.argv.slice(2));
  if (stderr) process.stderr.write(stderr);
  if (stdout) process.stdout.write(stdout);
  process.exit(exitCode);
}

// Compares via pathToFileURL() (not a plain `file://${process.argv[1]}`
// template) because that naive form breaks on paths containing spaces or
// other characters that get percent-encoded in a real file:// URL — e.g.
// this repo's own worktree path (`.../RMPG Flex/...`) — silently making
// the guard always false and main() never run.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
