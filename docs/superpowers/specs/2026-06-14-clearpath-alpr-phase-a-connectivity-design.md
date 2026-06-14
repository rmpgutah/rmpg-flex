# ClearPath → ALPR pipeline — Phase A: connectivity & configuration

- **Date:** 2026-06-14
- **Status:** Draft (awaiting user review)
- **Author:** Claude (brainstormed with Christopher Zamora)
- **Branch:** `claude/exciting-elion-a4c43a`

---

## Program context (why this is phased)

The end goal is a **passive ALPR pipeline fed by the agency's ClearPath/SmartWitness
dashcams**: a cron job pulls new dashcam captures from the ClearPath v2.0 Media API,
archives the outside-camera clips, runs the outside-camera frame through a Roboflow
workflow, and writes plate + vehicle reads (GPS-tagged, stolen/watchlist-screened)
into the existing intel plate log.

Decisions already made during brainstorming:

| Decision | Choice |
|----------|--------|
| Ingestion trigger | **Cron poll** the ClearPath v2.0 Media API (not vendor webhooks) |
| Scope | **ALPR + full media-sync** (archive clips to R2 *and* ALPR the frames) |
| Sequencing | **Phase A → B → C**, each its own spec → plan → PR |
| Credential storage | **Encrypted at rest** in `system_config` (AES-GCM + `CPG_ENC_KEY`) |

Because the work spans three distinct subsystems, it is decomposed:

- **Phase A (this doc) — Connectivity & configuration.** Make `/api/clearpathgps`
  real for the *config* surface so the existing admin tab works: store credentials,
  test the connection live, enable/disable, list discoverable cameras, and map
  cameras ↔ dispatch units. **No media download, no ALPR yet.**
- **Phase B — Media-sync.** Cron poller (throttled on the per-minute cron) that
  streams outside-camera MP4s to R2 and populates `dashcam_videos` / `dashcam_events`.
- **Phase C — ALPR on frames.** New Roboflow workflow client + per-event
  outside-JPEG → plate/vehicle → `vehicles_records` / `vehicle_sightings` /
  `alpr_captures` with screening, reusing Phase B's per-event loop.

Phases B and C both depend on Phase A (auth, client, device mappings).

---

## Phase A goal

After Phase A ships, an admin can open the **Admin → ClearPath GPS** tab and:

1. Enter ClearPath account / user / password → saved (password encrypted at rest).
2. Click **Test connection** → the Worker authenticates against ClearPath and
   reports how many cameras the account can see.
3. Enable the integration.
4. See the list of discoverable cameras (devices) and **map each camera to a
   dispatch unit** (so later phases know "this camera lives in Unit 12's vehicle").
5. Set the poll interval.

Nothing polls or downloads yet — Phase A is the configurable, verifiable foundation.

### Non-goals (explicitly deferred)

- Downloading any media (clips, thumbnails, frames) — **Phase B**.
- Any Roboflow / ALPR / plate-log writes — **Phase C**.
- Live GPS vehicle tracking / trips / alerts (`/vehicles`, `/vehicles/:id/trips`,
  `…/locations`, `…/alerts` from the legacy route) — out of scope for the whole
  program unless requested separately.
- `dashcam_events` table + `dashcam_videos` `cpg_*` columns — created in **Phase B**.

---

## Architecture

```
client/src/pages/admin/AdminClearPathGpsTab.tsx   (already built — unchanged)
        │  apiFetch('/clearpathgps/...')
        ▼
src/routesConfig.ts          /api/clearpathgps  →  NEW router (was: stubs)
        ▼
src/routes/clearpathgps.ts   (NEW)  ── ensureSchema() at boot (self-heal)
        │
        ├── src/utils/clearpathGps.ts  (NEW, Worker-safe client)
        │       getCredentials(db) / saveCredentials() / authHeader() /
        │       cpgFetch() / listCameras()
        │
        ├── src/utils/cpgCrypto.ts     (NEW, AES-GCM via Web Crypto)
        │       encryptSecret() / decryptSecret()  using env.CPG_ENC_KEY
        │
        └── D1: system_config (config), cpg_device_mappings (NEW table), units
```

### Component 1 — `src/utils/cpgCrypto.ts` (credential encryption)

Worker-native AES-GCM-256 using Web Crypto (`crypto.subtle`); no `node:*`.

- **Key:** `env.CPG_ENC_KEY` — a base64-encoded 32-byte key set via
  `wrangler secret put CPG_ENC_KEY`. Imported once per request via
  `crypto.subtle.importKey('raw', …, 'AES-GCM', false, ['encrypt','decrypt'])`.
- **`encryptSecret(plaintext, key): Promise<string>`** → returns
  `v1:<base64(iv)>:<base64(ciphertext+tag)>` (12-byte random IV from
  `crypto.getRandomValues`).
- **`decryptSecret(stored, key): Promise<string>`** → reverses it; throws on a
  bad/garbled value.
- If `CPG_ENC_KEY` is unset, credential save/use fails with a clear, typed error
  and `/status` reports `configured: false` with a hint to set the secret. Only the
  **password** is encrypted; account and user are low-sensitivity and stored plain.

### Component 2 — `src/utils/clearpathGps.ts` (Worker-safe client)

Ported from `legacy/server-vps/src/utils/clearPathGpsClient.ts` +
`clearPathGpsMediaClient.ts`, reduced to what connectivity needs and made
Worker-native (no `Buffer`, no `node:stream`).

- **`getCredentials(db, env)`** — reads `clearpathgps_account` / `_user` /
  `_password` / `_base_url` from `system_config` (category `integrations`);
  decrypts the password via `cpgCrypto`. Returns `null` if incomplete.
- **`authHeader(creds)`** — ClearPath's media API uses HTTP-Basic-in-Bearer:
  `Authorization: Bearer ` + `btoa('{account}/{user}:{password}')`
  (legacy used `Buffer.from(...).toString('base64')`; `btoa` is the Worker
  equivalent — inputs are ASCII so no UTF-8 edge case).
- **`cpgFetch(creds, endpoint, opts?)`** — `fetch` against
  `https://api.clearpathgps.com{endpoint}` with the auth header,
  `signal: AbortSignal.timeout(30_000)`, and typed errors:
  - `401` → `CpgAuthError` (bad creds).
  - `429` → `CpgRateLimitError` (carries `retryAfterSeconds`).
  - other non-2xx → `CpgHttpError` (carries status).
- **`listCameras(creds)`** — `GET /v2.0/media/cameras` → `CpgCamera[]`
  (`{ id, provider, name, providerId, notes, lastCommunication }`).

> Worker statelessness note: the legacy module-global `cachedAuthToken` is dropped
> — the "token" is a deterministic base64 of the credentials, so recomputing per
> request is free and avoids cross-invocation cache bugs. Rate-limit cooldown state
> is **not** needed in Phase A (no polling yet); it moves to KV in Phase B.

### Component 3 — `src/routes/clearpathgps.ts` (the un-stubbed route)

A Hono router replacing the `stubs` mapping. `ensureCpgSchema(db)` runs at the top of
each handler (cheap `CREATE TABLE IF NOT EXISTS` + `columnExists` reconcile, mirroring
`ensureAlprSchema` in `src/routes/alpr.ts`) so a silently-failed migration apply
can't 500 the tab. Reads are open to operational roles; **writes are
`requireRole('admin')`** (matching the legacy route).

Endpoint contract (the connectivity subset of what `AdminClearPathGpsTab.tsx` calls;
response shapes must satisfy the tab's TS interfaces `CpgStatus`, `CpgDevice`,
`CpgMapping`, `MediaSyncStatus`):

| Method | Path | Role | Behaviour |
|--------|------|------|-----------|
| GET | `/status` | any | `{ configured, enabled, account, poll_interval_seconds, active_mappings, last_sync, media_sync_enabled:false, … }` |
| GET | `/credentials` | any | `{ configured, account, user, base_url }` — **password never returned** |
| POST/PUT | `/credentials` | admin | Save account/user/password(+base_url); encrypt password; upsert into `system_config` |
| DELETE | `/credentials` | admin | Remove cred keys + disable |
| POST | `/test-connection` | admin | Load creds → `listCameras()` → `{ success, deviceCount }` or `{ success:false, error }` |
| POST | `/discover-accounts` | admin | Best-effort: validate creds and echo the configured account; `[]` if it can't enumerate (the tab uses this to help fill the account field) |
| POST/PUT | `/enable` | admin | Set `clearpathgps_enabled` = `true|false` |
| GET | `/devices` | any | `listCameras()` shaped to `CpgDevice` (`deviceId`=`providerId`/`id`, `displayName`=`name`, `serialNumber`, …) |
| GET | `/mappings` | any | `cpg_device_mappings` ⨝ `units` → `CpgMapping[]` |
| POST | `/mappings` | admin | Create/upsert a mapping (`cpg_device_id`, `cpg_display_name`, `cpg_serial_number`, `unit_id`) |
| DELETE | `/mappings/:id` | admin | Remove a mapping |
| GET | `/settings` | any | `{ poll_interval_seconds, … }` from `system_config` |
| POST | `/settings` | admin | Persist settings (poll interval, etc.) |

**Phase-B placeholders (kept benign so the tab never breaks, replaced in B):**
`GET /media-status` → `{ media_sync_enabled:false, … }`;
`POST /media-settings` → `{ success:true }` (persists the two media keys but nothing polls);
`POST /media-sync-now` → `{ success:false, error:'Media sync arrives in Phase B' }`;
`GET /dashcam-events` (+ `/by-officer/:id`, `/export`) → `[]`.

### Component 4 — Migration `0113_clearpathgps_device_mappings.sql`

`cpg_device_mappings` does **not** exist on live D1 (verified 2026-06-14 against
`rmpg-flex` `785de7ae-…`). Create it, idempotently:

```sql
CREATE TABLE IF NOT EXISTS cpg_device_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cpg_device_id TEXT NOT NULL,
  cpg_display_name TEXT,
  cpg_serial_number TEXT,
  cpg_camera_id INTEGER,            -- numeric v2.0 media camera id (resolved/cached in Phase B)
  unit_id INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_synced_at TEXT,
  last_media_synced_at TEXT,        -- used by Phase B
  media_sync_errors INTEGER DEFAULT 0,
  vehicle_make TEXT, vehicle_model TEXT, vehicle_vin TEXT,
  license_plate TEXT, ignition_state TEXT, driver_name TEXT,
  last_odometer REAL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cpg_map_device ON cpg_device_mappings(cpg_device_id);
CREATE INDEX IF NOT EXISTS idx_cpg_map_unit ON cpg_device_mappings(unit_id);
```

Per the repo's standing rule, **also apply this DDL directly to live `785de7ae` after
merge** (deploy migration step is `continue-on-error`), and the route reconciles it at
boot as a backstop.

### Component 5 — `system_config` keys (category `integrations`)

`clearpathgps_account`, `clearpathgps_user`, `clearpathgps_password` (encrypted),
`clearpathgps_base_url` (default `https://api.clearpathgps.com`),
`clearpathgps_enabled`, `clearpathgps_poll_interval`,
`clearpathgps_media_sync_enabled`, `clearpathgps_media_poll_interval`.

> **Trap (from prior incidents):** `system_config`'s UNIQUE constraint is the
> composite `(config_key, config_value)`, **not** `config_key` — so
> `INSERT … ON CONFLICT(config_key)` throws. Use **DELETE-then-INSERT** per key
> (the established safe-upsert in this codebase).

### Component 6 — Registration

In `src/routesConfig.ts`, replace
`{ prefix: '/api/clearpathgps', router: stubs, auth: 'required' }`
with the new `clearpathgps` router (still `auth: 'required'`; per-write `requireRole`
inside). Remove the now-dead `/api/clearpathgps` stub handlers from `src/routes/stubs.ts`.

---

## ClearPath v2.0 Media API reference (grounded from legacy)

- Base: `https://api.clearpathgps.com`
- Auth: `Authorization: Bearer ` + `base64('{account}/{user}:{password}')`
- `GET /v2.0/media/cameras` → `{ items: CpgCamera[] }`,
  `CpgCamera = { id:number, provider:"smartwitness", name:string, providerId:string, notes:string, lastCommunication:number }`
- (Phase B will additionally use
  `GET /v2.0/media/legacy/cameras/{cameraId}/data?from&to&page&pageSize` and the
  pre-signed S3 `accessUrl`/`thumbnailUrl` on each `mediaObject`.)

---

## Error handling

- Missing creds → `/status` `configured:false`; mutating endpoints 400 with a hint.
- `CPG_ENC_KEY` unset → save/test return a clear 503-style error
  (`"Set CPG_ENC_KEY (wrangler secret put CPG_ENC_KEY)"`); `/status` `configured:false`.
- `CpgAuthError` (401) → `test-connection` returns `{ success:false, error:'Invalid ClearPath credentials' }`.
- `CpgRateLimitError` (429) → surfaced to the admin with the retry-after hint.
- `CpgHttpError` / network / timeout → `{ success:false, error }`, never a 500.

## Testing

Unit-test the pure/near-pure helpers with vitest (the repo has no Worker route
harness yet — tracked tech debt):

- `cpgCrypto`: `encryptSecret`→`decryptSecret` round-trips; tampered ciphertext
  throws; output format is `v1:iv:ct`.
- `authHeader`: exact base64 for known creds.
- camera → `CpgDevice` shaping.
- credential **masking** (response never contains the password).
- `system_config` safe-upsert builder (emits DELETE+INSERT, not ON CONFLICT).

CI gates already enforce worker typecheck, client typecheck, client tests, client build.

## Security

- Password encrypted at rest (AES-GCM-256, `CPG_ENC_KEY`).
- Credentials never returned by any GET; logs never include the password or auth header.
- All writes `requireRole('admin')`; the whole prefix is JWT-gated.

## Rollout & verification

1. `wrangler secret put CPG_ENC_KEY` (32 random bytes, base64) before deploy.
2. Merge → deploy. **Apply `0113` directly to live `785de7ae`** and confirm with
   `pragma_table_info('cpg_device_mappings')`.
3. Verify in a real browser (WAF blocks plain `curl` on everything but `/api/health`):
   open Admin → ClearPath GPS, save creds, **Test connection** → expect a camera
   count, then create a camera→unit mapping and reload.
4. Phase A is **server-only** (changes are confined to `src/` + `migrations/`; no
   `client/` files), so **no `client/public/sw.js` `CACHE_NAME` bump is required**.

## Open items / dependencies

- **Phase C** needs the **deployed serverless ID + workspace** of the new
  "RMPG Flex vehicle capture" workflow (the pasted JSON is a spec). Confirm via the
  Roboflow MCP (`workflows_list`) whether it's published or needs publishing — does
  **not** block Phase A.
- **Phase B** needs `dashcam_events` (new table) and `cpg_*` columns on
  `dashcam_videos` (live table currently lacks them).
- Confirm whether `/discover-accounts` can truly enumerate accounts via the v2.0 API,
  or should just validate-and-echo the configured account (acceptable for the tab).

---

## Added requirement (2026-06-14) — camera recording profile

Christopher requested control over the dashcam **recording behavior**:

- **Continuous, full-rate recording while the ignition is on** (don't drop to the
  low-FPS parking rate while driving).
- **Keep normal parking mode when the engine is off** — i.e., motion/impact-triggered
  recording when parked. *(He initially asked to disable motion-wake-when-off; after the
  evidentiary tradeoff was flagged — that would mean no footage of a parked vehicle being
  broken into, vandalized, or hit — he chose to KEEP parking mode for evidence coverage.)*

**Reality / scope for Phase A:**
- These are **SmartWitness device recording-profile settings**, not Worker code. ClearPath
  runs SmartWitness cameras (e.g. CP2-NA-LTE); the known ClearPath/SmartWitness REST API is
  for **media/data retrieval** (the Media API), so device-config-via-API is **unverified**.
- **First Phase-A task for this:** with the user's ClearPath credentials, inspect the
  portal's own config calls (same approach that surfaced the Media API) to determine whether
  recording-mode config is API-pushable.
  - If **yes** → add a **recording-profile control** to the Admin → ClearPath GPS tab
    (set continuous-on-ignition + parking-mode-on; push to mapped devices).
  - If **no** → document the exact ClearPath portal / SmartWitness settings to change (and
    what to request from ClearPath support); the tab surfaces the intended profile read-only.
- We do **not** reflash firmware or push a fleet-wide recording change blind; the change is
  confirmed + reversible.
- Note: continuous full-rate recording raises cellular/storage usage + cost; the ALPR
  pipeline (Phase C) **samples frames**, it does not ingest every second of video.
