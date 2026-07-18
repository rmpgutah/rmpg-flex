# Triple-Algorithm PDF/Evidence Signing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sign every chain-of-custody PDF/evidence artifact with three independent algorithms simultaneously — Ed25519 (existing, unchanged), ML-DSA-87 (FIPS 204, CNSA 2.0), and SLH-DSA-SHA2-256f (FIPS 205, CNSA 2.0) — so a future cryptanalytic break in any one algorithm family (classical elliptic-curve, lattice-based PQC, or hash-based PQC) doesn't compromise document authenticity.

**Architecture:** All three keys derive deterministically from the same root secret (`PDF_SIGNING_KEY` when provisioned, else `JWT_SECRET`) — no new ops/secret-provisioning step, matching the existing Ed25519-only behavior. Ed25519 keeps its exact current derivation formula unchanged (backward-compat: already-issued signatures must stay verifiable). The two new algorithms get independently domain-separated seeds via HKDF-Expand. `src/utils/pdfSign.ts`'s `signTriple()` becomes the single source of truth for all three signatures; `src/routes/pdfTools.ts`'s `/sign-payload` route stops duplicating signing logic inline and calls it. Three client files that consume the response (`pdfIntegrity.ts`, `v2DispatchAdapter.ts`, `sidecar.ts`) update their local response-shape types together, since this is a breaking change to the API's response shape — it must ship as one PR, not split across Worker/client plans.

**Tech Stack:** `@noble/post-quantum@0.6.1` (pure TypeScript, zero native deps, confirmed Workers-compatible) for ML-DSA-87 and SLH-DSA-SHA2-256f. WebCrypto (`crypto.subtle`) for Ed25519 (unchanged) and the new HKDF seed derivation — both natively available in `workerd`.

## Global Constraints

- **Never change `deriveEd25519Seed()`'s formula.** Any already-issued Ed25519 signature (exported court packages, evidence records) must remain verifiable against the same deterministically-derived key. This is the single most important constraint in this plan.
- **SLH-DSA parameter set is `sha2-256f`, not `sha2-256s`.** Both are FIPS 205, NIST security category 5 (256-bit) — same security level, no downgrade. Benchmarked on this machine: `256s` sign takes **3.7 seconds** (would very likely blow Cloudflare Workers CPU-time limits and block the isolate for other concurrent requests on a live dispatch system); `256f` sign takes **365ms** (acceptable for a human-initiated, infrequent "sign this document" action). `256f`'s signature is larger (49,856 bytes vs 29,792) — a complete non-issue since it's embedded in PDF metadata, never printed in full.
- **No D1 migration in this plan.** Nothing in the current signing flow persists signatures to D1 (`flexcam.ts`'s court-package route returns them in the JSON response only); a `crypto_key_events` audit table is a separate future roadmap item.
- **No new `/verify` HTTP route.** None exists today; correctness is proven by unit tests calling each algorithm's own `verify()` directly. Do not add API surface beyond what's needed.
- All three benchmarked figures above come from running the actual `@noble/post-quantum@0.6.1` functions on this machine — quote them in code comments, don't re-derive from memory.

---

## File Map

| File | Change |
|---|---|
| `package.json` | Add `@noble/post-quantum` dependency |
| `src/utils/pdfSign.ts` | Add ML-DSA-87 + SLH-DSA-256f signing alongside unchanged Ed25519; rewrite `signTriple()` |
| `src/routes/pdfTools.ts` | `/sign-payload` route delegates to `signTriple()` instead of duplicating signing logic |
| `client/src/utils/pdfIntegrity.ts` | `PdfSignatureBundle` type + `fetchPdfSignature()` parse the new nested shape |
| `client/src/utils/pdf/v2/engine/sidecar.ts` | `SidecarSignature` type carries all three algorithms |
| `client/src/utils/pdf/v2DispatchAdapter.ts` | `signPayload()` response type + sidecar construction updated |
| `client/src/utils/pdfGenerator.ts` | Dormant `addDocumentIntegrityTrailer()` updated for the new type (required for typecheck; function has zero call sites today) |
| `tests/pdfSign.test.ts` | New — Worker-side crypto correctness tests |
| `client/src/utils/__tests__/pdfIntegrity.test.ts` | Existing tests updated for the new bundle shape |

---

### Task 1: Add `@noble/post-quantum` and prove it works in this repo

**Files:**
- Modify: `package.json`
- Test: `tests/pdfSign.test.ts` (new file, first test only)

**Interfaces:**
- Produces: confidence that `ml_dsa87` and `slh_dsa_sha2_256f` (imported from `@noble/post-quantum/ml-dsa.js` and `@noble/post-quantum/slh-dsa.js`) work correctly under this repo's `vitest` (Node) setup before wiring them into `pdfSign.ts`.

- [ ] **Step 1: Add the dependency**

Edit `package.json` — add this line to `dependencies`, alphabetically between `@hono/zod-validator` and `@simplewebauthn/server`:

```json
    "@noble/post-quantum": "^0.6.1",
```

- [ ] **Step 2: Install**

Run: `npm install`
Expected: `package-lock.json` updates; `node_modules/@noble/post-quantum` exists.

- [ ] **Step 3: Write the failing test**

Create `tests/pdfSign.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ml_dsa87 } from '@noble/post-quantum/ml-dsa.js';
import { slh_dsa_sha2_256f } from '@noble/post-quantum/slh-dsa.js';

// Benchmarked on 2026-07-18 (dev machine, @noble/post-quantum 0.6.1):
//   ml_dsa87:            keygen ~15ms, sign ~14ms,  verify ~5ms
//   slh_dsa_sha2_256s:    sign ~3711ms  — too slow for a Workers request handler
//   slh_dsa_sha2_256f:    sign ~365ms   — the parameter set this codebase uses
// Both are FIPS 205, NIST category 5 (256-bit) — same security level; f/s is
// purely a speed/signature-size tradeoff, not a security downgrade.

describe('@noble/post-quantum — library sanity', () => {
  it('ml_dsa87 signs and verifies with a deterministic 32-byte seed', () => {
    const seed = new Uint8Array(32).fill(7);
    const { publicKey, secretKey } = ml_dsa87.keygen(seed);
    const msg = new TextEncoder().encode('rmpg-test-message');
    const sig = ml_dsa87.sign(msg, secretKey);
    expect(ml_dsa87.verify(sig, msg, publicKey)).toBe(true);
    expect(publicKey.length).toBe(2592);
    expect(sig.length).toBe(4627);
  });

  it('ml_dsa87 rejects a tampered message', () => {
    const seed = new Uint8Array(32).fill(7);
    const { publicKey, secretKey } = ml_dsa87.keygen(seed);
    const sig = ml_dsa87.sign(new TextEncoder().encode('original'), secretKey);
    expect(ml_dsa87.verify(sig, new TextEncoder().encode('tampered'), publicKey)).toBe(false);
  });

  it('slh_dsa_sha2_256f signs and verifies with a deterministic 96-byte seed', () => {
    const seed = new Uint8Array(96).fill(9);
    const { publicKey, secretKey } = slh_dsa_sha2_256f.keygen(seed);
    const msg = new TextEncoder().encode('rmpg-test-message');
    const sig = slh_dsa_sha2_256f.sign(msg, secretKey);
    expect(slh_dsa_sha2_256f.verify(sig, msg, publicKey)).toBe(true);
    expect(publicKey.length).toBe(64);
    expect(sig.length).toBe(49856);
  });

  it('slh_dsa_sha2_256f rejects a tampered message', () => {
    const seed = new Uint8Array(96).fill(9);
    const { publicKey, secretKey } = slh_dsa_sha2_256f.keygen(seed);
    const sig = slh_dsa_sha2_256f.sign(new TextEncoder().encode('original'), secretKey);
    expect(slh_dsa_sha2_256f.verify(sig, new TextEncoder().encode('tampered'), publicKey)).toBe(false);
  });
});
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/pdfSign.test.ts`
Expected: PASS (all 4 tests) — this proves the library works correctly under this repo's Node-based vitest setup before any `pdfSign.ts` changes.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tests/pdfSign.test.ts
git commit -m "feat(pdf-sign): add @noble/post-quantum, prove ML-DSA-87/SLH-DSA-256f work"
```

---

### Task 2: HKDF seed derivation in `pdfSign.ts`

**Files:**
- Modify: `src/utils/pdfSign.ts`
- Test: `tests/pdfSign.test.ts`

**Interfaces:**
- Produces: `deriveHkdfSeed(env: Bindings, label: string, byteLength: number): Promise<Uint8Array>` — internal (not exported), but tested indirectly via a temporary exported test hook removed in a later task once `signTriple()` exercises it end-to-end. To keep this task's test real without over-exposing internals permanently, export it as `deriveHkdfSeedForTest` for now — Task 5 removes that export once `signTriple()`'s own tests cover the behavior.

- [ ] **Step 1: Write the failing test**

Add to `tests/pdfSign.test.ts`:

```ts
import { deriveHkdfSeedForTest } from '../src/utils/pdfSign';
import type { Bindings } from '../src/types';

describe('deriveHkdfSeedForTest', () => {
  const env = { JWT_SECRET: 'test-jwt-secret-value' } as unknown as Bindings;

  it('derives the requested byte length', async () => {
    const seed32 = await deriveHkdfSeedForTest(env, 'label-a', 32);
    const seed96 = await deriveHkdfSeedForTest(env, 'label-a', 96);
    expect(seed32.length).toBe(32);
    expect(seed96.length).toBe(96);
  });

  it('is deterministic for the same env + label', async () => {
    const a = await deriveHkdfSeedForTest(env, 'label-a', 32);
    const b = await deriveHkdfSeedForTest(env, 'label-a', 32);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('produces different bytes for different labels (domain separation)', async () => {
    const a = await deriveHkdfSeedForTest(env, 'label-a', 32);
    const b = await deriveHkdfSeedForTest(env, 'label-b', 32);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('prefers PDF_SIGNING_KEY over JWT_SECRET when both are set', async () => {
    const envWithBoth = { JWT_SECRET: 'jwt-value', PDF_SIGNING_KEY: 'dGVzdC1wZGYtc2lnbmluZy1rZXk=' } as unknown as Bindings;
    const envJwtOnly = { JWT_SECRET: 'jwt-value' } as unknown as Bindings;
    const a = await deriveHkdfSeedForTest(envWithBoth, 'label-a', 32);
    const b = await deriveHkdfSeedForTest(envJwtOnly, 'label-a', 32);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pdfSign.test.ts`
Expected: FAIL — `deriveHkdfSeedForTest` is not exported yet.

- [ ] **Step 3: Implement**

In `src/utils/pdfSign.ts`, add after the existing `base64ToBytes` function (before `let cachedSigningKey`):

```ts
// HKDF-Expand (RFC 5869) — derives arbitrary-length, domain-separated key
// material from the same root secret used by deriveEd25519Seed, WITHOUT
// touching that function's formula (see file header). `label` must be
// unique per algorithm so a break in one derived seed reveals nothing
// about the others.
async function deriveHkdfSeed(env: Bindings, label: string, byteLength: number): Promise<Uint8Array> {
  const material = env.PDF_SIGNING_KEY?.trim() || env.JWT_SECRET;
  const ikm = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(material), 'HKDF', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(), info: new TextEncoder().encode(label) },
    ikm,
    byteLength * 8,
  );
  return new Uint8Array(bits);
}

// Test-only export — removed once signTriple()'s own tests cover this
// behavior end-to-end (Task 5).
export const deriveHkdfSeedForTest = deriveHkdfSeed;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/pdfSign.test.ts`
Expected: PASS (all tests including Task 1's).

- [ ] **Step 5: Commit**

```bash
git add src/utils/pdfSign.ts tests/pdfSign.test.ts
git commit -m "feat(pdf-sign): add HKDF seed derivation, domain-separated from Ed25519"
```

---

### Task 3: Export the Ed25519 public key (backward-compat regression test)

**Files:**
- Modify: `src/utils/pdfSign.ts`
- Test: `tests/pdfSign.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: the private `getSigningKeys()` cache (introduced this task, replaces `getPdfSigningKey`) exposes `ed25519PublicKey: Uint8Array` — needed so the API response can finally include a real Ed25519 public key (it never has — `pdfTools.ts`'s current response has no `publicKey` field at all, a pre-existing gap this task fixes as a side effect of adding the other two algorithms' public keys).

- [ ] **Step 1: Write the failing test**

Add to `tests/pdfSign.test.ts`:

```ts
import { getPdfSigningKeyForTest } from '../src/utils/pdfSign';

describe('getPdfSigningKeyForTest — Ed25519', () => {
  const env = { JWT_SECRET: 'test-jwt-secret-value' } as unknown as Bindings;

  it('exports a 32-byte Ed25519 public key that verifies a signature made with the private key', async () => {
    const { key, ed25519PublicKey } = await getPdfSigningKeyForTest(env);
    expect(ed25519PublicKey.length).toBe(32);
    const msg = new TextEncoder().encode('hello');
    const sigBuf = await crypto.subtle.sign('Ed25519', key, msg);
    const pubKey = await crypto.subtle.importKey('raw', ed25519PublicKey, { name: 'Ed25519' }, false, ['verify']);
    expect(await crypto.subtle.verify('Ed25519', pubKey, sigBuf, msg)).toBe(true);
  });

  it('re-derives the exact same keyId across separate calls (deterministic)', async () => {
    const a = await getPdfSigningKeyForTest(env);
    const b = await getPdfSigningKeyForTest(env);
    expect(a.keyId).toBe(b.keyId);
    expect(Array.from(a.ed25519PublicKey)).toEqual(Array.from(b.ed25519PublicKey));
  });

  it('BACKWARD COMPAT: keyId for a known JWT_SECRET matches the pre-PQC value', async () => {
    // Golden value captured from the ORIGINAL getPdfSigningKey() (before this
    // plan), to prove deriveEd25519Seed()'s formula — and therefore every
    // already-issued signature's verifiability — is unchanged. Computed by
    // running the exact pre-change derivation formula (SHA-256(secret|
    // 'rmpg-pdf-ed25519-v1') -> seed -> SHA-256(seed) -> first 8 bytes hex)
    // against the fixed secret below. Never hand-edit this value — if this
    // test ever needs to change, something broke backward compatibility.
    const { keyId } = await getPdfSigningKeyForTest({ JWT_SECRET: 'golden-test-secret-do-not-change' } as unknown as Bindings);
    expect(keyId).toBe('867c4da05488c3a2');
  });
});
```

- [ ] **Step 2: Confirm the golden value independently before trusting the test**

The value above was computed by running this against the pre-Task-3 derivation formula (do this yourself to confirm before proceeding — don't just trust the plan text):

```bash
node -e "
const { subtle } = globalThis.crypto;
(async () => {
  const material = new TextEncoder().encode('golden-test-secret-do-not-change|rmpg-pdf-ed25519-v1');
  const seed = new Uint8Array(await subtle.digest('SHA-256', material));
  const seedHash = new Uint8Array(await subtle.digest('SHA-256', seed));
  const keyId = Array.from(seedHash.slice(0, 8)).map((b) => b.toString(16).padStart(2, '0')).join('');
  console.log(keyId);
})();
"
```

Expected output: `867c4da05488c3a2` — matching Step 1's test. If it doesn't match, stop and re-derive before continuing; do not proceed with a mismatched golden value.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/pdfSign.test.ts`
Expected: FAIL — `getPdfSigningKeyForTest` is not exported yet.

- [ ] **Step 4: Implement**

In `src/utils/pdfSign.ts`, replace the existing `cachedSigningKey` variable and `getPdfSigningKey` function with:

```ts
interface CachedEd25519Key {
  seedHash: string;
  key: CryptoKey;
  ed25519PublicKey: Uint8Array;
}

let cachedEd25519: CachedEd25519Key | null = null;

async function getSigningKeys(env: Bindings): Promise<{ key: CryptoKey; keyId: string; ed25519PublicKey: Uint8Array }> {
  const seed = await deriveEd25519Seed(env);
  const seedHashBuf = await crypto.subtle.digest('SHA-256', seed);
  const seedHashBytes = new Uint8Array(seedHashBuf);
  const seedHash = bytesToBase64(seedHashBytes);
  const keyId = Array.from(seedHashBytes.slice(0, 8)).map((b) => b.toString(16).padStart(2, '0')).join('');

  if (cachedEd25519 && cachedEd25519.seedHash === seedHash) {
    return { key: cachedEd25519.key, keyId, ed25519PublicKey: cachedEd25519.ed25519PublicKey };
  }

  const pkcs8 = new Uint8Array(ED25519_PKCS8_PREFIX.length + 32);
  pkcs8.set(ED25519_PKCS8_PREFIX, 0);
  pkcs8.set(seed, ED25519_PKCS8_PREFIX.length);
  // extractable: true (was false) — needed to export the public key below.
  // Safe: this is a server-held key derived from a secret we already
  // control; exporting the PUBLIC half leaks nothing the derivation
  // formula doesn't already make computable by anyone holding the secret.
  const key = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, true, ['sign']);
  const jwk = await crypto.subtle.exportKey('jwk', key);
  if (!jwk.x) throw new Error('Ed25519 JWK export missing public key (x)');
  const ed25519PublicKey = base64UrlToBytes(jwk.x);

  cachedEd25519 = { seedHash, key, ed25519PublicKey };
  return { key, keyId, ed25519PublicKey };
}

// Test-only export — removed in Task 5 once signTriple()'s tests cover this.
export const getPdfSigningKeyForTest = getSigningKeys;
```

Add the `base64UrlToBytes` helper next to `base64ToBytes`:

```ts
function base64UrlToBytes(b64url: string): Uint8Array {
  const pad = b64url.length % 4 === 2 ? '==' : b64url.length % 4 === 3 ? '=' : '';
  return base64ToBytes(b64url.replace(/-/g, '+').replace(/_/g, '/') + pad);
}
```

Update `signTriple()`'s existing body (still Ed25519-only at this point in the plan) to call `getSigningKeys` instead of the old `getPdfSigningKey` name — keep everything else in that function identical for now; Task 5 rewrites its return shape:

```ts
export async function signTriple(
  env: Bindings, formKey: string, caseNumber: string, payloadHash: string,
): Promise<{ signature: string; signedAt: string; algorithm: 'Ed25519'; keyId: string }> {
  const { key, keyId } = await getSigningKeys(env);
  const message = new TextEncoder().encode(`${formKey}|${caseNumber}|${payloadHash}`);
  const sigBuf = await crypto.subtle.sign('Ed25519', key, message);
  return { signature: bytesToBase64(new Uint8Array(sigBuf)), signedAt: new Date().toISOString(), algorithm: 'Ed25519', keyId }; // new-date-ok
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/pdfSign.test.ts`
Expected: PASS (all tests). If the golden-value test fails, you edited `deriveEd25519Seed()` — revert it; that function must be byte-for-byte unchanged.

- [ ] **Step 6: Fix the one call site**

`src/routes/pdfTools.ts` imports `getPdfSigningKey` (old name) — update the import to `getSigningKeys` is NOT needed yet since Task 6 rewrites this route entirely to call `signTriple()` instead. For now, just confirm the Worker still typechecks:

Run: `npm run typecheck`
Expected: FAIL — `pdfTools.ts` still imports the now-removed `getPdfSigningKey`. This is expected and resolved in Task 6; do not "fix" it here by keeping a compat alias — Task 6 removes this route's need for the function entirely.

- [ ] **Step 7: Commit**

```bash
git add src/utils/pdfSign.ts tests/pdfSign.test.ts
git commit -m "feat(pdf-sign): export Ed25519 public key; pin backward-compat golden keyId"
```

Note: the repo's `typecheck` script is red after this commit (expected — `pdfTools.ts` isn't fixed until Task 6). If your workflow requires green-at-every-commit, squash Tasks 3–6 before pushing; do not skip the golden-value regression test to avoid this.

---

### Task 4: ML-DSA-87 and SLH-DSA-256f keypair generation + caching

**Files:**
- Modify: `src/utils/pdfSign.ts`
- Test: `tests/pdfSign.test.ts`

**Interfaces:**
- Consumes: `deriveHkdfSeed` (Task 2), `ml_dsa87` / `slh_dsa_sha2_256f` (Task 1).
- Produces: `getSigningKeys()` (from Task 3) extended to also return `mlDsaPublicKey`, `mlDsaSecretKey`, `slhDsaPublicKey`, `slhDsaSecretKey` — all cached alongside the Ed25519 key so keygen (the expensive part: ~15ms ML-DSA, ~18ms SLH-DSA) only runs once per isolate, not once per request.

- [ ] **Step 1: Write the failing test**

Add to `tests/pdfSign.test.ts`:

```ts
describe('getPdfSigningKeyForTest — PQC keys', () => {
  const env = { JWT_SECRET: 'test-jwt-secret-value' } as unknown as Bindings;

  it('derives ML-DSA-87 and SLH-DSA-256f keypairs with correct sizes', async () => {
    const keys = await getPdfSigningKeyForTest(env);
    expect(keys.mlDsaPublicKey.length).toBe(2592);
    expect(keys.mlDsaSecretKey.length).toBe(4896);
    expect(keys.slhDsaPublicKey.length).toBe(64);
    expect(keys.slhDsaSecretKey.length).toBe(128);
  });

  it('is deterministic across separate calls', async () => {
    const a = await getPdfSigningKeyForTest(env);
    const b = await getPdfSigningKeyForTest(env);
    expect(Array.from(a.mlDsaPublicKey)).toEqual(Array.from(b.mlDsaPublicKey));
    expect(Array.from(a.slhDsaPublicKey)).toEqual(Array.from(b.slhDsaPublicKey));
  });

  it('produces different PQC keys for different root secrets', async () => {
    const other = { JWT_SECRET: 'a-different-secret' } as unknown as Bindings;
    const a = await getPdfSigningKeyForTest(env);
    const b = await getPdfSigningKeyForTest(other);
    expect(Array.from(a.mlDsaPublicKey)).not.toEqual(Array.from(b.mlDsaPublicKey));
    expect(Array.from(a.slhDsaPublicKey)).not.toEqual(Array.from(b.slhDsaPublicKey));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pdfSign.test.ts`
Expected: FAIL — `mlDsaPublicKey` etc. are `undefined` on the returned object.

- [ ] **Step 3: Implement**

In `src/utils/pdfSign.ts`, add the imports at the top of the file:

```ts
import { ml_dsa87 } from '@noble/post-quantum/ml-dsa.js';
import { slh_dsa_sha2_256f } from '@noble/post-quantum/slh-dsa.js';
```

Extend `CachedEd25519Key` (rename to `CachedSigningKeys`) and `getSigningKeys()`:

```ts
interface CachedSigningKeys {
  seedHash: string;
  ed25519Key: CryptoKey;
  ed25519PublicKey: Uint8Array;
  mlDsaPublicKey: Uint8Array;
  mlDsaSecretKey: Uint8Array;
  slhDsaPublicKey: Uint8Array;
  slhDsaSecretKey: Uint8Array;
}

let cachedKeys: CachedSigningKeys | null = null;

async function getSigningKeys(env: Bindings): Promise<{
  ed25519Key: CryptoKey; keyId: string; ed25519PublicKey: Uint8Array;
  mlDsaPublicKey: Uint8Array; mlDsaSecretKey: Uint8Array;
  slhDsaPublicKey: Uint8Array; slhDsaSecretKey: Uint8Array;
}> {
  const seed = await deriveEd25519Seed(env);
  const seedHashBuf = await crypto.subtle.digest('SHA-256', seed);
  const seedHashBytes = new Uint8Array(seedHashBuf);
  const seedHash = bytesToBase64(seedHashBytes);
  const keyId = Array.from(seedHashBytes.slice(0, 8)).map((b) => b.toString(16).padStart(2, '0')).join('');

  if (cachedKeys && cachedKeys.seedHash === seedHash) {
    return { ...cachedKeys, keyId };
  }

  const pkcs8 = new Uint8Array(ED25519_PKCS8_PREFIX.length + 32);
  pkcs8.set(ED25519_PKCS8_PREFIX, 0);
  pkcs8.set(seed, ED25519_PKCS8_PREFIX.length);
  const ed25519Key = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, true, ['sign']);
  const jwk = await crypto.subtle.exportKey('jwk', ed25519Key);
  if (!jwk.x) throw new Error('Ed25519 JWK export missing public key (x)');
  const ed25519PublicKey = base64UrlToBytes(jwk.x);

  const mlDsaSeed = await deriveHkdfSeed(env, 'rmpg-pdf-ml-dsa87-v1', 32);
  const { publicKey: mlDsaPublicKey, secretKey: mlDsaSecretKey } = ml_dsa87.keygen(mlDsaSeed);

  const slhDsaSeed = await deriveHkdfSeed(env, 'rmpg-pdf-slh-dsa-256f-v1', 96);
  const { publicKey: slhDsaPublicKey, secretKey: slhDsaSecretKey } = slh_dsa_sha2_256f.keygen(slhDsaSeed);

  cachedKeys = { seedHash, ed25519Key, ed25519PublicKey, mlDsaPublicKey, mlDsaSecretKey, slhDsaPublicKey, slhDsaSecretKey };
  return { ...cachedKeys, keyId };
}
```

Delete the old `CachedEd25519Key` interface and `cachedEd25519` variable (replaced above). Update `signTriple()`'s destructuring to match the renamed field (`key` → `ed25519Key`):

```ts
export async function signTriple(
  env: Bindings, formKey: string, caseNumber: string, payloadHash: string,
): Promise<{ signature: string; signedAt: string; algorithm: 'Ed25519'; keyId: string }> {
  const { ed25519Key, keyId } = await getSigningKeys(env);
  const message = new TextEncoder().encode(`${formKey}|${caseNumber}|${payloadHash}`);
  const sigBuf = await crypto.subtle.sign('Ed25519', ed25519Key, message);
  return { signature: bytesToBase64(new Uint8Array(sigBuf)), signedAt: new Date().toISOString(), algorithm: 'Ed25519', keyId }; // new-date-ok
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/pdfSign.test.ts`
Expected: PASS (all tests from Tasks 1–4).

- [ ] **Step 5: Commit**

```bash
git add src/utils/pdfSign.ts tests/pdfSign.test.ts
git commit -m "feat(pdf-sign): derive and cache ML-DSA-87 + SLH-DSA-256f keypairs"
```

---

### Task 5: Rewrite `signTriple()` to produce all three signatures

**Files:**
- Modify: `src/utils/pdfSign.ts`
- Test: `tests/pdfSign.test.ts`

**Interfaces:**
- Produces: the final public API of this file —
  ```ts
  export interface AlgorithmSignature { signature: string; publicKey: string }
  export interface PdfSignTripleResult {
    signedAt: string;
    keyId: string;
    ed25519: AlgorithmSignature;
    mlDsa87: AlgorithmSignature;
    slhDsa256f: AlgorithmSignature;
  }
  export async function signTriple(env: Bindings, formKey: string, caseNumber: string, payloadHash: string): Promise<PdfSignTripleResult>
  ```
  This is what Task 6 (`pdfTools.ts`) imports and calls.
- Removes: `deriveHkdfSeedForTest` and `getPdfSigningKeyForTest` (Task 2/3's test-only exports) — this task's tests exercise the same behavior through the real public API, so the temporary exports are no longer needed.

- [ ] **Step 1: Write the failing test**

Add to `tests/pdfSign.test.ts`:

```ts
import { signTriple } from '../src/utils/pdfSign';

describe('signTriple', () => {
  const env = { JWT_SECRET: 'test-jwt-secret-value' } as unknown as Bindings;

  it('produces three independently-verifiable signatures over the same message', async () => {
    const result = await signTriple(env, 'incident', 'INC-26-001234', 'a'.repeat(64));
    const message = new TextEncoder().encode('incident|INC-26-001234|' + 'a'.repeat(64));

    // Ed25519
    const ed25519Pub = await crypto.subtle.importKey(
      'raw', Uint8Array.from(atob(result.ed25519.publicKey), (c) => c.charCodeAt(0)),
      { name: 'Ed25519' }, false, ['verify'],
    );
    const ed25519Sig = Uint8Array.from(atob(result.ed25519.signature), (c) => c.charCodeAt(0));
    expect(await crypto.subtle.verify('Ed25519', ed25519Pub, ed25519Sig, message)).toBe(true);

    // ML-DSA-87
    const mlPub = Uint8Array.from(atob(result.mlDsa87.publicKey), (c) => c.charCodeAt(0));
    const mlSig = Uint8Array.from(atob(result.mlDsa87.signature), (c) => c.charCodeAt(0));
    expect(ml_dsa87.verify(mlSig, message, mlPub)).toBe(true);

    // SLH-DSA-256f
    const slhPub = Uint8Array.from(atob(result.slhDsa256f.publicKey), (c) => c.charCodeAt(0));
    const slhSig = Uint8Array.from(atob(result.slhDsa256f.signature), (c) => c.charCodeAt(0));
    expect(slh_dsa_sha2_256f.verify(slhSig, message, slhPub)).toBe(true);

    expect(result.keyId).toMatch(/^[0-9a-f]{16}$/);
    expect(new Date(result.signedAt).toISOString()).toBe(result.signedAt);
  });

  it('tampering with any input field invalidates all three signatures', async () => {
    const result = await signTriple(env, 'incident', 'INC-26-001234', 'a'.repeat(64));
    const tamperedMessage = new TextEncoder().encode('incident|INC-26-001234|' + 'b'.repeat(64));

    const ed25519Pub = await crypto.subtle.importKey(
      'raw', Uint8Array.from(atob(result.ed25519.publicKey), (c) => c.charCodeAt(0)),
      { name: 'Ed25519' }, false, ['verify'],
    );
    const ed25519Sig = Uint8Array.from(atob(result.ed25519.signature), (c) => c.charCodeAt(0));
    expect(await crypto.subtle.verify('Ed25519', ed25519Pub, ed25519Sig, tamperedMessage)).toBe(false);

    const mlPub = Uint8Array.from(atob(result.mlDsa87.publicKey), (c) => c.charCodeAt(0));
    const mlSig = Uint8Array.from(atob(result.mlDsa87.signature), (c) => c.charCodeAt(0));
    expect(ml_dsa87.verify(mlSig, tamperedMessage, mlPub)).toBe(false);

    const slhPub = Uint8Array.from(atob(result.slhDsa256f.publicKey), (c) => c.charCodeAt(0));
    const slhSig = Uint8Array.from(atob(result.slhDsa256f.signature), (c) => c.charCodeAt(0));
    expect(slh_dsa_sha2_256f.verify(slhSig, tamperedMessage, slhPub)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pdfSign.test.ts`
Expected: FAIL — `result.mlDsa87` / `result.slhDsa256f` are `undefined` (current `signTriple` is still Ed25519-only).

- [ ] **Step 3: Implement**

Replace `signTriple()` in `src/utils/pdfSign.ts` with:

```ts
export interface AlgorithmSignature {
  /** Base64 signature. */
  signature: string;
  /** Base64 raw public key — required for offline verification. */
  publicKey: string;
}

/** Triple-algorithm signature bundle: Ed25519 (classical), ML-DSA-87
 *  (FIPS 204, CNSA 2.0 lattice-based PQC), and SLH-DSA-SHA2-256f (FIPS
 *  205, CNSA 2.0 hash-based PQC). All three sign the identical message
 *  so a cryptanalytic break in any one algorithm family alone doesn't
 *  compromise document authenticity. */
export interface PdfSignTripleResult {
  signedAt: string;
  keyId: string;
  ed25519: AlgorithmSignature;
  mlDsa87: AlgorithmSignature;
  slhDsa256f: AlgorithmSignature;
}

/** Sign a (formKey | caseNumber | payloadHash) triple with all three
 *  algorithms. Identical message format to the pre-PQC version, so
 *  Ed25519 signatures issued before this change remain verifiable
 *  against the same deterministically-derived key. */
export async function signTriple(
  env: Bindings, formKey: string, caseNumber: string, payloadHash: string,
): Promise<PdfSignTripleResult> {
  const keys = await getSigningKeys(env);
  const message = new TextEncoder().encode(`${formKey}|${caseNumber}|${payloadHash}`);

  const ed25519SigBuf = await crypto.subtle.sign('Ed25519', keys.ed25519Key, message);
  const mlDsaSig = ml_dsa87.sign(message, keys.mlDsaSecretKey);
  const slhDsaSig = slh_dsa_sha2_256f.sign(message, keys.slhDsaSecretKey);

  return {
    signedAt: new Date().toISOString(), // new-date-ok
    keyId: keys.keyId,
    ed25519: { signature: bytesToBase64(new Uint8Array(ed25519SigBuf)), publicKey: bytesToBase64(keys.ed25519PublicKey) },
    mlDsa87: { signature: bytesToBase64(mlDsaSig), publicKey: bytesToBase64(keys.mlDsaPublicKey) },
    slhDsa256f: { signature: bytesToBase64(slhDsaSig), publicKey: bytesToBase64(keys.slhDsaPublicKey) },
  };
}
```

Remove the two test-only exports (`deriveHkdfSeedForTest`, `getPdfSigningKeyForTest`) — delete these two lines:

```ts
export const deriveHkdfSeedForTest = deriveHkdfSeed;
```
```ts
export const getPdfSigningKeyForTest = getSigningKeys;
```

In `tests/pdfSign.test.ts`, remove the `deriveHkdfSeedForTest` and `getPdfSigningKeyForTest` describe blocks from Tasks 2–4 (their behavior is now covered by this task's `signTriple` tests plus the golden-value regression test — but **keep the golden-value test**, just rewrite it to call `signTriple` and check `result.keyId` instead of the removed test-only function):

```ts
describe('signTriple — backward compat', () => {
  it('BACKWARD COMPAT: keyId for a known JWT_SECRET matches the pre-PQC value', async () => {
    const result = await signTriple({ JWT_SECRET: 'golden-test-secret-do-not-change' } as unknown as Bindings, 'x', 'y', 'a'.repeat(64));
    expect(result.keyId).toBe('867c4da05488c3a2');
  });
});
```
(Same golden value as Task 3 Step 1 — it must not change; `keyId`'s derivation only touches the Ed25519 seed, which this plan never modifies.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/pdfSign.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/pdfSign.ts tests/pdfSign.test.ts
git commit -m "feat(pdf-sign): signTriple() returns Ed25519 + ML-DSA-87 + SLH-DSA-256f"
```

---

### Task 6: Update `/sign-payload` route to delegate to `signTriple()`

**Files:**
- Modify: `src/routes/pdfTools.ts`

**Interfaces:**
- Consumes: `signTriple` from Task 5.
- Produces: `POST /api/pdf-tools/sign-payload` response shape:
  ```json
  {
    "signedAt": "...", "keyId": "...",
    "ed25519": { "signature": "...", "publicKey": "..." },
    "mlDsa87": { "signature": "...", "publicKey": "..." },
    "slhDsa256f": { "signature": "...", "publicKey": "..." },
    "formKey": "...", "caseNumber": "...", "payloadHash": "..."
  }
  ```
  This is the exact shape Task 7 (`pdfIntegrity.ts`) parses.

- [ ] **Step 1: Implement**

In `src/routes/pdfTools.ts`, replace the import line:

```ts
import { getPdfSigningKey, bytesToBase64 } from '../utils/pdfSign';
```

with:

```ts
import { signTriple } from '../utils/pdfSign';
```

Replace the entire `/sign-payload` route handler body (keep the same validation logic, replace only the signing block and response):

```ts
pdfTools.post('/sign-payload', async (c) => {
  try {
    const body = await c.req.json<{ formKey?: string; caseNumber?: string; payloadHash?: string }>();
    const formKey = typeof body.formKey === 'string' ? body.formKey.trim() : '';
    const caseNumber = typeof body.caseNumber === 'string' ? body.caseNumber.trim() : '';
    const payloadHash = typeof body.payloadHash === 'string' ? body.payloadHash.trim().toLowerCase() : '';

    if (!formKey || !payloadHash) {
      return c.json({ error: 'formKey and payloadHash are required' }, 400);
    }
    if (!/^[0-9a-f]{64}$/.test(payloadHash)) {
      return c.json({ error: 'payloadHash must be a 64-char lowercase SHA-256 hex string' }, 400);
    }

    const signed = await signTriple(c.env, formKey, caseNumber, payloadHash);

    return c.json({
      ...signed,
      formKey,
      caseNumber: caseNumber || '',
      payloadHash,
    });
  } catch (err) {
    return dbErrorResponse(c, err, 'Signing failed');
  }
});
```

Update the comment block directly above the route (currently describes the old `algorithm:'Ed25519'` shape) to:

```ts
// POST /api/pdf-tools/sign-payload — signs a (formKey, caseNumber, payloadHash)
// triple with THREE algorithms (Ed25519 + ML-DSA-87 + SLH-DSA-256f — see
// src/utils/pdfSign.ts) so a generated PDF can be later verified offline
// (court/exhibit chain-of-custody) even against a future quantum computer.
// Always signs (key derives from PDF_SIGNING_KEY when provisioned, else
// stably from JWT_SECRET — no secret-provisioning step required). Returns
// { signedAt, keyId, ed25519, mlDsa87, slhDsa256f, formKey, caseNumber,
// payloadHash } — the shape client/src/utils/pdfIntegrity.ts expects.
```

- [ ] **Step 2: Verify the Worker typechecks**

Run: `npm run typecheck`
Expected: PASS — this resolves the expected failure noted at the end of Task 3.

- [ ] **Step 3: Run the full Worker test suite**

Run: `npm test`
Expected: PASS (all existing tests, plus `tests/pdfSign.test.ts`).

- [ ] **Step 4: Commit**

```bash
git add src/routes/pdfTools.ts
git commit -m "feat(pdf-tools): /sign-payload delegates to signTriple(), returns all 3 algorithms"
```

---

### Task 7: Update client `pdfIntegrity.ts`

**Files:**
- Modify: `client/src/utils/pdfIntegrity.ts`
- Modify: `client/src/utils/__tests__/pdfIntegrity.test.ts`

**Interfaces:**
- Produces: `PdfSignatureBundle` — the type Task 8 and 9's files import.

- [ ] **Step 1: Update the failing tests first**

In `client/src/utils/__tests__/pdfIntegrity.test.ts`, replace the `'signature round-trips'` test inside `describe('active state setters', ...)`:

```ts
  it('signature round-trips', () => {
    const bundle = {
      signedAt: '2026-04-01T00:00:00Z',
      keyId: 'abcd1234',
      ed25519: { signature: 'edSigB64', publicKey: 'edPubB64' },
      mlDsa87: { signature: 'mlSigB64', publicKey: 'mlPubB64' },
      slhDsa256f: { signature: 'slhSigB64', publicKey: 'slhPubB64' },
    };
    setActiveSignature(bundle);
    expect(getActiveSignature()).toEqual(bundle);
    clearActiveSignature();
    expect(getActiveSignature()).toBeUndefined();
  });
```

Replace the two tests inside `describe('fetchPdfSignature', ...)` that reference the flat shape:

```ts
  it('parses a 200 response into a PdfSignatureBundle', async () => {
    const serverBody = {
      signedAt: '2026-04-01T00:00:00Z',
      keyId: 'abcd1234',
      ed25519: { signature: 'edSigB64', publicKey: 'edPubB64' },
      mlDsa87: { signature: 'mlSigB64', publicKey: 'mlPubB64' },
      slhDsa256f: { signature: 'slhSigB64', publicKey: 'slhPubB64' },
      formKey: 'incident', caseNumber: 'INC-1', payloadHash: 'a'.repeat(64),
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify(serverBody),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));
    const result = await fetchPdfSignature('incident', 'INC-1', 'a'.repeat(64));
    expect(result).toEqual({
      signedAt: serverBody.signedAt,
      keyId: serverBody.keyId,
      ed25519: serverBody.ed25519,
      mlDsa87: serverBody.mlDsa87,
      slhDsa256f: serverBody.slhDsa256f,
    });
  });

  it('returns null when 200 response is missing the ed25519 signature field', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ unrelated: 'shape' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));
    const result = await fetchPdfSignature('incident', 'INC-1', 'a'.repeat(64));
    expect(result).toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/utils/__tests__/pdfIntegrity.test.ts`
Expected: FAIL — `PdfSignatureBundle` doesn't have `ed25519`/`mlDsa87`/`slhDsa256f` fields yet.

- [ ] **Step 3: Implement**

In `client/src/utils/pdfIntegrity.ts`, replace the `PdfSignatureBundle` interface and `fetchPdfSignature` function:

```ts
export interface AlgorithmSignature {
  /** Base64 signature. */
  signature: string;
  /** Base64 raw public key — printed/embedded for offline verification. */
  publicKey: string;
}

/** Triple-algorithm signature bundle — Ed25519 (classical), ML-DSA-87
 *  (FIPS 204, CNSA 2.0 lattice-based PQC), and SLH-DSA-SHA2-256f (FIPS
 *  205, CNSA 2.0 hash-based PQC). All three sign the same message so a
 *  cryptanalytic break in any one algorithm family doesn't compromise
 *  document authenticity. */
export interface PdfSignatureBundle {
  signedAt: string;
  keyId: string;
  ed25519: AlgorithmSignature;
  mlDsa87: AlgorithmSignature;
  slhDsa256f: AlgorithmSignature;
}

let activeSignature: PdfSignatureBundle | undefined;

export function setActiveSignature(sig: PdfSignatureBundle | undefined): void {
  activeSignature = sig;
}
export function getActiveSignature(): PdfSignatureBundle | undefined {
  return activeSignature;
}
export function clearActiveSignature(): void {
  activeSignature = undefined;
}

/**
 * Fetch the triple-algorithm signature bundle from the server for the
 * current payload hash. Returns null on graceful failures (server has
 * no keypair configured, network error, non-200 response, or a
 * malformed body) so callers can continue rendering an UNSIGNED
 * trailer instead of failing the whole PDF generation.
 */
export async function fetchPdfSignature(
  formKey: string,
  caseNumber: string,
  payloadHash: string,
): Promise<PdfSignatureBundle | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch('/api/pdf-tools/sign-payload', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(getAuthHeader() ? { Authorization: getAuthHeader() } : {}),
      },
      body: JSON.stringify({ formKey, caseNumber, payloadHash }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || typeof json.ed25519?.signature !== 'string') return null;
    return {
      signedAt: json.signedAt,
      keyId: json.keyId,
      ed25519: json.ed25519,
      mlDsa87: json.mlDsa87,
      slhDsa256f: json.slhDsa256f,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
```

(Leave `getAuthHeader`, `formatSignatureGrouped`, `formatHashGrouped`, and everything else in the file unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run src/utils/__tests__/pdfIntegrity.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/pdfIntegrity.ts client/src/utils/__tests__/pdfIntegrity.test.ts
git commit -m "feat(pdf-integrity): PdfSignatureBundle carries all 3 algorithms"
```

---

### Task 8: Update `sidecar.ts`'s `SidecarSignature` type

**Files:**
- Modify: `client/src/utils/pdf/v2/engine/sidecar.ts`

**Interfaces:**
- Consumes: nothing new (pure type change).
- Produces: `SidecarSignature` — the type Task 9 constructs and embeds into the PDF's Info-dict Keywords + post-EOF marker (the mechanism that makes the full ~50KB of PQC signature data part of the offline-verifiable artifact, since it's far too large to print as visible page text — see Task 10).

- [ ] **Step 1: Implement**

In `client/src/utils/pdf/v2/engine/sidecar.ts`, replace the `SidecarSignature` interface:

```ts
export interface SidecarSignature {
  ed25519: { signature: string; publicKey: string };
  mlDsa87: { signature: string; publicKey: string };
  slhDsa256f: { signature: string; publicKey: string };
  signedAt: string;
  payloadHash: string;
}
```

No other change needed in this file — `SidecarPayload`, `canonicalize`, `embedSidecar`, `extractSidecarFromBytes`, etc. are all generic over `unknown`/the payload shape and don't destructure `SidecarSignature`'s fields directly.

- [ ] **Step 2: Run existing sidecar tests to confirm nothing broke**

Run: `cd client && npx vitest run "src/utils/pdf/v2/engine/__tests__/sidecar.test.ts" "src/utils/pdf/v2/engine/__tests__/multiCopy.sidecar.test.ts"`
Expected: PASS (these tests don't construct `SidecarSignature` directly, so this is a type-only change with no behavior impact).

- [ ] **Step 3: Commit**

```bash
git add client/src/utils/pdf/v2/engine/sidecar.ts
git commit -m "feat(sidecar): SidecarSignature carries all 3 algorithms"
```

---

### Task 9: Update `v2DispatchAdapter.ts`

**Files:**
- Modify: `client/src/utils/pdf/v2DispatchAdapter.ts`

**Interfaces:**
- Consumes: `PdfSignatureBundle` (Task 7), `SidecarSignature` (Task 8).

- [ ] **Step 1: Implement**

In `client/src/utils/pdf/v2DispatchAdapter.ts`, replace the local `SignPayloadResponse` interface:

```ts
import type { PdfSignatureBundle } from '../pdfIntegrity';
```

(add this import near the top of the file, with the other imports) and delete:

```ts
interface SignPayloadResponse {
  algorithm: 'Ed25519';
  signature: string;
  publicKey: string;
  signedAt: string;
}
```

Update `signPayload()`'s return type from `Promise<SignPayloadResponse | null>` to `Promise<PdfSignatureBundle | null>` (the function body's `isolatedFetch<SignPayloadResponse>(...)` call becomes `isolatedFetch<PdfSignatureBundle>(...)`).

Update `prepareCitationDispatch()`'s `sidecarOptions` construction:

```ts
  const signResp = caseNumber ? await signPayload('citation', caseNumber, hash) : null;
  const sidecarOptions = {
    schemaId: 'citation',
    caseNumber,
    signature: signResp
      ? {
          ed25519: signResp.ed25519,
          mlDsa87: signResp.mlDsa87,
          slhDsa256f: signResp.slhDsa256f,
          signedAt: signResp.signedAt,
          payloadHash: hash,
        }
      : undefined,
  };
```

- [ ] **Step 2: Verify the client typechecks**

Run: `cd client && npx tsc --noEmit`
Expected: PASS (or the same pre-existing error count noted in CLAUDE.md's session log — no NEW errors from this file).

- [ ] **Step 3: Commit**

```bash
git add client/src/utils/pdf/v2DispatchAdapter.ts
git commit -m "feat(v2-dispatch): use shared PdfSignatureBundle type for sign-payload response"
```

---

### Task 10: Update the dormant `addDocumentIntegrityTrailer()`

**Files:**
- Modify: `client/src/utils/pdfGenerator.ts`

**Interfaces:**
- Consumes: `PdfSignatureBundle` (Task 7).

This function has **zero call sites today** (the trailer page was disabled 2026-05-04 per user request — do not reactivate it as part of this task, that would override a separate past decision). It still must compile against the new type since `client-typecheck` is a CI gate.

- [ ] **Step 1: Implement**

In `client/src/utils/pdfGenerator.ts`, replace the signature-rendering block inside `addDocumentIntegrityTrailer()` (the `if (sig) { ... }` block that currently reads `sig.signature` / `sig.publicKey`):

```ts
  const sig = getActiveSignature();
  if (sig) {
    // Ed25519 — 88 base64 chars, short enough to print in full, grouped.
    doc.setFont('courier', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    for (const line of formatSignatureGrouped(sig.ed25519.signature)) {
      doc.text(line, labelX, y);
      y += 3.2;
    }
    y += 1;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.5);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    doc.text('SIGNED AT', labelX, y);
    doc.text('PUB KEY (PREFIX)', labelX + 38, y);
    y += 2.6;
    doc.setFont(PDF_VALUE_FONT, 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    doc.text(sanitizePdfText(sig.signedAt), labelX, y);
    doc.text((sig.ed25519.publicKey || '').slice(0, 16) + '…', labelX + 38, y);
    y += 5;

    // ML-DSA-87 (4.6KB) / SLH-DSA-256f (49.9KB) signatures are far too
    // large to print in full on a page — only a short fingerprint is
    // shown here. The complete post-quantum signatures travel inside
    // the PDF's embedded sidecar (engine/sidecar.ts, Keywords + post-EOF
    // marker) for machine verification, not human transcription.
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    doc.text('ML-DSA-87 / SLH-DSA-256F (POST-QUANTUM)', labelX, y);
    y += 3;
    doc.setFont('courier', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    doc.text(`ML-DSA-87  ${(sig.mlDsa87.signature || '').slice(0, 24)}…`, labelX, y);
    y += 2.8;
    doc.text(`SLH-DSA    ${(sig.slhDsa256f.signature || '').slice(0, 24)}…`, labelX, y);
    y += 2.8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5);
    doc.setTextColor(...COLOR.TEXT_TERTIARY);
    doc.text('Full post-quantum signatures embedded in PDF sidecar metadata.', labelX, y);
    y += 4;
  } else {
```

(The `} else { ... }` UNSIGNED-placeholder branch below is unchanged — leave it as-is.)

- [ ] **Step 2: Verify the client typechecks**

Run: `cd client && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add client/src/utils/pdfGenerator.ts
git commit -m "fix(pdf-generator): update dormant trailer renderer for triple-algorithm bundle"
```

---

### Task 11: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Worker typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 2: Worker test suite**

Run: `npm test`
Expected: PASS, including all `tests/pdfSign.test.ts` cases.

- [ ] **Step 3: Client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: PASS (or unchanged pre-existing error count — no new errors introduced by this plan's files).

- [ ] **Step 4: Client test suite**

Run: `cd client && npx vitest run`
Expected: PASS, including the updated `pdfIntegrity.test.ts` and unchanged `sidecar.test.ts`/`multiCopy.sidecar.test.ts`.

- [ ] **Step 5: Client build**

Run: `cd client && npx vite build`
Expected: PASS — confirms the new `@noble/post-quantum`-adjacent type changes don't break the production bundle (the library itself is Worker-only, never imported client-side; the client only ever sees base64 strings).

- [ ] **Step 6: Confirm no other consumer was missed**

Run: `grep -rn "\.publicKey\b\|\.signature\b\|algorithm.*Ed25519" client/src --include="*.ts" --include="*.tsx" | grep -v __tests__ | grep -v node_modules`

Expected: every match is inside a file already touched by Tasks 7–10 (`pdfIntegrity.ts`, `sidecar.ts`, `v2DispatchAdapter.ts`, `pdfGenerator.ts`), or is unrelated to PDF signing (e.g. an unrelated `.signature` field on a different type). If a new, unhandled consumer turns up, add a task to update it before merging.
