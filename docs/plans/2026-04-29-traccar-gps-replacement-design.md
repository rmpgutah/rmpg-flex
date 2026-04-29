# Traccar GPS Integration — Replacing OwnTracks (Design)

**Date:** 2026-04-29
**Status:** Approved, executing
**Scope:** Replace OwnTracks as the primary GPS ping system with Traccar. Remove every OwnTracks reference from code, schema, config, UI, and docs. Make Traccar the dominant priority source.

## Why

OwnTracks has shown serious failure in production for the dispatcher's
fleet — missed pings, silent device drops, opaque diagnostics. Traccar is
the operator's standard alternative:

- **200+ device protocols** vs OwnTracks' 1
- **Free Traccar Client apps** for iOS/Android (and compatible third-party
  GPS hardware speak Traccar's OsmAnd HTTP protocol natively)
- **Open REST API** at https://www.traccar.org/api-reference/ — we can pull
  positions from a self-hosted Traccar Server in addition to receiving
  direct webhooks
- **Active community + commercial support**

## Current state (what we're replacing)

The current GPS ingest path:

```
iPhone OwnTracks app  ─┐
                       ├──► POST /owntracks (Bearer token) ──► gps_breadcrumbs + units
Traccar Client app   ──┘                                       (gps_source = 'owntracks' or 'traccar')
```

- Single endpoint at `/owntracks` accepts both formats via auto-detection
- DB table `owntracks_device_map` maps tracker ID → unit ID
- Config `owntracks_webhook_token` is the shared bearer
- GPS source priority: `owntracks` and `traccar` are both 4 (tied)
- Admin Integrations tab shows OwnTracks-named entry as the canonical key

## After (target state)

```
Traccar Client app    ─┐
                       │
Traccar Server* ──────►├──► POST /api/traccar (Bearer token) ──► gps_breadcrumbs + units
                       │                                          (gps_source = 'traccar')
Third-party trackers  ─┘
                       
* Optional: RMPG Flex can also PULL positions from a self-hosted
  Traccar Server's /api/positions REST API on a 15-second interval.
```

- **Single endpoint** `POST /api/traccar` (canonical) plus `/traccar`,
  `/traccar/:user`, `/traccar/:user/:device` aliases for OsmAnd-style
  device clients
- DB table renamed: `owntracks_device_map` → `traccar_device_map`
  (in-place SQLite RENAME, FK + index migrate)
- Config key renamed: `owntracks_webhook_token` → `traccar_webhook_token`
  (in-place UPDATE in `system_config`)
- New optional config keys for Traccar Server pull mode:
  - `traccar_server_url` (e.g. `https://traccar.example.com`)
  - `traccar_server_email`
  - `traccar_server_password`
- GPS source priority: `traccar` becomes **5** (top, dominant). Legacy
  `clearpathgps` stays at 3 (vehicle hardware), `browser_mobile` at 2,
  `browser_desktop` at 1. The `owntracks` entry is removed entirely.
- Old `/owntracks` paths return **HTTP 410 Gone** with a JSON body
  pointing the device to `/api/traccar`. No silent forwarding — operators
  must migrate their device URLs.

## Phase A: webhook + admin (this slice, mandatory)

**Server changes**

- `server/src/routes/dispatch/gps.ts`:
  - `owntracksWebhookRouter` → `traccarWebhookRouter`
  - `owntracksHandler` → `traccarHandler`
  - Drop the OwnTracks `_type:'location'` parsing branch; accept Traccar
    OsmAnd HTTP query-string format AND Traccar Server forward-webhook
    JSON format. Specifically:
    - **OsmAnd HTTP** (Traccar Client default): query params `?id=<deviceId>&lat=<>&lon=<>&speed=<knots>&bearing=<>&altitude=<>&accuracy=<>&timestamp=<unix>`. Body may be empty.
    - **Traccar Server JSON forwarder**: `{ device:{id,uniqueId,name}, position:{latitude, longitude, speed, course, fixTime, accuracy, attributes:{batteryLevel}} }`
    - **Generic JSON**: `{ latitude, longitude, deviceId, speed, course, fixTime }` (Traccar's flat REST shape)
  - Speed: Traccar reports knots in OsmAnd, m/s in JSON forwarder. Normalize
    to m/s server-side; the broadcast layer converts to mph.
  - All log lines, error messages, hint strings rewritten to mention
    Traccar only.
  - GPS_SOURCE_PRIORITY: `traccar: 5`, no `owntracks` key.
- `server/src/index.ts`:
  - `app.use('/owntracks', ...)` → `app.use('/traccar', traccarWebhookRouter)`
  - Plus a new `app.use('/owntracks', goneRouter)` that returns 410 with
    JSON body `{ error: 'OwnTracks deprecated', migrateTo: '/api/traccar' }`.
- `server/src/models/database.ts`:
  - Add a one-time migration block:
    ```sql
    -- Migrate device map
    CREATE TABLE IF NOT EXISTS traccar_device_map (... same shape ...);
    INSERT OR IGNORE INTO traccar_device_map SELECT * FROM owntracks_device_map;
    DROP TABLE owntracks_device_map;
    -- Migrate config key
    UPDATE system_config SET config_key = 'traccar_webhook_token'
     WHERE config_key = 'owntracks_webhook_token';
    -- Migrate live unit GPS source
    UPDATE units SET gps_source = 'traccar' WHERE gps_source = 'owntracks';
    ```
  - **Historical `gps_breadcrumbs.gps_source = 'owntracks'` rows are
    LEFT AS-IS** — that's an audit/history table and rewriting historical
    facts is wrong even when the upstream system changes.

**Client changes**

- `client/src/pages/admin/AdminIntegrationsTab.tsx`:
  - `GPS_WEBHOOK_KEYS` collapses to ONE entry: `traccar_webhook_token`,
    description rewritten to "Bearer token for Traccar Client + Traccar
    Server webhook → POST /api/traccar".
  - Add three new keys: `traccar_server_url`, `traccar_server_email`,
    `traccar_server_password` for Phase B pull mode.
  - The existing UI strings ("OwnTracks / Traccar" panel title) → "Traccar GPS".

**Tests**

- New `server/src/routes/__tests__/dispatch.gps.traccar.test.ts`:
  - OsmAnd query-string format → breadcrumb + unit position update
  - Traccar Server forwarder JSON → breadcrumb + unit position update
  - Generic JSON flat shape → breadcrumb + unit position update
  - Missing token → 403
  - Wrong token → 403
  - Unknown deviceId / no unit map → 404
- The existing OwnTracks-named webhook tests retire; replace.

**Deploy gate** — server tsc + vitest must stay green.

## Phase B: Traccar Server REST API pull (this slice, conditional)

**Optional pull mode** triggered when admin sets all three of
`traccar_server_url`, `traccar_server_email`, `traccar_server_password`.

- `server/src/utils/traccarServerPoller.ts` (new): polling worker
  - On boot if config present, login via `POST <url>/api/session` with
    `email=&password=` (form-encoded). Capture `JSESSIONID` cookie.
  - Every 15 s: `GET <url>/api/positions?from=<lastSeen>&to=<now>` with
    cookie. For each position, look up device by `deviceId` in
    `traccar_device_map` and ingest via the same internal helper that
    the webhook uses (extracted as `ingestTraccarPosition()`).
  - On any 401, re-login; on persistent failure, set a `traccar_pull_status`
    config key to "error: ..." for the admin tab to surface.
- Admin tab: shows current pull status + last-seen timestamp.
- Disabled by default — direct webhook remains the primary path.

## Migration / data preservation

| Artifact | Action |
|---|---|
| `owntracks_device_map` table rows | Copied into `traccar_device_map` then table dropped |
| `system_config.owntracks_webhook_token` | Renamed in place |
| `units.gps_source = 'owntracks'` | Updated to `'traccar'` |
| `gps_breadcrumbs.gps_source = 'owntracks'` | **Left as-is** (history) |
| `/owntracks` endpoint | Returns 410 Gone with migration JSON |
| Historical plan docs `docs/plans/2026-04-20-always-on-officer-tracking*.md` | Annotated with a note pointing at this slice's design |

## Tests

Listed under Phase A. Coverage targets: webhook handler is the ingest
contract; new test file is canonical.

## Risks

- **Active OwnTracks users get 410.** Operators with phones still pointed
  at `/owntracks` will stop reporting until they re-config to `/api/traccar`.
  This is the *intended* migration pressure. CLAUDE.md and
  the admin UI both surface the new endpoint.
- **Traccar Server REST cookie auth is stateful.** A redeploy / restart
  drops the in-memory cookie. The poller re-logs in on its first 401, so
  the worst case is ~15 s of missed pulls per server restart.
- **GPS source priority bump (4 → 5) for `traccar`.** Stale rows in
  `units.gps_source` legacy values (`device`, `manual`, `dispatch`,
  `mdtWebSocket`) are not in the priority table at all — they fall to 0
  and are immediately overridden by any incoming Traccar ping. Acceptable.
