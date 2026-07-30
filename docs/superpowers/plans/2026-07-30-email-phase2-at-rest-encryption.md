# Email System — Phase 2 At-Rest Encryption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encrypt `email_messages.body_preview` and `email_scheduled.body`/`to_addresses`/`cc_addresses` at rest in D1, using a new envelope-encryption helper, with decrypt-tolerant reads so existing plaintext rows keep working with no backfill migration.

**Architecture:** One new pure crypto module (`src/utils/emailFieldCrypto.ts`, Web Crypto AES-GCM, envelope pattern mirroring `src/utils/encryptedR2.ts`) plus targeted encrypt-on-write / decrypt-on-read edits to 4 existing call sites in `src/routes/email.ts`. No new tables — the wrapped DEK and IVs are packed into the existing TEXT column's stored string. No migration required.

**Tech Stack:** Cloudflare Workers `crypto.subtle` (Web Crypto, no `node:*`), D1, Hono, Vitest.

## Global Constraints

- New secret: `EMAIL_FIELD_ENCRYPTION_KEK` — 32 bytes, base64-encoded, set via `wrangler secret put EMAIL_FIELD_ENCRYPTION_KEK` (production) / `.dev.vars` (local, gitignored). Distinct from `FILE_ENCRYPTION_KEK`.
- Fails CLOSED: a missing or malformed KEK must throw, never silently fall back to storing plaintext. This is the opposite posture from `src/utils/emailCrypto.ts` (which falls back to a `JWT_SECRET`-derived key) — match `src/utils/encryptedR2.ts`'s posture instead.
- Stored format: `v2:<base64 wrapped_dek>:<base64 dek_iv>:<base64 field_iv>:<base64 ciphertext>` (colon-delimited, 4 segments after the `v2:` tag).
- Decrypt-tolerant reads: any value NOT starting with `v2:` is returned as-is (this is how existing plaintext rows keep working without a backfill).
- `email_messages.subject`, `from_address`, `from_name` stay PLAINTEXT — do not encrypt them. Only `body_preview` in that table is in scope.
- `GET /messages/search`'s LIKE clause narrows to `subject OR from_address` — `body_preview LIKE ?` must be REMOVED from that query (ciphertext can't be LIKE-matched).
- D1 calls are always `await`ed.
- Tests: `npx vitest run <file>`; full suite `npx vitest run` before the final commit.
- Bindings type: `env.EMAIL_FIELD_ENCRYPTION_KEK` needs adding to `src/types.ts`'s `Bindings` interface (it will not exist there yet) and to `wrangler.toml` under `[vars]` is WRONG — secrets are never declared in `wrangler.toml`; only `wrangler secret put` and `.dev.vars` for local. Do not add it to `wrangler.toml`.

---

### Task 1: `src/utils/emailFieldCrypto.ts` — envelope encryption helper

**Files:**
- Create: `src/utils/emailFieldCrypto.ts`
- Modify: `src/types.ts` — add `EMAIL_FIELD_ENCRYPTION_KEK?: string;` to the `Bindings` interface (find the existing interface, which already has other optional secret fields like `ROBOFLOW_API_KEY` — follow that pattern exactly, same optional-string style)
- Test: `tests/emailFieldCrypto.test.ts` (new)

**Interfaces:**
- Produces:
  - `export class EmailFieldEncryptionError extends Error` — thrown on missing/malformed KEK.
  - `export async function encryptField(env: { EMAIL_FIELD_ENCRYPTION_KEK?: string }, plaintext: string): Promise<string>` — returns the `v2:...` stored form.
  - `export async function decryptFieldIfEncrypted(env: { EMAIL_FIELD_ENCRYPTION_KEK?: string }, stored: string | null | undefined): Promise<string>` — returns `''` for null/undefined input, the plaintext value unchanged if it doesn't start with `v2:`, or the decrypted plaintext if it does. Throws `EmailFieldEncryptionError` if the value IS `v2:`-prefixed but the KEK is missing/malformed (can't decrypt without it) or decryption fails (corrupted/wrong-key ciphertext) — do NOT swallow this into an empty string, since that would silently show blank content instead of surfacing the real problem.

- [ ] **Step 1: Write the failing test**

Create `tests/emailFieldCrypto.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { encryptField, decryptFieldIfEncrypted, EmailFieldEncryptionError } from '../src/utils/emailFieldCrypto';

// 32 random bytes, base64-encoded — a valid test KEK.
const TEST_KEK = 'MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=';

describe('emailFieldCrypto', () => {
  it('round-trips a plaintext value through encrypt then decrypt', async () => {
    const env = { EMAIL_FIELD_ENCRYPTION_KEK: TEST_KEK };
    const encrypted = await encryptField(env, 'Case update: subject closed');
    expect(encrypted.startsWith('v2:')).toBe(true);
    const decrypted = await decryptFieldIfEncrypted(env, encrypted);
    expect(decrypted).toBe('Case update: subject closed');
  });

  it('passes through a value that is not v2:-prefixed unchanged (legacy plaintext row)', async () => {
    const env = { EMAIL_FIELD_ENCRYPTION_KEK: TEST_KEK };
    const result = await decryptFieldIfEncrypted(env, 'plain unencrypted body preview text');
    expect(result).toBe('plain unencrypted body preview text');
  });

  it('returns empty string for null/undefined input', async () => {
    const env = { EMAIL_FIELD_ENCRYPTION_KEK: TEST_KEK };
    expect(await decryptFieldIfEncrypted(env, null)).toBe('');
    expect(await decryptFieldIfEncrypted(env, undefined)).toBe('');
  });

  it('throws EmailFieldEncryptionError when encrypting with no KEK set', async () => {
    const env = {};
    await expect(encryptField(env, 'anything')).rejects.toThrow(EmailFieldEncryptionError);
  });

  it('throws EmailFieldEncryptionError when decrypting a v2: value with no KEK set', async () => {
    const env = { EMAIL_FIELD_ENCRYPTION_KEK: TEST_KEK };
    const encrypted = await encryptField(env, 'secret body');
    await expect(decryptFieldIfEncrypted({}, encrypted)).rejects.toThrow(EmailFieldEncryptionError);
  });

  it('produces different ciphertext for the same plaintext on repeated calls (fresh IV/DEK each time)', async () => {
    const env = { EMAIL_FIELD_ENCRYPTION_KEK: TEST_KEK };
    const a = await encryptField(env, 'same text');
    const b = await encryptField(env, 'same text');
    expect(a).not.toBe(b);
  });

  it('throws EmailFieldEncryptionError for a malformed (non-32-byte) KEK', async () => {
    const env = { EMAIL_FIELD_ENCRYPTION_KEK: 'dG9vc2hvcnQ=' }; // "tooshort" base64, not 32 bytes
    await expect(encryptField(env, 'x')).rejects.toThrow(EmailFieldEncryptionError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/emailFieldCrypto.test.ts`
Expected: FAIL — `src/utils/emailFieldCrypto.ts` does not exist.

- [ ] **Step 3: Implement `src/utils/emailFieldCrypto.ts`**

```ts
// Envelope encryption for individual D1 TEXT columns (email_messages.body_preview,
// email_scheduled.body/to_addresses/cc_addresses). Mirrors the envelope shape in
// src/utils/encryptedR2.ts (fresh per-value DEK wrapped by a master KEK) rather
// than emailCrypto.ts's single static-key approach, which is fine for a handful
// of OAuth secret rows but not a growing table of message content.
//
// Unlike encryptedR2.ts (one file_encryption_keys D1 row per R2 object), these
// are inline TEXT columns — the wrapped DEK and both IVs are packed into the
// stored string itself: v2:<b64 wrapped_dek>:<b64 dek_iv>:<b64 field_iv>:<b64 ciphertext>
//
// Fails CLOSED: a missing/malformed KEK throws EmailFieldEncryptionError rather
// than silently storing/returning plaintext — matches encryptedR2.ts's posture,
// not emailCrypto.ts's graceful JWT_SECRET fallback, because silently skipping
// encryption here would defeat the whole feature without anyone noticing.

export class EmailFieldEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailFieldEncryptionError';
  }
}

const STORED_PREFIX = 'v2:';

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKek(kekB64: string | undefined): Promise<CryptoKey> {
  if (!kekB64) {
    throw new EmailFieldEncryptionError('EMAIL_FIELD_ENCRYPTION_KEK is not set (wrangler secret put EMAIL_FIELD_ENCRYPTION_KEK)');
  }
  let raw: Uint8Array;
  try {
    raw = base64ToBytes(kekB64.trim());
  } catch {
    throw new EmailFieldEncryptionError('EMAIL_FIELD_ENCRYPTION_KEK is not valid base64');
  }
  if (raw.length !== 32) {
    throw new EmailFieldEncryptionError(`EMAIL_FIELD_ENCRYPTION_KEK must decode to 32 bytes (got ${raw.length})`);
  }
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export async function encryptField(env: { EMAIL_FIELD_ENCRYPTION_KEK?: string }, plaintext: string): Promise<string> {
  const kek = await importKek(env.EMAIL_FIELD_ENCRYPTION_KEK);

  const dekRaw = crypto.getRandomValues(new Uint8Array(32));
  const dek = await crypto.subtle.importKey('raw', dekRaw, { name: 'AES-GCM' }, false, ['encrypt']);

  const fieldIv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: fieldIv }, dek, enc.encode(plaintext)),
  );

  const dekIv = crypto.getRandomValues(new Uint8Array(12));
  const wrappedDek = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: dekIv }, kek, dekRaw),
  );

  return [
    STORED_PREFIX.slice(0, -1), // 'v2' (without trailing colon, added by join below)
    bytesToBase64(wrappedDek),
    bytesToBase64(dekIv),
    bytesToBase64(fieldIv),
    bytesToBase64(ciphertext),
  ].join(':');
}

export async function decryptFieldIfEncrypted(
  env: { EMAIL_FIELD_ENCRYPTION_KEK?: string },
  stored: string | null | undefined,
): Promise<string> {
  if (stored == null) return '';
  if (!stored.startsWith(STORED_PREFIX)) return stored;

  const parts = stored.slice(STORED_PREFIX.length).split(':');
  if (parts.length !== 4) {
    throw new EmailFieldEncryptionError('Malformed v2: encrypted field — expected 4 colon-delimited segments');
  }
  const [wrappedDekB64, dekIvB64, fieldIvB64, ciphertextB64] = parts;

  const kek = await importKek(env.EMAIL_FIELD_ENCRYPTION_KEK);
  const dekRaw = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(dekIvB64) }, kek, base64ToBytes(wrappedDekB64),
    ),
  );
  const dek = await crypto.subtle.importKey('raw', dekRaw, { name: 'AES-GCM' }, false, ['decrypt']);

  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(fieldIvB64) }, dek, base64ToBytes(ciphertextB64),
  );
  return dec.decode(plainBuf);
}
```

- [ ] **Step 4: Add the Bindings field**

In `src/types.ts`, find the `Bindings` interface (search for `ROBOFLOW_API_KEY` or `FILE_ENCRYPTION_KEK` to locate it) and add, near the other optional secret fields:

```ts
EMAIL_FIELD_ENCRYPTION_KEK?: string;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/emailFieldCrypto.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no new errors

- [ ] **Step 7: Commit**

```bash
git add src/utils/emailFieldCrypto.ts src/types.ts tests/emailFieldCrypto.test.ts
git commit -m "feat(email): add envelope-encryption helper for cached email content"
```

---

### Task 2: Encrypt `email_messages.body_preview` on write, decrypt on read, narrow search

**Files:**
- Modify: `src/routes/email.ts` — `runEmailPoll`'s upsert (encrypt), `GET /messages/search` (decrypt + narrow LIKE), `GET /messages/:id` if it reads cached `body_preview` from `email_messages` (check — it may only read live from Graph; if so, skip), any other read of `email_messages.body_preview` you find via `grep -n "body_preview" src/routes/email.ts`
- Test: `tests/emailFieldCrypto.test.ts` already covers the pure crypto; this task's tests go in a new `tests/emailMessagesEncryption.test.ts` covering the route-level wiring at the level the existing `tests/emailAudit.test.ts`/`tests/emailOutboxDrain.test.ts` do (fake D1, no real network)

**Interfaces:**
- Consumes: `encryptField`, `decryptFieldIfEncrypted` from `src/utils/emailFieldCrypto.ts` (Task 1).

- [ ] **Step 1: Read the current state of the two call sites**

Run: `grep -n "body_preview" src/routes/email.ts` to find every reference. As of this plan's writing there are at least two: the `runEmailPoll` upsert (around line 1441, inside the `INSERT INTO email_messages ... ON CONFLICT` block) and `GET /messages/search`'s SELECT (around line 599). Confirm the exact current line numbers before editing — earlier phases may have shifted them slightly.

- [ ] **Step 2: Write the failing test**

Create `tests/emailMessagesEncryption.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { encryptField, decryptFieldIfEncrypted } from '../src/utils/emailFieldCrypto';

const TEST_KEK = 'MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=';

// This test exercises the encrypt-then-search-narrows-then-decrypt round trip
// at the level of the pure helpers, since a full Hono route test would need
// Miniflare (covered separately in test-workers/ per project convention).
// It documents the CONTRACT this task's route changes must satisfy:
// body_preview is stored encrypted, and a value read back out must decrypt
// to the original.
describe('email_messages.body_preview encryption contract', () => {
  it('a body_preview written via encryptField and read back via decryptFieldIfEncrypted round-trips', async () => {
    const env = { EMAIL_FIELD_ENCRYPTION_KEK: TEST_KEK };
    const original = 'Officer requested backup at 123 Main St — see attached photo.';
    const stored = await encryptField(env, original);
    expect(stored.startsWith('v2:')).toBe(true);
    const readBack = await decryptFieldIfEncrypted(env, stored);
    expect(readBack).toBe(original);
  });

  it('a legacy plaintext body_preview (pre-encryption row) still decrypts to itself', async () => {
    const env = { EMAIL_FIELD_ENCRYPTION_KEK: TEST_KEK };
    const legacy = 'Old cached preview text from before encryption shipped';
    expect(await decryptFieldIfEncrypted(env, legacy)).toBe(legacy);
  });
});
```

Also add a plain grep-based structural check that the search query no longer references `body_preview LIKE`:

```ts
import { readFileSync } from 'node:fs';

describe('GET /messages/search query shape', () => {
  it('does not LIKE-match body_preview (ciphertext cannot be pattern-matched)', () => {
    const src = readFileSync(new URL('../src/routes/email.ts', import.meta.url), 'utf-8');
    const searchHandlerMatch = src.match(/email\.get\('\/messages\/search'[\s\S]*?\n}\);/);
    expect(searchHandlerMatch).toBeTruthy();
    const handlerSrc = searchHandlerMatch![0];
    expect(handlerSrc).not.toMatch(/body_preview\s+LIKE/);
    expect(handlerSrc).toMatch(/subject\s+LIKE/);
    expect(handlerSrc).toMatch(/from_address\s+LIKE/);
  });
});
```

- [ ] **Step 3: Run test to verify the crypto-contract tests pass already (Task 1 dependency) and the structural test FAILS**

Run: `npx vitest run tests/emailMessagesEncryption.test.ts`
Expected: the two crypto-contract tests PASS (they only depend on Task 1, already done); the structural "does not LIKE-match body_preview" test FAILS, because the route hasn't been changed yet.

- [ ] **Step 4: Modify the `runEmailPoll` upsert to encrypt `body_preview`**

Find the block (search for `INSERT INTO email_messages`):

```ts
      try {
        await execute(
          env.DB,
          `INSERT INTO email_messages
            (owner_user_id, graph_id, conversation_id, folder_id, subject, from_address, from_name, to_addresses, cc_addresses, body_preview, has_attachments, is_read, is_flagged, importance, categories, received_at, sent_at)
           VALUES (?, ?, ?, 'inbox', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(owner_user_id, graph_id) DO UPDATE SET
             is_read = excluded.is_read,
             is_flagged = excluded.is_flagged,
             categories = COALESCE(excluded.categories, email_messages.categories),
             body_preview = excluded.body_preview`,
          ownerUserId, m.graph_id, m.conversation_id ?? null, m.subject, m.from_address, m.from_name,
          m.to_addresses, m.cc_addresses, m.body_preview, m.has_attachments, m.is_read, m.is_flagged,
          m.importance, categories, m.received_at ?? null, m.sent_at ?? null,
        );
        upserted++;
      } catch { /* upsert best-effort */ }
```

Change to encrypt `m.body_preview` before binding it. Add the import at the top of the file (with the other `../utils/*` imports): `import { encryptField, decryptFieldIfEncrypted } from '../utils/emailFieldCrypto';`. Then:

```ts
      try {
        const encryptedBodyPreview = m.body_preview ? await encryptField(env, m.body_preview) : m.body_preview;
        await execute(
          env.DB,
          `INSERT INTO email_messages
            (owner_user_id, graph_id, conversation_id, folder_id, subject, from_address, from_name, to_addresses, cc_addresses, body_preview, has_attachments, is_read, is_flagged, importance, categories, received_at, sent_at)
           VALUES (?, ?, ?, 'inbox', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(owner_user_id, graph_id) DO UPDATE SET
             is_read = excluded.is_read,
             is_flagged = excluded.is_flagged,
             categories = COALESCE(excluded.categories, email_messages.categories),
             body_preview = excluded.body_preview`,
          ownerUserId, m.graph_id, m.conversation_id ?? null, m.subject, m.from_address, m.from_name,
          m.to_addresses, m.cc_addresses, encryptedBodyPreview, m.has_attachments, m.is_read, m.is_flagged,
          m.importance, categories, m.received_at ?? null, m.sent_at ?? null,
        );
        upserted++;
      } catch { /* upsert best-effort */ }
```

Note: `m.body_preview` is typed as `(raw.bodyPreview as string) || null` earlier in the same function — the `? :` guard above handles the `null` case by passing `null` straight through unencrypted (nothing to encrypt), which is fine since `decryptFieldIfEncrypted` returns `''` for null reads anyway. Do NOT wrap the `null` case in `encryptField` — encrypting an empty/absent value adds cost for no benefit and this project's own `emailCrypto.ts` follows the same "skip if falsy" convention.

- [ ] **Step 5: Modify `GET /messages/search` to decrypt on read and narrow the LIKE clause**

Find the handler (search for `email.get('/messages/search'`):

```ts
email.get('/messages/search', async (c) => {
  const userId = c.get('userId');
  const q = (c.req.query('q') || '').trim();
  if (q.length < 2) return c.json({ results: [] });
  const folder = (c.req.query('folder') || '').trim();
  const like = buildSearchLikePattern(q);
  try {
    const params: unknown[] = [userId, like, like, like];
    let folderClause = '';
    if (folder && folder !== 'inbox') { folderClause = 'AND folder_id = ?'; params.push(folder); }
    const rows = await query(
      c.env.DB,
      `SELECT graph_id, conversation_id, subject, from_address, from_name, body_preview,
              has_attachments, is_read, is_flagged, importance, received_at
         FROM email_messages
        WHERE owner_user_id = ?
          AND (subject LIKE ? OR from_address LIKE ? OR body_preview LIKE ?)
          ${folderClause}
        ORDER BY received_at DESC
        LIMIT 50`,
      ...params,
    );
    return c.json({ results: rows });
  } catch {
    return c.json({ results: [] });
  }
});
```

Replace with (narrow the LIKE to subject/from_address only, drop `body_preview LIKE`, decrypt `body_preview` on the way out):

```ts
email.get('/messages/search', async (c) => {
  const userId = c.get('userId');
  const q = (c.req.query('q') || '').trim();
  if (q.length < 2) return c.json({ results: [] });
  const folder = (c.req.query('folder') || '').trim();
  const like = buildSearchLikePattern(q);
  try {
    // body_preview is stored encrypted (src/utils/emailFieldCrypto.ts) and
    // therefore cannot be LIKE-matched — search narrows to subject/sender.
    const params: unknown[] = [userId, like, like];
    let folderClause = '';
    if (folder && folder !== 'inbox') { folderClause = 'AND folder_id = ?'; params.push(folder); }
    const rows = await query<Record<string, unknown>>(
      c.env.DB,
      `SELECT graph_id, conversation_id, subject, from_address, from_name, body_preview,
              has_attachments, is_read, is_flagged, importance, received_at
         FROM email_messages
        WHERE owner_user_id = ?
          AND (subject LIKE ? OR from_address LIKE ?)
          ${folderClause}
        ORDER BY received_at DESC
        LIMIT 50`,
      ...params,
    );
    const results = await Promise.all(rows.map(async (r) => ({
      ...r,
      body_preview: await decryptFieldIfEncrypted(c.env, r.body_preview as string | null),
    })));
    return c.json({ results });
  } catch {
    return c.json({ results: [] });
  }
});
```

- [ ] **Step 6: Check for any other reader of `email_messages.body_preview`**

Run: `grep -n "body_preview" src/routes/email.ts` again to confirm every SELECT that includes this column now decrypts it before returning to the client. If you find another one not covered above, apply the same `decryptFieldIfEncrypted` treatment. Do not modify any code that only READS `subject`/`from_address`/`from_name`/`to_addresses`/`cc_addresses` on `email_messages` — those stay plaintext per the Global Constraints.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/emailMessagesEncryption.test.ts tests/emailFieldCrypto.test.ts`
Expected: PASS (all tests, including the structural LIKE-clause check)

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: no new errors

- [ ] **Step 9: Commit**

```bash
git add src/routes/email.ts tests/emailMessagesEncryption.test.ts
git commit -m "feat(email): encrypt cached body_preview at rest, narrow search to subject/sender"
```

---

### Task 3: Encrypt `email_scheduled` body/recipients on write, decrypt on drain

**Files:**
- Modify: `src/routes/email.ts` — `POST /schedule` (encrypt), `drainScheduledEmails` (decrypt)
- Modify: `GET /scheduled` (the list endpoint a user sees for their own pending scheduled sends) if it returns `body`/`to_addresses`/`cc_addresses` to the client — check via `grep -n "email_scheduled" src/routes/email.ts` and decrypt there too if so
- Test: `tests/emailScheduledEncryption.test.ts` (new)

**Interfaces:**
- Consumes: `encryptField`, `decryptFieldIfEncrypted` from Task 1's `src/utils/emailFieldCrypto.ts`.

- [ ] **Step 1: Read the current state of all `email_scheduled` call sites**

Run: `grep -n "email_scheduled" src/routes/email.ts` and read each one. As of this plan's writing there are at least three: `POST /schedule` (insert), `GET /scheduled` (list for the current user), `drainScheduledEmails` (cron drain that builds the Graph payload). Confirm current line numbers and exact column lists returned by any SELECT before editing.

- [ ] **Step 2: Write the failing test**

Create `tests/emailScheduledEncryption.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { encryptField, decryptFieldIfEncrypted } from '../src/utils/emailFieldCrypto';

const TEST_KEK = 'MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=';

describe('email_scheduled body/recipients encryption contract', () => {
  it('body round-trips through encryptField/decryptFieldIfEncrypted', async () => {
    const env = { EMAIL_FIELD_ENCRYPTION_KEK: TEST_KEK };
    const original = 'Please review the attached warrant packet before Friday.';
    const stored = await encryptField(env, original);
    expect(await decryptFieldIfEncrypted(env, stored)).toBe(original);
  });

  it('to_addresses (JSON array as a string) round-trips', async () => {
    const env = { EMAIL_FIELD_ENCRYPTION_KEK: TEST_KEK };
    const original = JSON.stringify(['officer1@rmpgutah.us', 'officer2@rmpgutah.us']);
    const stored = await encryptField(env, original);
    const readBack = await decryptFieldIfEncrypted(env, stored);
    expect(JSON.parse(readBack)).toEqual(['officer1@rmpgutah.us', 'officer2@rmpgutah.us']);
  });
});

describe('POST /schedule and drainScheduledEmails wiring', () => {
  it('POST /schedule encrypts body/to_addresses/cc_addresses before the INSERT', () => {
    const src = readFileSync(new URL('../src/routes/email.ts', import.meta.url), 'utf-8');
    const handlerMatch = src.match(/email\.post\('\/schedule'[\s\S]*?\n}\);/);
    expect(handlerMatch).toBeTruthy();
    const handlerSrc = handlerMatch![0];
    expect(handlerSrc).toMatch(/encryptField/);
  });

  it('drainScheduledEmails decrypts before building the Graph payload', () => {
    const src = readFileSync(new URL('../src/routes/email.ts', import.meta.url), 'utf-8');
    const fnMatch = src.match(/export async function drainScheduledEmails[\s\S]*?\n}/);
    expect(fnMatch).toBeTruthy();
    const fnSrc = fnMatch![0];
    expect(fnSrc).toMatch(/decryptFieldIfEncrypted/);
  });
});
```

- [ ] **Step 3: Run test to verify the structural checks fail**

Run: `npx vitest run tests/emailScheduledEncryption.test.ts`
Expected: the two crypto round-trip tests PASS (Task 1 dependency); the two structural "wiring" tests FAIL, since the route hasn't been changed yet.

- [ ] **Step 4: Modify `POST /schedule` to encrypt before insert**

Find the handler (search for `email.post('/schedule'`) — current body (from the plan's research, verify against actual file):

```ts
email.post('/schedule', emailSendRateLimit, async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json().catch(() => ({})) as {
    to?: string | string[]; cc?: string | string[]; bcc?: string | string[];
    subject?: string; body?: string; isHtml?: boolean; scheduledAt?: string;
    attachments?: SendAttachment[]; importance?: string;
  };
  const to = parseAddrList(body.to).map((r) => r.emailAddress.address);
  if (!to.length) return c.json({ error: 'At least one recipient required' }, 400);
  if (!body.scheduledAt) return c.json({ error: 'scheduledAt required' }, 400);
  const attBytes = totalAttachmentBytes(body.attachments);
  if (attBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    return c.json({
      error: `Attachments total ${(attBytes / 1024 / 1024).toFixed(1)}MB, max ${MAX_TOTAL_ATTACHMENT_BYTES / 1024 / 1024}MB per message`,
      code: 'ATTACHMENTS_TOO_LARGE',
    }, 413);
  }
  const when = body.scheduledAt.replace('T', ' ').slice(0, 19);
  const cc = parseAddrList(body.cc).map((r) => r.emailAddress.address);
  const bcc = parseAddrList(body.bcc).map((r) => r.emailAddress.address);
  const r = await execute(
    c.env.DB,
    `INSERT INTO email_scheduled (owner_user_id, to_addresses, cc_addresses, bcc_addresses, subject, body, is_html, importance, attachments, scheduled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    userId, JSON.stringify(to), cc.length ? JSON.stringify(cc) : null, bcc.length ? JSON.stringify(bcc) : null,
    body.subject || '', body.body || '', body.isHtml === false ? 0 : 1,
    ['low', 'normal', 'high'].includes(body.importance || '') ? body.importance : 'normal',
    body.attachments?.length ? JSON.stringify(body.attachments.slice(0, 20)) : null,
    when,
  );
  return c.json({ success: true, id: r.meta.last_row_id });
});
```

Note: `bcc_addresses` is NOT in the encryption scope per the design doc (only `body`/`to_addresses`/`cc_addresses` are listed) — leave `bcc_addresses` plaintext as-is; this is deliberate, not an oversight, so do not "fix" it to also be encrypted. Replace with:

```ts
email.post('/schedule', emailSendRateLimit, async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json().catch(() => ({})) as {
    to?: string | string[]; cc?: string | string[]; bcc?: string | string[];
    subject?: string; body?: string; isHtml?: boolean; scheduledAt?: string;
    attachments?: SendAttachment[]; importance?: string;
  };
  const to = parseAddrList(body.to).map((r) => r.emailAddress.address);
  if (!to.length) return c.json({ error: 'At least one recipient required' }, 400);
  if (!body.scheduledAt) return c.json({ error: 'scheduledAt required' }, 400);
  const attBytes = totalAttachmentBytes(body.attachments);
  if (attBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    return c.json({
      error: `Attachments total ${(attBytes / 1024 / 1024).toFixed(1)}MB, max ${MAX_TOTAL_ATTACHMENT_BYTES / 1024 / 1024}MB per message`,
      code: 'ATTACHMENTS_TOO_LARGE',
    }, 413);
  }
  const when = body.scheduledAt.replace('T', ' ').slice(0, 19);
  const cc = parseAddrList(body.cc).map((r) => r.emailAddress.address);
  const bcc = parseAddrList(body.bcc).map((r) => r.emailAddress.address);
  const encryptedTo = await encryptField(c.env, JSON.stringify(to));
  const encryptedCc = cc.length ? await encryptField(c.env, JSON.stringify(cc)) : null;
  const encryptedBody = await encryptField(c.env, body.body || '');
  const r = await execute(
    c.env.DB,
    `INSERT INTO email_scheduled (owner_user_id, to_addresses, cc_addresses, bcc_addresses, subject, body, is_html, importance, attachments, scheduled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    userId, encryptedTo, encryptedCc, bcc.length ? JSON.stringify(bcc) : null,
    body.subject || '', encryptedBody, body.isHtml === false ? 0 : 1,
    ['low', 'normal', 'high'].includes(body.importance || '') ? body.importance : 'normal',
    body.attachments?.length ? JSON.stringify(body.attachments.slice(0, 20)) : null,
    when,
  );
  return c.json({ success: true, id: r.meta.last_row_id });
});
```

- [ ] **Step 5: Modify `drainScheduledEmails` to decrypt before building the Graph payload**

Find the function (search for `export async function drainScheduledEmails`) — current body (verify against actual file):

```ts
export async function drainScheduledEmails(env: Bindings): Promise<number> {
  const rows = await query<{
    id: number; owner_user_id: number; to_addresses: string; cc_addresses: string | null;
    bcc_addresses: string | null; subject: string; body: string; is_html: number;
    importance: string; attachments: string | null;
  }>(
    env.DB,
    "SELECT id, owner_user_id, to_addresses, cc_addresses, bcc_addresses, subject, body, is_html, importance, attachments FROM email_scheduled WHERE status = 'pending' AND scheduled_at <= datetime('now') LIMIT 10",
  ).catch(() => [] as never[]);
  let queued = 0;
  for (const r of rows) {
    try {
      const parse = (s: string | null): string[] => { try { return s ? JSON.parse(s) : []; } catch { return []; } };
      const atts = ((): SendAttachment[] => { try { return r.attachments ? JSON.parse(r.attachments) : []; } catch { return []; } })();
      const attachments = mapAttachments(atts);
      const payload = {
        message: {
          subject: r.subject || '(no subject)',
          body: { contentType: r.is_html ? 'HTML' : 'Text', content: r.body || '' },
          toRecipients: parseAddrList(parse(r.to_addresses)),
          ccRecipients: parseAddrList(parse(r.cc_addresses)),
          bccRecipients: parseAddrList(parse(r.bcc_addresses)),
          ...(attachments.length ? { attachments } : {}),
          importance: r.importance || 'normal',
        },
        saveToSentItems: true,
      };
      // Reuse the durable outbox so retries/backoff are uniform.
      await execute(
        env.DB,
        "INSERT INTO email_outbox (owner_user_id, payload, status) VALUES (?, ?, 'pending')",
        r.owner_user_id, JSON.stringify(payload),
      );
      await execute(env.DB, "UPDATE email_scheduled SET status = 'sent', sent_at = datetime('now') WHERE id = ?", r.id);
      queued++;
    } catch (err: unknown) {
      await execute(
        env.DB,
        "UPDATE email_scheduled SET status = 'failed', last_error = ? WHERE id = ?",
        err instanceof Error ? err.message : 'enqueue failed', r.id,
      ).catch(() => null);
    }
  }
  return queued;
}
```

Replace the body of the `for` loop's try block to decrypt `body`/`to_addresses`/`cc_addresses` before use (`bcc_addresses` stays plaintext, unchanged):

```ts
export async function drainScheduledEmails(env: Bindings): Promise<number> {
  const rows = await query<{
    id: number; owner_user_id: number; to_addresses: string; cc_addresses: string | null;
    bcc_addresses: string | null; subject: string; body: string; is_html: number;
    importance: string; attachments: string | null;
  }>(
    env.DB,
    "SELECT id, owner_user_id, to_addresses, cc_addresses, bcc_addresses, subject, body, is_html, importance, attachments FROM email_scheduled WHERE status = 'pending' AND scheduled_at <= datetime('now') LIMIT 10",
  ).catch(() => [] as never[]);
  let queued = 0;
  for (const r of rows) {
    try {
      const decryptedBody = await decryptFieldIfEncrypted(env, r.body);
      const decryptedTo = await decryptFieldIfEncrypted(env, r.to_addresses);
      const decryptedCc = r.cc_addresses ? await decryptFieldIfEncrypted(env, r.cc_addresses) : null;
      const parse = (s: string | null): string[] => { try { return s ? JSON.parse(s) : []; } catch { return []; } };
      const atts = ((): SendAttachment[] => { try { return r.attachments ? JSON.parse(r.attachments) : []; } catch { return []; } })();
      const attachments = mapAttachments(atts);
      const payload = {
        message: {
          subject: r.subject || '(no subject)',
          body: { contentType: r.is_html ? 'HTML' : 'Text', content: decryptedBody || '' },
          toRecipients: parseAddrList(parse(decryptedTo)),
          ccRecipients: parseAddrList(parse(decryptedCc)),
          bccRecipients: parseAddrList(parse(r.bcc_addresses)),
          ...(attachments.length ? { attachments } : {}),
          importance: r.importance || 'normal',
        },
        saveToSentItems: true,
      };
      // Reuse the durable outbox so retries/backoff are uniform.
      await execute(
        env.DB,
        "INSERT INTO email_outbox (owner_user_id, payload, status) VALUES (?, ?, 'pending')",
        r.owner_user_id, JSON.stringify(payload),
      );
      await execute(env.DB, "UPDATE email_scheduled SET status = 'sent', sent_at = datetime('now') WHERE id = ?", r.id);
      queued++;
    } catch (err: unknown) {
      await execute(
        env.DB,
        "UPDATE email_scheduled SET status = 'failed', last_error = ? WHERE id = ?",
        err instanceof Error ? err.message : 'enqueue failed', r.id,
      ).catch(() => null);
    }
  }
  return queued;
}
```

- [ ] **Step 6: Check `GET /scheduled` (the user-facing list) for plaintext exposure needs**

Run: `grep -n "email.get('/scheduled'" src/routes/email.ts` and read that handler. If it SELECTs `body`/`to_addresses`/`cc_addresses` and returns them to the client (e.g. for a "review before it sends" UI), add the same `decryptFieldIfEncrypted` treatment as Task 2 Step 5 did for search results. If it only returns `id`/`subject`/`scheduled_at`/`status` (no encrypted columns), no change needed — confirm which case applies by reading the actual SELECT column list.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/emailScheduledEncryption.test.ts tests/emailFieldCrypto.test.ts tests/emailMessagesEncryption.test.ts`
Expected: PASS (all tests)

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: no new errors

- [ ] **Step 9: Commit**

```bash
git add src/routes/email.ts tests/emailScheduledEncryption.test.ts
git commit -m "feat(email): encrypt scheduled-send body and to/cc addresses at rest"
```

---

### Task 4: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full worker test suite**

Run: `npx vitest run`
Expected: all files pass, including all new/modified test files from Tasks 1-3.

- [ ] **Step 2: Run worker typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 3: Confirm no client code was touched**

Run: `git diff main --stat` (or `git diff <phase-2-start-commit> --stat`)
Expected: only `src/utils/emailFieldCrypto.ts` (new), `src/routes/email.ts`, `src/types.ts`, and the 3 new test files. No `client/` changes, no migrations (this phase deliberately requires none).

- [ ] **Step 4: Manual note for deployment (not automated — record in the final report)**

`EMAIL_FIELD_ENCRYPTION_KEK` must be set on the live Worker via `wrangler secret put EMAIL_FIELD_ENCRYPTION_KEK` (32 random bytes, base64-encoded — e.g. generate with `openssl rand -base64 32`) before this deploys, or every encrypt/decrypt call will throw `EmailFieldEncryptionError` in production. This is a deployment step, not something this plan's tests can verify — flag it clearly in the final report so the human operator doesn't miss it.

- [ ] **Step 5: Final commit if any cleanup was needed**

If Steps 1-2 required fixes, commit them separately with a clear message. If everything passed clean, no action needed here.
