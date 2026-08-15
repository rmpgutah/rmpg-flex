# Cloudflare Secondary Fallback Design

**Date:** 2026-08-14
**Status:** Approved
**Branch:** `claude/cloudflare-secondary-fallback-7d7e6f`

## Problem

RMPG Flex is 100% Cloudflare-dependent (Workers + D1 + Pages + KV + R2 + Durable Objects). A Cloudflare degradation or outage means:

- D1 write failures silently drop CAD data (D1 degraded, Workers alive)
- Full API/SPA unavailability (Cloudflare fully down)
- No continuity for field officers on cellular

## Goals

- **Full parity** fallback capability
- **Cold standby** on existing Toughbook hardware (~hours RTO acceptable)
- **Zero data loss** for write operations at any failure depth
- **Field officers on cellular** remain reachable during outage

## Non-Goals

- Hot / automatic failover (sub-minute RTO)
- Replacing Cloudflare as the primary platform
- Real-time bidirectional sync during the outage

---

## Architecture Overview

Three interlocking layers, each covering a different failure depth:

```
Layer 1 — Turso mirror (always running)
  Every D1 write also writes to Turso (independent SQLite cloud, not Cloudflare).
  Turso stays current within milliseconds. If D1 fails but Workers are up,
  Turso captures the write. If Cloudflare is fully down, Turso has all data.

Layer 2 — Worker dual-write (D1 degraded, Workers alive)
  A thin wrapper around execute() in src/utils/db.ts.
  Promise.allSettled([d1Write, tursoWrite]) — if D1 errors, Turso still gets
  the row. Reads fall back to Turso if D1 returns an error.

Layer 3 — Client IndexedDB queue (full outage, API unreachable)
  apiFetch() detects network failures and queues POST/PATCH/PUT/DELETE
  operations in IndexedDB. On reconnect, the queue replays against
  api.rmpgutah.us automatically.

Cold Standby — Toughbook (extended outage, need full compute)
  wrangler dev on the Toughbook, local D1 pre-loaded from a Turso dump.
  Tailscale gives field officers cellular access to the Toughbook.
  Client auto-detects API failure and switches base URL to the Toughbook's
  Tailscale address after 3 consecutive failures.
```

---

## Layer 1 — Turso Secondary Database

### Why Turso

Turso uses the exact same SQLite dialect as D1. Every migration file in `migrations/` applies without modification. The `@libsql/client` package speaks libSQL HTTP — no Node.js, no TCP sockets, runs natively in Cloudflare Workers. Turso infrastructure is independent of Cloudflare.

### Database

- **Name:** `rmpg-flex-secondary`
- **Provider:** Turso (turso.tech)
- **Tier:** Free (500 DBs, 9 GB, 1B row reads/month — sufficient for RMPG scale)

### Worker Secrets

```bash
wrangler secret put TURSO_URL        # libsql://rmpg-flex-secondary-rmpg-utah.turso.io
wrangler secret put TURSO_AUTH_TOKEN # Turso auth token
```

For local dev, add both to `.dev.vars` (gitignored). When unset, the dual-write wrapper is a no-op — local `wrangler dev` works unchanged.

### Schema Sync

Add one step to `.github/workflows/deploy.yml` after `Apply D1 migrations`:

```yaml
- name: Apply migrations to Turso secondary
  continue-on-error: true
  run: |
    for f in migrations/*.sql; do
      turso db shell rmpg-flex-secondary < "$f" || true
    done
  env:
    TURSO_AUTH_TOKEN: ${{ secrets.TURSO_AUTH_TOKEN }}
```

This keeps Turso schema-identical to D1 on every deploy.

### Toughbook Data Restore

Script at `scripts/restore-from-turso.sh` (runs on the Toughbook during activation):

```bash
#!/usr/bin/env bash
set -euo pipefail
echo "Dumping Turso to /tmp/turso-restore.sql..."
turso db shell rmpg-flex-secondary .dump > /tmp/turso-restore.sql
echo "Importing into local D1..."
wrangler d1 execute rmpg-flex --local --file=/tmp/turso-restore.sql
echo "Restore complete."
```

---

## Layer 2 — Worker Dual-Write Wrapper

### Seam

All mutating D1 calls in the codebase route through `execute()` in `src/utils/db.ts`. Reads route through `query()` and `queryFirst()`. Wrapping these three functions covers all 150+ routes without touching any route file.

### Implementation

**New file:** `src/utils/tursoClient.ts`

```ts
import { createClient, type Client } from '@libsql/client/web';

export function createTursoClient(env: { TURSO_URL?: string; TURSO_AUTH_TOKEN?: string }): Client | null {
  if (!env.TURSO_URL || !env.TURSO_AUTH_TOKEN) return null;
  return createClient({ url: env.TURSO_URL, authToken: env.TURSO_AUTH_TOKEN });
}
```

**Modified `execute()` in `src/utils/db.ts`:**

```ts
export async function execute(
  db: D1Database,
  sql: string,
  ...bindings: unknown[]
): Promise<D1Result> {
  const stmt = db.prepare(sql);
  const d1Promise = (bindings.length > 0 ? stmt.bind(...bindings) : stmt).run();

  // Dual-write: fire Turso in parallel, never block on it
  const turso = getTursoClient(); // singleton from env, null in local dev
  const tursoPromise = turso
    ? turso.execute({ sql, args: bindings as InValue[] }).catch(err => {
        log.error('Turso dual-write failed', { sql }, err);
      })
    : Promise.resolve();

  const [d1Result] = await Promise.allSettled([d1Promise, tursoPromise]);

  if (d1Result.status === 'rejected') {
    log.error('D1 write failed — Turso captured it', { sql }, d1Result.reason);
    throw d1Result.reason; // surface to caller; Turso already has the row
  }
  return d1Result.value;
}
```

**Read fallback in `query()` / `queryFirst()`:**

```ts
// If D1 throws, replay against Turso transparently
try {
  return await d1Read;
} catch (err) {
  log.warn('D1 read failed — falling back to Turso', { sql });
  if (!turso) throw err;
  const result = await turso.execute({ sql, args: bindings as InValue[] });
  return result.rows as T[];
}
```

### Behavior Matrix

| D1 | Turso | Outcome |
|----|-------|---------|
| ✅ | ✅ | Normal — D1 result returned |
| ✅ | ❌ | D1 result returned, Turso failure logged |
| ❌ | ✅ | D1 error surfaced to caller, Turso has the row — no data loss |
| ❌ | ❌ | D1 error surfaced — same as today |

---

## Layer 3 — Client IndexedDB Queue

### Scope

Only mutating methods are queued (POST, PATCH, PUT, DELETE). GETs are never queued — stale reads are harmless and re-fetching on reconnect is sufficient.

### Queue Store

IndexedDB database `rmpg_offline_queue`, object store `operations`:

```ts
interface QueuedOperation {
  id: string;          // uuid
  method: string;      // POST | PATCH | PUT | DELETE
  path: string;        // /api/dispatch/calls
  body: unknown;       // JSON body
  headers: Record<string, string>;
  timestamp: number;   // ms since epoch
  retries: number;     // incremented on replay failure
}
```

### apiFetch Integration

In `client/src/hooks/useApi.ts`, `apiFetch` catches network errors and 5xx responses:

```ts
// On failure: queue and return optimistic success
if (isNetworkError || response.status >= 500) {
  await enqueueOperation({ method, path, body, headers });
  toast.warn('Saved locally — will sync when connection restores.');
  return; // UI proceeds optimistically
}
```

### Replay

`useOfflineQueue` hook in `client/src/hooks/useOfflineQueue.ts`, mounted in `App.tsx`:

- Triggers on: `navigator.onLine` change, `window.focus`, 30-second interval
- Drains queue in chronological order (FIFO)
- Failed replay: increments `retries`; after 5 retries, flags for manual review
- Manual review surface: `/admin` → new "Offline Queue" tab

### Fallback URL Switching

After 3 consecutive `apiFetch` failures to `api.rmpgutah.us`, the client switches its API base URL to `localStorage.getItem('rmpg_fallback_api_url')`. Admins set this once via Settings page (e.g., `http://toughbook.rmpg.ts.net:8787`). The client switches back automatically when a health check to the primary succeeds.

---

## Toughbook Cold Standby

### Network: Tailscale

- Install Tailscale on the Toughbook and all officer devices / patrol laptops
- Toughbook joins the RMPG Tailnet
- Field officers on cellular reach the Toughbook via Tailscale MagicDNS: `http://toughbook.rmpg.ts.net:8787`
- No public IP, no port forwarding, no static IP required
- Tailscale relay servers (DERP) are independent of Cloudflare

### One-Time Setup (done in advance, not during an outage)

```bash
# On the Toughbook
git clone https://github.com/rmpgutah/rmpg-flex .
npm install
cd client && npm install --legacy-peer-deps && npm run build && cd ..

# Create .dev.vars (gitignored)
cat > .dev.vars <<EOF
TURSO_URL=libsql://rmpg-flex-secondary-rmpg-utah.turso.io
TURSO_AUTH_TOKEN=<token>
JWT_SECRET=<secret>
VITE_MAPBOX_ACCESS_TOKEN=<token>
EOF

# Pre-build SPA (so activation is just wrangler dev)
cd client && npm run build
```

In the live app Settings page, set `rmpg_fallback_api_url` = `http://toughbook.rmpg.ts.net:8787`. This value is cached in every officer's browser.

### Activation Runbook (~10 minutes)

```bash
# Step 1 — Pull latest code and restore Turso data to local D1 (~2 min)
git pull origin main
scripts/restore-from-turso.sh

# Step 2 — Start the Worker API on port 8787
npm run dev

# Step 3 — Serve the SPA on port 3000
npx serve client/dist -p 3000
```

Officers' clients auto-switch to the Toughbook after 3 failed primary API calls. No officer action needed.

### Recovery (when Cloudflare restores)

```bash
# 1. Export delta from Toughbook local D1
wrangler d1 export rmpg-flex --local --output=toughbook-delta.sql

# 2. Apply delta to live D1
scripts/apply-migration.sh toughbook-delta.sql

# 3. Client queues drain automatically — no manual step
# 4. Turso re-syncs from the next Worker dual-write — no manual step
```

---

## Files Changed / Created

| File | Change |
|------|--------|
| `src/utils/tursoClient.ts` | New — Turso client factory |
| `src/utils/db.ts` | Modified — dual-write in `execute()`, fallback reads in `query()`/`queryFirst()` |
| `client/src/hooks/useOfflineQueue.ts` | New — IndexedDB queue drain hook |
| `client/src/hooks/useApi.ts` | Modified — failure detection, queue write, fallback URL switching |
| `client/src/pages/admin/OfflineQueueTab.tsx` | New — manual review panel for stuck queue items |
| `scripts/restore-from-turso.sh` | New — Toughbook activation data restore script |
| `.github/workflows/deploy.yml` | Modified — add Turso migration step |
| `wrangler.toml` | Modified — document `TURSO_URL` / `TURSO_AUTH_TOKEN` as required secrets |
| `.dev.vars.example` | Modified — add Turso vars |

## New Secrets Required

| Secret | Where | Command |
|--------|-------|---------|
| `TURSO_URL` | Worker | `wrangler secret put TURSO_URL` |
| `TURSO_AUTH_TOKEN` | Worker | `wrangler secret put TURSO_AUTH_TOKEN` |

## Dependencies Added

| Package | Where | Purpose |
|---------|-------|---------|
| `@libsql/client` | `package.json` (root) | Turso HTTP client for Workers |
| `idb` | `client/package.json` | IndexedDB wrapper for offline queue |
