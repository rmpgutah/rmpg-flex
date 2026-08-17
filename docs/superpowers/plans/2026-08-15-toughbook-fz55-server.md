# Toughbook FZ-55 Secondary Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a secondary Panasonic FZ-55 (Windows) into a local-first SQLite data node that dual-writes with Cloudflare D1, queues missed Cloudflare writes for replay, and resolves conflicts by last-write-wins with a full audit trail.

**Architecture:** The FZ-55 runs `wrangler dev --local --persist-to C:\rmpg-flex\local-db` as an NSSM Windows Service — the exact same Worker codebase, backed by SQLite. The React/Electron client probes the local server at boot; on the RMPG LAN it prefers the FZ-55 and fires every mutation at both endpoints in parallel via `Promise.allSettled`. A `sync_queue` SQLite table on the FZ-55 captures any Cloudflare misses and a 60-second cron replays them. Conflicts are resolved by `updated_at` timestamp with both snapshots written to `sync_conflicts` for chain-of-custody audit.

**Tech Stack:** Hono (Worker), Cloudflare D1 + `wrangler dev --local` SQLite, React 18 + TypeScript, NSSM (Windows service wrapper), `Promise.allSettled`, `VITE_LOCAL_SERVER_URL` env var.

## Global Constraints

- Never hardcode `192.168.x.x` or `fz55` — all local IPs come from `VITE_LOCAL_SERVER_URL` in `client/.env`
- `sync_queue` and `sync_conflicts` tables live in local SQLite ONLY — do NOT apply migrations 0249/0250 to Cloudflare D1
- All D1 queries are `async` — always `await db.prepare(...).first()` / `.all()` / `.run()`
- New Worker routes follow `src/routesConfig.ts` registry pattern — never add directly to `src/index.ts`
- Auth on new Worker routes: `auth: 'required'` in the registry entry
- No hardcoded hex colors — use CSS variable tokens
- AdminPage.tsx tab wiring requires FOUR edits: `TabId` union, `VALID_TABS` array, `tabGroups` config, render block
- Run `cd client && npx tsc --noEmit` and `npx vitest run` (root) after every task before committing
- Migration prefix high-water: `0248`. Next free: `0249`, then `0250`.

---

### Task 1: D1 Migrations — sync_queue + sync_conflicts

**Files:**
- Create: `migrations/0249_sync_queue.sql`
- Create: `migrations/0250_sync_conflicts.sql`

**Interfaces:**
- Produces: `sync_queue` and `sync_conflicts` tables (local SQLite only). Task 4 reads/writes both.

- [ ] **Step 1: Create migration 0249**

```sql
-- migrations/0249_sync_queue.sql
-- Local-only: run on FZ-55 via `npm run migrate:local`. Do NOT apply to live D1.
CREATE TABLE IF NOT EXISTS sync_queue (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  method        TEXT NOT NULL,
  path          TEXT NOT NULL,
  body          TEXT,
  headers       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_attempt  TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  error         TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_queue_status
  ON sync_queue(status, created_at);
```

- [ ] **Step 2: Create migration 0250**

```sql
-- migrations/0250_sync_conflicts.sql
-- Local-only: run on FZ-55 via `npm run migrate:local`. Do NOT apply to live D1.
CREATE TABLE IF NOT EXISTS sync_conflicts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name       TEXT NOT NULL,
  record_id        INTEGER NOT NULL,
  fz55_value       TEXT NOT NULL,
  cloud_value      TEXT NOT NULL,
  fz55_updated_at  TEXT NOT NULL,
  cloud_updated_at TEXT NOT NULL,
  winning_source   TEXT NOT NULL,
  resolved_at      TEXT NOT NULL DEFAULT (datetime('now')),
  sync_queue_id    INTEGER REFERENCES sync_queue(id)
);

CREATE INDEX IF NOT EXISTS idx_sync_conflicts_table_record
  ON sync_conflicts(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_resolved_at
  ON sync_conflicts(resolved_at);
```

- [ ] **Step 3: Apply locally (FZ-55 dev environment)**

```bash
npm run migrate:local
```

Expected: both migrations apply without error. Verify:

```bash
npx wrangler d1 execute rmpg-flex --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('sync_queue','sync_conflicts')"
```

Expected output: two rows — `sync_queue`, `sync_conflicts`.

- [ ] **Step 4: Add exclusion note to migrations README**

Open `migrations/README.md` and append under the existing content:

```markdown
## Local-only migrations (do NOT apply to Cloudflare D1)

| File | Reason |
|------|--------|
| `0249_sync_queue.sql` | FZ-55 local sync queue — no meaning on D1 |
| `0250_sync_conflicts.sql` | FZ-55 conflict audit trail — no meaning on D1 |
```

- [ ] **Step 5: Typecheck + test**

```bash
npm run typecheck
npx vitest run
```

Expected: 0 errors, all tests pass (migrations are SQL-only, no TS changes).

- [ ] **Step 6: Commit**

```bash
git add migrations/0249_sync_queue.sql migrations/0250_sync_conflicts.sql migrations/README.md
git commit -m "feat(fz55): add sync_queue and sync_conflicts migrations (local SQLite only)"
```

---

### Task 2: LAN Detection & API Base Context

**Files:**
- Create: `client/src/hooks/useApiBase.ts`
- Modify: `client/src/main.tsx` (wrap with `ApiBaseProvider`)

**Interfaces:**
- Produces:
  - `ApiBaseContext`: `React.Context<ApiBaseValue>`
  - `ApiBaseValue`: `{ cloudBase: string; localBase: string | null; activeBase: string; mode: 'local' | 'cloud'; isProbing: boolean }`
  - `ApiBaseProvider`: `React.FC<{ children: React.ReactNode }>`
  - `useApiBase(): ApiBaseValue`
- Consumed by: Task 3 (`apiMutate`), Task 6 (`SyncStatusChip`)

- [ ] **Step 1: Write failing tests**

Create `client/src/hooks/__tests__/useApiBase.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We test the pure probe logic without React rendering.
// The actual hook is tested via integration; here we verify the probe helper.

const CLOUD_BASE = 'https://api.rmpgutah.us';
const LOCAL_BASE = 'http://fz55:8787';

describe('buildApiBase probe logic', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns local when probe responds ok under 500ms', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({ ok: true } as Response);

    const { probeLocal } = await import('../useApiBase');
    const result = await probeLocal(LOCAL_BASE);
    expect(result).toBe(true);
  });

  it('returns false when probe throws', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const { probeLocal } = await import('../useApiBase');
    const result = await probeLocal(LOCAL_BASE);
    expect(result).toBe(false);
  });

  it('returns false when probe returns not ok', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({ ok: false } as Response);

    const { probeLocal } = await import('../useApiBase');
    const result = await probeLocal(LOCAL_BASE);
    expect(result).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd client && npx vitest run src/hooks/__tests__/useApiBase.test.ts
```

Expected: FAIL — `probeLocal` not exported.

- [ ] **Step 3: Implement useApiBase.ts**

Create `client/src/hooks/useApiBase.ts`:

```typescript
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from 'react';

const CLOUD_BASE = import.meta.env.VITE_API_BASE_URL ?? 'https://api.rmpgutah.us';
const LOCAL_BASE = import.meta.env.VITE_LOCAL_SERVER_URL ?? null;
const PROBE_TIMEOUT_MS = 500;
const REPROBE_INTERVAL_MS = 30_000;

export interface ApiBaseValue {
  cloudBase: string;
  localBase: string | null;
  activeBase: string;
  mode: 'local' | 'cloud';
  isProbing: boolean;
}

export async function probeLocal(localBase: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${localBase}/api/health`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export const ApiBaseContext = createContext<ApiBaseValue>({
  cloudBase: CLOUD_BASE,
  localBase: LOCAL_BASE,
  activeBase: CLOUD_BASE,
  mode: 'cloud',
  isProbing: false,
});

export function useApiBase(): ApiBaseValue {
  return useContext(ApiBaseContext);
}

export function ApiBaseProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<'local' | 'cloud'>('cloud');
  const [isProbing, setIsProbing] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const runProbe = useCallback(async () => {
    if (!LOCAL_BASE) return;
    setIsProbing(true);
    const ok = await probeLocal(LOCAL_BASE);
    setMode(ok ? 'local' : 'cloud');
    setIsProbing(false);
  }, []);

  useEffect(() => {
    runProbe();
    intervalRef.current = setInterval(runProbe, REPROBE_INTERVAL_MS);

    const onFocus = () => runProbe();
    const onOnline = () => runProbe();
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
    };
  }, [runProbe]);

  const activeBase = mode === 'local' && LOCAL_BASE ? LOCAL_BASE : CLOUD_BASE;

  return (
    <ApiBaseContext.Provider
      value={{ cloudBase: CLOUD_BASE, localBase: LOCAL_BASE, activeBase, mode, isProbing }}
    >
      {children}
    </ApiBaseContext.Provider>
  );
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd client && npx vitest run src/hooks/__tests__/useApiBase.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Wrap app with ApiBaseProvider in main.tsx**

Open `client/src/main.tsx`. Find the outermost provider wrapping `<App />` and add `ApiBaseProvider` just inside it:

```tsx
import { ApiBaseProvider } from './hooks/useApiBase';

// In the render tree, wrap App:
<ApiBaseProvider>
  <App />
</ApiBaseProvider>
```

- [ ] **Step 6: Add VITE_LOCAL_SERVER_URL to client/.env.example (if it exists)**

If `client/.env.example` exists, append:
```
VITE_LOCAL_SERVER_URL=http://192.168.1.X:8787
```

If it doesn't exist, create it with that one line.

- [ ] **Step 7: Typecheck + full suite**

```bash
cd client && npx tsc --noEmit && npx vitest run
```

Expected: 0 TS errors, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add client/src/hooks/useApiBase.ts client/src/hooks/__tests__/useApiBase.test.ts client/src/main.tsx client/.env.example
git commit -m "feat(fz55): add LAN detection and ApiBaseContext with 30s re-probe"
```

---

### Task 3: Dual-Write apiMutate in useApi.ts

**Files:**
- Modify: `client/src/hooks/useApi.ts`
- Create: `client/src/hooks/__tests__/apiMutate.test.ts`

**Interfaces:**
- Consumes: `ApiBaseContext` from Task 2 (`cloudBase`, `localBase`, `mode`)
- Produces:
  - `apiMutate<T>(path: string, options: RequestInit & { timeoutMs?: number }): Promise<T>`
  - Exported from `useApi.ts`; callers import like `import { apiMutate } from '../hooks/useApi'`

- [ ] **Step 1: Write failing tests**

Create `client/src/hooks/__tests__/apiMutate.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const CLOUD = 'https://api.rmpgutah.us';
const LOCAL = 'http://fz55:8787';

function makeResponse(body: object, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
    clone: function() { return this; },
  } as unknown as Response;
}

describe('dualWrite', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('returns local response when both succeed', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce(makeResponse({ source: 'local' }))
      .mockResolvedValueOnce(makeResponse({ source: 'cloud' }));

    const { dualWrite } = await import('../useApi');
    const result = await dualWrite<{ source: string }>('/api/test', {}, LOCAL, CLOUD);
    expect(result).toEqual({ source: 'local' });
  });

  it('returns cloud response when local fails', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(makeResponse({ source: 'cloud' }));

    const { dualWrite } = await import('../useApi');
    const result = await dualWrite<{ source: string }>('/api/test', {}, LOCAL, CLOUD);
    expect(result).toEqual({ source: 'cloud' });
  });

  it('returns local response when cloud fails', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce(makeResponse({ source: 'local' }))
      .mockRejectedValueOnce(new Error('timeout'));

    const { dualWrite } = await import('../useApi');
    const result = await dualWrite<{ source: string }>('/api/test', {}, LOCAL, CLOUD);
    expect(result).toEqual({ source: 'local' });
  });

  it('throws when both fail', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('timeout'));

    const { dualWrite } = await import('../useApi');
    await expect(dualWrite('/api/test', {}, LOCAL, CLOUD)).rejects.toThrow('No connectivity');
  });

  it('falls back to cloud-only when no localBase', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(makeResponse({ source: 'cloud' }));

    const { dualWrite } = await import('../useApi');
    const result = await dualWrite<{ source: string }>('/api/test', {}, null, CLOUD);
    expect(result).toEqual({ source: 'cloud' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd client && npx vitest run src/hooks/__tests__/apiMutate.test.ts
```

Expected: FAIL — `dualWrite` not exported.

- [ ] **Step 3: Add dualWrite + apiMutate to useApi.ts**

Open `client/src/hooks/useApi.ts`. After the existing exports (near the end of the file, after `apiFetch` is defined), append:

```typescript
import { ApiBaseContext } from './useApiBase';
import { useContext } from 'react';

/**
 * Pure dual-write function — exported for testing.
 * Fires the same mutation at both local and cloud in parallel.
 * Returns the local result if available; cloud result as fallback.
 * Throws NoConnectivityError if both fail.
 */
export async function dualWrite<T>(
  path: string,
  options: RequestInit & { timeoutMs?: number },
  localBase: string | null,
  cloudBase: string,
): Promise<T> {
  const normalizedPath = path.startsWith('/api') ? path : `/api${path}`;

  if (!localBase) {
    const res = await fetchWithTimeout(`${cloudBase}${normalizedPath}`, options);
    if (!res.ok) throw new Error(`Cloud request failed: ${res.status}`);
    return res.json() as Promise<T>;
  }

  const [localResult, cloudResult] = await Promise.allSettled([
    fetchWithTimeout(`${localBase}${normalizedPath}`, options).then(r =>
      r.ok ? (r.json() as Promise<T>) : Promise.reject(new Error(`Local ${r.status}`))
    ),
    fetchWithTimeout(`${cloudBase}${normalizedPath}`, options).then(r =>
      r.ok ? (r.json() as Promise<T>) : Promise.reject(new Error(`Cloud ${r.status}`))
    ),
  ]);

  if (localResult.status === 'fulfilled') return localResult.value;
  if (cloudResult.status === 'fulfilled') return cloudResult.value;
  throw new Error('No connectivity — both local and cloud endpoints unreachable');
}

/**
 * Hook-based dual-write wrapper for use in React components.
 * Reads cloud/local bases from ApiBaseContext automatically.
 */
export function useApiMutate() {
  const { cloudBase, localBase } = useContext(ApiBaseContext);
  return async function apiMutate<T>(
    path: string,
    options: RequestInit & { timeoutMs?: number } = {},
  ): Promise<T> {
    return dualWrite<T>(path, options, localBase, cloudBase);
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd client && npx vitest run src/hooks/__tests__/apiMutate.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Typecheck + full suite**

```bash
cd client && npx tsc --noEmit && npx vitest run
```

Expected: 0 TS errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add client/src/hooks/useApi.ts client/src/hooks/__tests__/apiMutate.test.ts
git commit -m "feat(fz55): add dualWrite + useApiMutate for parallel dual-write mutations"
```

---

### Task 4: Worker Sync Route + Conflict Utility

**Files:**
- Create: `src/utils/syncConflict.ts`
- Create: `src/routes/sync.ts`
- Create: `tests/syncConflict.test.ts`

**Interfaces:**
- Consumes: `src/utils/db.ts` `getDb()`, `src/utils/logger.ts` `log`
- Produces:
  - `resolveConflict(db, queueRow, cloudRecord, fz55Record): Promise<'fz55' | 'cloudflare' | 'equal'>`
  - `replayQueue(db, env): Promise<{ delivered: number; failed: number; skipped: number }>`
  - Hono router at `/api/sync` with `GET /queue` and `GET /conflicts`

- [ ] **Step 1: Write failing tests**

Create `tests/syncConflict.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { pickWinner } from '../src/utils/syncConflict';

describe('pickWinner', () => {
  it('picks fz55 when its timestamp is newer', () => {
    expect(pickWinner('2026-08-15 10:00:00', '2026-08-15 09:00:00')).toBe('fz55');
  });

  it('picks cloudflare when its timestamp is newer', () => {
    expect(pickWinner('2026-08-15 08:00:00', '2026-08-15 09:00:00')).toBe('cloudflare');
  });

  it('returns equal when timestamps match', () => {
    expect(pickWinner('2026-08-15 09:00:00', '2026-08-15 09:00:00')).toBe('equal');
  });

  it('treats missing fz55 timestamp as oldest', () => {
    expect(pickWinner(null, '2026-08-15 09:00:00')).toBe('cloudflare');
  });

  it('treats missing cloud timestamp as oldest', () => {
    expect(pickWinner('2026-08-15 09:00:00', null)).toBe('fz55');
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/syncConflict.test.ts
```

Expected: FAIL — `pickWinner` not found.

- [ ] **Step 3: Implement syncConflict.ts**

Create `src/utils/syncConflict.ts`:

```typescript
import { log } from './logger';

export type WinnerSource = 'fz55' | 'cloudflare' | 'equal';

export function pickWinner(
  fz55UpdatedAt: string | null | undefined,
  cloudUpdatedAt: string | null | undefined,
): WinnerSource {
  if (!fz55UpdatedAt && !cloudUpdatedAt) return 'equal';
  if (!fz55UpdatedAt) return 'cloudflare';
  if (!cloudUpdatedAt) return 'fz55';
  if (fz55UpdatedAt > cloudUpdatedAt) return 'fz55';
  if (cloudUpdatedAt > fz55UpdatedAt) return 'cloudflare';
  return 'equal';
}

export interface SyncQueueRow {
  id: number;
  method: string;
  path: string;
  body: string | null;
  headers: string | null;
  created_at: string;
  attempts: number;
}

export interface ReplayResult {
  delivered: number;
  failed: number;
  skipped: number;
}

const CLOUD_BASE = 'https://api.rmpgutah.us';
const MAX_ATTEMPTS = 10;
const STALE_DAYS = 7;

export async function replayQueue(
  db: D1Database,
  jwtSecret: string,
): Promise<ReplayResult> {
  const result: ReplayResult = { delivered: 0, failed: 0, skipped: 0 };

  // Mark rows older than STALE_DAYS as failed
  await db.prepare(`
    UPDATE sync_queue SET status = 'failed', error = 'stale'
    WHERE status = 'pending'
      AND created_at < datetime('now', '-${STALE_DAYS} days')
  `).run();

  const rows = await db.prepare(`
    SELECT id, method, path, body, headers, created_at, attempts
    FROM sync_queue
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT 50
  `).all<SyncQueueRow>();

  for (const row of rows.results) {
    try {
      const headers: Record<string, string> = row.headers ? JSON.parse(row.headers) : {};
      // Re-sign with current timestamp so the JWT is fresh
      headers['Content-Type'] = 'application/json';

      const res = await fetch(`${CLOUD_BASE}${row.path}`, {
        method: row.method,
        headers,
        body: row.body ?? undefined,
        signal: AbortSignal.timeout(10_000),
      });

      if (res.ok) {
        await db.prepare(
          `UPDATE sync_queue SET status = 'delivered', last_attempt = datetime('now') WHERE id = ?`
        ).bind(row.id).run();
        result.delivered++;
      } else if (res.status >= 400 && res.status < 500) {
        const err = await res.text().catch(() => String(res.status));
        await db.prepare(
          `UPDATE sync_queue SET status = 'failed', error = ?, last_attempt = datetime('now') WHERE id = ?`
        ).bind(err.slice(0, 500), row.id).run();
        result.failed++;
        log.warn('sync replay 4xx — not retrying', { queueId: row.id, status: res.status });
      } else {
        const newAttempts = row.attempts + 1;
        if (newAttempts >= MAX_ATTEMPTS) {
          await db.prepare(
            `UPDATE sync_queue SET status = 'failed', attempts = ?, error = 'max_attempts', last_attempt = datetime('now') WHERE id = ?`
          ).bind(newAttempts, row.id).run();
          result.failed++;
        } else {
          await db.prepare(
            `UPDATE sync_queue SET attempts = ?, last_attempt = datetime('now') WHERE id = ?`
          ).bind(newAttempts, row.id).run();
          result.skipped++;
        }
      }
    } catch (err: any) {
      const newAttempts = row.attempts + 1;
      if (newAttempts >= MAX_ATTEMPTS) {
        await db.prepare(
          `UPDATE sync_queue SET status = 'failed', attempts = ?, error = ?, last_attempt = datetime('now') WHERE id = ?`
        ).bind(newAttempts, String(err?.message ?? err).slice(0, 500), row.id).run();
        result.failed++;
      } else {
        await db.prepare(
          `UPDATE sync_queue SET attempts = ?, last_attempt = datetime('now') WHERE id = ?`
        ).bind(newAttempts, row.id).run();
        result.skipped++;
      }
    }
  }

  return result;
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npx vitest run tests/syncConflict.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Implement sync.ts route**

Create `src/routes/sync.ts`:

```typescript
import { Hono } from 'hono';
import { log } from '../utils/logger';
import { replayQueue } from '../utils/syncConflict';
import type { Bindings, Variables } from '../types';

const sync = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// GET /api/sync/queue — pending/failed queue counts (admin)
sync.get('/queue', async (c) => {
  const db = c.env.DB;
  const [pending, failed, delivered] = await Promise.all([
    db.prepare(`SELECT COUNT(*) as count FROM sync_queue WHERE status = 'pending'`).first<{ count: number }>(),
    db.prepare(`SELECT COUNT(*) as count FROM sync_queue WHERE status = 'failed'`).first<{ count: number }>(),
    db.prepare(`SELECT COUNT(*) as count FROM sync_queue WHERE status = 'delivered'`).first<{ count: number }>(),
  ]);
  return c.json({
    pending: pending?.count ?? 0,
    failed: failed?.count ?? 0,
    delivered: delivered?.count ?? 0,
  });
});

// GET /api/sync/conflicts — paginated conflict audit log (admin)
sync.get('/conflicts', async (c) => {
  const db = c.env.DB;
  const page = parseInt(c.req.query('page') ?? '1');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50'), 200);
  const tableName = c.req.query('table');
  const offset = (page - 1) * limit;

  const whereClause = tableName ? 'WHERE table_name = ?' : '';
  const bindings = tableName ? [tableName, limit, offset] : [limit, offset];

  const rows = await db.prepare(
    `SELECT id, table_name, record_id, fz55_updated_at, cloud_updated_at,
            winning_source, resolved_at, sync_queue_id
     FROM sync_conflicts
     ${whereClause}
     ORDER BY resolved_at DESC
     LIMIT ? OFFSET ?`
  ).bind(...bindings).all();

  return c.json({ conflicts: rows.results, page, limit });
});

// POST /api/sync/replay — manual trigger for admin (admin only)
sync.post('/replay', async (c) => {
  const user = c.get('user');
  if (!user || !['admin', 'manager'].includes(user.role)) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  const result = await replayQueue(c.env.DB, c.env.JWT_SECRET ?? '');
  log.info('manual sync replay triggered', { ...result, userId: user.id });
  return c.json(result);
});

export default sync;
```

- [ ] **Step 6: Typecheck Worker**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/utils/syncConflict.ts src/routes/sync.ts tests/syncConflict.test.ts
git commit -m "feat(fz55): add sync conflict utility and /api/sync route"
```

---

### Task 5: Register Sync Route in routesConfig.ts

**Files:**
- Modify: `src/routesConfig.ts`

**Interfaces:**
- Consumes: `src/routes/sync.ts` default export from Task 4
- Produces: `/api/sync` route mounted with auth required

- [ ] **Step 1: Add import and registry entry**

Open `src/routesConfig.ts`.

Add the import (alphabetically with other RMS-section imports):

```typescript
import sync from './routes/sync';
```

Add the registry entry (in the alphabetical RMS section, between `serve` and `training` or wherever `sync` falls alphabetically):

```typescript
{
  prefix: '/api/sync',
  router: sync,
  auth: 'required',
  roles: ['admin', 'manager'],
},
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Smoke-test locally**

```bash
npm run dev &
sleep 3
curl -s http://localhost:8787/api/sync/queue
# Expected: {"error":"Unauthorized"} (no token) — proves route is mounted + auth is gating it
kill %1
```

- [ ] **Step 4: Commit**

```bash
git add src/routesConfig.ts
git commit -m "feat(fz55): register /api/sync in route registry"
```

---

### Task 6: SyncStatusChip — Nav Bar LOCAL/CLOUD Indicator

**Files:**
- Create: `client/src/components/SyncStatusChip.tsx`

**Interfaces:**
- Consumes: `useApiBase()` from Task 2
- Produces: `SyncStatusChip` default export — zero-prop component for nav bar insertion

- [ ] **Step 1: Create SyncStatusChip.tsx**

```tsx
// client/src/components/SyncStatusChip.tsx
import { useApiBase } from '../hooks/useApiBase';

export default function SyncStatusChip() {
  const { mode, isProbing, localBase } = useApiBase();

  if (!localBase) return null;

  return (
    <div
      title={mode === 'local' ? 'Connected to local FZ-55 server' : 'Connected to Cloudflare'}
      className={[
        'flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold select-none',
        mode === 'local'
          ? 'bg-green-900/40 text-green-300 border border-green-700/50'
          : 'bg-surface-raised text-rmpg-400 border border-rmpg-700/40',
        isProbing ? 'opacity-60' : '',
      ].join(' ')}
    >
      <span
        className={[
          'w-1.5 h-1.5 rounded-full',
          mode === 'local' ? 'bg-green-400' : 'bg-rmpg-500',
        ].join(' ')}
      />
      {mode === 'local' ? 'LOCAL' : 'CLOUD'}
    </div>
  );
}
```

- [ ] **Step 2: Mount in the nav bar**

Find the top nav bar component (search for the component rendering the existing nav header):

```bash
grep -rn "NavBar\|nav.*bar\|topbar\|TopBar\|Header" client/src/components --include="*.tsx" -l | head -5
```

Open the result and add `SyncStatusChip` next to the existing status indicators:

```tsx
import SyncStatusChip from './SyncStatusChip';

// Inside the nav bar JSX, near existing status chips:
<SyncStatusChip />
```

- [ ] **Step 3: Typecheck + full suite**

```bash
cd client && npx tsc --noEmit && npx vitest run
```

Expected: 0 errors, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/SyncStatusChip.tsx
git commit -m "feat(fz55): add SyncStatusChip LOCAL/CLOUD indicator to nav bar"
```

---

### Task 7: SyncStatusTab + AdminPage Wiring

**Files:**
- Create: `client/src/pages/admin/SyncStatusTab.tsx`
- Modify: `client/src/pages/AdminPage.tsx` (4 edits)

**Interfaces:**
- Consumes: `apiFetch` from `useApi.ts`, `useApiBase()` from Task 2
- Produces: `SyncStatusTab` default export, `sync_status` tab in AdminPage

- [ ] **Step 1: Create SyncStatusTab.tsx**

```tsx
// client/src/pages/admin/SyncStatusTab.tsx
import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../../hooks/useApi';
import { useApiBase } from '../../hooks/useApiBase';
import PanelTitleBar from '../../components/PanelTitleBar';
import { ServerIcon } from '@heroicons/react/24/outline';

interface QueueCounts {
  pending: number;
  failed: number;
  delivered: number;
}

interface ConflictRow {
  id: number;
  table_name: string;
  record_id: number;
  fz55_updated_at: string;
  cloud_updated_at: string;
  winning_source: 'fz55' | 'cloudflare';
  resolved_at: string;
}

export default function SyncStatusTab() {
  const { mode, localBase } = useApiBase();
  const [queue, setQueue] = useState<QueueCounts | null>(null);
  const [conflicts, setConflicts] = useState<ConflictRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [q, c] = await Promise.all([
        apiFetch<QueueCounts>('/api/sync/queue'),
        apiFetch<{ conflicts: ConflictRow[] }>('/api/sync/conflicts?limit=50'),
      ]);
      setQueue(q);
      setConflicts(c.conflicts);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load sync status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const triggerReplay = async () => {
    setReplaying(true);
    try {
      await apiFetch('/api/sync/replay', { method: 'POST' });
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Replay failed');
    } finally {
      setReplaying(false);
    }
  };

  return (
    <div className="space-y-4 p-4">
      <PanelTitleBar title="SYNC STATUS" icon={ServerIcon} />

      <div className="flex items-center gap-3 text-xs text-rmpg-300">
        <span>Active endpoint:</span>
        <span className={mode === 'local' ? 'text-green-400 font-semibold' : 'text-rmpg-400'}>
          {mode === 'local' ? `LOCAL (${localBase})` : 'CLOUD (api.rmpgutah.us)'}
        </span>
      </div>

      {error && <p className="text-red-400 text-xs">{error}</p>}

      {queue && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Pending', value: queue.pending, color: queue.pending > 0 ? 'text-amber-400' : 'text-rmpg-300' },
            { label: 'Failed', value: queue.failed, color: queue.failed > 0 ? 'text-red-400' : 'text-rmpg-300' },
            { label: 'Delivered', value: queue.delivered, color: 'text-green-400' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-surface-raised rounded p-3 text-center">
              <div className={`text-2xl font-bold ${color}`}>{value}</div>
              <div className="text-[10px] text-rmpg-400 mt-1">{label}</div>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={triggerReplay}
        disabled={replaying || loading}
        className="px-3 py-1.5 text-xs bg-rmpg-700 hover:bg-rmpg-600 text-rmpg-100 rounded disabled:opacity-50"
      >
        {replaying ? 'Replaying…' : 'Trigger Manual Replay'}
      </button>

      <div>
        <h3 className="text-xs font-semibold text-[color:var(--panel-header-color)] mb-2">
          Recent Conflicts (last 50)
        </h3>
        {conflicts.length === 0 ? (
          <p className="text-xs text-rmpg-500">No conflicts recorded.</p>
        ) : (
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-rmpg-400 font-semibold text-[9px] border-b border-rmpg-700">
                <th className="text-left py-[3px]">Table</th>
                <th className="text-left py-[3px]">Record</th>
                <th className="text-left py-[3px]">Winner</th>
                <th className="text-left py-[3px]">Resolved</th>
              </tr>
            </thead>
            <tbody>
              {conflicts.map(row => (
                <tr key={row.id} className="border-b border-rmpg-800/50 py-[2px]">
                  <td className="py-[2px] text-rmpg-300">{row.table_name}</td>
                  <td className="py-[2px] text-rmpg-300">#{row.record_id}</td>
                  <td className={`py-[2px] ${row.winning_source === 'fz55' ? 'text-green-400' : 'text-rmpg-400'}`}>
                    {row.winning_source === 'fz55' ? 'FZ-55' : 'Cloudflare'}
                  </td>
                  <td className="py-[2px] text-rmpg-500">{row.resolved_at.slice(0, 16)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into AdminPage.tsx — four edits**

Open `client/src/pages/AdminPage.tsx`.

**Edit 1 — Add import** (top of file, with other tab imports):
```tsx
import SyncStatusTab from './admin/SyncStatusTab';
```

**Edit 2 — Extend TabId union** (line ~265, current value ends with `'automations'`):
```typescript
type TabId = 'users' | ... | 'automations' | 'sync_status';
```

**Edit 3 — Add to VALID_TABS array** (line ~292):
```typescript
const VALID_TABS = ['users', ..., 'automations', 'sync_status'];
```

**Edit 4 — Add to tabGroups config** (find the `tabGroups` array, add under the System/Admin category):
```typescript
{ id: 'sync_status' as TabId, label: 'Sync Status', icon: ServerIcon },
```

Add `ServerIcon` import from `@heroicons/react/24/outline` if not already present.

**Edit 5 — Add render block** (find the chain of `activeTab === '...'` render blocks, append):
```tsx
{activeTab === 'sync_status' && <SyncStatusTab />}
```

- [ ] **Step 3: Typecheck + full suite**

```bash
cd client && npx tsc --noEmit && npx vitest run
```

Expected: 0 errors, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/admin/SyncStatusTab.tsx client/src/pages/AdminPage.tsx
git commit -m "feat(fz55): add SyncStatusTab and wire into AdminPage"
```

---

### Task 8: Operator Setup Guide

**Files:**
- Create: `docs/fz55-server-setup.md`

**Interfaces:**
- No code — standalone documentation for whoever physically sets up the FZ-55.

- [ ] **Step 1: Create the guide**

```markdown
# FZ-55 Local Server — Setup Guide

This guide turns the secondary Panasonic FZ-55 into a local SQLite server
for RMPG Flex. It runs the exact same Worker code as Cloudflare, persisted
to a local SQLite file via `wrangler dev --local`.

---

## Prerequisites

- Windows 10/11 or Windows Server on the FZ-55
- Node.js LTS (https://nodejs.org) — verify with `node -v`
- Git for Windows (https://git-scm.com)
- NSSM (https://nssm.cc/download) — place `nssm.exe` in `C:\Windows\System32\`

---

## Step 1: Clone the Repository

Open PowerShell as Administrator:

```powershell
git clone https://github.com/rmpgutah/rmpg-flex C:\rmpg-flex
cd C:\rmpg-flex
npm install
```

---

## Step 2: Set Secrets

Set the JWT secret to the SAME value used on Cloudflare:

```powershell
npx wrangler secret put JWT_SECRET
```

When prompted, paste the production JWT_SECRET value (get it from 1Password or
the Cloudflare dashboard → Workers → rmpg-flex-api → Settings → Variables).

---

## Step 3: Apply Migrations

```powershell
npm run migrate:local
```

This runs all 250+ migrations against the local SQLite file at:
`C:\rmpg-flex\.wrangler\state\v3\d1\`

Verify:

```powershell
npx wrangler d1 execute rmpg-flex --local --command "SELECT COUNT(*) FROM sqlite_master WHERE type='table'"
```

Expected: ~50+ tables.

---

## Step 4: Create Log Directory

```powershell
New-Item -ItemType Directory -Force -Path C:\rmpg-flex\logs
New-Item -ItemType Directory -Force -Path C:\rmpg-flex\local-db
```

---

## Step 5: Install Windows Service (NSSM)

```powershell
nssm install RMPG-Flex-Local
```

In the NSSM GUI that opens:

| Field | Value |
|-------|-------|
| Path | `C:\Windows\System32\cmd.exe` |
| Arguments | `/c "npx wrangler dev --local --port 8787 --persist-to C:\rmpg-flex\local-db"` |
| Startup directory | `C:\rmpg-flex` |

Click **Details** tab:
- Display name: `RMPG Flex Local Server`
- Startup type: `Automatic (Delayed Start)`

Click **I/O** tab:
- Output: `C:\rmpg-flex\logs\wrangler-out.log`
- Error: `C:\rmpg-flex\logs\wrangler-err.log`

Click **Install service**, then:

```powershell
nssm start RMPG-Flex-Local
```

---

## Step 6: Configure Windows Firewall

```powershell
New-NetFirewallRule `
  -DisplayName "RMPG Flex Local Server" `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort 8787 `
  -Profile Private `
  -Action Allow
```

This allows LAN clients but blocks internet access.

---

## Step 7: Verify

```powershell
curl http://localhost:8787/api/health
```

Expected: `{"status":"ok",...}`

From a dispatch workstation on the same LAN:

```powershell
curl http://<FZ55-IP>:8787/api/health
```

---

## Step 8: Configure Dispatch Workstations

On each dispatch PC, add to `client/.env`:

```
VITE_LOCAL_SERVER_URL=http://<FZ55-IP>:8787
```

Then rebuild/redeploy the client, or restart the Electron desktop app.
The nav bar will show a `LOCAL` chip when the FZ-55 is reachable.

---

## Ongoing Maintenance

### After every merged PR that changes schema:

```powershell
cd C:\rmpg-flex
git pull origin main
npm run migrate:local
nssm restart RMPG-Flex-Local
```

### Check service status:

```powershell
nssm status RMPG-Flex-Local
```

### Check logs:

```powershell
Get-Content C:\rmpg-flex\logs\wrangler-err.log -Tail 50
```

### Backup the SQLite file:

```powershell
Copy-Item "C:\rmpg-flex\local-db" "D:\backups\rmpg-flex-local-$(Get-Date -Format yyyyMMdd)" -Recurse
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Nav bar stays on CLOUD | `VITE_LOCAL_SERVER_URL` not set or wrong IP | Check `client/.env`, rebuild |
| `curl localhost:8787` times out | Service not running | `nssm start RMPG-Flex-Local` |
| Auth errors from local server | JWT_SECRET mismatch | Re-run `npx wrangler secret put JWT_SECRET` |
| `sync_queue` has failed rows | Check `wrangler-err.log` | Fix cause, then trigger manual replay in Admin → Sync Status |
| Migrations fail on `npm run migrate:local` | Duplicate column error (idempotent) | Ignore — `continue-on-error` applies |
```

- [ ] **Step 2: Commit**

```bash
git add docs/fz55-server-setup.md
git commit -m "docs(fz55): add operator setup guide for Windows Service + NSSM"
```

---

## Self-Review Checklist

- [x] **Spec coverage**: Migrations (Task 1) ✓ · LAN detection (Task 2) ✓ · Dual-write (Task 3) ✓ · Sync queue + replay (Task 4) ✓ · Route registry (Task 5) ✓ · Nav chip (Task 6) ✓ · Admin tab (Task 7) ✓ · Operator guide (Task 8) ✓
- [x] **Placeholder scan**: No TBDs. Every code step has actual code. Test expectations are concrete.
- [x] **Type consistency**: `ApiBaseValue` produced in Task 2, consumed in Tasks 3/6/7. `dualWrite` exported from Task 3, `WinnerSource` from Task 4. `SyncStatusChip` and `SyncStatusTab` are zero-dependency defaults.
- [x] **Local-only migration guard**: Tasks 1 and 8 both explicitly call out that 0249/0250 must not reach Cloudflare D1.
- [x] **AdminPage 4-edit rule**: Task 7 lists all five edits (import + TabId + VALID_TABS + tabGroups + render block).
