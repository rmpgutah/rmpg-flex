# Cloudflare Secondary Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Turso secondary database with Worker dual-write, client-side IndexedDB offline queue, and Toughbook cold standby scripts so no CAD data is lost during any Cloudflare failure.

**Architecture:** Every D1 write in the Worker mirrors to Turso via `Promise.allSettled`; reads fall back to Turso on D1 failure. The client tracks consecutive API failures; after 3, it switches its base URL to the configured Toughbook Tailscale address. Failed mutations are queued in IndexedDB and replayed on reconnect. The Toughbook runs `wrangler dev` against a Turso dump for extended outages.

**Tech Stack:** `@libsql/client` (Turso HTTP client, Workers-safe), `idb` (IndexedDB wrapper), Tailscale (network), `wrangler dev` (cold standby runtime)

## Global Constraints

- `execute()` / `query()` / `queryFirst()` signatures in `src/utils/db.ts` must not change — 150+ routes call them with rest-param bindings
- Turso client must be null-safe no-op when `TURSO_URL`/`TURSO_AUTH_TOKEN` are unset — local `wrangler dev` must work unchanged
- Use `@libsql/client/web` (not `@libsql/client`) in Worker code — Workers have no Node.js APIs
- `setTursoClient(null)` required in `beforeEach` for all dual-write tests — singleton persists across test cases
- AdminPage.tsx tab wiring always needs FOUR edits: `VALID_TABS` array (line ~292), `TabId` union (line ~265), `tabGroups` config array (line ~707), render block (line ~1045)
- Never hardcode hex colors — use CSS variable tokens (`text-[color:var(--x)]`)
- Install client deps with `--legacy-peer-deps`
- New secrets: `TURSO_URL`, `TURSO_AUTH_TOKEN` — set via `wrangler secret put`, document in `.dev.vars.example`

---

### Task 1: Install @libsql/client and create Turso client factory

**Files:**
- Modify: `package.json`
- Create: `src/utils/tursoClient.ts`
- Create: `tests/tursoClient.test.ts`
- Modify: `.dev.vars.example`

**Interfaces:**
- Produces:
  - `createTursoClient(env): Client | null` — null when either secret is missing
  - `initTursoSingleton(env): void` — idempotent; safe to call every request
  - `getTursoClient(): Client | null` — returns current singleton
  - `setTursoClient(client: Client | null): void` — test-only reset
  - `type InValue` — re-exported for use in db.ts

- [ ] **Step 1: Install @libsql/client**

```bash
npm install @libsql/client
```

Verify `@libsql/client` appears in `package.json` `dependencies`.

- [ ] **Step 2: Write failing tests**

Create `tests/tursoClient.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@libsql/client/web', () => ({
  createClient: vi.fn(() => ({ execute: vi.fn() })),
}));

import {
  createTursoClient,
  initTursoSingleton,
  getTursoClient,
  setTursoClient,
} from '../src/utils/tursoClient';

describe('createTursoClient', () => {
  it('returns null when TURSO_URL is missing', () => {
    expect(createTursoClient({ TURSO_AUTH_TOKEN: 'token' })).toBeNull();
  });

  it('returns null when TURSO_AUTH_TOKEN is missing', () => {
    expect(createTursoClient({ TURSO_URL: 'libsql://example.turso.io' })).toBeNull();
  });

  it('returns null when both secrets are missing', () => {
    expect(createTursoClient({})).toBeNull();
  });

  it('returns a client when both secrets are present', () => {
    const client = createTursoClient({
      TURSO_URL: 'libsql://rmpg-flex-secondary-rmpg-utah.turso.io',
      TURSO_AUTH_TOKEN: 'test-token',
    });
    expect(client).not.toBeNull();
    expect(client).toHaveProperty('execute');
  });
});

describe('singleton', () => {
  beforeEach(() => setTursoClient(null));

  it('getTursoClient returns null before init', () => {
    expect(getTursoClient()).toBeNull();
  });

  it('initTursoSingleton sets client when secrets present', () => {
    initTursoSingleton({
      TURSO_URL: 'libsql://rmpg-flex-secondary-rmpg-utah.turso.io',
      TURSO_AUTH_TOKEN: 'test-token',
    });
    expect(getTursoClient()).not.toBeNull();
  });

  it('initTursoSingleton is idempotent — does not replace existing client', () => {
    const fake = { execute: vi.fn() } as any;
    setTursoClient(fake);
    initTursoSingleton({
      TURSO_URL: 'libsql://rmpg-flex-secondary-rmpg-utah.turso.io',
      TURSO_AUTH_TOKEN: 'new-token',
    });
    expect(getTursoClient()).toBe(fake);
  });

  it('setTursoClient(null) resets singleton', () => {
    initTursoSingleton({
      TURSO_URL: 'libsql://rmpg-flex-secondary-rmpg-utah.turso.io',
      TURSO_AUTH_TOKEN: 'test-token',
    });
    setTursoClient(null);
    expect(getTursoClient()).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run tests/tursoClient.test.ts
```

Expected: FAIL — `Cannot find module '../src/utils/tursoClient'`

- [ ] **Step 4: Create src/utils/tursoClient.ts**

```ts
import { createClient, type Client, type InValue } from '@libsql/client/web';

export type { Client, InValue };

let _singleton: Client | null = null;

export function createTursoClient(env: {
  TURSO_URL?: string;
  TURSO_AUTH_TOKEN?: string;
}): Client | null {
  if (!env.TURSO_URL || !env.TURSO_AUTH_TOKEN) return null;
  return createClient({ url: env.TURSO_URL, authToken: env.TURSO_AUTH_TOKEN });
}

export function initTursoSingleton(env: {
  TURSO_URL?: string;
  TURSO_AUTH_TOKEN?: string;
}): void {
  if (_singleton !== null) return;
  _singleton = createTursoClient(env);
}

export function getTursoClient(): Client | null {
  return _singleton;
}

/** Test-only reset. Never call from production code. */
export function setTursoClient(client: Client | null): void {
  _singleton = client;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run tests/tursoClient.test.ts
```

Expected: 8 passed

- [ ] **Step 6: Update .dev.vars.example**

Read `.dev.vars.example` first, then append:

```
TURSO_URL=libsql://rmpg-flex-secondary-rmpg-utah.turso.io
TURSO_AUTH_TOKEN=your-turso-auth-token-here
```

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/utils/tursoClient.ts tests/tursoClient.test.ts .dev.vars.example
git commit -m "feat(fallback): Turso client factory and singleton"
```

---

### Task 2: Worker dual-write wrapper

**Files:**
- Modify: `src/utils/db.ts`
- Modify: `src/index.ts`
- Create: `tests/dualWrite.test.ts`

**Interfaces:**
- Consumes: `getTursoClient(): Client | null`, `initTursoSingleton(env): void`, `setTursoClient(client): void`, `InValue` — all from `src/utils/tursoClient.ts`
- Produces: `execute()`, `query()`, `queryFirst()` — unchanged signatures, now with dual-write/fallback behavior

- [ ] **Step 1: Write failing tests**

Create `tests/dualWrite.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execute, query, queryFirst } from '../src/utils/db';
import { setTursoClient } from '../src/utils/tursoClient';
import type { D1Database, D1Result } from '@cloudflare/workers-types';

const D1_SUCCESS = {
  success: true,
  results: [],
  meta: { last_row_id: 1, changes: 1, duration: 0, rows_read: 0, rows_written: 1 },
} as unknown as D1Result;

function makeD1(opts?: {
  run?: () => Promise<D1Result>;
  all?: () => Promise<{ results: unknown[] }>;
  first?: () => Promise<unknown>;
}): D1Database {
  const run = opts?.run ?? vi.fn().mockResolvedValue(D1_SUCCESS);
  const all = opts?.all ?? vi.fn().mockResolvedValue({ results: [{ id: 1 }] });
  const first = opts?.first ?? vi.fn().mockResolvedValue({ id: 1 });
  const bound = { run, all, first };
  const stmt = { run, all, first, bind: vi.fn().mockReturnValue(bound) };
  return {
    prepare: vi.fn().mockReturnValue(stmt),
    batch: vi.fn(),
    exec: vi.fn(),
    dump: vi.fn(),
  } as unknown as D1Database;
}

function makeTurso(opts?: { execute?: () => Promise<unknown> }) {
  return {
    execute: opts?.execute ?? vi.fn().mockResolvedValue({ rows: [{ id: 99 }] }),
  };
}

describe('execute — dual-write', () => {
  beforeEach(() => setTursoClient(null));

  it('writes to D1 when no Turso client', async () => {
    const db = makeD1();
    await execute(db, 'INSERT INTO t(v) VALUES (?)', 'x');
    expect(db.prepare).toHaveBeenCalledWith('INSERT INTO t(v) VALUES (?)');
  });

  it('writes to both D1 and Turso when Turso is set', async () => {
    const db = makeD1();
    const turso = makeTurso();
    setTursoClient(turso as any);
    await execute(db, 'INSERT INTO t(v) VALUES (?)', 'x');
    expect(turso.execute).toHaveBeenCalledWith({
      sql: 'INSERT INTO t(v) VALUES (?)',
      args: ['x'],
    });
  });

  it('returns D1 result on success', async () => {
    const db = makeD1();
    const result = await execute(db, 'INSERT INTO t(v) VALUES (?)', 'x');
    expect(result).toMatchObject({ success: true });
  });

  it('throws D1 error and still calls Turso when D1 fails', async () => {
    const run = vi.fn().mockRejectedValue(new Error('D1 down'));
    const db = makeD1({ run });
    const turso = makeTurso();
    setTursoClient(turso as any);
    await expect(execute(db, 'INSERT INTO t(v) VALUES (?)', 'x')).rejects.toThrow('D1 down');
    expect(turso.execute).toHaveBeenCalled();
  });

  it('succeeds when Turso fails but D1 succeeds', async () => {
    const db = makeD1();
    const turso = makeTurso({
      execute: vi.fn().mockRejectedValue(new Error('Turso down')),
    });
    setTursoClient(turso as any);
    await expect(execute(db, 'INSERT INTO t(v) VALUES (?)', 'x')).resolves.toMatchObject({ success: true });
  });
});

describe('query — read fallback', () => {
  beforeEach(() => setTursoClient(null));

  it('returns D1 results normally', async () => {
    const db = makeD1();
    const rows = await query(db, 'SELECT * FROM t WHERE id = ?', 1);
    expect(rows).toEqual([{ id: 1 }]);
  });

  it('falls back to Turso when D1 read throws', async () => {
    const all = vi.fn().mockRejectedValue(new Error('D1 down'));
    const db = makeD1({ all });
    const turso = makeTurso({
      execute: vi.fn().mockResolvedValue({ rows: [{ id: 99 }] }),
    });
    setTursoClient(turso as any);
    const rows = await query(db, 'SELECT * FROM t WHERE id = ?', 1);
    expect(rows).toEqual([{ id: 99 }]);
  });

  it('throws when D1 fails and no Turso client', async () => {
    const all = vi.fn().mockRejectedValue(new Error('D1 down'));
    const db = makeD1({ all });
    await expect(query(db, 'SELECT * FROM t')).rejects.toThrow('D1 down');
  });
});

describe('queryFirst — read fallback', () => {
  beforeEach(() => setTursoClient(null));

  it('returns D1 result normally', async () => {
    const db = makeD1();
    const row = await queryFirst(db, 'SELECT * FROM t WHERE id = ?', 1);
    expect(row).toEqual({ id: 1 });
  });

  it('falls back to Turso when D1 throws', async () => {
    const first = vi.fn().mockRejectedValue(new Error('D1 down'));
    const db = makeD1({ first });
    const turso = makeTurso({
      execute: vi.fn().mockResolvedValue({ rows: [{ id: 99 }] }),
    });
    setTursoClient(turso as any);
    const row = await queryFirst(db, 'SELECT * FROM t WHERE id = ?', 1);
    expect(row).toEqual({ id: 99 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/dualWrite.test.ts
```

Expected: FAIL — Turso-related assertions fail because db.ts has no Turso logic yet

- [ ] **Step 3: Modify src/utils/db.ts**

Read the full `src/utils/db.ts` first. Add these imports after the existing imports at the top:

```ts
import { getTursoClient, type InValue } from './tursoClient';
import { log } from './logger';
```

Replace the `execute` function body (keep the signature `execute(db, sql, ...bindings)` unchanged):

```ts
export async function execute(
  db: D1Database,
  sql: string,
  ...bindings: unknown[]
): Promise<D1Result> {
  const turso = getTursoClient();

  const d1Promise = (bindings.length > 0
    ? db.prepare(sql).bind(...bindings)
    : db.prepare(sql)
  ).run();

  const tursoPromise = turso
    ? turso.execute({ sql, args: bindings as InValue[] }).catch((err: unknown) => {
        log.error('Turso dual-write failed', { sql },
          err instanceof Error ? err : new Error(String(err)));
      })
    : Promise.resolve(null);

  const [d1Result] = await Promise.allSettled([d1Promise, tursoPromise]);

  if (d1Result.status === 'rejected') {
    log.error('D1 write failed — Turso captured the row', { sql },
      d1Result.reason instanceof Error ? d1Result.reason : new Error(String(d1Result.reason)));
    throw d1Result.reason;
  }

  return d1Result.value;
}
```

Replace the `query` function body (keep the signature `query<T>(db, sql, ...bindings)` unchanged):

```ts
export async function query<T = unknown>(
  db: D1Database,
  sql: string,
  ...bindings: unknown[]
): Promise<T[]> {
  const stmt = db.prepare(sql);
  try {
    const result = await (bindings.length > 0 ? stmt.bind(...bindings) : stmt).all<T>();
    return result.results ?? [];
  } catch (err) {
    const turso = getTursoClient();
    if (!turso) throw err;
    log.warn('D1 read failed — falling back to Turso', { sql });
    const result = await turso.execute({ sql, args: bindings as InValue[] });
    return (result.rows ?? []) as T[];
  }
}
```

Replace the `queryFirst` function body (keep the signature `queryFirst<T>(db, sql, ...bindings)` unchanged):

```ts
export async function queryFirst<T = unknown>(
  db: D1Database,
  sql: string,
  ...bindings: unknown[]
): Promise<T | null> {
  const stmt = db.prepare(sql);
  try {
    const result = await (bindings.length > 0 ? stmt.bind(...bindings) : stmt).first<T>();
    return result ?? null;
  } catch (err) {
    const turso = getTursoClient();
    if (!turso) throw err;
    log.warn('D1 queryFirst failed — falling back to Turso', { sql });
    const result = await turso.execute({ sql, args: bindings as InValue[] });
    return (result.rows?.[0] as T) ?? null;
  }
}
```

- [ ] **Step 4: Add Turso init middleware to src/index.ts**

Open `src/index.ts`. Add the import at the top with the other utils imports:

```ts
import { initTursoSingleton } from './utils/tursoClient';
```

Find the middleware chain near the top (the `app.use('*', traceMiddleware())` block). Add the Turso init as the FIRST middleware, before `traceMiddleware()`:

```ts
app.use('*', async (c, next) => {
  initTursoSingleton(c.env);
  await next();
});
```

- [ ] **Step 5: Run dual-write tests**

```bash
npx vitest run tests/dualWrite.test.ts
```

Expected: all 10 tests pass

- [ ] **Step 6: Run full Worker test suite**

```bash
npx vitest run
```

Expected: same pass count as before Task 1 — no regressions

- [ ] **Step 7: Typecheck**

```bash
npx tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 8: Commit**

```bash
git add src/utils/db.ts src/utils/tursoClient.ts src/index.ts tests/dualWrite.test.ts
git commit -m "feat(fallback): Worker dual-write — execute/query/queryFirst mirror to Turso"
```

---

### Task 3: Deploy pipeline Turso migration step + Toughbook restore script

**Files:**
- Modify: `.github/workflows/deploy.yml`
- Modify: `wrangler.toml`
- Create: `scripts/restore-from-turso.sh`

**Interfaces:**
- Consumes: `TURSO_AUTH_TOKEN` GitHub Actions secret (set in repo Settings → Secrets); `TURSO_URL`/`TURSO_AUTH_TOKEN` env vars on the Toughbook
- Produces: Turso schema stays in sync with D1 on every deploy; Toughbook can restore from Turso in ~2 minutes

- [ ] **Step 1: Add Turso migration step to deploy.yml**

Open `.github/workflows/deploy.yml`. Find the step named `Apply D1 migrations (remote)`. Insert this new step immediately AFTER it:

```yaml
      - name: Apply migrations to Turso secondary
        continue-on-error: true
        timeout-minutes: 3
        env:
          TURSO_AUTH_TOKEN: ${{ secrets.TURSO_AUTH_TOKEN }}
        run: |
          curl -sSfL https://get.tur.so/install.sh | bash -s -- --yes
          export PATH="$HOME/.turso:$PATH"
          for f in migrations/*.sql; do
            turso db shell rmpg-flex-secondary < "$f" || true
          done
```

- [ ] **Step 2: Document new secrets in wrangler.toml**

Open `wrangler.toml`. Find the `[vars]` section. Add this comment block immediately below it:

```toml
# ─── Turso secondary DB — set via `wrangler secret put`, NOT wrangler.toml ──
# TURSO_URL          libsql://rmpg-flex-secondary-rmpg-utah.turso.io
# TURSO_AUTH_TOKEN   Turso auth token (turso.tech dashboard → database → tokens)
# Both must also be added to .dev.vars for local development.
# Without them the dual-write wrapper is a null no-op — local dev is unaffected.
```

- [ ] **Step 3: Create scripts/restore-from-turso.sh**

```bash
#!/usr/bin/env bash
# Toughbook cold-standby activation — Step 1 of the runbook.
# Dumps the Turso secondary DB and imports it into wrangler dev's local D1.
# Prerequisites on the Toughbook:
#   - turso CLI installed (curl -sSfL https://get.tur.so/install.sh | bash)
#   - TURSO_AUTH_TOKEN set in environment or .dev.vars
set -euo pipefail

DB_NAME="rmpg-flex-secondary"
DUMP_FILE="/tmp/turso-restore-$(date +%Y%m%d-%H%M%S).sql"

echo "==> Dumping Turso '${DB_NAME}' → ${DUMP_FILE} ..."
turso db shell "${DB_NAME}" .dump > "${DUMP_FILE}"

echo "==> Importing into local D1 (wrangler dev SQLite) ..."
npx wrangler d1 execute rmpg-flex --local --file="${DUMP_FILE}"

echo ""
echo "==> Done. Run the fallback stack:"
echo "    npm run dev                      # Worker API on :8787"
echo "    npx serve client/dist -p 3000   # SPA on :3000"
```

- [ ] **Step 4: Make script executable**

```bash
chmod +x scripts/restore-from-turso.sh
git add scripts/restore-from-turso.sh
```

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/deploy.yml wrangler.toml scripts/restore-from-turso.sh
git commit -m "feat(fallback): Turso migration step in deploy pipeline + Toughbook restore script"
```

---

### Task 4: Client offline queue infrastructure

**Files:**
- Modify: `client/package.json`
- Create: `client/src/hooks/useOfflineQueue.ts`
- Create: `client/src/__tests__/offlineQueue.test.ts`

**Interfaces:**
- Produces:
  - `interface QueuedOperation { id, method, path, body, headers, timestamp, retries }`
  - `enqueueOperation(op: Omit<QueuedOperation, 'id'|'timestamp'|'retries'>): Promise<void>`
  - `getQueuedOperations(): Promise<QueuedOperation[]>` — sorted by timestamp ascending
  - `removeOperation(id: string): Promise<void>`
  - `incrementRetries(id: string): Promise<void>`
  - `MAX_RETRIES: 5` — exported constant
  - `useOfflineQueue(): void` — React hook, mounts in App.tsx

- [ ] **Step 1: Install idb and fake-indexeddb**

```bash
cd client && npm install idb --legacy-peer-deps && npm install --save-dev fake-indexeddb --legacy-peer-deps && cd ..
```

Verify both appear in `client/package.json`.

- [ ] **Step 2: Write failing tests**

Create `client/src/__tests__/offlineQueue.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import {
  enqueueOperation,
  getQueuedOperations,
  removeOperation,
  incrementRetries,
} from '../hooks/useOfflineQueue';

beforeEach(async () => {
  await deleteDB('rmpg_offline_queue');
});

describe('enqueueOperation', () => {
  it('adds an operation with id, timestamp, retries=0', async () => {
    await enqueueOperation({ method: 'POST', path: '/api/dispatch/calls', body: { type: 'Test' }, headers: {} });
    const ops = await getQueuedOperations();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ method: 'POST', path: '/api/dispatch/calls', retries: 0 });
    expect(typeof ops[0].id).toBe('string');
    expect(ops[0].timestamp).toBeGreaterThan(0);
  });

  it('returns multiple operations sorted by timestamp', async () => {
    await enqueueOperation({ method: 'POST', path: '/api/a', body: {}, headers: {} });
    await enqueueOperation({ method: 'PATCH', path: '/api/b', body: {}, headers: {} });
    const ops = await getQueuedOperations();
    expect(ops).toHaveLength(2);
    expect(ops[0].path).toBe('/api/a');
    expect(ops[1].path).toBe('/api/b');
  });
});

describe('removeOperation', () => {
  it('removes the operation by id', async () => {
    await enqueueOperation({ method: 'POST', path: '/api/a', body: {}, headers: {} });
    const [op] = await getQueuedOperations();
    await removeOperation(op.id);
    expect(await getQueuedOperations()).toHaveLength(0);
  });

  it('is a no-op for unknown id', async () => {
    await expect(removeOperation('does-not-exist')).resolves.toBeUndefined();
  });
});

describe('incrementRetries', () => {
  it('increments retries from 0 to 1', async () => {
    await enqueueOperation({ method: 'POST', path: '/api/a', body: {}, headers: {} });
    const [op] = await getQueuedOperations();
    await incrementRetries(op.id);
    const [updated] = await getQueuedOperations();
    expect(updated.retries).toBe(1);
  });

  it('increments retries multiple times', async () => {
    await enqueueOperation({ method: 'POST', path: '/api/a', body: {}, headers: {} });
    const [op] = await getQueuedOperations();
    await incrementRetries(op.id);
    await incrementRetries(op.id);
    await incrementRetries(op.id);
    const [updated] = await getQueuedOperations();
    expect(updated.retries).toBe(3);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd client && npx vitest run src/__tests__/offlineQueue.test.ts && cd ..
```

Expected: FAIL — `Cannot find module '../hooks/useOfflineQueue'`

- [ ] **Step 4: Create client/src/hooks/useOfflineQueue.ts**

```ts
import { openDB, type IDBPDatabase } from 'idb';
import { useEffect, useCallback } from 'react';

export interface QueuedOperation {
  id: string;
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
  timestamp: number;
  retries: number;
}

const DB_NAME = 'rmpg_offline_queue';
const STORE = 'operations';
export const MAX_RETRIES = 5;

async function getQueueDb(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp');
      }
    },
  });
}

export async function enqueueOperation(
  op: Omit<QueuedOperation, 'id' | 'timestamp' | 'retries'>,
): Promise<void> {
  const db = await getQueueDb();
  await db.add(STORE, {
    ...op,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    retries: 0,
  });
}

export async function getQueuedOperations(): Promise<QueuedOperation[]> {
  const db = await getQueueDb();
  return db.getAllFromIndex(STORE, 'timestamp');
}

export async function removeOperation(id: string): Promise<void> {
  const db = await getQueueDb();
  await db.delete(STORE, id);
}

export async function incrementRetries(id: string): Promise<void> {
  const db = await getQueueDb();
  const tx = db.transaction(STORE, 'readwrite');
  const op = await tx.store.get(id);
  if (op) {
    op.retries += 1;
    await tx.store.put(op);
  }
  await tx.done;
}

export function useOfflineQueue(): void {
  const drain = useCallback(async () => {
    if (!navigator.onLine) return;
    const { apiFetch } = await import('./useApi');
    const ops = await getQueuedOperations();
    for (const op of ops) {
      try {
        await (apiFetch as Function)(op.path, {
          method: op.method,
          body: op.body !== undefined ? JSON.stringify(op.body) : undefined,
          headers: { 'Content-Type': 'application/json', ...op.headers },
          _skipQueue: true,
        });
        await removeOperation(op.id);
      } catch {
        await incrementRetries(op.id);
      }
    }
  }, []);

  useEffect(() => {
    window.addEventListener('online', drain);
    window.addEventListener('focus', drain);
    const interval = setInterval(drain, 30_000);
    void drain();
    return () => {
      window.removeEventListener('online', drain);
      window.removeEventListener('focus', drain);
      clearInterval(interval);
    };
  }, [drain]);
}
```

- [ ] **Step 5: Run tests**

```bash
cd client && npx vitest run src/__tests__/offlineQueue.test.ts && cd ..
```

Expected: 7 tests pass

- [ ] **Step 6: Commit**

```bash
git add client/package.json client/package-lock.json client/src/hooks/useOfflineQueue.ts client/src/__tests__/offlineQueue.test.ts
git commit -m "feat(fallback): client IndexedDB offline queue infrastructure"
```

---

### Task 5: apiFetch failure detection, queue writes, and fallback URL switching

**Files:**
- Modify: `client/src/hooks/useApi.ts`
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `enqueueOperation`, `QueuedOperation` — from `useOfflineQueue.ts`; `useOfflineQueue` hook
- Produces: `apiFetch` queues failed mutations in IndexedDB; switches API base to Toughbook Tailscale address after 3 consecutive failures

**Context on apiFetch internals** (read before editing):
- `apiFetch` is defined at line ~448 of `useApi.ts`
- Line ~452: `const relativeUrl = endpoint.startsWith('/api') ? endpoint : \`/api${endpoint}\`;`
- Line ~453: `const url = options?.directWorker ? absolute : relativeUrl;` — relative for normal calls
- Line ~476: `const res = await fetchWithRetry(url, fetchInit);` — the primary fetch point
- `fetchWithRetry` already retries 3× with 2 s exponential backoff before throwing
- `_skipQueue` is a custom field on options — prevents re-queuing during replay

- [ ] **Step 1: Add module-level failure state above apiFetch**

Open `client/src/hooks/useApi.ts`. Locate the line `export async function apiFetch<T>(`. Add these declarations immediately above it:

```ts
// ─── Fallback URL switching (Toughbook cold standby) ──────────────────────
const FALLBACK_URL_KEY = 'rmpg_fallback_api_url';
const CONSECUTIVE_FAILURE_THRESHOLD = 3;
const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
let _consecutiveApiFailures = 0;

function resolveFallbackUrl(relativeUrl: string): string | null {
  if (_consecutiveApiFailures < CONSECUTIVE_FAILURE_THRESHOLD) return null;
  const fallback = localStorage.getItem(FALLBACK_URL_KEY);
  return fallback ? `${fallback}${relativeUrl}` : null;
}
```

- [ ] **Step 2: Wrap the fetchWithRetry call in apiFetch**

Find line ~476 inside `apiFetch`:

```ts
const res = await fetchWithRetry(url, fetchInit);
```

Replace it with:

```ts
let res: Response;
const fallbackUrl = resolveFallbackUrl(relativeUrl);
try {
  res = await fetchWithRetry(fallbackUrl ?? url, fetchInit);
  _consecutiveApiFailures = 0;
} catch (fetchErr) {
  _consecutiveApiFailures += 1;
  const m = method.toUpperCase();
  if (MUTATING_METHODS.has(m) && !(options as any)?._skipQueue) {
    const { enqueueOperation } = await import('./useOfflineQueue');
    await enqueueOperation({
      method: m,
      path: relativeUrl,
      body: options?.body ? (() => { try { return JSON.parse(options.body as string); } catch { return undefined; } })() : undefined,
      headers: { ...(options?.headers as Record<string, string>) },
    });
  }
  throw fetchErr;
}
```

- [ ] **Step 3: Mount useOfflineQueue in App.tsx**

Open `client/src/App.tsx`. Add the import:

```ts
import { useOfflineQueue } from './hooks/useOfflineQueue';
```

Inside the root `App` component function body (before the return statement), add:

```ts
useOfflineQueue();
```

- [ ] **Step 4: Run client typecheck**

```bash
cd client && npx tsc --noEmit && cd ..
```

Expected: 0 new errors from your changes

- [ ] **Step 5: Run full client test suite**

```bash
cd client && npx vitest run && cd ..
```

Expected: all tests pass (same count as before this task)

- [ ] **Step 6: Commit**

```bash
git add client/src/hooks/useApi.ts client/src/App.tsx
git commit -m "feat(fallback): apiFetch queues failed mutations + switches to Toughbook URL after 3 failures"
```

---

### Task 6: Admin Offline Queue panel

**Files:**
- Create: `client/src/pages/admin/OfflineQueueTab.tsx`
- Modify: `client/src/pages/AdminPage.tsx` (4 edits)

**Interfaces:**
- Consumes: `getQueuedOperations`, `removeOperation`, `QueuedOperation`, `MAX_RETRIES` — from `useOfflineQueue.ts`

- [ ] **Step 1: Create OfflineQueueTab.tsx**

Create `client/src/pages/admin/OfflineQueueTab.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import {
  getQueuedOperations,
  removeOperation,
  type QueuedOperation,
  MAX_RETRIES,
} from '../../hooks/useOfflineQueue';
import PanelTitleBar from '../../components/PanelTitleBar';

export default function OfflineQueueTab() {
  const [ops, setOps] = useState<QueuedOperation[]>([]);

  async function load() {
    setOps(await getQueuedOperations());
  }

  useEffect(() => { void load(); }, []);

  async function handleDiscard(id: string) {
    await removeOperation(id);
    void load();
  }

  if (ops.length === 0) {
    return (
      <div className="p-4 space-y-4">
        <PanelTitleBar title="OFFLINE QUEUE" icon={WifiOff} />
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          No queued operations — all data synced.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="OFFLINE QUEUE" icon={WifiOff} />
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        {ops.length} operation{ops.length !== 1 ? 's' : ''} pending sync. These were
        queued during a connectivity outage and will replay automatically when the API
        recovers. Operations stuck after {MAX_RETRIES} retries require manual discard.
      </p>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-left font-semibold text-[9px]">
            <th className="py-[3px] pr-3">Method</th>
            <th className="py-[3px] pr-3">Path</th>
            <th className="py-[3px] pr-3">Queued</th>
            <th className="py-[3px] pr-3">Retries</th>
            <th className="py-[3px]">Action</th>
          </tr>
        </thead>
        <tbody>
          {ops.map(op => {
            const stuck = op.retries >= MAX_RETRIES;
            return (
              <tr
                key={op.id}
                className="py-[2px]"
                style={{ color: stuck ? 'var(--sev-critical)' : 'var(--text-primary)' }}
              >
                <td className="py-[2px] pr-3 font-mono">{op.method}</td>
                <td className="py-[2px] pr-3 font-mono truncate max-w-[220px]">{op.path}</td>
                <td className="py-[2px] pr-3">
                  {new Date(op.timestamp).toLocaleTimeString()}
                </td>
                <td className="py-[2px] pr-3">
                  {op.retries}{stuck ? ' — stuck' : ''}
                </td>
                <td className="py-[2px]">
                  <button
                    onClick={() => handleDiscard(op.id)}
                    className="hover:underline text-[9px]"
                    style={{ color: 'var(--sev-critical)' }}
                    aria-label={`Discard queued ${op.method} ${op.path}`}
                  >
                    Discard
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Wire into AdminPage.tsx — Edit 1: TabId union**

Open `client/src/pages/AdminPage.tsx`. Find line ~265 (the `type TabId = ...` declaration). Add `'offline-queue'` to the union:

```ts
type TabId = 'users' | ... | 'automations' | 'offline-queue';
```

- [ ] **Step 3: Wire into AdminPage.tsx — Edit 2: VALID_TABS array**

Find line ~292 (`const VALID_TABS = [...]`). Add `'offline-queue'` to the end of the array:

```ts
const VALID_TABS = ['users', ..., 'automations', 'offline-queue'];
```

- [ ] **Step 4: Wire into AdminPage.tsx — Edit 3: tabGroups config**

Find the `tabGroups` array (line ~707). Add `offline-queue` to the `'System'` category tabs array:

```ts
{ id: 'offline-queue', label: 'Offline Queue', icon: WifiOff },
```

Add the import at the top of the file if `WifiOff` is not already imported from lucide-react:

```ts
import { ..., WifiOff } from 'lucide-react';
```

Also add the OfflineQueueTab import at the top:

```ts
import OfflineQueueTab from './admin/OfflineQueueTab';
```

- [ ] **Step 5: Wire into AdminPage.tsx — Edit 4: render block**

Find the section after line ~1045 where `activeTab === 'users'` is rendered. Add the offline-queue render block alongside the other tab conditionals:

```tsx
{activeTab === 'offline-queue' && <OfflineQueueTab />}
```

- [ ] **Step 6: Run client typecheck**

```bash
cd client && npx tsc --noEmit && cd ..
```

Expected: 0 new errors

- [ ] **Step 7: Run full test suites**

```bash
npx vitest run
cd client && npx vitest run && cd ..
```

Expected: all tests pass in both suites

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/admin/OfflineQueueTab.tsx client/src/pages/AdminPage.tsx
git commit -m "feat(fallback): admin Offline Queue panel for stuck operations"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Turso secondary DB (same SQLite dialect, independent of Cloudflare) | Task 1 |
| Worker dual-write via `execute()` using `Promise.allSettled` | Task 2 |
| Read fallback via `query()` / `queryFirst()` | Task 2 |
| Turso init as Worker middleware (idempotent singleton) | Task 2 |
| Deploy pipeline: Turso schema stays in sync with D1 | Task 3 |
| `TURSO_URL` / `TURSO_AUTH_TOKEN` secrets documented | Task 1, Task 3 |
| Toughbook restore script (`scripts/restore-from-turso.sh`) | Task 3 |
| Client IndexedDB queue (enqueue, drain, retry, discard) | Task 4 |
| apiFetch failure detection + queue writes | Task 5 |
| Fallback URL auto-switch after 3 consecutive failures | Task 5 |
| `useOfflineQueue` mounted in App.tsx | Task 5 |
| Admin Offline Queue review panel | Task 6 |

All spec requirements covered. ✅

**Placeholder scan:** No TBDs or "implement later" strings. Step 2 of Task 5 shows the exact line to replace in `useApi.ts`; the context block above it explains where to find it.

**Type consistency:**
- `QueuedOperation` defined in Task 4, consumed in Tasks 5 and 6 ✅
- `MAX_RETRIES` exported in Task 4, consumed in Task 6 ✅
- `enqueueOperation` defined in Task 4, imported in Tasks 5 and 6 ✅
- `getTursoClient()` defined in Task 1, called in Task 2 ✅
- `initTursoSingleton()` defined in Task 1, called in Task 2 (index.ts) ✅
- `setTursoClient()` defined in Task 1, used in Task 2 tests ✅
- `InValue` re-exported in Task 1, used in Task 2 casts ✅
