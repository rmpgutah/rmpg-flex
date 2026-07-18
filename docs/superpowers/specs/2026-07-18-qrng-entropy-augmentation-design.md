# QRNG Entropy Augmentation for Key Generation — Design

**Date:** 2026-07-18
**Status:** Approved for planning

## Purpose

Roadmap item 2 of [`2026-07-18-quantum-encryption-crypto-inventory-design.md`](2026-07-18-quantum-encryption-crypto-inventory-design.md):
a local operator CLI tool that mixes quantum-sourced randomness into the entropy used when
generating or rotating a long-lived RMPG secret (`PDF_SIGNING_KEY`, `CPG_ENC_KEY`,
`EMAIL_CRED_KEY`, or any future fixed-length key). Defense-in-depth against a compromised or
backdoored local RNG, plus auditable entropy provenance for compliance records — **not** a
defense against quantum computers (see the compliance-honesty boundary in the linked design doc;
that distinction still governs this document and must not be blurred here either).

## Non-goals

- **No two-person integrity ("no-lone-zone") ceremony mode** — the design doc mentions this as a
  future option for the highest-value keys. Deferred: it adds real UX complexity (coordinating
  two operators) for a tool used a handful of times a year. Add it later as its own small
  follow-up if a genuine need arises.
- **No named-secret presets.** The script has no knowledge of `PDF_SIGNING_KEY` vs `CPG_ENC_KEY`
  vs anything else — it only knows byte lengths. Keeps the tool reusable for any future secret
  without needing updates, and keeps secret-naming knowledge where it already lives (`wrangler
  secret put <NAME>`, run by the operator).
- **No Worker runtime code, no new dependency on any live request path.** This is purely a local,
  offline, operator-run tool — nothing here ships to `api.rmpgutah.us`.
- **No new API key or account.** ANU QRNG's free, unauthenticated tier is sufficient for a tool
  invoked a few times a year.

## Architecture

### `scripts/generate-quantum-key.mjs <byteLength>`

Standalone Node script, following this repo's existing `scripts/*.mjs` ops-tooling convention
(same style as `scripts/gen-migration.mjs`, `scripts/sync-d1.mjs`). No dependency on the Worker's
`package.json`, no import from `src/`.

**Flow:**

1. Validate `byteLength` (a positive integer command-line argument, e.g. `32` or `96` to match
   this repo's existing seed sizes). Print usage and exit 1 if missing/invalid.
2. Draw `byteLength` bytes via Node's `crypto.randomBytes(byteLength)` (local CSPRNG) —
   unconditionally, first, before any network call.
3. Attempt to fetch `byteLength` bytes from ANU QRNG:
   `https://qrng.anu.edu.au/API/jsonI.php?length=<byteLength>&type=uint8`, 5-second timeout via
   `AbortController`. Expected response shape: `{ success: true, data: [<byteLength uint8
   values>], length: <byteLength>, type: "uint8" }`.
4. **On any failure** (network error, timeout, non-200, `success: false`, malformed JSON, wrong
   `data.length`): fall back to local bytes alone. Print a clear stderr warning: `QRNG
   unreachable — using local CSPRNG only; re-run to retry the mix.` Still exit 0 — a
   local-CSPRNG-only key is fully valid, just without the extra entropy source.
5. **On success:** combine via HKDF (RFC 5869), same primitive already used in
   `src/utils/pdfSign.ts`'s seed derivation, so this document isn't introducing a new
   cryptographic building block to the codebase:
   - `HKDF-Extract(salt = qrngBytes, ikm = localBytes)` → pseudorandom key
   - `HKDF-Expand(prk, info = 'rmpg-quantum-key-v1', length = byteLength)` → final output
   - This ordering (QRNG bytes as salt, local CSPRNG bytes as the input keying material) follows
     NIST SP 800-90C's multi-source combination guidance: the output is at least as strong as the
     stronger single input, and matches the standard HKDF two-phase construction the codebase
     already uses in `pdfSign.ts`'s `deriveHkdfSeed()`.
6. Print **only** the base64-encoded final key to **stdout** — nothing else on stdout, so the
   script is directly pipeable: `node scripts/generate-quantum-key.mjs 32 | wrangler secret put
   PDF_SIGNING_KEY`.
7. Print a provenance line to **stderr** (never stdout, so it never pollutes the piped secret
   value): timestamp, byte length, and whether the QRNG mix succeeded or fell back to local-only.
   This is for the operator's own compliance record-keeping (e.g. pasted into a change-ticket) —
   nothing is persisted server-side by this script.

### Error handling summary

| Condition | Behavior |
|---|---|
| Missing/invalid `byteLength` arg | Print usage to stderr, exit 1 |
| Local `crypto.randomBytes` fails | Extremely unlikely (Node/OS-level failure) — let it throw, exit non-zero; no sensible fallback exists |
| QRNG fetch fails/times out/malformed | Fall back to local-only, warn on stderr, **exit 0** |
| QRNG succeeds | HKDF-combine, exit 0 |

The only case that produces a non-zero exit is a fundamentally broken local environment (no
working CSPRNG) — the QRNG path never blocks or degrades below local-CSPRNG-alone security.

## Testing

- Unit tests for the pure HKDF-combine logic (`combineEntropy(localBytes, qrngBytes, byteLength)`
  or similar extracted function) — deterministic given fixed inputs, testable without any network
  call.
- Unit tests for the QRNG response parser (`parseQrngResponse(json)` or similar) — valid shape,
  `success: false`, wrong-length `data`, malformed JSON — each mapped to the correct fallback
  decision, independent of any real network call (mocked `fetch`).
- One integration-style test exercising the full CLI with `fetch` mocked to fail, asserting stdout
  is still a valid base64 string of the right decoded length and stderr contains the fallback
  warning.
- This repo's existing Node/vitest suite (`tests/**/*.test.ts`) is Worker-scoped
  (`vitest.config.ts`'s `include` is `['tests/**/*.test.ts']`, `exclude` covers `client`/`legacy`)
  — a script in `scripts/` isn't currently covered. Add `scripts/generate-quantum-key.test.mjs` as
  a colocated sibling test file, and add `'scripts/**/*.test.mjs'` to `vitest.config.ts`'s
  `include` array (one-line change) so `npm test` picks it up automatically — no new npm script,
  no separate test runner.

## What this document does not cover

Two-person integrity mode, and any change to `src/utils/pdfSign.ts` or other Worker code — those
remain out of scope per Non-goals above and stay on the roadmap as separate future items.
