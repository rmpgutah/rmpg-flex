# Toughbook FZ-55 Secondary Server — Design Spec
**Date:** 2026-08-15  
**Status:** Approved  
**Branch:** `claude/toughbook-fz55-server-2c5312`

---

## Overview

A secondary Panasonic Toughbook FZ-55 running Windows acts as a local-first data node for RMPG Flex. All writes land on both the FZ-55 (SQLite via `wrangler dev --local`) and Cloudflare D1 simultaneously. When Cloudflare is unreachable the FZ-55 absorbs writes and replays them when connectivity is restored. On the RMPG LAN the client automatically prefers the FZ-55; off-LAN (field units, remote) the client uses Cloudflare only.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  RMPG LAN (dispatch center)                             │
│                                                         │
│  React/Electron Client                                  │
│    │  LAN detected (VITE_LOCAL_SERVER_URL subnet)       │
│    ├──► FZ-55 :8787  (wrangler dev --local / SQLite)   │
│    └──► api.rmpgutah.us  (Cloudflare D1)               │
│         Both fired in parallel on every mutation        │
│                                                         │
│  FZ-55 Windows Service (NSSM: RMPG-Flex-Local)         │
│    • sync_queue  →  replays missed Cloudflare writes    │
│    • sync_conflicts  →  audit trail, LWW resolution     │
└─────────────────────────────────────────────────────────┘

Off-LAN (field units, remote access): Cloudflare only. No change.
```

### Components

| # | Component | Location |
|---|-----------|----------|
| 1 | `wrangler dev --local` Windows Service | FZ-55 hardware |
| 2 | LAN detection + API base switcher | `client/src/hooks/useApiBase.ts` |
| 3 | Dual-write fetch wrapper | `client/src/hooks/useApi.ts` |
| 4 | Sync queue + replay cron | `src/routes/sync.ts` + migration `0249` |
| 5 | Conflict resolution + audit table | `src/utils/syncConflict.ts` + migration `0250` |

---

## Section 1 — Windows Service Setup (FZ-55)

**Tool:** NSSM (Non-Sucking Service Manager)

```
Service name:   RMPG-Flex-Local
Executable:     C:\Windows\System32\cmd.exe
Arguments:      /c "npx wrangler dev --local --port 8787
                    --persist-to C:\rmpg-flex\local-db"
Working dir:    C:\rmpg-flex\
Startup type:   Automatic (Delayed)
Recovery:       Restart on failure, 5s delay, 3 attempts
Log stdout:     C:\rmpg-flex\logs\wrangler-out.log
Log stderr:     C:\rmpg-flex\logs\wrangler-err.log
```

**Local DB location:**
```
C:\rmpg-flex\local-db\.wrangler\state\v3\d1\   ← SQLite file
```

`--persist-to` is mandatory. Without it wrangler dev uses a temp directory wiped on every restart, destroying the queue.

**Initial setup sequence:**
```bash
# 1. Install Node.js LTS + Git on the FZ-55
# 2. Clone repo
git clone https://github.com/rmpgutah/rmpg-flex C:\rmpg-flex
cd C:\rmpg-flex && npm install

# 3. Set secrets (same values as Cloudflare production)
npx wrangler secret put JWT_SECRET

# 4. Apply all migrations to local SQLite
npm run migrate:local

# 5. Register + start Windows Service
nssm install RMPG-Flex-Local
nssm start RMPG-Flex-Local

# 6. Verify
curl http://localhost:8787/api/health
```

**Windows Firewall rule:**
- Port 8787, TCP, inbound, Private network scope only
- Blocks internet exposure; allows all LAN clients

---

## Section 2 — LAN Detection & API Base Switcher

**File:** `client/src/hooks/useApiBase.ts`  
**Context:** `ApiBaseContext` — consumed by all `apiFetch` / `apiMutate` calls

```
Boot sequence:
1. GET VITE_LOCAL_SERVER_URL/api/health  (configurable, default http://fz55:8787)
2. Response < 500ms AND status ok  →  LOCAL mode
3. Otherwise  →  CLOUD mode (https://api.rmpgutah.us)
4. Re-probe every 30s + on window focus + on navigator.onLine change
```

- `VITE_LOCAL_SERVER_URL` set in `client/.env` (gitignored) — no hardcoded IPs in source
- Nav bar chip shows `LOCAL` or `CLOUD` — officers always know active endpoint
- Electron desktop: system tray tooltip mirrors the same state

---

## Section 3 — Dual-Write Fetch Wrapper

**File:** `client/src/hooks/useApi.ts` (extends existing `apiFetch`)

**Reads:** Single request to the active preferred endpoint only. No double-reads.

**Writes (`apiMutate`):**
```
Promise.allSettled([
  fetch(LOCAL_BASE + path, options),   // FZ-55
  fetch(CLOUD_BASE + path, options),   // Cloudflare
])

Resolution:
  Both succeed      →  return LOCAL response
  LOCAL fails only  →  return CLOUD response, log warning
  CLOUD fails only  →  return LOCAL response (FZ-55 queues for replay)
  Both fail         →  throw, surface toast: "No connectivity"
```

- `Promise.allSettled` — never lets one failure cancel the other write
- FZ-55 detects its own Cloudflare miss via health probe and marks `sync_queue` rows
- `apiMutate` replaces current `apiFetch(path, {method:'POST',...})` call sites (one-line swap)

---

## Section 4 — Sync Queue & Replay

**Route:** `src/routes/sync.ts`  
**Migration:** `0249_sync_queue.sql`

```sql
CREATE TABLE IF NOT EXISTS sync_queue (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  method        TEXT NOT NULL,
  path          TEXT NOT NULL,
  body          TEXT,
  headers       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_attempt  TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | delivered | failed
  error         TEXT
);
```

**Replay cron (every 60s, local scheduled trigger):**
1. `SELECT` pending rows `ORDER BY created_at ASC`
2. POST to `https://api.rmpgutah.us` + path with stored body; re-sign JWT using local `JWT_SECRET`
3. `2xx` → mark `delivered`, run conflict check (Section 5)
4. `4xx` → mark `failed`, no retry (payload issue, not connectivity)
5. `5xx` / timeout → increment `attempts`; retry up to 10×, then mark `failed` + admin alert
6. Rows `pending` older than 7 days → escalate to `failed` + page admin

**Invariants:**
- `sync_queue` lives in local SQLite only — never synced to Cloudflare D1 (would create a loop)
- Headers stored per-row so replay is fully authenticated without client involvement

---

## Section 5 — Conflict Resolution & Audit

**Utility:** `src/utils/syncConflict.ts`  
**Migration:** `0250_sync_conflicts.sql`

```sql
CREATE TABLE IF NOT EXISTS sync_conflicts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name       TEXT NOT NULL,
  record_id        INTEGER NOT NULL,
  fz55_value       TEXT NOT NULL,       -- JSON snapshot
  cloud_value      TEXT NOT NULL,       -- JSON snapshot
  fz55_updated_at  TEXT NOT NULL,
  cloud_updated_at TEXT NOT NULL,
  winning_source   TEXT NOT NULL,       -- 'fz55' | 'cloudflare'
  resolved_at      TEXT NOT NULL DEFAULT (datetime('now')),
  sync_queue_id    INTEGER REFERENCES sync_queue(id)
);
```

**Resolution flow (runs on every replay attempt):**
1. GET current Cloudflare version of the record
2. Compare `updated_at` timestamps — most recent wins
3. FZ-55 newer → proceed with replay write; `winning_source = 'fz55'`
4. CF newer → skip write; `winning_source = 'cloudflare'`
5. Equal → skip write (already in sync)
6. Insert `sync_conflicts` row in all cases (complete audit trail)

**Admin visibility:**
- `GET /api/sync/conflicts` — paginated, filterable by `table_name` / date range
- `GET /api/sync/queue` — pending/failed queue status + counts
- New **"Sync Status"** tab in `AdminPage.tsx` surfaces both endpoints

Both JSON snapshots (`fz55_value` + `cloud_value`) are stored permanently so chain-of-custody audits can reconstruct exactly what each system held at resolution time.

---

## New Files

| File | Purpose |
|------|---------|
| `client/src/hooks/useApiBase.ts` | LAN probe, `ApiBaseContext`, re-probe logic |
| `client/src/hooks/useApi.ts` | Extended with `apiMutate` dual-write |
| `src/routes/sync.ts` | Queue replay cron + admin endpoints |
| `src/utils/syncConflict.ts` | Conflict fetch, compare, insert audit row |
| `migrations/0249_sync_queue.sql` | `sync_queue` table |
| `migrations/0250_sync_conflicts.sql` | `sync_conflicts` table |
| `client/src/components/SyncStatusChip.tsx` | Nav bar LOCAL/CLOUD indicator |
| `client/src/pages/admin/SyncStatusTab.tsx` | Admin panel for queue + conflicts |
| `docs/fz55-server-setup.md` | Operator setup guide (NSSM steps, firewall) |

---

## Migration Notes

- Next free prefix is `0249` (current high-water `0248_stack_group_id.sql`)
- Both migrations are idempotent (`CREATE TABLE IF NOT EXISTS`)
- `sync_queue` and `sync_conflicts` are **local-SQLite-only** — run only on the FZ-55:
  ```bash
  npm run migrate:local   # on the FZ-55
  ```
- **Do NOT** run these via `scripts/apply-migration.sh` (that targets live Cloudflare D1).
  These tables have no meaning on D1 and would clutter the remote schema.
- Add both filenames to a `.d1-exclude` comment block in `migrations/README.md` so future
  operators know not to apply them remotely.

---

## Deployment Checklist

- [ ] `VITE_LOCAL_SERVER_URL` set in `client/.env` on every dispatch workstation
- [ ] `JWT_SECRET` set on FZ-55 via `npx wrangler secret put JWT_SECRET` (matches Cloudflare)
- [ ] `npm run migrate:local` run on FZ-55 after every schema-changing PR merges to main
- [ ] NSSM service verified running after each FZ-55 reboot
- [ ] Windows Firewall rule confirmed Private-only (not Domain/Public)
- [ ] `curl http://fz55:8787/api/health` passes from at least one dispatch workstation
- [ ] Admin `Sync Status` tab shows 0 pending, 0 failed after initial setup
