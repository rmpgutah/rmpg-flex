# Kiosk Linux Sub-Project 4: Device Registry — Design

## Status

Approved 2026-07-23. Scopes the first slice of Kiosk Linux sub-project 4
(previously listed as "no update/provisioning mechanism" in
`kiosk-linux/README.md`'s non-goals). This slice is **registration and fleet
tracking only** — no OTA image delivery. OTA update delivery, if wanted later,
is a separate future design built on top of this registry.

## Problem

Kiosk Linux (sub-projects 1–3: base image, DRM/KMS graphics, networking +
browser) currently exists only as a manually-built, manually-flashed QEMU
image. There is no way to know which physical/virtual devices exist, what OS
version each is running, or whether a device is still checking in. This
sub-project adds that visibility, ahead of any real hardware being deployed.

## Non-goals

- No OTA image delivery — a device does not download or apply a new
  `kiosk-linux-os-*.tar.gz` through this system. That remains the existing
  manual `RELEASE.md` process.
- No fix for the sub-project 3 blank-render WebKit limitation — unrelated.
- No real hardware — this registry is built now so it's ready the moment real
  hardware exists, but zero real devices exist as of this design. It will sit
  mostly unused until then; that's an accepted, explicit trade-off (the user's
  own choice, made when scoping this design).
- No per-device remote config push (device → server is one-way check-in +
  upload; server → device push is out of scope).

## Architecture

Everything is added to the **existing** `rmpg-flex-api` Worker
(`src/index.ts`) as new routes and new bindings — not a new Worker. A Worker
can hold multiple D1/R2 bindings simultaneously; this follows the same
pattern already used for `DB`/`MAP_DATA`/`KV`.

### New Cloudflare resources

- **D1 database**: `kiosk-linux-fleet` (new, dedicated — deliberately
  separate from the main `rmpg-flex` D1 database, per explicit choice during
  design, to keep this experimental/low-traffic subsystem isolated from the
  live CAD/RMS schema). Bound as `KIOSK_DB`.
- **R2 bucket**: `kiosk-linux-devices` (new, dedicated — separate from
  `rmpg-flex-downloads`, which continues to hold OS release artifacts only).
  Bound as `KIOSK_DEVICES`.

Both bindings are added to `wrangler.toml` alongside the existing bindings.

### Data model (`kiosk-linux-fleet` D1, its own migration numbering starting
at `0001` — this is a separate database from `rmpg-flex`, so it does **not**
share that database's `migrations/` sequence or high-water mark)

```sql
CREATE TABLE IF NOT EXISTS kiosk_devices (
  id            TEXT PRIMARY KEY,        -- uuid, generated at registration
  label         TEXT NOT NULL,           -- human name, e.g. "Lobby kiosk 1"
  token_hash    TEXT NOT NULL,           -- bcrypt hash of the device's bearer token
  os_version    TEXT,                    -- last-reported OS image version string
  status        TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'revoked'
  registered_at TEXT NOT NULL,           -- ISO8601 UTC
  last_seen_at  TEXT,                    -- ISO8601 UTC, null until first check-in
  last_ip       TEXT
);

CREATE TABLE IF NOT EXISTS kiosk_device_uploads (
  id          TEXT PRIMARY KEY,          -- uuid
  device_id   TEXT NOT NULL REFERENCES kiosk_devices(id),
  kind        TEXT NOT NULL,             -- 'config' | 'log'
  r2_key      TEXT NOT NULL,             -- object key in kiosk-linux-devices bucket
  size_bytes  INTEGER NOT NULL,
  uploaded_at TEXT NOT NULL              -- ISO8601 UTC
);

CREATE INDEX IF NOT EXISTS idx_kiosk_device_uploads_device
  ON kiosk_device_uploads(device_id);
```

The device's bearer token itself is generated at registration, shown to the
admin **once** in the API response, and never stored in plaintext — only its
bcrypt hash (`bcryptjs`, already a project dependency) is persisted, matching
the existing password-hash convention in this codebase.

### API — `src/routes/kioskLinux.ts`, mounted at `/api/kiosk-linux`

**Admin-authenticated** (existing JWT `authMiddleware`, restricted to
`admin`/`manager` roles — mounted the same way `/api/dispatch` restricts by
prefix in `src/index.ts`):

- `POST /devices` — body `{ label }`. Generates a uuid `id` and a random
  bearer token, bcrypt-hashes the token, inserts the row, returns
  `{ id, label, token }` — the **only** time the plaintext token is ever
  returned.
- `GET /devices` — list all devices with `id`, `label`, `os_version`,
  `status`, `last_seen_at`.
- `DELETE /devices/:id` — sets `status = 'revoked'`. A revoked device's token
  no longer authenticates (checked at request time, not just cosmetic).

**Device-authenticated** (new lightweight middleware — reads
`Authorization: Bearer <token>`, looks up the device by `id` in the URL path,
`bcrypt.compare`s the token against `token_hash`, rejects if `status !=
'active'`; distinct from the JWT `authMiddleware`, since devices are not
users and have no JWT):

- `POST /devices/:id/checkin` — body `{ os_version }`. Updates
  `last_seen_at` (server-generated UTC timestamp), `os_version`, `last_ip`
  (from the request).
- `POST /devices/:id/upload` — multipart `file` + `kind` (`config`|`log`).
  Writes the object to `KIOSK_DEVICES` under a key namespaced by device id
  and timestamp (e.g. `<device_id>/<kind>/<uploaded_at>-<filename>`), inserts
  a `kiosk_device_uploads` row.

Unset bindings (if `KIOSK_DB`/`KIOSK_DEVICES` are ever missing in a given
environment) return `200 { ok: false, code: 'not_configured' }` on every route
in this file, per this codebase's established pattern for optional
integrations (see Fleet.io/Roboflow/Legal Data Hunter in `CLAUDE.md`) —
**not** a 503, and not a crash.

### Admin UI

New "Kiosk Devices" tab in `client/src/pages/AdminPage.tsx`. Per the
documented four-edit-site tab-wiring gotcha in `CLAUDE.md`, adding it requires
touching: the `VALID_TABS` array, the `TabId` type union, the
`{id,label,icon}` config array, and the `{activeTab === '...' && <Tab/>}`
render block.

The tab itself (a new component, e.g. `KioskDevicesTab.tsx`):
- Table of devices: label, status, OS version, last-seen (relative time).
- "Register device" button → calls `POST /devices`, then shows the returned
  plaintext token in a one-time modal/toast with a copy button and an
  explicit "this will not be shown again" warning.
- Revoke action per row → calls `DELETE /devices/:id`, confirms first (a
  revoke is a real, if reversible-by-re-registering, action).

## Error handling

- Device check-in/upload with an invalid or revoked token → `401`, generic
  message (no distinction between "wrong token" and "revoked", to avoid
  leaking device existence).
- Admin registering a device with a duplicate label is allowed (labels are
  not unique — multiple kiosks could share a physical location name); `id` is
  the real identity.
- Upload with no matching device id → `404`.

## Testing

No Worker test suite exists yet for this repo beyond typecheck (per
`CLAUDE.md`'s Testing & CI section) — this sub-project follows the same
convention as other new routes: a smoke test added in the same PR is
preferred but not blocking. Given the device-auth middleware is new logic
(not just a copy of the existing JWT middleware), a small Miniflare test
(`test-workers/`) covering token-hash accept/reject/revoked is worth adding.

## Deployment

- Create the D1 database and R2 bucket as real Cloudflare resources (via
  `wrangler d1 create kiosk-linux-fleet` / `wrangler r2 bucket create
  kiosk-linux-devices`) — done once, by hand, same as any other resource
  creation in this project.
- Add both bindings to `wrangler.toml`.
- Migration for `kiosk-linux-fleet` applies via the same
  `wrangler d1 migrations apply` mechanism, but pointed at the new database
  name — this is a **separate migration history** from the main
  `rmpg-flex` database's `migrations/` directory. A new directory
  (e.g. `kiosk-linux/migrations/`) holds this database's own migrations,
  starting at `0001`.
- No changes needed to `.github/workflows/deploy.yml`'s existing steps
  beyond adding the new migration-apply command, since it's the same Worker.
