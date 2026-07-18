# Crypto-Agility Versioning + Audit Trail — Design

**Date:** 2026-07-18
**Status:** Approved for planning

## Purpose

Roadmap item 3 of [`2026-07-18-quantum-encryption-crypto-inventory-design.md`](2026-07-18-quantum-encryption-crypto-inventory-design.md):
tag every signed artifact with an explicit algorithm-version marker, and give RMPG a real,
automatic audit trail of when the PDF/evidence signing key set changed — the kind of "when was
this key generated, by whom, with what algorithms" record a CJIS-adjacent review or a
chain-of-custody legal challenge would actually check for, as opposed to inferring it from
`wrangler secret` shell history that isn't logged anywhere today.

This document covers two closely-coupled but independently-shippable halves of the same roadmap
item: an `algorithmVersion` tag on every signed bundle, and a `crypto_key_events` D1 table.

## Non-goals

- **No operator-identity or QRNG-used columns on `crypto_key_events`.** Those fields cannot be
  genuinely populated by the automatic-capture mechanism this design uses (see Architecture) — a
  column that would sit permanently `NULL` is exactly the kind of placeholder the review process
  in this project flags as a defect. If a future manual-annotation feature is built, it's a
  natural additive migration (`ALTER TABLE ... ADD COLUMN`) at that time, not now.
- **No change to `deriveEd25519Seed()` or any other key-derivation formula.** This design only
  adds an observability layer on top of the existing (unchanged) triple-algorithm signing from
  the prior roadmap-item-1 work — it does not touch what gets signed or how.
- **No new HTTP route.** The audit write is a side effect of the existing `/sign-payload` and
  court-package signing paths, not a new API surface.
- **No retroactive backfill.** `crypto_key_events` starts empty and only records key sets
  observed from the first deploy of this feature onward — it does not attempt to reconstruct
  history for keys already in use before this feature shipped.

## Architecture

### Part 1 — `algorithmVersion` tag

`src/utils/pdfSign.ts`'s `PdfSignTripleResult` gains one new field:

```ts
export interface PdfSignTripleResult {
  algorithmVersion: 'pdf-sig-v2';
  signedAt: string;
  keyId: string;
  ed25519: AlgorithmSignature;
  mlDsa87: AlgorithmSignature;
  slhDsa256f: AlgorithmSignature;
}
```

`'pdf-sig-v2'` is a literal constant today — there is no `v1` to migrate from in code (the
pre-triple-algorithm scheme never carried a version tag at all, so `v1` is retroactively
"whatever existed before this field existed," never itself tagged). A future algorithm swap (e.g.
if ML-DSA is ever deprecated in favor of a different PQC standard) bumps this string to `v3`;
verifiers dispatch on it rather than assuming today's three-algorithm shape forever.

Threads through the same consumers the roadmap-item-1 work already touched:
`client/src/utils/pdfIntegrity.ts`'s `PdfSignatureBundle`, `client/src/utils/pdf/v2/engine/sidecar.ts`'s
`SidecarSignature`, `client/src/utils/pdf/v2DispatchAdapter.ts`'s sidecar construction, and the
dormant `addDocumentIntegrityTrailer()` in `client/src/utils/pdfGenerator.ts` (kept compiling,
still not reactivated — same rule as before).

### Part 2 — `crypto_key_events` audit table

**Schema** — migration `0192_crypto_key_events.sql`:

```sql
CREATE TABLE IF NOT EXISTS crypto_key_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_id TEXT NOT NULL UNIQUE,
  algorithm_version TEXT NOT NULL,
  algorithms TEXT NOT NULL,        -- JSON array, e.g. ["Ed25519","ML-DSA-87","SLH-DSA-256f"]
  first_observed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_crypto_key_events_first_observed ON crypto_key_events(first_observed_at);
```

`first_observed_at` uses `datetime('now')` (UTC), not `datetime('now','localtime')` as the older
`webauthn_credentials` table does — that table's `'localtime'` modifier is inconsistent with this
project's own "always store UTC, convert at display time" convention (the exact class of bug
`scripts/check-new-date.js` exists to catch on the client side). This design does not propagate
that pattern into new code.

**Capture mechanism — automatic first-observation, not operator-reported:**

Nothing today observes a key *rotation* as a discrete event — the Worker derives the Ed25519 /
ML-DSA-87 / SLH-DSA-256f key set deterministically from `PDF_SIGNING_KEY`/`JWT_SECRET` on every
isolate's first `getSigningKeys()` call (a cache-miss, not a rotation), the QRNG CLI runs fully
offline with zero D1 access, and Cloudflare's `wrangler secret put` doesn't notify the Worker at
all. So instead of trying to observe the *act* of rotation, this design observes its *effect*:
the first time any isolate computes a `keyId` that has never been logged before, that's recorded
as a key event. `key_id UNIQUE` + `INSERT OR IGNORE` makes this race-safe: many isolates can cold-start
concurrently after a real rotation, and all but the first `INSERT` are silently no-ops at the SQLite
level — no explicit locking needed.

`src/utils/pdfSign.ts` gains:

```ts
async function logCryptoKeyEvent(db: D1Database, keyId: string, algorithms: string[], ctx?: ExecCtx): Promise<void> {
  const work = (async () => {
    try {
      await db.prepare(
        `INSERT OR IGNORE INTO crypto_key_events (key_id, algorithm_version, algorithms) VALUES (?, ?, ?)`,
      ).bind(keyId, 'pdf-sig-v2', JSON.stringify(algorithms)).run();
    } catch {
      // Table may not exist yet (migration not applied), or D1 hiccup — audit
      // logging must never block or fail an actual signing request.
    }
  })();
  if (ctx) ctx.waitUntil(work); else void work;
}
```

This mirrors `src/utils/logger.ts`'s existing `logErrorToDb()` exactly — same minimal `ExecCtx`
interface (`{ waitUntil(p: Promise<unknown>): void }`, not the full `@cloudflare/workers-types`
`ExecutionContext`, avoiding a generic-param mismatch the same way `logErrorToDb` does), same
try/catch-and-swallow body, same `ctx?.waitUntil(work) : void work` fallback. This is a deliberate
reuse of an established, already-shipped pattern — not a new convention.

`getSigningKeys()` calls `logCryptoKeyEvent(...)` exactly once, at the point it computes a
genuinely new key set (the `cachedKeys` cache-miss branch) — never on a cache-hit, so a busy
isolate doesn't re-fire this on every request.

`signTriple()`'s signature grows one new optional parameter:

```ts
export async function signTriple(
  env: Bindings, formKey: string, caseNumber: string, payloadHash: string, ctx?: ExecCtx,
): Promise<PdfSignTripleResult>
```

Both call sites that have a Hono context available (`src/routes/pdfTools.ts`'s `/sign-payload`
route, `src/routes/flexcam.ts`'s court-package route) pass `c.executionCtx`. Omitting `ctx`
degrades gracefully to a fire-and-forget write with no delivery guarantee — never a thrown error,
never a blocked signing response.

## Testing

- `logCryptoKeyEvent` and the cache-miss trigger point are testable in the existing
  `tests/pdfSign.test.ts` Node/vitest suite using a minimal mock `D1Database`-shaped object
  (`{ prepare: () => ({ bind: () => ({ run: async () => {} }) }) }`) — this file already has this
  exact testing pattern precedent from the roadmap-item-1 plan's `Bindings` stubs, so no new test
  infrastructure is needed.
- A test proving `INSERT OR IGNORE` semantics don't need a real D1 to verify (that's SQLite's own
  guarantee) — what needs testing is that `logCryptoKeyEvent` is called with the correct
  `algorithm_version`/`algorithms` values, and that a `db.prepare(...).run()` throw is swallowed
  without propagating.
- A test proving the cache-hit path does NOT call `logCryptoKeyEvent` a second time for the same
  env/secret (guards against the "re-fire on every cached request" mistake this design explicitly
  avoids).
- The `algorithmVersion` field threads through the same client-side test files touched by the
  roadmap-item-1 plan (`pdfIntegrity.test.ts`) — extend those existing assertions rather than
  writing a new test file.

## What this document does not cover

Operator-identity/QRNG-used enrichment of audit rows, and any retroactive backfill — both
explicitly out of scope per Non-goals above.
