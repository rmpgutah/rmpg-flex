# Security Hardening (Tier 1 + Tier 2) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden RMPG Flex with 8 defense-in-depth security improvements covering cookie security, payload limits, pagination caps, security alerting, token revocation on privilege change, CSP nonces, WebSocket message validation, and database query timeouts.

**Architecture:** Surgical edits to existing middleware and config files. One new utility (`securityAlerts.ts`) and one new DB table (`security_alerts`). Token revocation uses a `token_generation` counter on the `users` table — when a user's role changes, their generation increments and existing JWTs (which embed the old generation) are rejected by auth middleware.

**Tech Stack:** Express 4, better-sqlite3, JWT, WebSocket (ws), crypto

---

### Task 1: Harden index.ts — Error Handler, Health Endpoint, Cache Headers

**Files:**
- Modify: `server/src/index.ts:227-253` (health endpoint), `:437-442` (error handler)

**Step 1: Fix global error handler information leak**

The global error handler at line 437-442 leaks `err.message` to clients. Change line 440 from:
```typescript
res.status(500).json({ error: err?.message || 'Internal server error' });
```
to:
```typescript
res.status(500).json({ error: 'Internal server error' });
```

**Step 2: Harden health endpoint — strip sensitive info in production**

Replace lines 227-253 so that production returns only `status`, `timestamp`, `database.status`. Dev keeps the full response.

**Step 3: Add `Cache-Control: no-store` to all API responses**

Before line 209 (`app.use('/api', apiRateLimit)`), add middleware:
```typescript
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});
```

**Step 4: Commit**
```bash
git commit -m "fix: harden error handler, health endpoint, and API cache headers"
```

---

### Task 2: Token Revocation on Privilege Change

**Files:**
- Modify: `server/src/models/database.ts` (add `token_generation` column)
- Modify: `server/src/middleware/auth.ts` (check generation in JWT validation + update JwtPayload interface)
- Modify: `server/src/routes/auth.ts` (embed generation in JWTs at login)
- Modify: `server/src/routes/admin.ts:1097-1152` (bump generation on role change)

**Step 1: Add `token_generation` column via migration in `migrateSchema()`**

```typescript
try {
  db.prepare("SELECT token_generation FROM users LIMIT 0").get();
} catch {
  db.prepare("ALTER TABLE users ADD COLUMN token_generation INTEGER NOT NULL DEFAULT 1").run();
  console.log('[Migration] Added token_generation column to users');
}
```

**Step 2: Update JwtPayload interface in auth.ts**

Add `tokenGeneration?: number` to the interface.

**Step 3: Embed generation in JWT at login**

In `server/src/routes/auth.ts`, wherever `generateAccessToken` is called after login, include `tokenGeneration: user.token_generation` in the payload object.

**Step 4: Validate generation in `authenticateToken` middleware**

After the IP validation block (after line 65 in auth.ts), add a check:
- Query `SELECT token_generation FROM users WHERE id = ?`
- If `user.token_generation > decoded.tokenGeneration`, return 401 with code `TOKEN_REVOKED`
- Wrap in try/catch to avoid lockout on DB failure

**Step 5: Bump generation on role change in admin.ts**

After line 1125 in admin.ts, add:
```typescript
db.prepare('UPDATE users SET token_generation = token_generation + 1 WHERE id = ?').run(userId);
```

**Step 6: Commit**
```bash
git commit -m "feat: token revocation via generation counter on privilege changes"
```

---

### Task 3: Security Alerts System

**Files:**
- Create: `server/src/utils/securityAlerts.ts`
- Modify: `server/src/models/database.ts` (create `security_alerts` table)
- Modify: `server/src/routes/auth.ts` (emit alerts on login anomalies)
- Modify: `server/src/routes/admin.ts` (alert on privilege escalation + read/acknowledge endpoints)

**Step 1: Create `security_alerts` table in `createTables()`**

```sql
CREATE TABLE IF NOT EXISTS security_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('low','medium','high','critical')),
  title TEXT NOT NULL,
  details TEXT,
  source_ip TEXT,
  user_id INTEGER,
  acknowledged_by INTEGER,
  acknowledged_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
```

Add indexes in `createIndexes()`:
```sql
CREATE INDEX IF NOT EXISTS idx_security_alerts_created ON security_alerts(created_at);
CREATE INDEX IF NOT EXISTS idx_security_alerts_severity ON security_alerts(severity, acknowledged_at);
```

**Step 2: Create `securityAlerts.ts` utility**

Functions:
- `createSecurityAlert(alertType, severity, title, details, sourceIp?, userId?)` — inserts row + broadcasts via WebSocket
- `checkLoginAnomalies(ip, username)` — checks for 5+ failures from same IP in 5 min, creates alert if threshold met (deduplicated to 1 per IP per 15 min)
- `alertPrivilegeEscalation(targetUserId, targetUsername, oldRole, newRole, changedBy, ip)` — creates critical/high alert

**Step 3: Wire into auth.ts login failure path**

After each failed login, call `checkLoginAnomalies(ip, username)`.

**Step 4: Wire into admin.ts role change handler**

After role change at line 1130, call `alertPrivilegeEscalation(...)`.

**Step 5: Add admin endpoints**

- `GET /api/admin/security-alerts` — list alerts with optional severity/acknowledged filters, max 200
- `PUT /api/admin/security-alerts/:id/acknowledge` — mark alert acknowledged

**Step 6: Commit**
```bash
git commit -m "feat: security alerts system with brute-force and privilege escalation detection"
```

---

### Task 4: CSP Nonce-Based Script Loading

**Files:**
- Modify: `server/src/middleware/securityHeaders.ts` (generate nonce, add to CSP)
- Modify: `server/src/index.ts` (inject nonce into HTML responses)

**Step 1: Generate per-request nonce in securityHeaders.ts**

```typescript
import crypto from 'crypto';
// At top of function:
const nonce = crypto.randomBytes(16).toString('base64');
res.locals.cspNonce = nonce;
```

Update script-src to include `'nonce-${nonce}'` alongside existing `'unsafe-inline'` (kept for Google Maps compatibility).

**Step 2: Inject nonce into HTML**

In the SPA fallback in index.ts (line 419-432), read index.html as string, replace `<script` with `<script nonce="${nonce}"`, send as response.

**Step 3: Commit**
```bash
git commit -m "feat: CSP nonce-based script loading for defense-in-depth"
```

---

### Task 5: WebSocket Message Schema Validation

**Files:**
- Modify: `server/src/utils/websocket.ts:197-208`

**Step 1: Add valid message types allowlist**

Define `VALID_WS_TYPES` Set at module level with all accepted message types.

**Step 2: Add validation in message handler**

After `JSON.parse` at line 198, before `handleClientMessage`:
1. Validate `message` is an object with a string `type` field
2. Reject unknown message types
3. Require authentication for all types except `authenticate` and `ping`
4. Add 64KB text message size check (binary audio handled separately by `maxPayload`)

**Step 3: Commit**
```bash
git commit -m "feat: WebSocket message schema validation and auth enforcement"
```

---

### Task 6: Pagination Cap Standardization

**Files:**
- Modify: Any route file using `Math.min(500, ...)` for pagination

**Step 1: Find and fix oversized pagination caps**

Search for `Math.min(500` in route files. Change to `Math.min(200, ...)`.

Check `server/src/routes/incidents.ts` specifically — it allows up to 500.

**Step 2: Commit**
```bash
git commit -m "fix: standardize pagination cap to 200 across all routes"
```

---

### Task 7: Database Query Timeout (Already Covered)

`better-sqlite3` is synchronous — no async timeout mechanism exists. Protection is already in place via:
- `PRAGMA busy_timeout = 5000` (line 44 in database.ts) — handles lock contention
- `req.setTimeout(30_000)` (line 202 in index.ts) — kills HTTP requests that block too long

**No code changes needed.** Skip this task.

---

### Task 8: Build Verification

**Step 1: Run TypeScript type check**
```bash
cd server && npx tsc --noEmit
```

**Step 2: Run client build**
```bash
cd client && npx vite build
```

**Step 3: Run tests**
```bash
cd server && npm test
```
