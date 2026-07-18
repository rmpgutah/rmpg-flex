# QRNG Entropy Augmentation CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `scripts/generate-quantum-key.mjs`, a standalone local CLI tool that mixes local
CSPRNG bytes with quantum-sourced randomness (ANU QRNG) via HKDF, for use when provisioning or
rotating a long-lived RMPG secret (`PDF_SIGNING_KEY`, `CPG_ENC_KEY`, `EMAIL_CRED_KEY`, etc.).

**Architecture:** Five small, independently-testable pure/near-pure functions
(`parseQrngResponse`, `fetchQrngBytes`, `combineEntropy`, `generateQuantumKey`, `runCli`) compose
into one CLI entrypoint. All I/O (network, stdout/stderr, process exit) is pushed to the edges —
`runCli` returns a plain `{ exitCode, stdout, stderr }` object instead of touching `process`
directly, so it's testable by calling it and inspecting the return value, with no subprocess
spawning or console/process mocking required.

**Tech Stack:** Plain Node.js (`node:crypto`'s `randomBytes` + `webcrypto`), global `fetch` (Node
18+, no new dependency). Runs via `node scripts/generate-quantum-key.mjs <byteLength>` — no
Worker/repo runtime involvement.

## Global Constraints

- **No Worker runtime code, no live-request-path dependency.** This entire feature is a local,
  offline, operator-run tool. Nothing in this plan touches `src/`, `wrangler.toml`, or any
  deployed surface.
- **Fails open, never closed.** If the QRNG fetch fails for any reason, fall back to local-CSPRNG
  bytes alone (via HKDF with an empty salt) and warn on stderr — never block, never error out,
  never produce a weaker-than-local-CSPRNG-alone result.
- **stdout carries ONLY the base64 key.** All human-readable output (usage errors, provenance,
  warnings) goes to stderr, so the script is safely pipeable:
  `node scripts/generate-quantum-key.mjs 32 | wrangler secret put PDF_SIGNING_KEY`.
- **No new API key, no new npm dependency.** ANU QRNG's free unauthenticated endpoint
  (`https://qrng.anu.edu.au/API/jsonI.php`) is sufficient; `node:crypto`/`fetch` are Node builtins.
- **No two-person integrity mode, no named-secret presets** — explicitly out of scope per the
  design doc (`docs/superpowers/specs/2026-07-18-qrng-entropy-augmentation-design.md`).
- HKDF combiner: `crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: <qrngBytes or
  empty>, info: 'rmpg-quantum-key-v1' }, <localBytes as HKDF key>, byteLength * 8)` — this ONE
  `deriveBits` call performs the full RFC 5869 Extract-then-Expand; there is no separate
  extract/expand step to implement.

---

## File Map

| File | Change |
|---|---|
| `vitest.config.ts` | Add `'scripts/**/*.test.mjs'` to the `include` array |
| `scripts/generate-quantum-key.mjs` | New — the CLI tool |
| `scripts/generate-quantum-key.test.mjs` | New — tests |

---

### Task 1: Scaffold + `parseQrngResponse`

**Files:**
- Modify: `vitest.config.ts`
- Create: `scripts/generate-quantum-key.mjs` (file header + this function only)
- Create: `scripts/generate-quantum-key.test.mjs`

**Interfaces:**
- Produces: `export function parseQrngResponse(json, expectedLength)` → `Uint8Array | null`.
  Validates the ANU QRNG response shape: `{ success: true, data: number[], length, type }`.
  Returns `null` on `success !== true`, non-array `data`, wrong-length `data`, or any element
  outside `0..255`.

- [ ] **Step 1: Wire the test file into the Worker test suite**

Edit `vitest.config.ts` — change:

```ts
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'client', 'legacy'],
    environment: 'node',
  },
});
```

to:

```ts
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'scripts/**/*.test.mjs'],
    exclude: ['node_modules', 'client', 'legacy'],
    environment: 'node',
  },
});
```

- [ ] **Step 2: Write the failing test**

Create `scripts/generate-quantum-key.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { parseQrngResponse } from './generate-quantum-key.mjs';

describe('parseQrngResponse', () => {
  it('parses a valid response into a Uint8Array of the expected length', () => {
    const json = { success: true, data: [1, 2, 3, 4], length: 4, type: 'uint8' };
    const result = parseQrngResponse(json, 4);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(Array.from(result)).toEqual([1, 2, 3, 4]);
  });

  it('returns null when success is false', () => {
    const json = { success: false, data: [1, 2, 3, 4] };
    expect(parseQrngResponse(json, 4)).toBeNull();
  });

  it('returns null when data is missing', () => {
    expect(parseQrngResponse({ success: true }, 4)).toBeNull();
  });

  it('returns null when data length does not match expectedLength', () => {
    const json = { success: true, data: [1, 2, 3], length: 3, type: 'uint8' };
    expect(parseQrngResponse(json, 4)).toBeNull();
  });

  it('returns null when data contains an out-of-range value', () => {
    const json = { success: true, data: [1, 2, 3, 999], length: 4, type: 'uint8' };
    expect(parseQrngResponse(json, 4)).toBeNull();
  });

  it('returns null for null/undefined input', () => {
    expect(parseQrngResponse(null, 4)).toBeNull();
    expect(parseQrngResponse(undefined, 4)).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run scripts/generate-quantum-key.test.mjs`
Expected: FAIL — `generate-quantum-key.mjs` does not exist yet.

- [ ] **Step 4: Implement**

Create `scripts/generate-quantum-key.mjs`:

```js
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run scripts/generate-quantum-key.test.mjs`
Expected: PASS (all 6 tests).

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts scripts/generate-quantum-key.mjs scripts/generate-quantum-key.test.mjs
git commit -m "feat(scripts): scaffold generate-quantum-key.mjs, add parseQrngResponse"
```

---

### Task 2: `fetchQrngBytes`

**Files:**
- Modify: `scripts/generate-quantum-key.mjs`
- Modify: `scripts/generate-quantum-key.test.mjs`

**Interfaces:**
- Consumes: `parseQrngResponse` (Task 1).
- Produces: `export async function fetchQrngBytes(byteLength)` → `Promise<Uint8Array | null>`.
  Fetches `byteLength` random bytes from ANU QRNG with a 5s timeout. Returns `null` (never
  throws) on any network error, timeout, non-OK response, or malformed body.

- [ ] **Step 1: Write the failing tests**

Add to `scripts/generate-quantum-key.test.mjs`:

```js
import { fetchQrngBytes } from './generate-quantum-key.mjs';
import { vi, beforeEach, afterEach } from 'vitest';

describe('fetchQrngBytes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns bytes on a successful response', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      expect(url).toContain('length=4');
      expect(url).toContain('type=uint8');
      return new Response(JSON.stringify({ success: true, data: [10, 20, 30, 40], length: 4, type: 'uint8' }), { status: 200 });
    }));
    const result = await fetchQrngBytes(4);
    expect(Array.from(result)).toEqual([10, 20, 30, 40]);
  });

  it('returns null on a non-OK HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429 })));
    expect(await fetchQrngBytes(4)).toBeNull();
  });

  it('returns null on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    expect(await fetchQrngBytes(4)).toBeNull();
  });

  it('returns null on malformed JSON body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })));
    expect(await fetchQrngBytes(4)).toBeNull();
  });

  it('returns null when the response has success: false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 200 })));
    expect(await fetchQrngBytes(4)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run scripts/generate-quantum-key.test.mjs`
Expected: FAIL — `fetchQrngBytes` is not exported yet.

- [ ] **Step 3: Implement**

Add to `scripts/generate-quantum-key.mjs`, after `parseQrngResponse`:

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run scripts/generate-quantum-key.test.mjs`
Expected: PASS (all 11 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-quantum-key.mjs scripts/generate-quantum-key.test.mjs
git commit -m "feat(scripts): add fetchQrngBytes with fail-open timeout handling"
```

---

### Task 3: `combineEntropy`

**Files:**
- Modify: `scripts/generate-quantum-key.mjs`
- Modify: `scripts/generate-quantum-key.test.mjs`

**Interfaces:**
- Produces: `export async function combineEntropy(localBytes, qrngBytes, byteLength)` →
  `Promise<Uint8Array>`. HKDF-combines the two byte sources (or falls back to local-only via an
  empty salt when `qrngBytes` is `null`). Output is `byteLength` bytes.

- [ ] **Step 1: Write the failing tests**

Add to `scripts/generate-quantum-key.test.mjs`:

```js
import { combineEntropy } from './generate-quantum-key.mjs';

describe('combineEntropy', () => {
  it('produces byteLength bytes', async () => {
    const local = new Uint8Array(32).fill(1);
    const qrng = new Uint8Array(32).fill(2);
    const result = await combineEntropy(local, qrng, 32);
    expect(result.length).toBe(32);
  });

  it('is deterministic for the same inputs', async () => {
    const local = new Uint8Array(32).fill(1);
    const qrng = new Uint8Array(32).fill(2);
    const a = await combineEntropy(local, qrng, 32);
    const b = await combineEntropy(local, qrng, 32);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('produces different output when qrngBytes is null (local-only fallback)', async () => {
    const local = new Uint8Array(32).fill(1);
    const qrng = new Uint8Array(32).fill(2);
    const withQrng = await combineEntropy(local, qrng, 32);
    const localOnly = await combineEntropy(local, null, 32);
    expect(Array.from(withQrng)).not.toEqual(Array.from(localOnly));
  });

  it('local-only fallback is itself deterministic', async () => {
    const local = new Uint8Array(32).fill(1);
    const a = await combineEntropy(local, null, 32);
    const b = await combineEntropy(local, null, 32);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('different local bytes produce different output', async () => {
    const qrng = new Uint8Array(32).fill(2);
    const a = await combineEntropy(new Uint8Array(32).fill(1), qrng, 32);
    const b = await combineEntropy(new Uint8Array(32).fill(9), qrng, 32);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('supports a 96-byte output (SLH-DSA seed length)', async () => {
    const local = new Uint8Array(96).fill(3);
    const qrng = new Uint8Array(96).fill(4);
    const result = await combineEntropy(local, qrng, 96);
    expect(result.length).toBe(96);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run scripts/generate-quantum-key.test.mjs`
Expected: FAIL — `combineEntropy` is not exported yet.

- [ ] **Step 3: Implement**

Add to `scripts/generate-quantum-key.mjs`, after `fetchQrngBytes`:

```js
import { webcrypto } from 'node:crypto';
const { subtle } = webcrypto;

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
```

(Add the `import { webcrypto } from 'node:crypto';` line at the top of the file, with the other
top-level code — not inside the function.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run scripts/generate-quantum-key.test.mjs`
Expected: PASS (all 17 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-quantum-key.mjs scripts/generate-quantum-key.test.mjs
git commit -m "feat(scripts): add combineEntropy (HKDF, RFC 5869)"
```

---

### Task 4: `generateQuantumKey`

**Files:**
- Modify: `scripts/generate-quantum-key.mjs`
- Modify: `scripts/generate-quantum-key.test.mjs`

**Interfaces:**
- Consumes: `fetchQrngBytes` (Task 2), `combineEntropy` (Task 3).
- Produces: `export async function generateQuantumKey(byteLength)` →
  `Promise<{ combined: Uint8Array, qrngUsed: boolean }>`. Draws local CSPRNG bytes, attempts the
  QRNG fetch, combines, and reports whether the QRNG mix succeeded.

- [ ] **Step 1: Write the failing tests**

Add to `scripts/generate-quantum-key.test.mjs`:

```js
import { generateQuantumKey } from './generate-quantum-key.mjs';

describe('generateQuantumKey', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports qrngUsed: true and returns byteLength bytes on QRNG success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ success: true, data: Array.from({ length: 32 }, (_, i) => i), length: 32, type: 'uint8' }),
      { status: 200 },
    )));
    const { combined, qrngUsed } = await generateQuantumKey(32);
    expect(qrngUsed).toBe(true);
    expect(combined.length).toBe(32);
  });

  it('reports qrngUsed: false and still returns byteLength bytes on QRNG failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const { combined, qrngUsed } = await generateQuantumKey(32);
    expect(qrngUsed).toBe(false);
    expect(combined.length).toBe(32);
  });

  it('produces different output across two calls even with the same QRNG response (local bytes differ each time)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ success: true, data: Array.from({ length: 32 }, (_, i) => i), length: 32, type: 'uint8' }),
      { status: 200 },
    )));
    const a = await generateQuantumKey(32);
    const b = await generateQuantumKey(32);
    expect(Array.from(a.combined)).not.toEqual(Array.from(b.combined));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run scripts/generate-quantum-key.test.mjs`
Expected: FAIL — `generateQuantumKey` is not exported yet.

- [ ] **Step 3: Implement**

Add to `scripts/generate-quantum-key.mjs`, after `combineEntropy`:

```js
import { randomBytes } from 'node:crypto';

/** Draw local CSPRNG bytes, attempt the QRNG mix, and return the final
 *  key plus whether the QRNG source was actually used. */
export async function generateQuantumKey(byteLength) {
  const localBytes = new Uint8Array(randomBytes(byteLength));
  const qrngBytes = await fetchQrngBytes(byteLength);
  const combined = await combineEntropy(localBytes, qrngBytes, byteLength);
  return { combined, qrngUsed: qrngBytes !== null };
}
```

(Add `randomBytes` to the existing `import { webcrypto } from 'node:crypto';` line from Task 3,
making it `import { randomBytes, webcrypto } from 'node:crypto';`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run scripts/generate-quantum-key.test.mjs`
Expected: PASS (all 20 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-quantum-key.mjs scripts/generate-quantum-key.test.mjs
git commit -m "feat(scripts): add generateQuantumKey (local + QRNG orchestration)"
```

---

### Task 5: `runCli` + CLI entrypoint

**Files:**
- Modify: `scripts/generate-quantum-key.mjs`
- Modify: `scripts/generate-quantum-key.test.mjs`

**Interfaces:**
- Consumes: `generateQuantumKey` (Task 4).
- Produces: `export async function runCli(argv)` →
  `Promise<{ exitCode: number, stdout: string, stderr: string }>`. Argument parsing, usage
  errors, and the final stdout/stderr shape — all I/O-free so it's directly testable.

- [ ] **Step 1: Write the failing tests**

Add to `scripts/generate-quantum-key.test.mjs`:

```js
import { runCli } from './generate-quantum-key.mjs';

describe('runCli', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prints usage and exits 1 when byteLength is missing', async () => {
    const { exitCode, stdout, stderr } = await runCli([]);
    expect(exitCode).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('Usage:');
  });

  it('prints usage and exits 1 when byteLength is not a positive integer', async () => {
    expect((await runCli(['0'])).exitCode).toBe(1);
    expect((await runCli(['-5'])).exitCode).toBe(1);
    expect((await runCli(['abc'])).exitCode).toBe(1);
  });

  it('on QRNG success: stdout is a valid base64 string decoding to byteLength bytes, exit 0', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ success: true, data: Array.from({ length: 32 }, (_, i) => i), length: 32, type: 'uint8' }),
      { status: 200 },
    )));
    const { exitCode, stdout, stderr } = await runCli(['32']);
    expect(exitCode).toBe(0);
    const decoded = Buffer.from(stdout.trim(), 'base64');
    expect(decoded.length).toBe(32);
    expect(stderr).toContain('QRNG mix: yes');
  });

  it('on QRNG failure: falls back to local-only, still exits 0 with a valid key, warns on stderr', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const { exitCode, stdout, stderr } = await runCli(['32']);
    expect(exitCode).toBe(0);
    const decoded = Buffer.from(stdout.trim(), 'base64');
    expect(decoded.length).toBe(32);
    expect(stderr).toContain('QRNG unreachable');
    expect(stderr).toContain('QRNG mix: no');
  });

  it('stdout contains nothing but the base64 key and a trailing newline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const { stdout } = await runCli(['16']);
    expect(stdout).toMatch(/^[A-Za-z0-9+/=]+\n$/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run scripts/generate-quantum-key.test.mjs`
Expected: FAIL — `runCli` is not exported yet.

- [ ] **Step 3: Implement**

Add to `scripts/generate-quantum-key.mjs`, after `generateQuantumKey`, replacing nothing (this is
new code at the end of the file):

```js
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
    `[${new Date().toISOString()}] Generated ${byteLength}-byte key. `  // new-date-ok
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

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run scripts/generate-quantum-key.test.mjs`
Expected: PASS (all 25 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-quantum-key.mjs scripts/generate-quantum-key.test.mjs
git commit -m "feat(scripts): add runCli + CLI entrypoint for generate-quantum-key"
```

---

### Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full repo test suite**

Run: `npm test`
Expected: PASS, including all 25 `scripts/generate-quantum-key.test.mjs` cases picked up via the
Task 1 `vitest.config.ts` change.

- [ ] **Step 2: Manually run the real CLI against the live ANU QRNG endpoint**

Run: `node scripts/generate-quantum-key.mjs 32`
Expected: stderr shows a timestamped line ending in either `QRNG mix: yes.` (if the live endpoint
is reachable) or `QRNG mix: no (local-only fallback).` (if it's rate-limited/unreachable from this
environment — both are valid, expected outcomes per the fail-open design). stdout shows exactly
one line: a base64 string.

- [ ] **Step 3: Verify the output decodes to the right length**

Run:
```bash
node scripts/generate-quantum-key.mjs 32 2>/dev/null | base64 -d | wc -c
```
Expected: `32`

- [ ] **Step 4: Verify the usage error path**

Run: `node scripts/generate-quantum-key.mjs; echo "exit: $?"`
Expected: stderr shows the `Usage:` message, `exit: 1`.
