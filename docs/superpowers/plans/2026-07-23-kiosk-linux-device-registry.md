# Kiosk Linux Device Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated device registry (registration + fleet tracking, no OTA delivery) for Kiosk Linux devices, backed by a new D1 database and R2 bucket bound to the existing `rmpg-flex-api` Worker, with admin-JWT-gated CRUD and a device-bearer-token check-in/upload surface, plus an admin UI tab.

**Architecture:** New routes in `src/routes/kioskLinux.ts`, mounted at `/api/kiosk-linux` via `ROUTE_REGISTRY`. Admin endpoints reuse the existing `authMiddleware` + `requireRole('admin', 'manager')`, applied per-route (not per-prefix, since the same router also serves device-token-authed paths). Device endpoints use a new `deviceAuthMiddleware` that bcrypt-compares an `Authorization: Bearer <token>` header against a stored hash — no JWT involved. Data lives in a new dedicated D1 database `kiosk-linux-fleet` (bound `KIOSK_DB`) and R2 bucket `kiosk-linux-devices` (bound `KIOSK_DEVICES`), both optional bindings that degrade to `{ ok: false, code: 'not_configured' }` rather than crashing if unset.

**Tech Stack:** Hono (Worker), Cloudflare D1 + R2, `bcryptjs` (already a dependency), React + TypeScript (client), `apiFetch`/`apiPostForm` from `client/src/hooks/useApi.ts`.

## Global Constraints

- New optional bindings never crash the Worker when unset — every route in `kioskLinux.ts` returns `200 { ok: false, code: 'not_configured' }` when `KIOSK_DB`/`KIOSK_DEVICES` is missing (per `CLAUDE.md`'s established pattern for optional integrations — Fleet.io, Roboflow, Legal Data Hunter — and per [`docs/superpowers/specs/2026-07-23-kiosk-linux-device-registry-design.md`](../specs/2026-07-23-kiosk-linux-device-registry-design.md)).
- The device bearer token is shown in plaintext exactly once (the registration API response) and never stored in plaintext — only its bcrypt hash persists.
- `kiosk-linux-fleet` is a separate D1 database from the main `rmpg-flex` D1 — it has its own migration file sequence starting at `0001`, stored under `kiosk-linux/migrations/`, NOT the repo's top-level `migrations/` directory.
- All D1 calls are async — always `await` (`CLAUDE.md` gotcha #3).
- Follow the existing `ROUTE_REGISTRY` alphabetical-by-prefix convention in `src/routesConfig.ts` when inserting the new mount.
- Adding the AdminPage tab requires FOUR edits (`CLAUDE.md` gotcha #16): the `VALID_TABS` array, the `TabId` type union, the `{id,label,icon}` config array, and the `{activeTab === '...' && <Tab/>}` render block.

---

### Task 1: D1 schema — migrations for `kiosk-linux-fleet`

**Files:**
- Create: `kiosk-linux/migrations/0001_kiosk_devices.sql`
- Create: `kiosk-linux/migrations/README.md`

**Interfaces:**
- Produces: the `kiosk_devices` and `kiosk_device_uploads` tables, consumed by every later task's D1 queries.

- [ ] **Step 1: Write the migration file**

```sql
-- kiosk-linux/migrations/0001_kiosk_devices.sql
CREATE TABLE IF NOT EXISTS kiosk_devices (
  id            TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  token_hash    TEXT NOT NULL,
  os_version    TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  registered_at TEXT NOT NULL,
  last_seen_at  TEXT,
  last_ip       TEXT
);

CREATE TABLE IF NOT EXISTS kiosk_device_uploads (
  id          TEXT PRIMARY KEY,
  device_id   TEXT NOT NULL REFERENCES kiosk_devices(id),
  kind        TEXT NOT NULL,
  r2_key      TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  uploaded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kiosk_device_uploads_device
  ON kiosk_device_uploads(device_id);
```

- [ ] **Step 2: Write the migrations README** (this is a brand-new, separate database — document that explicitly so a future session doesn't confuse it with the main `rmpg-flex` migration sequence)

```markdown
# Kiosk Linux Fleet — D1 Migrations

Migrations for the **dedicated** `kiosk-linux-fleet` D1 database (bound as
`KIOSK_DB` in `wrangler.toml`). This is a SEPARATE database from the main
`rmpg-flex` D1 (bound `DB`) — its migration numbering starts fresh at
`0001` and has no relationship to the top-level `migrations/` directory's
numbering.

## Applying

```bash
wrangler d1 migrations apply kiosk-linux-fleet --remote
```

(Run from the repo root — `wrangler.toml`'s `[[d1_databases]]` entry for
`KIOSK_DB` points wrangler at this directory via its own
`migrations_dir` setting; see Task 2.)
```

- [ ] **Step 3: Commit**

```bash
git add kiosk-linux/migrations/0001_kiosk_devices.sql kiosk-linux/migrations/README.md
git commit -m "feat(kiosk-linux): add device registry D1 schema (migration 0001)"
```

---

### Task 2: Bindings — `wrangler.toml` + `src/types.ts`

**Files:**
- Modify: `wrangler.toml`
- Modify: `src/types.ts:7-19` (the `Bindings` type)

**Interfaces:**
- Consumes: nothing.
- Produces: `env.KIOSK_DB` (`D1Database`, optional) and `env.KIOSK_DEVICES` (`R2Bucket`, optional), consumed by Task 3's route handlers.

- [ ] **Step 1: Add the new D1 binding to `wrangler.toml`**, right after the existing `GEO_DB` block (`wrangler.toml:59-62`):

```toml
[[d1_databases]]
binding = "KIOSK_DB"
database_name = "kiosk-linux-fleet"
database_id = "REPLACE_WITH_REAL_ID_AFTER_WRANGLER_D1_CREATE"
migrations_dir = "kiosk-linux/migrations"
```

`database_id` is a placeholder — Task 7 (deployment) replaces it with the
real id returned by `wrangler d1 create kiosk-linux-fleet`. Do not attempt
to deploy with the placeholder still in place.

- [ ] **Step 2: Add the new R2 binding**, right after the existing `DOWNLOADS` block (`wrangler.toml:132-134`):

```toml
[[r2_buckets]]
binding = "KIOSK_DEVICES"
bucket_name = "kiosk-linux-devices"
```

- [ ] **Step 3: Add both bindings to `src/types.ts`'s `Bindings` type**, right after the `DOWNLOADS` field (`src/types.ts:19`):

```ts
  // Kiosk Linux sub-project 4: device registry. Optional — routes in
  // src/routes/kioskLinux.ts return { ok:false, code:'not_configured' }
  // when unset, per the established pattern for optional integrations.
  KIOSK_DB?: D1Database;
  KIOSK_DEVICES?: R2Bucket;
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: passes (no route file references these bindings yet, so this is purely additive).

- [ ] **Step 5: Commit**

```bash
git add wrangler.toml src/types.ts
git commit -m "feat(kiosk-linux): add KIOSK_DB/KIOSK_DEVICES bindings"
```

---

### Task 3: Device-auth middleware

**Files:**
- Create: `src/middleware/kioskDeviceAuth.ts`
- Test: `tests/kioskDeviceAuth.test.ts`

**Interfaces:**
- Consumes: `env.KIOSK_DB` (Task 2), the `kiosk_devices` table (Task 1).
- Produces: `deviceAuthMiddleware(c, next)` — a Hono middleware function. On success, calls `c.set('kioskDevice', { id, label })` and calls `next()`. On failure, returns a `c.json(...)` response directly (never throws). Later tasks (Task 4) read `c.get('kioskDevice')`.

This is Worker code, but bcrypt comparison logic is pure enough to unit-test
by calling the exported helper directly with a fake D1-shaped object — this
repo's Worker route tests use Miniflare (`test-workers/`), but the plain
Node `tests/` directory (per `CLAUDE.md`'s Testing & CI section) is
sufficient here since we're testing token comparison logic, not real D1
wiring.

- [ ] **Step 1: Write the failing test**

```ts
// tests/kioskDeviceAuth.test.ts
import { describe, it, expect, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { authenticateDeviceToken } from '../src/middleware/kioskDeviceAuth';

function fakeDb(row: Record<string, unknown> | null) {
  return {
    prepare: () => ({
      bind: () => ({
        first: async () => row,
      }),
    }),
  } as unknown as D1Database;
}

describe('authenticateDeviceToken', () => {
  it('accepts a matching token for an active device', async () => {
    const token = 'test-token-abc123';
    const hash = await bcrypt.hash(token, 10);
    const db = fakeDb({ id: 'dev-1', label: 'Lobby kiosk 1', token_hash: hash, status: 'active' });
    const result = await authenticateDeviceToken(db, 'dev-1', token);
    expect(result).toEqual({ id: 'dev-1', label: 'Lobby kiosk 1' });
  });

  it('rejects a wrong token', async () => {
    const hash = await bcrypt.hash('correct-token', 10);
    const db = fakeDb({ id: 'dev-1', label: 'Lobby kiosk 1', token_hash: hash, status: 'active' });
    const result = await authenticateDeviceToken(db, 'dev-1', 'wrong-token');
    expect(result).toBeNull();
  });

  it('rejects a revoked device even with the correct token', async () => {
    const token = 'test-token-abc123';
    const hash = await bcrypt.hash(token, 10);
    const db = fakeDb({ id: 'dev-1', label: 'Lobby kiosk 1', token_hash: hash, status: 'revoked' });
    const result = await authenticateDeviceToken(db, 'dev-1', token);
    expect(result).toBeNull();
  });

  it('rejects an unknown device id', async () => {
    const db = fakeDb(null);
    const result = await authenticateDeviceToken(db, 'no-such-device', 'anything');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/kioskDeviceAuth.test.ts`
Expected: FAIL — `Cannot find module '../src/middleware/kioskDeviceAuth'`

- [ ] **Step 3: Write the implementation**

```ts
// src/middleware/kioskDeviceAuth.ts
import type { Context, Next } from 'hono';
import bcrypt from 'bcryptjs';
import type { D1Database } from '@cloudflare/workers-types';

interface DeviceRow {
  id: string;
  label: string;
  token_hash: string;
  status: string;
}

/**
 * Looks up device `deviceId` and bcrypt-compares `token` against its stored
 * hash. Returns the device's public identity on success, or null on any
 * failure (unknown device, wrong token, revoked status) — deliberately
 * undifferentiated so a caller can't probe which device ids exist.
 */
export async function authenticateDeviceToken(
  db: D1Database,
  deviceId: string,
  token: string,
): Promise<{ id: string; label: string } | null> {
  const row = await db
    .prepare('SELECT id, label, token_hash, status FROM kiosk_devices WHERE id = ?')
    .bind(deviceId)
    .first<DeviceRow>();
  if (!row || row.status !== 'active') return null;
  const matches = await bcrypt.compare(token, row.token_hash);
  if (!matches) return null;
  return { id: row.id, label: row.label };
}

/**
 * Hono middleware for device-authenticated Kiosk Linux endpoints
 * (check-in, upload). Distinct from the JWT authMiddleware — devices have
 * no user account and no JWT, only their per-device bearer token.
 */
export async function deviceAuthMiddleware(c: Context, next: Next) {
  const kioskDb = (c.env as { KIOSK_DB?: D1Database }).KIOSK_DB;
  if (!kioskDb) {
    return c.json({ ok: false, code: 'not_configured' }, 200);
  }
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Authentication required' }, 401);
  }
  const token = authHeader.slice(7);
  const deviceId = c.req.param('id');
  const device = await authenticateDeviceToken(kioskDb, deviceId, token);
  if (!device) {
    return c.json({ error: 'Invalid or revoked device token' }, 401);
  }
  c.set('kioskDevice', device);
  await next();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/kioskDeviceAuth.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/middleware/kioskDeviceAuth.ts tests/kioskDeviceAuth.test.ts
git commit -m "feat(kiosk-linux): device bearer-token auth middleware"
```

---

### Task 4: Worker routes — `src/routes/kioskLinux.ts`

**Files:**
- Create: `src/routes/kioskLinux.ts`
- Modify: `src/routesConfig.ts` (import + `ROUTE_REGISTRY` entry)

**Interfaces:**
- Consumes: `authMiddleware`/`requireRole` (`src/middleware/auth.ts`), `deviceAuthMiddleware` (Task 3), `c.env.KIOSK_DB`/`c.env.KIOSK_DEVICES` (Task 2).
- Produces: the `/api/kiosk-linux` HTTP surface — `POST /devices`, `GET /devices`, `DELETE /devices/:id`, `POST /devices/:id/checkin`, `POST /devices/:id/upload`. Later tasks (client UI, Task 6) call these exact paths/shapes.

- [ ] **Step 1: Write the route file**

```ts
// ============================================================
// RMPG Flex — Kiosk Linux device registry (sub-project 4)
// ============================================================
// Registration + fleet tracking for Kiosk Linux devices. No OTA image
// delivery — see docs/superpowers/specs/2026-07-23-kiosk-linux-device-registry-design.md.
//
// Backed by a DEDICATED D1 database (kiosk-linux-fleet, bound KIOSK_DB) and
// R2 bucket (kiosk-linux-devices, bound KIOSK_DEVICES) — both separate from
// the main rmpg-flex DB and rmpg-flex-downloads bucket. Unset → every route
// returns { ok:false, code:'not_configured' }, never a crash.
//
// Admin endpoints (register/list/revoke) use the existing JWT authMiddleware
// + requireRole, applied per-route rather than per-prefix — this router
// ALSO serves device-token-authed endpoints (checkin/upload) that carry no
// JWT at all, so a blanket prefix-level authMiddleware would 401 every
// device check-in.
// ============================================================

import { Hono } from 'hono';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import bcrypt from 'bcryptjs';
import type { Env } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';
import { deviceAuthMiddleware } from '../middleware/kioskDeviceAuth';

const kioskLinux = new Hono<Env>();

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function nowIso(): string {
  return new Date().toISOString();
}

function requireKioskDb(env: { KIOSK_DB?: D1Database }): D1Database | null {
  return env.KIOSK_DB ?? null;
}

// ── Admin: register a device ────────────────────────────────
kioskLinux.post('/devices', authMiddleware, requireRole('admin', 'manager'), async (c) => {
  const db = requireKioskDb(c.env);
  if (!db) return c.json({ ok: false, code: 'not_configured' }, 200);

  const body = await c.req.json<{ label?: string }>().catch(() => ({}));
  const label = body.label?.trim();
  if (!label) return c.json({ error: 'label is required' }, 400);

  const id = crypto.randomUUID();
  const token = randomToken();
  const tokenHash = await bcrypt.hash(token, 10);
  const registeredAt = nowIso();

  await db
    .prepare(
      `INSERT INTO kiosk_devices (id, label, token_hash, status, registered_at)
       VALUES (?, ?, ?, 'active', ?)`,
    )
    .bind(id, label, tokenHash, registeredAt)
    .run();

  // The ONLY response that ever carries the plaintext token.
  return c.json({ id, label, token, registered_at: registeredAt });
});

// ── Admin: list devices ──────────────────────────────────────
kioskLinux.get('/devices', authMiddleware, requireRole('admin', 'manager'), async (c) => {
  const db = requireKioskDb(c.env);
  if (!db) return c.json({ ok: false, code: 'not_configured' }, 200);

  const result = await db
    .prepare(
      `SELECT id, label, os_version, status, registered_at, last_seen_at, last_ip
       FROM kiosk_devices ORDER BY registered_at DESC`,
    )
    .all();
  return c.json({ devices: result.results ?? [] });
});

// ── Admin: revoke a device ───────────────────────────────────
kioskLinux.delete('/devices/:id', authMiddleware, requireRole('admin', 'manager'), async (c) => {
  const db = requireKioskDb(c.env);
  if (!db) return c.json({ ok: false, code: 'not_configured' }, 200);

  const id = c.req.param('id');
  const result = await db
    .prepare(`UPDATE kiosk_devices SET status = 'revoked' WHERE id = ? AND status = 'active'`)
    .bind(id)
    .run();
  if (!result.meta?.changes) {
    return c.json({ error: 'Device not found or already revoked' }, 404);
  }
  return c.json({ success: true });
});

// ── Device: check-in ─────────────────────────────────────────
kioskLinux.post('/devices/:id/checkin', deviceAuthMiddleware, async (c) => {
  const db = requireKioskDb(c.env);
  if (!db) return c.json({ ok: false, code: 'not_configured' }, 200);

  const device = c.get('kioskDevice') as { id: string };
  const body = await c.req.json<{ os_version?: string }>().catch(() => ({}));
  const lastIp = c.req.header('CF-Connecting-IP') ?? null;

  await db
    .prepare(
      `UPDATE kiosk_devices SET last_seen_at = ?, os_version = COALESCE(?, os_version), last_ip = ?
       WHERE id = ?`,
    )
    .bind(nowIso(), body.os_version ?? null, lastIp, device.id)
    .run();

  return c.json({ ok: true });
});

// ── Device: upload a config or log file ─────────────────────
kioskLinux.post('/devices/:id/upload', deviceAuthMiddleware, async (c) => {
  const db = requireKioskDb(c.env);
  const bucket = (c.env as { KIOSK_DEVICES?: R2Bucket }).KIOSK_DEVICES;
  if (!db || !bucket) return c.json({ ok: false, code: 'not_configured' }, 200);

  const device = c.get('kioskDevice') as { id: string };
  const form = await c.req.formData();
  const file = form.get('file');
  const kind = form.get('kind');
  if (!(file instanceof File) || (kind !== 'config' && kind !== 'log')) {
    return c.json({ error: 'file (multipart) and kind ("config"|"log") are required' }, 400);
  }

  const uploadedAt = nowIso();
  const r2Key = `${device.id}/${kind}/${uploadedAt}-${file.name}`;
  const bytes = await file.arrayBuffer();
  await bucket.put(r2Key, bytes);

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO kiosk_device_uploads (id, device_id, kind, r2_key, size_bytes, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, device.id, kind, r2Key, bytes.byteLength, uploadedAt)
    .run();

  return c.json({ ok: true, id, r2_key: r2Key });
});

export default kioskLinux;
```

- [ ] **Step 2: Wire the mount into `src/routesConfig.ts`**

Add the import alphabetically near the other `k`-prefixed imports (right
after `import jail from './routes/jail';` at `src/routesConfig.ts:85`):

```ts
import kioskLinux from './routes/kioskLinux';
```

Add the `ROUTE_REGISTRY` entry in the alphabetical RMS section, right
after the `/api/knowledge-base` entry (`src/routesConfig.ts:573-574`):

```ts
  { prefix: '/api/kiosk-linux', router: kioskLinux, auth: 'public',
    note: 'Kiosk Linux device registry (sub-project 4): registration + fleet tracking only, no OTA delivery. auth:"public" at the registry level because /devices/:id/checkin and /devices/:id/upload use a per-device bearer token, not a JWT — admin routes (/devices GET/POST, /devices/:id DELETE) apply authMiddleware+requireRole per-route inside the file instead. 200 {ok:false,code:"not_configured"} when KIOSK_DB/KIOSK_DEVICES are unset.' },
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 4: Manual smoke test against local dev**

Run: `npm run dev` (in one terminal), then in another:

```bash
curl -s -X POST http://localhost:8787/api/kiosk-linux/devices \
  -H "Content-Type: application/json" -d '{"label":"test"}'
```

Expected: `{"ok":false,"code":"not_configured"}` (KIOSK_DB isn't bound in
local dev yet — this confirms the not-configured fallback works, which is
what's testable before Task 7's real resource creation).

- [ ] **Step 5: Commit**

```bash
git add src/routes/kioskLinux.ts src/routesConfig.ts
git commit -m "feat(kiosk-linux): device registry API routes at /api/kiosk-linux"
```

---

### Task 5: Admin UI — `KioskDevicesTab.tsx`

**Files:**
- Create: `client/src/pages/admin/KioskDevicesTab.tsx`

**Interfaces:**
- Consumes: `apiFetch` (`client/src/hooks/useApi.ts`), calls `GET /kiosk-linux/devices`, `POST /kiosk-linux/devices`, `DELETE /kiosk-linux/devices/:id` (Task 4's exact response shapes: `{ devices: [...] }`, `{ id, label, token, registered_at }`, `{ success: true }`).
- Produces: `export default function KioskDevicesTab()`, consumed by Task 6's `AdminPage.tsx` wiring.

- [ ] **Step 1: Write the component**

```tsx
// ============================================================
// RMPG Flex — Admin → Kiosk Devices tab (Kiosk Linux sub-project 4)
// ------------------------------------------------------------
// Device registration + fleet tracking only — no OTA update delivery.
// See docs/superpowers/specs/2026-07-23-kiosk-linux-device-registry-design.md.
// ============================================================
import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../../hooks/useApi';
import { Plus, Trash2, Copy } from 'lucide-react';

interface DeviceRow {
  id: string;
  label: string;
  os_version: string | null;
  status: 'active' | 'revoked';
  registered_at: string;
  last_seen_at: string | null;
  last_ip: string | null;
}

export default function KioskDevicesTab() {
  const [rows, setRows] = useState<DeviceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [issuedToken, setIssuedToken] = useState<{ label: string; token: string } | null>(null);

  const fetchRows = useCallback(() => {
    setErr(null); setLoading(true);
    apiFetch<{ devices: DeviceRow[] }>('/kiosk-linux/devices')
      .then((r) => { setRows(r?.devices ?? []); setLoading(false); })
      .catch((e) => { setErr(e instanceof Error ? e.message : 'Failed to load'); setLoading(false); });
  }, []);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const register = () => {
    const label = newLabel.trim();
    if (!label) return;
    apiFetch<{ id: string; label: string; token: string }>('/kiosk-linux/devices', {
      method: 'POST',
      body: JSON.stringify({ label }),
    })
      .then((r) => { setIssuedToken({ label: r.label, token: r.token }); setNewLabel(''); fetchRows(); })
      .catch((e) => alert(`Failed to register device: ${e instanceof Error ? e.message : 'unknown'}`));
  };

  const revoke = (id: string, label: string) => {
    if (!confirm(`Revoke device "${label}"? Its token will stop working immediately.`)) return;
    apiFetch<{ success: boolean }>(`/kiosk-linux/devices/${id}`, { method: 'DELETE' })
      .then(() => fetchRows())
      .catch((e) => alert(`Failed to revoke: ${e instanceof Error ? e.message : 'unknown'}`));
  };

  if (loading) return <div className="p-4 text-sm text-rmpg-400">Loading kiosk devices…</div>;

  return (
    <div className="p-4 space-y-3">
      {err && <div className="text-sm text-sev-critical">{err}</div>}

      {issuedToken && (
        <div className="bg-surface-raised border border-brand-400 p-3 rounded-none space-y-2">
          <p className="text-sm font-semibold text-text-primary">
            Device "{issuedToken.label}" registered. Copy its token now — it will not be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="text-xs bg-surface-base px-2 py-1 flex-1 break-all">{issuedToken.token}</code>
            <button
              type="button"
              aria-label="Copy device token"
              onClick={() => navigator.clipboard.writeText(issuedToken.token)}
              className="p-1"
            >
              <Copy size={14} />
            </button>
          </div>
          <button
            type="button"
            className="text-xs text-brand-400 underline"
            onClick={() => setIssuedToken(null)}
          >
            I have saved this token
          </button>
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Device label, e.g. Lobby kiosk 1"
          className="text-sm bg-surface-raised border border-rmpg-700 px-2 py-1 flex-1"
        />
        <button
          type="button"
          onClick={register}
          className="flex items-center gap-1 text-sm bg-brand-500 text-surface-base px-3 py-1"
        >
          <Plus size={14} /> Register device
        </button>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left font-semibold" style={{ fontSize: '9px' }}>
            <th className="py-[3px]">Label</th>
            <th className="py-[3px]">Status</th>
            <th className="py-[3px]">OS version</th>
            <th className="py-[3px]">Last seen</th>
            <th className="py-[3px]"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} style={{ fontSize: '11px' }}>
              <td className="py-[2px]">{row.label}</td>
              <td className="py-[2px]">{row.status}</td>
              <td className="py-[2px]">{row.os_version ?? '—'}</td>
              <td className="py-[2px]">{row.last_seen_at ?? 'never'}</td>
              <td className="py-[2px]">
                {row.status === 'active' && (
                  <button
                    type="button"
                    aria-label={`Revoke ${row.label}`}
                    onClick={() => revoke(row.id, row.label)}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={5} className="py-2 text-rmpg-400">No devices registered yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: passes (component isn't imported anywhere yet, so this only
checks the file compiles standalone).

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/admin/KioskDevicesTab.tsx
git commit -m "feat(kiosk-linux): admin Kiosk Devices tab component"
```

---

### Task 6: Wire the tab into `AdminPage.tsx`

**Files:**
- Modify: `client/src/pages/AdminPage.tsx` (four edits per `CLAUDE.md` gotcha #16)

**Interfaces:**
- Consumes: `KioskDevicesTab` (Task 6).

- [ ] **Step 1: Add the import** near the other admin tab imports (e.g.
right after `import AdminInspectionTemplatesTab from './admin/AdminInspectionTemplatesTab';` at line 70):

```tsx
import KioskDevicesTab from './admin/KioskDevicesTab';
```

- [ ] **Step 2: Add `'kiosk_devices'` to the `TabId` union** (`client/src/pages/AdminPage.tsx:253`) — append it before the closing `;`:

```tsx
| 'court_lookups' | 'kiosk_devices';
```

- [ ] **Step 3: Add `'kiosk_devices'` to `VALID_TABS`** (`client/src/pages/AdminPage.tsx:280`) — append it to the array:

```tsx
'vmrs_browser', 'dev', 'kiosk_devices'
```

- [ ] **Step 4: Add the `{id,label,icon}` config entry.** Pick an icon
already imported in this file's `lucide-react` import block (check with
`grep -n "^import.*lucide-react" client/src/pages/AdminPage.tsx`); if `Server`
or `MonitorSmartphone` isn't already imported, add it to that import line.
Add the tab entry near the other infra/ops tabs (e.g. next to `cloudflare`,
around line 749):

```tsx
{ id: 'kiosk_devices', label: 'Kiosk Devices', icon: MonitorSmartphone },
```

- [ ] **Step 5: Add the render block**, right after the `inspection_templates` block (`client/src/pages/AdminPage.tsx:1170-1172`):

```tsx
{activeTab === 'kiosk_devices' && (
  <KioskDevicesTab />
)}
```

- [ ] **Step 6: Client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: passes — this is exactly the check that catches a missed edit
among the four (a `TabId` union without a matching `VALID_TABS` entry, or
vice versa, surfaces here per `CLAUDE.md` gotcha #16).

- [ ] **Step 7: Manual verification**

Run `cd client && npm run dev`, open the admin page, confirm a "Kiosk
Devices" entry appears in the tab list and clicking it renders the empty-state
table without console errors.

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/AdminPage.tsx
git commit -m "feat(kiosk-linux): wire Kiosk Devices tab into AdminPage"
```

---

### Task 7: Deploy — create real Cloudflare resources

**Files:**
- Modify: `wrangler.toml` (replace the Task 2 placeholder `database_id`)

This task creates real, billable Cloudflare resources — confirm with the
user before running the create commands, per this project's standing rule
on hard-to-reverse infrastructure actions.

- [ ] **Step 1: Create the D1 database**

```bash
wrangler d1 create kiosk-linux-fleet
```

Expected output includes a `database_id` — copy it.

- [ ] **Step 2: Replace the placeholder in `wrangler.toml`** with the real
id from Step 1 (the `KIOSK_DB` block added in Task 2).

- [ ] **Step 3: Create the R2 bucket**

```bash
wrangler r2 bucket create kiosk-linux-devices
```

- [ ] **Step 4: Apply the migration to the real database**

```bash
wrangler d1 migrations apply kiosk-linux-fleet --remote
```

Expected: reports `0001_kiosk_devices.sql` applied.

- [ ] **Step 5: Verify the schema landed**

```bash
wrangler d1 execute kiosk-linux-fleet --remote --command \
  "SELECT name FROM sqlite_master WHERE type='table'"
```

Expected: `kiosk_devices` and `kiosk_device_uploads` both listed.

- [ ] **Step 6: Commit the real `database_id`**

```bash
git add wrangler.toml
git commit -m "chore(kiosk-linux): pin real kiosk-linux-fleet D1 database_id"
```

- [ ] **Step 7: Deploy and verify end-to-end**

Push to `main` (per this repo's PR flow) and, once `deploy.yml` completes,
confirm via the admin UI: register a test device, confirm the token
appears once, confirm it appears in the list, then revoke it and confirm
its status flips.
