# Security Policy Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Admin → System Config → Security Policy section (`admin?tab=system`) actually control password rules, login-lockout thresholds, and concurrent-session limits, instead of writing to a JSON blob nothing reads.

**Architecture:** A single new Worker-side module, `src/utils/securityPolicy.ts`, reads the existing `system_config` row (`category='security_settings'`, `config_key='security_config'`) that `AdminSystemTab.tsx` already saves to, parses it into a typed `SecurityPolicy`, and exposes `getSecurityPolicy(db)` + `validatePassword(pwd, policy)`. Every place in `src/routes/auth.ts` and `src/routes/personnel.ts` that currently hardcodes a password rule, a lockout threshold, or (new) a session cap is repointed at this module. No new tables, no new admin endpoints — the save path already works; only the read side is missing.

**Tech Stack:** Hono route handlers, D1 (`system_config` table), Vitest (`tests/`).

## Global Constraints

- Worker code lives under `/src/`; this plan does not touch `/client/src/` except one small consistency fix in Task 6.
- All D1 calls are async — every `db.prepare(...)` call in this plan uses `await`.
- `system_config.category` is `NOT NULL DEFAULT 'general'` — the security row already uses `category='security_settings'`, `config_key='security_config'`; do not invent a new key.
- **Binding constraint (from `docs/superpowers/specs/2026-07-25-admin-system-tab-wiring-design.md`):** the default policy used when no admin has ever saved a row MUST reproduce today's actual hardcoded behavior in `auth.ts`, not the client form's `DEFAULT_SECURITY` object — those two already disagree (see Task 1).
- Out of scope for this plan (explicitly deferred, not silently dropped): `password_expiry_days` forced-rotation-at-login enforcement. The field will be read and validated as a number but not yet used to force a password change — that requires touching both the 2FA and non-2FA login return paths in `auth.ts` and deserves its own follow-up plan. Note this in the PR body.

---

## File Structure

- **Create:** `src/utils/securityPolicy.ts` — `SecurityPolicy` type, `DEFAULT_SECURITY_POLICY` constant, `getSecurityPolicy(db)`, `validatePassword(pwd, policy)`. One responsibility: turn the saved JSON blob into a typed, clamped policy and validate passwords against it.
- **Create:** `tests/securityPolicy.test.ts` — unit tests for the pure functions above (no D1 needed for `validatePassword`; a fake `db.prepare` stub for `getSecurityPolicy`).
- **Modify:** `src/routes/auth.ts` — replace `validateNewPassword()`, the hardcoded `FAILED_LOGIN_THRESHOLD`/`LOCKOUT_DURATION_MINUTES` constants, `GET /password-policy`, and `createSession()`.
- **Modify:** `src/routes/personnel.ts` — replace the two hardcoded `password.length < 8` checks (create-user, admin reset-password) with the shared validator.
- **Modify:** `client/src/pages/admin/AdminSystemTab.tsx` — remove the Phase-0 "not enforced" notice from the Security section; fix `DEFAULT_SECURITY.require_special_chars` from `'0'` to `'1'` so the form's own default stops lying about what happens when nothing is saved yet.

---

### Task 1: `securityPolicy.ts` — typed policy reader + password validator

**Files:**
- Create: `src/utils/securityPolicy.ts`
- Test: `tests/securityPolicy.test.ts`

**Interfaces:**
- Produces: `interface SecurityPolicy { minPasswordLength: number; requireUppercase: boolean; requireLowercase: boolean; requireNumbers: boolean; requireSpecialChars: boolean; maxLoginAttempts: number; lockoutDurationMinutes: number; maxActiveSessions: number; passwordExpiryDays: number; }`
- Produces: `DEFAULT_SECURITY_POLICY: SecurityPolicy`
- Produces: `async function getSecurityPolicy(db: D1Database): Promise<SecurityPolicy>`
- Produces: `function validatePassword(pwd: string, policy: SecurityPolicy): string | null` (returns an error message, or `null` when valid)

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/securityPolicy.test.ts
import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_SECURITY_POLICY, getSecurityPolicy, validatePassword } from '../src/utils/securityPolicy';

describe('validatePassword', () => {
  const policy = { ...DEFAULT_SECURITY_POLICY };

  it('rejects passwords shorter than minPasswordLength', () => {
    expect(validatePassword('Ab1!', policy)).toBe('Password must be at least 8 characters');
  });

  it('rejects missing uppercase when required', () => {
    expect(validatePassword('lowercase1!', policy)).toBe('Password must contain an uppercase letter');
  });

  it('rejects missing lowercase (always required)', () => {
    expect(validatePassword('UPPERCASE1!', policy)).toBe('Password must contain a lowercase letter');
  });

  it('rejects missing number when required', () => {
    expect(validatePassword('NoNumbers!', policy)).toBe('Password must contain a number');
  });

  it('rejects missing special char when required', () => {
    expect(validatePassword('NoSpecial1', policy)).toBe('Password must contain a special character');
  });

  it('accepts a password satisfying every rule', () => {
    expect(validatePassword('Valid1Password!', policy)).toBeNull();
  });

  it('skips the uppercase check when the policy disables it', () => {
    const relaxed = { ...policy, requireUppercase: false };
    expect(validatePassword('lowercase1!', relaxed)).toBeNull();
  });

  it('honors a shorter minPasswordLength from the policy', () => {
    const shorter = { ...policy, minPasswordLength: 6 };
    expect(validatePassword('Ab1!cd', shorter)).toBeNull();
  });
});

describe('getSecurityPolicy', () => {
  it('returns DEFAULT_SECURITY_POLICY when no row is saved', async () => {
    const db = { prepare: () => ({ bind: () => ({ first: async () => null }) }) } as any;
    const policy = await getSecurityPolicy(db);
    expect(policy).toEqual(DEFAULT_SECURITY_POLICY);
  });

  it('parses a saved security_config row and clamps out-of-range values', async () => {
    const saved = JSON.stringify({
      min_password_length: '10',
      require_uppercase: '0',
      require_numbers: '1',
      require_special_chars: '1',
      max_login_attempts: '999',       // out of UI range (1-20) — clamp to 20
      lockout_duration_minutes: '0',   // out of UI range (1-1440) — clamp to 1
      max_active_sessions: '3',
      password_expiry_days: '90',
    });
    const db = {
      prepare: () => ({ bind: () => ({ first: async () => ({ config_value: saved }) }) }),
    } as any;
    const policy = await getSecurityPolicy(db);
    expect(policy.minPasswordLength).toBe(10);
    expect(policy.requireUppercase).toBe(false);
    expect(policy.requireNumbers).toBe(true);
    expect(policy.requireSpecialChars).toBe(true);
    expect(policy.maxLoginAttempts).toBe(20);
    expect(policy.lockoutDurationMinutes).toBe(1);
    expect(policy.maxActiveSessions).toBe(3);
    expect(policy.passwordExpiryDays).toBe(90);
  });

  it('falls back to defaults when the saved value is malformed JSON', async () => {
    const db = {
      prepare: () => ({ bind: () => ({ first: async () => ({ config_value: 'not json' }) }) }),
    } as any;
    const policy = await getSecurityPolicy(db);
    expect(policy).toEqual(DEFAULT_SECURITY_POLICY);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/securityPolicy.test.ts`
Expected: FAIL with "Cannot find module '../src/utils/securityPolicy'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/utils/securityPolicy.ts
//
// Reads the Security Policy section of Admin → System Config
// (system_config: category='security_settings', config_key='security_config',
// JSON-stringified SecurityConfig — see client/src/pages/admin/AdminSystemTab.tsx)
// and turns it into a validated, clamped policy for auth.ts / personnel.ts to enforce.

export interface SecurityPolicy {
  minPasswordLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialChars: boolean;
  maxLoginAttempts: number;
  lockoutDurationMinutes: number;
  maxActiveSessions: number; // 0 = no cap enforced
  passwordExpiryDays: number; // 0 = disabled
}

// Reproduces auth.ts's ACTUAL hardcoded behavior today (validateNewPassword,
// FAILED_LOGIN_THRESHOLD, LOCKOUT_DURATION_MINUTES) — NOT the client form's
// DEFAULT_SECURITY object, which has require_special_chars: '0'. An admin who
// has never touched this section must see no behavior change.
export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  minPasswordLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
  maxLoginAttempts: 5,
  lockoutDurationMinutes: 15,
  maxActiveSessions: 0,
  passwordExpiryDays: 0,
};

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

interface RawSecurityConfig {
  min_password_length?: string;
  require_uppercase?: string;
  require_numbers?: string;
  require_special_chars?: string;
  max_login_attempts?: string;
  lockout_duration_minutes?: string;
  max_active_sessions?: string;
  password_expiry_days?: string;
}

export async function getSecurityPolicy(db: D1Database): Promise<SecurityPolicy> {
  const row = await db
    .prepare(
      `SELECT config_value FROM system_config
       WHERE category = 'security_settings' AND config_key = 'security_config' AND is_active = 1
       LIMIT 1`,
    )
    .bind()
    .first<{ config_value: string }>();

  if (!row?.config_value) return { ...DEFAULT_SECURITY_POLICY };

  let raw: RawSecurityConfig;
  try {
    raw = JSON.parse(row.config_value);
  } catch {
    return { ...DEFAULT_SECURITY_POLICY };
  }

  // The UI's own <input min/max> bounds (AdminSystemTab.tsx:2253-2297) are the
  // clamp bounds here, so a value saved through the admin form always round-trips
  // unchanged, and a value it could never produce can't be forced in some other way.
  return {
    minPasswordLength: clamp(Number(raw.min_password_length), 6, 32, DEFAULT_SECURITY_POLICY.minPasswordLength),
    requireUppercase: raw.require_uppercase !== undefined ? raw.require_uppercase === '1' : DEFAULT_SECURITY_POLICY.requireUppercase,
    requireLowercase: true, // not exposed as a toggle in the UI; always required
    requireNumbers: raw.require_numbers !== undefined ? raw.require_numbers === '1' : DEFAULT_SECURITY_POLICY.requireNumbers,
    requireSpecialChars: raw.require_special_chars !== undefined ? raw.require_special_chars === '1' : DEFAULT_SECURITY_POLICY.requireSpecialChars,
    maxLoginAttempts: clamp(Number(raw.max_login_attempts), 1, 20, DEFAULT_SECURITY_POLICY.maxLoginAttempts),
    lockoutDurationMinutes: clamp(Number(raw.lockout_duration_minutes), 1, 1440, DEFAULT_SECURITY_POLICY.lockoutDurationMinutes),
    maxActiveSessions: clamp(Number(raw.max_active_sessions), 1, 10, DEFAULT_SECURITY_POLICY.maxActiveSessions),
    passwordExpiryDays: clamp(Number(raw.password_expiry_days), 0, 365, DEFAULT_SECURITY_POLICY.passwordExpiryDays),
  };
}

export function validatePassword(pwd: string, policy: SecurityPolicy): string | null {
  if (typeof pwd !== 'string' || pwd.length < policy.minPasswordLength) {
    return `Password must be at least ${policy.minPasswordLength} characters`;
  }
  if (policy.requireUppercase && !/[A-Z]/.test(pwd)) return 'Password must contain an uppercase letter';
  if (policy.requireLowercase && !/[a-z]/.test(pwd)) return 'Password must contain a lowercase letter';
  if (policy.requireNumbers && !/[0-9]/.test(pwd)) return 'Password must contain a number';
  if (policy.requireSpecialChars && !/[^A-Za-z0-9]/.test(pwd)) return 'Password must contain a special character';
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/securityPolicy.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utils/securityPolicy.ts tests/securityPolicy.test.ts
git commit -m "feat(security): add typed security policy reader + password validator"
```

---

### Task 2: Wire password validation + `/password-policy` in `auth.ts`

**Files:**
- Modify: `src/routes/auth.ts:607-614` (delete `validateNewPassword`, replace its 4 call sites), `src/routes/auth.ts:961-970` (`GET /password-policy`)
- Test: `tests/auth.test.ts` (create if it doesn't already cover this route; check first)

**Interfaces:**
- Consumes: `getSecurityPolicy(db)`, `validatePassword(pwd, policy)` from Task 1 (`../utils/securityPolicy`)

- [ ] **Step 1: Check for an existing auth policy test to extend**

Run: `ls tests/ | grep -i auth`
If `tests/auth.test.ts` exists, read it first and add the new test there instead of creating a duplicate file with a colliding name.

- [ ] **Step 2: Write the failing test**

```typescript
// tests/auth.test.ts (add to existing file, or create if none exists)
import { describe, it, expect } from 'vitest';
import { validatePassword, DEFAULT_SECURITY_POLICY } from '../src/utils/securityPolicy';

describe('auth.ts password policy integration', () => {
  it('DEFAULT_SECURITY_POLICY still requires the same 4 character classes auth.ts historically enforced', () => {
    // Locks in that Task 1's default matches the pre-existing validateNewPassword
    // behavior this task removes — a regression here means a live behavior change.
    expect(validatePassword('short1!', DEFAULT_SECURITY_POLICY)).toBe('Password must be at least 8 characters');
    expect(validatePassword('alllowercase1!', DEFAULT_SECURITY_POLICY)).toBe('Password must contain an uppercase letter');
    expect(validatePassword('ALLUPPERCASE1!', DEFAULT_SECURITY_POLICY)).toBe('Password must contain a lowercase letter');
    expect(validatePassword('NoDigitsHere!', DEFAULT_SECURITY_POLICY)).toBe('Password must contain a number');
    expect(validatePassword('NoSpecialChar1', DEFAULT_SECURITY_POLICY)).toBe('Password must contain a special character');
    expect(validatePassword('ValidPassword1!', DEFAULT_SECURITY_POLICY)).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it passes already (Task 1 already implements this — this step just confirms the integration point before editing auth.ts)**

Run: `npx vitest run tests/auth.test.ts`
Expected: PASS

- [ ] **Step 4: Edit `auth.ts` — remove `validateNewPassword`, use the shared module**

Delete the function at `src/routes/auth.ts:607-614`:

```typescript
// DELETE this block:
function validateNewPassword(pwd: string): string | null {
  if (typeof pwd !== 'string' || pwd.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(pwd)) return 'Password must contain an uppercase letter';
  if (!/[a-z]/.test(pwd)) return 'Password must contain a lowercase letter';
  if (!/[0-9]/.test(pwd)) return 'Password must contain a number';
  if (!/[^A-Za-z0-9]/.test(pwd)) return 'Password must contain a special character';
  return null;
}
```

Add the import near the top of the file (alongside the other `../utils/*` imports):

```typescript
import { getSecurityPolicy, validatePassword } from '../utils/securityPolicy';
```

At each of the 4 call sites (`src/routes/auth.ts:622`, `:659`, `:694`, `:849`), replace:

```typescript
const policyErr = validateNewPassword(new_password);
```

with:

```typescript
const securityPolicy = await getSecurityPolicy(db);
const policyErr = validatePassword(new_password, securityPolicy);
```

(adjust the variable name used at each site — `new_password`, `next`, `next`, `newPassword` respectively — to match what's already in scope there; `db` is already in scope at all 4 sites).

- [ ] **Step 5: Edit `auth.ts` — make `GET /password-policy` return the real policy**

Replace `src/routes/auth.ts:961-970`:

```typescript
auth.get('/password-policy', (c) => {
  return c.json({
    minLength: 8,
    requireUppercase: true,
    requireLowercase: true,
    requireNumber: true,
    requireSpecial: true,
    expiryDays: 90,
    preventReuse: 5,
  });
});
```

with:

```typescript
auth.get('/password-policy', async (c) => {
  const policy = await getSecurityPolicy(getDb(c.env));
  return c.json({
    minLength: policy.minPasswordLength,
    requireUppercase: policy.requireUppercase,
    requireLowercase: policy.requireLowercase,
    requireNumber: policy.requireNumbers,
    requireSpecial: policy.requireSpecialChars,
    expiryDays: policy.passwordExpiryDays,
    preventReuse: 5, // not yet configurable — no UI field exists for this
  });
});
```

- [ ] **Step 6: Typecheck and run the full worker test suite**

Run: `npm run typecheck && npx vitest run`
Expected: 0 typecheck errors; all tests pass (re-run once if `tests/pdfSign.test.ts` or `tests/footage/flexcamRoute.test.ts` time out under load — see CLAUDE.md's documented flake).

- [ ] **Step 7: Commit**

```bash
git add src/routes/auth.ts tests/auth.test.ts
git commit -m "feat(security): enforce configurable password policy in auth.ts"
```

---

### Task 3: Wire password validation in `personnel.ts` (admin-created / admin-reset passwords)

**Files:**
- Modify: `src/routes/personnel.ts:1504` (create user), `src/routes/personnel.ts:1775` (admin reset-password)
- Test: `tests/personnel.test.ts` (check for an existing file first, same as Task 2 Step 1)

**Interfaces:**
- Consumes: `getSecurityPolicy(db)`, `validatePassword(pwd, policy)` from Task 1

- [ ] **Step 1: Write the failing test**

```typescript
// tests/personnel.test.ts (add to existing file if present)
import { describe, it, expect } from 'vitest';
import { validatePassword, DEFAULT_SECURITY_POLICY } from '../src/utils/securityPolicy';

describe('personnel.ts password policy integration', () => {
  it('an 8-character password with no complexity fails the default policy', () => {
    // Before this task, personnel.ts accepted this password (length-only check).
    // After this task, the create-user and reset-password routes must reject it.
    expect(validatePassword('12345678', DEFAULT_SECURITY_POLICY)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it passes (confirms the module behavior before wiring the routes)**

Run: `npx vitest run tests/personnel.test.ts`
Expected: PASS

- [ ] **Step 3: Add the import**

At the top of `src/routes/personnel.ts`, alongside the existing imports:

```typescript
import { getSecurityPolicy, validatePassword } from '../utils/securityPolicy';
```

- [ ] **Step 4: Replace the create-user check**

Replace `src/routes/personnel.ts:1504`:

```typescript
if (password.length < 8) return c.json({ error: 'password must be at least 8 characters' }, 400);
```

with:

```typescript
const securityPolicy = await getSecurityPolicy(db);
const passwordErr = validatePassword(password, securityPolicy);
if (passwordErr) return c.json({ error: passwordErr }, 400);
```

(`db` must already be in scope above this line in the handler — confirm via the surrounding code at `personnel.ts:1516` where `getDb` is called; if `db` isn't yet defined at line 1504, move the `getDb(c.env)` call earlier in the handler rather than duplicating it.)

- [ ] **Step 5: Replace the reset-password check**

Replace `src/routes/personnel.ts:1775-1777`:

```typescript
if (!newPassword || newPassword.length < 8) {
  return c.json({ error: 'Password must be at least 8 characters' }, 400);
}
```

with:

```typescript
if (!newPassword) {
  return c.json({ error: 'Password is required' }, 400);
}
const db = getDb(c.env);
const securityPolicy = await getSecurityPolicy(db);
const passwordErr = validatePassword(newPassword, securityPolicy);
if (passwordErr) return c.json({ error: passwordErr }, 400);
```

(Check the existing code a few lines below at `personnel.ts:1780` — `const db = getDb(c.env);` already exists there. Delete that now-duplicate line and keep the single `db` declaration introduced above, so the handler declares `db` exactly once.)

- [ ] **Step 6: Typecheck and run the full worker test suite**

Run: `npm run typecheck && npx vitest run`
Expected: 0 typecheck errors; all tests pass

- [ ] **Step 7: Commit**

```bash
git add src/routes/personnel.ts tests/personnel.test.ts
git commit -m "feat(security): enforce configurable password policy in personnel.ts"
```

---

### Task 4: Wire login-lockout threshold + duration to the saved policy

**Files:**
- Modify: `src/routes/auth.ts:43-44` (delete the two constants), `src/routes/auth.ts:220-280` (the `/login` handler's lockout logic)
- Test: `tests/auth.test.ts`

**Interfaces:**
- Consumes: `getSecurityPolicy(db)` from Task 1

- [ ] **Step 1: Write the failing test**

```typescript
// tests/auth.test.ts (add)
describe('lockout policy defaults', () => {
  it('DEFAULT_SECURITY_POLICY.maxLoginAttempts matches the pre-existing FAILED_LOGIN_THRESHOLD (5)', () => {
    expect(DEFAULT_SECURITY_POLICY.maxLoginAttempts).toBe(5);
  });
  it('DEFAULT_SECURITY_POLICY.lockoutDurationMinutes matches the pre-existing LOCKOUT_DURATION_MINUTES (15)', () => {
    expect(DEFAULT_SECURITY_POLICY.lockoutDurationMinutes).toBe(15);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run tests/auth.test.ts`
Expected: PASS

- [ ] **Step 3: Delete the hardcoded constants**

Delete `src/routes/auth.ts:43-44`:

```typescript
// DELETE:
const FAILED_LOGIN_THRESHOLD = 5;
const LOCKOUT_DURATION_MINUTES = 15;
```

- [ ] **Step 4: Read the policy once at the top of the `/login` handler**

Immediately after the existing `const db = getDb(c.env);` / `await ensureAccountLockoutColumns(db);` lines near `src/routes/auth.ts:216-217`, add:

```typescript
const securityPolicy = await getSecurityPolicy(db);
```

- [ ] **Step 5: Replace the interpolated SQL literals**

At `src/routes/auth.ts:265-266`, replace:

```typescript
             WHEN (CASE WHEN locked_until IS NOT NULL AND locked_until <= datetime('now') THEN 0 ELSE failed_login_count END) + 1 >= ${FAILED_LOGIN_THRESHOLD}
               THEN datetime('now', '+${LOCKOUT_DURATION_MINUTES} minutes')
```

with:

```typescript
             WHEN (CASE WHEN locked_until IS NOT NULL AND locked_until <= datetime('now') THEN 0 ELSE failed_login_count END) + 1 >= ${securityPolicy.maxLoginAttempts}
               THEN datetime('now', '+${securityPolicy.lockoutDurationMinutes} minutes')
```

(These values are already clamped to `1-20` and `1-1440` by `getSecurityPolicy` in Task 1, so they are safe to interpolate as numeric literals the same way the two constants were — no new injection surface.)

At `src/routes/auth.ts:277-279`, replace:

```typescript
        return c.json({
          error: `Account locked due to repeated failed attempts. Try again in ${LOCKOUT_DURATION_MINUTES} minutes.`,
          code: 'ACCOUNT_LOCKED',
          retry_after_seconds: LOCKOUT_DURATION_MINUTES * 60,
        }, 403);
```

with:

```typescript
        return c.json({
          error: `Account locked due to repeated failed attempts. Try again in ${securityPolicy.lockoutDurationMinutes} minutes.`,
          code: 'ACCOUNT_LOCKED',
          retry_after_seconds: securityPolicy.lockoutDurationMinutes * 60,
        }, 403);
```

- [ ] **Step 6: Typecheck and run the full worker test suite**

Run: `npm run typecheck && npx vitest run`
Expected: 0 typecheck errors; all tests pass

- [ ] **Step 7: Commit**

```bash
git add src/routes/auth.ts tests/auth.test.ts
git commit -m "feat(security): read login lockout threshold/duration from saved policy"
```

---

### Task 5: Enforce `maxActiveSessions` in `createSession()`

**Files:**
- Modify: `src/routes/auth.ts:135-145` (`createSession`)
- Test: `tests/auth.test.ts`

**Interfaces:**
- Consumes: `getSecurityPolicy(db)` from Task 1

- [ ] **Step 1: Write the failing test**

```typescript
// tests/auth.test.ts (add)
describe('createSession session cap', () => {
  it('DEFAULT_SECURITY_POLICY.maxActiveSessions is 0 (unenforced) by default', () => {
    // Today, before this task, there is NO session cap anywhere in the codebase.
    // 0 means "don't enforce" so an admin who has never touched this section
    // sees no behavior change — matches the binding constraint in Task 1.
    expect(DEFAULT_SECURITY_POLICY.maxActiveSessions).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run tests/auth.test.ts`
Expected: PASS

- [ ] **Step 3: Edit `createSession` to enforce the cap after inserting the new session**

Replace `src/routes/auth.ts:134-145`:

```typescript
async function createSession(c: any, db: any, userId: number, refreshToken: string): Promise<string> {
  const sessionId = uuidv4(); // full dashed UUID → matches live session_id (36 chars)
  const refreshHash = await sha256Hex(refreshToken);
  await execute(
    db,
    `INSERT INTO sessions (session_id, user_id, refresh_token_hash, ip_address, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?, datetime('now', '+7 days'))`,
    sessionId, userId, refreshHash,
    c.req.header('cf-connecting-ip') || '', c.req.header('user-agent') || '',
  );
  return sessionId;
}
```

with:

```typescript
async function createSession(c: any, db: any, userId: number, refreshToken: string): Promise<string> {
  const sessionId = uuidv4(); // full dashed UUID → matches live session_id (36 chars)
  const refreshHash = await sha256Hex(refreshToken);
  await execute(
    db,
    `INSERT INTO sessions (session_id, user_id, refresh_token_hash, ip_address, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?, datetime('now', '+7 days'))`,
    sessionId, userId, refreshHash,
    c.req.header('cf-connecting-ip') || '', c.req.header('user-agent') || '',
  );

  // Enforce Security Policy → "Max Active Sessions". 0 means unenforced
  // (today's behavior — no cap has ever existed). Best-effort: never fail
  // the login itself if this cleanup step errors.
  try {
    const policy = await getSecurityPolicy(db);
    if (policy.maxActiveSessions > 0) {
      await execute(
        db,
        `UPDATE sessions SET is_active = 0
         WHERE user_id = ? AND is_active = 1
           AND session_id NOT IN (
             SELECT session_id FROM sessions
             WHERE user_id = ? AND is_active = 1
             ORDER BY created_at DESC
             LIMIT ?
           )`,
        userId, userId, policy.maxActiveSessions,
      );
    }
  } catch { /* session-cap cleanup is best-effort — never block login */ }

  return sessionId;
}
```

- [ ] **Step 4: Typecheck and run the full worker test suite**

Run: `npm run typecheck && npx vitest run`
Expected: 0 typecheck errors; all tests pass

- [ ] **Step 5: Manual verification against local D1**

Run: `npm run dev` (wrangler dev on 8787), then in a second terminal:

```bash
npm run migrate:local
```

Log in 4 times as the same local test user with `max_active_sessions` saved as `2` via `PUT /admin/config` (or directly via the admin UI at `http://localhost:5173/admin?tab=system` if the client dev server is also running), then run:

```bash
npx wrangler d1 execute rmpg-flex --local --command "SELECT session_id, is_active FROM sessions WHERE user_id = <test_user_id> ORDER BY created_at DESC"
```

Expected: only the 2 most recent sessions have `is_active = 1`; the older 2 have `is_active = 0`.

- [ ] **Step 6: Commit**

```bash
git add src/routes/auth.ts tests/auth.test.ts
git commit -m "feat(security): enforce max active sessions from saved policy"
```

---

### Task 6: Remove the Phase-0 notice and fix the client default mismatch

**Files:**
- Modify: `client/src/pages/admin/AdminSystemTab.tsx`

**Interfaces:**
- None (client-only display change; no new props or exports)

- [ ] **Step 1: Find and remove the Security Policy "not enforced" notice**

Run: `grep -n "NotEnforcedNotice" client/src/pages/admin/AdminSystemTab.tsx`

Find the invocation scoped to the Security Policy section (near `AdminSystemTab.tsx:2244`, inside the `activeSection === 'security'` block). Delete that single `<NotEnforcedNotice ... />` JSX element (leave the import and other sections' usages untouched — they still apply to Priorities, Call Sources, Unit Types, Zones & Beats, and Evidence Types, none of which this plan wires).

- [ ] **Step 2: Fix `DEFAULT_SECURITY.require_special_chars`**

At `client/src/pages/admin/AdminSystemTab.tsx:207-215`, change:

```typescript
const DEFAULT_SECURITY: SecurityConfig = {
  min_password_length: '8',
  require_uppercase: '1',
  require_numbers: '1',
  require_special_chars: '0',
  max_login_attempts: '5',
  lockout_duration_minutes: '15',
  max_active_sessions: '3',
  password_expiry_days: '0',
};
```

to:

```typescript
const DEFAULT_SECURITY: SecurityConfig = {
  min_password_length: '8',
  require_uppercase: '1',
  require_numbers: '1',
  require_special_chars: '1', // matches the Worker's DEFAULT_SECURITY_POLICY (src/utils/securityPolicy.ts) — this section is now enforced
  max_login_attempts: '5',
  lockout_duration_minutes: '15',
  max_active_sessions: '3',
  password_expiry_days: '0',
};
```

(Note: `max_active_sessions` here stays `'3'` as the client form's pre-filled *suggestion* — it does not change enforced behavior until an admin clicks Save, since the Worker's real unenforced default from Task 1 is `0`, not `3`.)

- [ ] **Step 3: Typecheck and run the client test suite**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: 0 typecheck errors; all tests pass

- [ ] **Step 4: Manual browser verification**

Navigate to `https://rmpgutah.us/admin?tab=system` (or local `http://localhost:5173/admin?tab=system` against `npm run dev`), click "Security Policy" in the left nav, and confirm:
- The "not yet enforced" notice is gone from this section only (still present on Priorities/Call Sources/Unit Types/Zones & Beats/Evidence Types).
- The "Require Special Character" toggle now defaults to on for a fresh install.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/admin/AdminSystemTab.tsx
git commit -m "feat(security): remove not-enforced notice from Security Policy section"
```

---

## Self-Review Notes (for the implementer, not a separate step)

- **Spec coverage:** all 8 `SecurityConfig` fields are addressed — 7 enforced (min length, uppercase, numbers, special chars, max login attempts, lockout duration, max active sessions), 1 explicitly deferred with a stated reason (password expiry days) per the Global Constraints section.
- **Type consistency:** `SecurityPolicy` fields introduced in Task 1 (`minPasswordLength`, `requireUppercase`, `requireLowercase`, `requireNumbers`, `requireSpecialChars`, `maxLoginAttempts`, `lockoutDurationMinutes`, `maxActiveSessions`, `passwordExpiryDays`) are used with the exact same names and types in Tasks 2–5.
- **No placeholders:** every step above shows complete, exact code — no "add validation here" or "similar to Task N" shortcuts.
