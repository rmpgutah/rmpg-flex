# Quantum-Resistant Cryptography — Inventory & Roadmap

**Date:** 2026-07-18
**Status:** Approved for planning (Phase 1: this document only — no code changes)

## Purpose

Audit every cryptographic primitive across the RMPG family of software (Worker API, React
client, iOS app, Electron desktop, edge Python runner) for exposure to a future
cryptographically-relevant quantum computer (CRQC), and lay out a concrete, honestly-scoped
roadmap toward government-grade post-quantum hardening. This document is Phase 1: an audit and
plan, not an implementation. Each roadmap item becomes its own brainstorm → spec → plan cycle
before code changes land.

## Terminology, up front

"Quantum encryption" in the literal sense — **Quantum Key Distribution (QKD)** — is a
physical-layer technology requiring dedicated fiber-optic channels and single-photon detectors.
It cannot be implemented as software running on Cloudflare Workers, React, iOS, Electron, or
Python. It is permanently out of scope for this system.

What this document actually covers is **post-quantum cryptography (PQC)**: algorithms that run
on ordinary CPUs but are designed to resist attacks from a CRQC, standardized by NIST in 2024 —
FIPS 203 (ML-KEM, née Kyber — key encapsulation), FIPS 204 (ML-DSA, née Dilithium — signatures),
and FIPS 205 (SLH-DSA, née SPHINCS+ — hash-based signatures) — plus one adjacent, genuinely
"quantum" technology that *is* usable from software: consuming quantum-sourced random numbers
(QRNG) as an entropy input, discussed in Roadmap item 2.

**Compliance honesty boundary:** RMPG handles criminal justice information, so the applicable
government benchmark is CJIS Security Policy §5.10.1.2 (requires FIPS 140-2/140-3 *validated*
encryption for CJI) and NSA's CNSA 2.0 suite (mandated algorithm/parameter choices for
national-security-grade PQC transition). **"FIPS validated" is a certification of one frozen
software/hardware module by an accredited NIST CMVP lab — it is not something application code
becomes by using the right algorithms.** RMPG's Worker code can honestly claim it *uses
FIPS-approved algorithms* (AES-256, SHA-384/512, ML-KEM, ML-DSA, SLH-DSA). It cannot honestly
claim to *be* FIPS validated without a separate, formal certification process pursued against a
specific frozen module (Cloudflare's `workerd` crypto core would be the certifiable artifact, not
RMPG's application code). Every roadmap item below is written to keep that line intact — nothing
here should ever be summarized upward as "FIPS validated" or "CJIS certified."

## Non-goals

- No code changes in this phase. Each roadmap item is a candidate for a future, separately
  brainstormed project.
- Not a general crypto-hygiene review. TOTP's HMAC-SHA1 (RFC 6238) and other non-quantum-related
  observations are noted where found but are explicitly out of scope for action — changing them
  isn't a quantum-resistance question and risks breaking compatibility (e.g. existing
  authenticator apps) for no quantum-safety benefit.
- No claim of, or path toward, actual QKD. See Terminology above.
- No proposal to add a network dependency to any live request path (dispatch, auth, signing).
  QRNG augmentation (item 2) is scoped to rare, offline, operator-run key-generation events only —
  see that section for why.

## Part 1 — Crypto Inventory

Every cryptographic primitive found across the stack, classified by real quantum exposure (not by
whether it "sounds like crypto").

| Surface | File | Primitive | Type | Quantum risk |
|---|---|---|---|---|
| Session auth (JWT) | [`src/routes/auth.ts:339`](../../../src/routes/auth.ts) | HS256 (HMAC-SHA256) | Symmetric | None — Grover's algorithm only halves effective key strength; 256-bit HMAC keeps ~128-bit post-quantum security |
| ClearPath creds at rest | [`src/utils/cpgCrypto.ts`](../../../src/utils/cpgCrypto.ts) | AES-GCM-256 | Symmetric | None |
| M365 OAuth secrets at rest | [`src/utils/emailCrypto.ts`](../../../src/utils/emailCrypto.ts) | AES-GCM-256 | Symmetric | None |
| Wallet/badge tokens | [`src/utils/walletToken.ts`](../../../src/utils/walletToken.ts) | HMAC-SHA256 | Symmetric | None |
| TOTP MFA | [`src/utils/totp.ts`](../../../src/utils/totp.ts) | HMAC-SHA1 (RFC 6238) | Symmetric | None (Grover-only; the RFC mandates SHA1 for compatibility — not a quantum concern, out of scope per Non-goals) |
| Signed resource URLs | [`src/utils/signedAccess.ts`](../../../src/utils/signedAccess.ts) | HMAC | Symmetric | None |
| Dashcam edge webhooks | [`edge/flex_edge/signer.py`](../../../edge/flex_edge/signer.py) | HMAC-SHA256 | Symmetric | None |
| Desktop PIN sessions | [`desktop/pinManager.js`](../../../desktop/pinManager.js) | HMAC-SHA256 + `timingSafeEqual` | Symmetric | None |
| iOS evidence capture | [`ios2/.../EvidenceManifest.swift`](../../../ios2/RMPGFlexConnect/Packages/FeatureEvidence/Sources/FeatureEvidence/EvidenceManifest.swift) | SHA-256 hashing (CryptoKit) | Hash only | None |
| Password storage | `bcryptjs` (root `package.json`) | bcrypt | Password hash (not public-key) | None — not a public-key primitive; Grover applies in theory but bcrypt's deliberate slowness dominates |
| **PDF/evidence signing** | [`src/utils/pdfSign.ts`](../../../src/utils/pdfSign.ts), consumed by [`client/src/utils/pdfIntegrity.ts`](../../../client/src/utils/pdfIntegrity.ts) | **Ed25519** | **Asymmetric** | **Real.** The signature is offline-verifiable — the public key travels with the document, no server round-trip required to check it. A future CRQC could use Shor's algorithm to recover the private key from the public key and forge new, valid-looking signatures over altered chain-of-custody documents. This is the one concrete "harvest-now, forge-later" exposure in the entire stack. |
| Security keys (YubiKey/Touch ID/Windows Hello) | [`migrations/0090_webauthn_credentials.sql`](../../../migrations/0090_webauthn_credentials.sql) | COSE public key (ES256/RS256, authenticator's choice) | Asymmetric | Real in theory, **not actionable in software** — the signature algorithm is negotiated between the browser and the physical authenticator, not chosen by RMPG code. FIDO Alliance has not yet standardized a PQC WebAuthn ceremony; no hardware authenticators support one today. |
| Transport (TLS) | Cloudflare edge (`rmpgutah.us`, `api.rmpgutah.us`) | Hybrid X25519+ML-KEM key exchange | Already PQC | None — Cloudflare negotiates this automatically for HTTPS; zero app code involved or required. |

**Bottom line:** every symmetric primitive and hash function RMPG uses is already quantum-resistant
at its current key size. The entire actionable surface is one file: `src/utils/pdfSign.ts`.

## Part 2 — Roadmap

Each item is a candidate future project (own brainstorm → spec → plan cycle), sequenced by value.
Parameter choices below follow **NSA CNSA 2.0** (the mandated suite for national-security-grade
PQC transition), not NIST's lower baseline tier — this is what "government level" concretely means
for algorithm selection.

### 1. Triple-algorithm signing for `pdfSign.ts` / `pdfIntegrity.ts`

Sign every PDF/evidence artifact with **three independent algorithms simultaneously**, never
dropping any:

- **Ed25519** (current) — kept for backward compatibility with already-issued documents.
- **ML-DSA-87** (FIPS 204, CNSA 2.0 parameter set — the 87 variant, not the lower 65 tier) —
  lattice-based PQC signature.
- **SLH-DSA** (FIPS 205, SPHINCS+) — hash-based PQC signature, a *completely different*
  mathematical foundation from ML-DSA's lattice math.

This is beyond the industry-standard "one classical + one PQC" hybrid: stacking two independent
PQC families means a cryptanalytic break in lattice-based math alone (the more actively-attacked
of the two) doesn't compromise document authenticity — SLH-DSA and Ed25519 still hold. This
matters specifically because chain-of-custody documents may need to remain verifiable for decades.

- Library candidate: `@noble/post-quantum` (pure TypeScript, no WASM/`node:*` dependency —
  confirmed Workers-compatible; not currently a project dependency).
- `pdfIntegrity.ts` and the PDF footer/trailer page carry all three signatures plus an explicit
  algorithm-version tag (see item 3).
- `pdfTools.ts`'s `/sign-payload` route and `signTriple()` extend to a new `signTripleHybrid()`
  helper without breaking already-issued single-algorithm signatures.

### 2. Quantum-sourced entropy augmentation for key-generation events

A **local operator CLI script** — not Worker runtime code, no new dependency on any live request
path — used only when provisioning or rotating a long-lived secret (`PDF_SIGNING_KEY`,
`CPG_ENC_KEY`, `EMAIL_CRED_KEY`, a future `ML_DSA_SEED`/`SLH_DSA_SEED`):

- Draws local CSPRNG bytes (Node `crypto.randomBytes`) **and** fetches bytes from a public QRNG
  service (ANU QRNG — laser vacuum-fluctuation measurement is the standard citable
  genuinely-quantum entropy source), combined via an HKDF-SHA256 extractor per NIST SP 800-90C
  guidance for multi-source entropy combination.
- **Fails open, never closed**: if the QRNG fetch is unreachable or times out, the script uses
  local entropy alone and tells the operator to re-run if they want the QRNG mix — it never
  blocks key generation and never produces output weaker than local CSPRNG alone.
- **Two-person integrity ("no-lone-zone") mode**: for the highest-value keys, two operators each
  independently supply local entropy input (in person, separately) before the QRNG mix is
  applied, so no single person ever generates or holds the complete seed alone — the DoD/NSA
  practice for high-value key material.
- Prints a provenance note (timestamp, whether the QRNG mix succeeded, which operators
  participated) for the operator's own compliance records. Nothing sensitive is stored server-side
  by this script.
- **What this is not**: it is not a defense against quantum computers. CSPRNG output isn't
  vulnerable to Shor's/Grover's the way public-key math is — a quantum computer gains no advantage
  attacking well-formed random key material regardless of its entropy source. This is
  defense-in-depth against a compromised or backdoored local RNG (the historical Dual_EC_DRBG
  concern) and gives auditable entropy provenance. The design doc for this item must state this
  distinction as plainly as it's stated here — it must never be summarized as "quantum-encrypted
  keys" in any downstream document, slide, or compliance answer.

### 3. Crypto-agility versioning + audit trail

- Every signed artifact carries an explicit `algorithm_version` tag (e.g. `pdf-sig-v2` distinct
  from today's implicit `algorithm: 'Ed25519'`), so a future algorithm swap (e.g. if ML-DSA is
  ever deprecated in favor of something else) never breaks verification of already-issued
  documents — verifiers dispatch on the tag.
- A new `crypto_key_events` D1 table logs every key-generation/rotation event: operator(s),
  timestamp, algorithms/parameter sets involved, whether QRNG augmentation succeeded. This is the
  audit trail a CJIS-adjacent review or a chain-of-custody legal challenge would actually check
  for — "when was this key generated, by whom, and how" — as opposed to inferring it from `wrangler
  secret` command history that isn't logged anywhere today.

### 4. WebAuthn — monitor only, no action

Track FIDO Alliance PQC-WebAuthn standardization. Nothing to build until hardware authenticators
support a PQC ceremony — building anything today would mean inventing a non-standard protocol,
which is worse than the status quo for an authentication primitive.

### 5. No action — already sufficient

Every symmetric/hash primitive in Part 1's inventory (JWT HS256, AES-GCM-256, all HMAC-SHA256
uses, TOTP, bcrypt, iOS/desktop/edge signing) needs no change. Re-verify this conclusion only if
NIST publishes new guidance materially lowering the assumed security margin of AES-256 or
SHA-256/384 against Grover's algorithm — no such guidance exists today.

## What Phase 1 delivers

This document, committed to `docs/superpowers/specs/`. No code changes. Each roadmap item above
is scoped clearly enough to go straight into its own brainstorming session when the user is ready
to pick one up — item 1 (triple-algorithm PDF signing) is the natural first pick given it's the
only item with a real, present quantum-risk finding in Part 1.
