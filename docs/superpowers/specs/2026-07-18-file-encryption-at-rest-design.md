# Application-Layer File Encryption at Rest — Design

**Date:** 2026-07-18
**Status:** Approved for planning (Phase 1 scope only — see Non-goals)

## Purpose

Every object in RMPG's `UPLOADS` R2 bucket (`rmpg-flex-uploads`) — field photos, bodycam/dashcam
footage, evidence images/documents, property/business photos, case attachments, and more, across
~24 route files — is currently protected only by Cloudflare R2's automatic infrastructure-level
server-side encryption. There is no application-layer encryption: a leaked R2 API token, a
compromised storage layer, or unauthorized direct bucket access would expose every file as plain
bytes. This document designs the encryption primitive and its **first pilot rollout** to one
upload pathway; the remaining ~20+ pathways are explicitly future phases (see Non-goals).

## Threat model — what this does and does not defend against

- **Defends against:** R2/infrastructure-level exposure — a leaked R2 API token, unauthorized
  direct bucket access, a compromised storage layer, or a Cloudflare-side incident that exposes
  bucket contents without going through the Worker.
- **Does NOT defend against:** a compromised Worker itself. The Worker holds the means to decrypt
  on demand — it has to, because ALPR plate detection, OCR, video redaction, and thumbnail
  generation all require the Worker to read real file content to function. True end-to-end
  (client-side) encryption would close that gap but would break all of those features outright;
  that's a materially different, much larger project explicitly out of scope here (see
  Non-goals).
- This is the same category of guarantee as AWS S3 SSE-KMS or similar server-managed-key
  encryption-at-rest schemes — not a claim of end-to-end confidentiality.

## Non-goals

- **No client-side / end-to-end encryption.** Out of scope per the threat model above.
- **No all-at-once rollout across all ~24 route files.** This document's Phase 1 covers exactly
  one upload pathway (see Architecture, Phase 1 Scope) as a proof of the pattern. Dashcam/bodycam
  footage, evidence images/documents, and the remaining general-upload routes are each separate,
  future brainstorm → design → plan cycles, sequenced by sensitivity.
- **No changes to `MAP_DATA` or `DOWNLOADS` R2 buckets.** Map tiles and installer binaries aren't
  sensitive personal/evidence data; excluded from this initiative entirely.
- **No streaming/chunked encryption primitive in Phase 1.** Verified against this codebase's own
  existing size-ceiling convention (`flexcam.ts:298`, "100 MB — avoid loading a pathological
  chunk into the 128 MB isolate") — every object Phase 1 touches is well under that ceiling
  (field photos cap at 12 MB, per `fieldPhotos.ts`'s existing `MAX_SIZE`). A streaming/chunked
  design is deferred to whichever future phase first needs it (likely dashcam/bodycam footage,
  whose *individual chunks* are already bounded by `MAX_CHUNK_SECONDS` but warrant a dedicated
  check when that phase is scoped).
- **No manual key-rotation ceremony or two-person integrity for `FILE_ENCRYPTION_KEK`** — the
  secret is provisioned once via the existing QRNG entropy CLI
  (`scripts/generate-quantum-key.mjs`, from the earlier crypto-hardening initiative); a
  from-scratch rotation ceremony is future work if ever needed, not part of this phase.

## Architecture

### Core primitive: envelope encryption

- **Master key**: a new Worker secret, `FILE_ENCRYPTION_KEK` (Key-Encryption-Key), 32 random
  bytes, provisioned via `node scripts/generate-quantum-key.mjs 32 | wrangler secret put
  FILE_ENCRYPTION_KEK` — reusing the QRNG-augmented generator built earlier in this same
  initiative rather than a plain `openssl rand` call.
- **Per-file key**: every file gets its own random 256-bit Data Encryption Key (DEK), generated
  fresh at upload time via `crypto.getRandomValues`.
- **Envelope**: the DEK is itself AES-GCM-encrypted ("wrapped") by the KEK. The wrapped DEK + its
  IV + an algorithm-version tag are stored in a new D1 table — **not** R2 custom metadata, which
  has size limits, isn't easily queryable, and would make crypto-shredding (below) awkward.
- **File content**: encrypted with the (unwrapped, in-memory-only) DEK via AES-GCM, buffered
  whole-object (not streamed — see Non-goals for the size ceiling this relies on).

**Migration** — `file_encryption_keys` table:

```sql
CREATE TABLE IF NOT EXISTS file_encryption_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  r2_key TEXT NOT NULL UNIQUE,
  wrapped_dek TEXT NOT NULL,       -- base64 AES-GCM ciphertext of the DEK
  dek_iv TEXT NOT NULL,            -- base64, IV used to wrap the DEK
  file_iv TEXT NOT NULL,           -- base64, IV used to encrypt the file content itself
  algorithm_version TEXT NOT NULL, -- literal 'file-enc-v1' today, for future crypto-agility
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Two separate IVs (one for wrapping the DEK, one for encrypting the file) because they're
cryptographically independent operations — reusing an IV across two different AES-GCM operations
under different circumstances is the kind of mistake this design should make structurally
impossible to make by accident, not just avoid by convention.

**Key rotation**: rotating `FILE_ENCRYPTION_KEK` means re-wrapping every row's `wrapped_dek`
(unwrap with the old KEK, re-wrap with the new one) — a D1-only operation, fast even at scale,
never touching the actual file bytes in R2.

**Crypto-shredding**: `DELETE FROM file_encryption_keys WHERE r2_key = ?` permanently and
irreversibly destroys the ability to decrypt that one file, without needing to guarantee the
underlying R2 object's bytes are actually gone — useful for legal retention-period expiry on
specific evidence without touching anything else.

### Shared R2 wrapper, not per-call-site discipline

Investigating the pilot's actual blast radius surfaced an important constraint: **more than one
file writes/reads the same R2 prefix.** `field-photos/` is touched by both
`src/routes/fieldPhotos.ts` (the primary CRUD route) and `src/routes/alpr.ts` (which also
writes/reads into the same prefix for its own vehicle-capture flow, independently of
`fieldPhotos.ts`). Building `encryptFile()`/`decryptFile()` as raw utility functions that each
call site must remember to invoke correctly would be exactly the kind of thing that's fine until
someone adds a third call site and forgets. Instead:

**New module `src/utils/encryptedR2.ts`** wraps R2 access itself:

```ts
export async function putEncrypted(
  bucket: R2Bucket, db: D1Database, key: string, bytes: ArrayBuffer | Uint8Array,
  opts?: { httpMetadata?: R2HTTPMetadata },
): Promise<void>

export async function getDecrypted(
  bucket: R2Bucket, db: D1Database, key: string,
): Promise<{ bytes: Uint8Array; httpMetadata?: R2HTTPMetadata } | null>
```

`putEncrypted` generates the DEK, encrypts, wraps, writes both the R2 object and the D1 row.
`getDecrypted` looks up the D1 row, unwraps the DEK, decrypts, returns plaintext bytes. Both
`fieldPhotos.ts` and `alpr.ts` call these instead of `bucket.put()`/`bucket.get()` directly — the
encryption step becomes structurally unavoidable rather than a convention to remember. Any future
consumer of `field-photos/` (or any other prefix this pattern extends to) gets the same guarantee
for free.

### Phase 1 scope: `field-photos/` only

Exactly the two files identified above — but narrower than the initial survey suggested. A closer
read of `alpr.ts` found it has **three** `UPLOADS` call sites, and only **one** of them actually
touches the `field-photos/` prefix:

- `src/routes/fieldPhotos.ts` — `POST /` (upload, currently `c.env.UPLOADS.put(key, ...)` at
  line 84) and `GET /file/*` (stream, currently `c.env.UPLOADS.get(key)` at line 136) switch to
  `putEncrypted`/`getDecrypted`.
- `src/routes/alpr.ts:507` — the ONE call site that touches `field-photos/`, and only
  conditionally: `imageKey` is `` `${attachToCall ? FIELD_PHOTO_PREFIX : ALPR_PREFIX}...` `` — it
  writes to `field-photos/` only when the capture is attached to a call/incident, and to
  `alpr-captures/` (a different, out-of-scope prefix) otherwise. Only the `field-photos/` branch
  of this write switches to `putEncrypted`; the `alpr-captures/` branch is untouched. **This is a
  write-only path** — ALPR's plate detection runs on the in-memory `bytes` captured at line 499,
  before this R2 write, not on a re-fetched R2 object, and this write is already wrapped in a
  best-effort try/catch that doesn't affect detection either way. There is no decrypt-for-detection
  concern here, unlike what the original survey assumed.
  - `alpr.ts:972` (`GET /image/*`) and `alpr.ts:1002` (crop upload) were confirmed, on closer
    inspection, to touch `alpr-captures/` and `alpr/vehicles/` respectively — genuinely different
    prefixes, never `field-photos/`. **Out of scope; do not modify these two call sites.**
- `field_photos` DELETE (`fieldPhotos.ts:160`) additionally deletes the corresponding
  `file_encryption_keys` row — otherwise a deleted photo would leave an orphaned wrapped key
  behind indefinitely.

No other file touches this prefix with actual R2 I/O — `src/middleware/auth.ts`,
`src/utils/serveBillingEnhanced.ts`, and `src/routes/drivingEvents.ts` only build/check URL
strings pointing back at `fieldPhotos.ts`'s own route, so they need no changes.

## Testing

- Unit tests for `encryptedR2.ts`'s core crypto: round-trip (encrypt then decrypt returns
  original bytes), determinism-of-independence (two calls with the same plaintext produce
  different ciphertext, since each gets a fresh random DEK), tamper detection (corrupting the
  wrapped DEK or the ciphertext fails to decrypt rather than silently returning garbage),
  crypto-shred behavior (deleting the D1 row makes the file permanently undecryptable even though
  the R2 object still exists) — all using a mocked `R2Bucket`/`D1Database`, no real Cloudflare
  infrastructure needed, matching this codebase's existing test patterns for Worker-safe utils.
- A Miniflare/`test-workers` integration test exercising `fieldPhotos.ts`'s actual upload →
  list → stream → delete cycle end-to-end against real (local) D1 + R2 bindings, confirming the
  full route still behaves identically from the client's perspective (same response shapes, same
  status codes) while the underlying R2 object is now ciphertext.
- A manual smoke-test step (documented in the plan, not scripted) confirming a call-attached ALPR
  capture still stores successfully and the resulting photo is viewable (correctly decrypted) via
  the call's photo gallery afterward — since ALPR's plate detection itself runs on in-memory bytes
  before the R2 write (see Phase 1 scope above), the actual regression risk here is narrower than
  originally assumed: it's "does the stored photo still open correctly," not "does detection still
  work."

## What this document does not cover

Every other UPLOADS pathway besides `field-photos/` — explicitly deferred to future phases per
Non-goals above.
