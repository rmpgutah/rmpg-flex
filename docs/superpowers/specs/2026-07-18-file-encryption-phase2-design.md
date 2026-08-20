# Application-Layer File Encryption at Rest — Phase 2 — Design

**Date:** 2026-07-18
**Status:** Approved for planning
**Depends on:** `docs/superpowers/specs/2026-07-18-file-encryption-at-rest-design.md` (Phase 1, shipped in
PR [#2847](https://github.com/rmpgutah/rmpg-flex/pull/2847) — `src/utils/encryptedR2.ts`,
`migrations/0194_file_encryption_keys.sql`, `FILE_ENCRYPTION_KEK` secret)

## Purpose

Phase 1 proved the envelope-encryption pattern on one prefix (`field-photos/`). This phase extends it to
every other **whole-buffer** `UPLOADS` R2 prefix in `/src/` — the ones that already read/write complete
objects in memory today, so `encryptedR2.ts`'s existing `putEncrypted`/`getDecrypted`/`deleteEncryptionKey`
functions drop in unchanged. Streaming/chunked/multipart prefixes (`flexcam/trips/`, `dashcam/` +
`dashcam-videos/`, `bodycam-videos/`, `flexcam/events/`) need a genuinely different encryption primitive
and are explicitly deferred to a future Phase 3 (see Non-goals).

Threat model, non-goals around end-to-end/client-side encryption, and the "why envelope encryption"
rationale are identical to Phase 1 and are not repeated here — see the Phase 1 design doc.

## Non-goals

- **No streaming-encryption primitive.** `flexcam/trips/` (`captureOrchestrator.ts`, `concat.ts`'s
  `TransformStream` chunk-relay, `footageAlpr.ts`, `flexcam.ts`), `dashcam/` + `dashcam-videos/`
  (`clearpathSync.ts`'s streamed fetch-response puts, `fleet.ts`'s `file.stream()` puts,
  `clearpathgps.ts` playback), `bodycam-videos/` (`bodyCameraUploads.ts`'s R2 multipart-upload API), and
  `flexcam/events/` (`drivingEvents.ts`'s streamed `resp.body` put) are all out of scope. Each writes
  R2 objects incrementally rather than buffering a complete object first, so `putEncrypted`'s
  buffer-then-encrypt-then-write shape does not apply without a real design cycle of its own (a
  streaming AEAD construction, likely chunked with per-chunk auth tags — STREAM/AES-GCM-SIV-style, or a
  simpler per-chunk-independent-object encryption if the existing chunking granularity is fine-grained
  enough). That is a separate brainstorm → design → plan cycle, likely the next phase after this one.
- **No fix for the two orphaned write paths' missing readers.** `panic-audio/` (written by
  `VoiceHubDO.ts`, no route currently reads it back) and `alpr/vehicles/{id}/{field}.jpg` crop uploads
  (written by `alpr.ts:1008`, no route matches that prefix in `/image/*`) get their writes encrypted for
  defense-in-depth, but building or fixing their reader routes is a separate bug, out of scope here.
- **No change to `encryptedR2.ts`'s core envelope primitive or the `file_encryption_keys` schema.**
  Both are already generic across `r2_key` — this phase is pure call-site wiring plus one small
  addition (see Range-read handling below).
- **No change to `MAP_DATA` or `DOWNLOADS` buckets** — unchanged from Phase 1.

## Architecture

### Reused unchanged: `src/utils/encryptedR2.ts`

`putEncrypted(bucket, db, kekB64, key, bytes, opts?)`, `getDecrypted(bucket, db, kekB64, key)`, and
`deleteEncryptionKey(db, key)` — exactly as shipped in Phase 1. Every prefix below is a whole-buffer
read/write today, so no signature changes are needed.

### New: Range-read handling for `radio-audio/`

`radio.ts`'s reader (`GET` on a signed-URL-gated route) currently does `c.env.UPLOADS.get(key, { range:
r2Range })` to let the browser's `<audio>` element seek within a transmission clip via HTTP Range
requests. AES-GCM ciphertext cannot be range-fetched from R2 directly — GCM's authentication tag covers
the whole ciphertext, so decryption requires the complete object. Per-transmission clips are small
(seconds to low minutes of audio, not multi-hour video), so the fix is to decrypt the full object
server-side via `getDecrypted`, then slice the requested byte range out of the resulting plaintext
`Uint8Array` and respond with the matching `Content-Range`/`Content-Length`/206 status — a "pseudo-range"
served from an in-memory plaintext buffer rather than R2's native range fetch. This is a small addition
in `radio.ts` itself (slicing logic at the route layer), not a change to `encryptedR2.ts`.

### New: `FILE_ENCRYPTION_KEK` reaches a Durable Object

`VoiceHubDO.ts` writes `radio-audio/` and `panic-audio/` directly (it already holds a `DB: D1Database`
binding in its `VoiceEnv` interface, per Phase 1's `db`-based design). Its `VoiceEnv` interface gains
`FILE_ENCRYPTION_KEK?: string` alongside the existing `DB`/`JWT_SECRET`/`UPLOADS`/`AI` bindings — Durable
Objects receive the same Worker secrets as `c.env` in routes, so no new provisioning is needed; the
secret set once in Phase 1 already covers this.

### Per-prefix scope (9 prefixes, 9 route files + 1 Durable Object)

Ordered by sensitivity, matching the inventory from the scoping conversation:

Verified directly against current `main` (no route file guessed):

| Prefix | Writer(s) | Reader(s) | Delete wiring |
|---|---|---|---|
| `nsopw-photos/` | `src/utils/nsopw/photoStore.ts` | `src/routes/nsopw.ts` | None — no R2-deleting route exists for this prefix today; encrypting doesn't change that |
| `redactions/` | `src/routes/redactions.ts` | `src/routes/redactions.ts` (colocated) | Yes — `redactions.ts:91` (`c.env.UPLOADS.delete(r2Key)` in the custody-row-failed rollback path) gets a paired `deleteEncryptionKey` call |
| `radio-audio/` | `src/durable-objects/VoiceHubDO.ts` | `src/routes/radio.ts` (+ range-slice, above) | None — no delete route found |
| `panic-audio/` | `src/durable-objects/VoiceHubDO.ts` | none (write-only, per Non-goals) | None |
| `alpr-captures/` + `alpr/vehicles/` | `src/routes/alpr.ts` | `src/routes/alpr.ts` (`alpr-captures/` only; vehicle crops have no reader, per Non-goals) | None — no delete route found |
| `interactions/` | `src/routes/intel.ts` | `src/routes/intel.ts` (colocated) | None — no delete route found for this prefix (intel.ts's other DELETE routes target saved-searches/watchlist/canonical-person, not interaction media) |
| `citations/` | `src/routes/citations.ts` | `src/routes/citations.ts` (colocated) | None — `citations.ts:668`'s `DELETE /:id` removes DB rows only, never touches the R2 PDFs; pre-existing orphan-on-delete gap, out of scope to fix here |
| `attachments/` | `src/routes/uploads.ts` | `src/routes/uploads.ts` (colocated) | Yes — `uploads.ts:473` (`c.env.UPLOADS.delete(att.file_path)`) gets a paired `deleteEncryptionKey` call |
| `vehicle-inspections/` | `src/routes/inspections.ts` | same file | None — no delete route found |
| `business-photos/` | `src/routes/business/photos.ts` | same file | Yes — `photos.ts:199` (`c.env.UPLOADS.delete(r2Key)`) gets a paired `deleteEncryptionKey` call |
| `property-photos/` | `src/routes/property/photos.ts` | same file | Yes — `photos.ts:178` (`c.env.UPLOADS.delete(r2Key)`) gets a paired `deleteEncryptionKey` call |
| `work-order-attachments/` | `src/routes/workOrders.ts` | same file | None — only a `POST /:id/attachments` upload route exists; no delete route for individual attachments |
| `serve-intake/` | `src/routes/serveIntake.ts` | same file | None — `serveIntake.ts:1941`'s `DELETE /:id` detaches documents (`serve_intake_documents.serve_queue_id = NULL`) rather than deleting them; R2 objects are never removed |

Every "None" row above is a pre-existing gap (the R2 object and/or `file_encryption_keys` row simply
outlives the parent record) — encrypting these prefixes doesn't introduce that gap or make it worse;
per Phase 1's design, an orphaned `file_encryption_keys` row with a still-live R2 object is harmless
dead data, not a security issue. Fixing these gaps is separate future work, not this phase's scope.

**`attachments/` size cap**: `uploads.ts`'s `MAX_FILE_SIZE` drops from `500 * 1024 * 1024` to
`100 * 1024 * 1024` (matching the codebase's existing 100 MB whole-buffer-safety convention from
`flexcam.ts`), landing in the same task as the encryption wiring for that file. This fixes a
pre-existing latent memory-pressure risk (encrypting doubles peak buffer size at write time) rather than
just avoiding it.

**Multi-consumer prefixes**: only `alpr-captures/`/`alpr/vehicles/` and `radio-audio/`/`panic-audio/`
(both via `VoiceHubDO.ts`, which also touches two different prefixes) have more than one call site to
keep consistent — smaller blast radius than Phase 1's `field-photos/`, which had two entirely separate
route files as writers.

## Testing

- Extend `tests/encryptedR2.test.ts`'s existing coverage is not needed (the primitive itself doesn't
  change) — new tests target each call site instead.
- For each of the 9 prefixes: a focused unit/integration test confirming the write path calls
  `putEncrypted` (not raw `bucket.put`) and the read path calls `getDecrypted` — following Phase 1's
  `test-workers/fieldPhotosEncryption.test.ts` pattern (Miniflare, real D1 + R2 bindings) where a route
  already has Miniflare coverage, or a mocked-binding unit test otherwise.
- A dedicated test for `radio-audio/`'s range-slice behavior: request a sub-range of a known plaintext
  audio blob, confirm the response's byte range matches what an unencrypted range-fetch would have
  returned, confirm `Content-Range`/206 status are correct.
- A dedicated test confirming `VoiceHubDO.ts` fails closed (throws, does not silently store plaintext)
  when `FILE_ENCRYPTION_KEK` is unset — mirroring `encryptedR2.ts`'s existing fail-closed contract from
  Phase 1, now exercised from a Durable Object caller instead of a route.
- Manual smoke-test step (documented in the plan, not scripted): confirm a live radio transmission
  still records and plays back with working seek/scrub after the change, since that's the one prefix
  with a real behavioral change (range-to-full-decrypt-then-slice) rather than a pure swap.

## What this document does not cover

Streaming/chunked/multipart prefixes (`flexcam/trips/`, `dashcam/`, `dashcam-videos/`,
`bodycam-videos/`, `flexcam/events/`) — deferred to a future Phase 3 requiring a dedicated streaming-
encryption design, per Non-goals above.
