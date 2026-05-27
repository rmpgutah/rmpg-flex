# Production Error Triage — 2026-05-27

Snapshot of the errors in your browser console, root-caused against deployed Worker source + live D1 schema. Each row says what's broken, *why* (with the evidence), and the cheapest fix that actually works.

## Architecture refresher (verified against deployed state)

- `rmpgutah.us/api/*` is fronted by `proxy/` (Worker name `rmpg-api-proxy`).
- The proxy dispatches per-path between **`rmpg-flex`** (legacy, source not in this repo, recoverable via `workers_get_worker_code`) and **`rmpg-flex-api`** (the `/src/` rewrite).
- Live D1 is `785de7ae-3e7a-4e01-93bb-d24ddd813f6b` (`rmpg-flex` DB). The DB named `rmpg-flex-db` (`8893480a-…`) in `wrangler.toml` exists but is empty — touching it via `wrangler d1 migrations apply` is a no-op for live.

---

## Bucket A — Dispatch list 500s: D1 100-column cap (legacy Worker)

| Endpoint | Page | Evidence |
|---|---|---|
| `GET /api/dispatch/queue` | MapPage | Deployed source line 13334: `SELECT c.*, p.name, u.full_name, ROUND(...) age_minutes, c.priority_score, c.response_time_seconds FROM calls_for_service c ...`. `calls_for_service` is at **100 columns** (confirmed via `pragma_table_info`). `SELECT c.*` plus joined extras blows past the D1 result-set cap. Error envelope: `Queue query failed`. |
| `GET /api/dispatch/calls?limit=*` | MdtPage, DispatchPage | Same root cause — `api.get("/calls", ...)` at line 12871. Falls through to legacy (proxy only routes specific sub-paths to new Worker). |
| `GET /api/dispatch/calls?archived=true&limit=500` | DispatchPage (archive view) | Same. |

**Why the proxy doesn't already fix this:** `proxy/index.ts` routes `/api/dispatch/calls/:id` (single-row GET/PUT/DELETE) and `POST /api/dispatch/calls` (create) to the new Worker, but the bare list `GET /api/dispatch/calls` and `GET /api/dispatch/queue` still go to legacy.

**Fix options (in order of effort):**
1. **Port `GET /api/dispatch/calls` + `GET /api/dispatch/queue` to `/src/` and route via proxy.** The new Worker already uses `LIST_VIEW_COLUMNS` per `src/routes/dispatch/calls.ts` (per existing memory `feedback-d1-column-cap-for-lists`). Add a `/queue` handler that does the same projection + the in-memory overdue/priority enrichment. Add two more lines to `API_ROUTES`. This is the right long-term fix.
2. **Hot-patch the legacy Worker** by listing the columns explicitly instead of `c.*`. We don't have legacy source in this repo, but it's recoverable. Slower iteration than option 1.

Recommend option 1.

---

## Bucket B — Radio 500s: migration `0038_radio.sql` was never applied

The radio routes go to `env.API` (proxy rule `{ prefix: '/api/radio' }`), so the handler is `/src/routes/radio.ts`. That handler was written against `migrations/0038_radio.sql`, which defines:

```sql
radio_channels: id, name, description, frequency, talkgroup, color, is_default, sort_order, archived_at, created_at, created_by
radio_transmissions: id, channel_id, user_id, unit_label, transmitted_at, duration_seconds, transcript, audio_url, priority, tags, call_id
radio_recordings: (table)
```

But live D1 actually has:

```
radio_channels: id, label, freq, channel_type, sort_order, is_active, created_at
radio_transmissions: id, channel_id, unit_call_sign, user_id, message, duration_ms, started_at, ended_at, is_emergency, created_at
radio_transcripts: (exists, unused by /src/)
radio_recordings: (DOES NOT EXIST)
```

That's a complete divergence — not just a missing column. Errors map:

| Error | Cause |
|---|---|
| `no such column: c.name` (channels list, transmissions list) | Handler does `SELECT c.name AS channel_name`. Live column is `label`. |
| `no such column: transmitted_at` (transmissions, stats, channels last_tx_at) | Live column is `started_at`. |
| `no such table: radio_recordings` (recordings list) | Table never created. |

**Fix options:**
1. **Drop and recreate** the three radio tables on live D1 from `migrations/0038_radio.sql`. Risk: loses any existing rows. `radio_transmissions` on live looks like it has the WS-broadcast columns from a pre-`0038` design — check `SELECT COUNT(*)` before nuking.
2. **Apply additive ALTERs + new table** (ALTER TABLE radio_channels ADD COLUMN name, etc. + CREATE TABLE radio_recordings). Keeps existing data but creates "dead" columns alongside the live ones; handler still won't read them unless updated.
3. **Rewrite the handler to match the live schema** (`label` instead of `name`, `started_at` instead of `transmitted_at`, skip recordings entirely for now). Keeps data, but the schema you actually want is the migration's, not what's live — this path is technical debt.

Recommend option 1 *after* `SELECT COUNT(*) FROM radio_transmissions` to confirm it's safe (the live schema looks like an old stub that may never have collected real data).

---

## Bucket C — Other 500s: handlers query missing tables or schema drift

| Endpoint | Root cause | Live D1 has? |
|---|---|---|
| `GET /api/arrests/recent` (AdminPage) | Handler queries `FROM arrests` | **No `arrests` table on live D1.** Returns 500. |
| `GET /api/admin/clients/1/billing` (AdminPage) | Handler at line 16045 queries `clients`, then `incidents`, then `invoices`. | `clients` ✓, but need to verify `incidents` and `invoices` exist with the expected columns. Quick `pragma_table_info` confirms before fixing. |
| `GET /api/hr/benefits` (HrPage) | Handler at line 33724 queries `FROM hr_benefits b JOIN users u ON u.id = b.officer_id` | **No `hr_benefits` table on live D1.** Per memory `project-hr-tables-stub-created`, three HR tables were patched directly on live but `hr_benefits` was apparently not one of them. |
| `GET /api/howen/devices` (DashcamPage) | Handler at line 63073 does `SELECT hd.*, u.call_sign, u.status, u.officer_name, fv.license_plate FROM howen_devices hd LEFT JOIN units u … LEFT JOIN fleet_vehicles fv …` | `howen_devices` ✓ but need to verify `units` and `fleet_vehicles` exist. |
| `GET /api/howen/events` (DashcamPage) | Handler at line 63272 | `howen_events` ✓ but probably similar join-table issue. |

**Fix:** Per-endpoint — either create the missing table on live D1 (HR pattern from `project-hr-tables-stub-created`) or add a stub to `proxy/index.ts` (HR benefits is a good stub candidate since it's a noisy poller).

---

## Bucket D — 404s: routes not registered on the Worker that serves them

The proxy assumes the new Worker has these handlers, but it doesn't (yet):

| Endpoint | Routed to | Status in new Worker |
|---|---|---|
| `/api/fleet`, `/api/fleet?archived=false`, `/api/fleet?per_page=200`, `/api/fleet/analytics`, `/api/fleet/dashcam-videos` | `env.API` (rule `'/api/fleet'`) | **No `src/routes/fleet.ts`.** All 404. |
| `/api/personnel/body-cameras`, `/api/personnel/bodycam-videos`, `/api/personnel/bodycam-videos/reviews/pending`, `/api/personnel/bodycam-videos/redaction-requests`, `/api/personnel/bodycam-videos/retention/report` | `env.API` (rules at lines 197-198) | Not implemented. 404. |
| `/api/reports/crime-analysis` | `env.API` (line 232) | Not implemented. 404. |
| `/api/audit/logs`, `/api/audit/stats`, `/api/audit/compliance-report`, `/api/audit/index-stats` | No proxy rule → falls through to **legacy** | Legacy has `/audit/logs` (line 16641) but the other three appear missing → 404. |
| `POST /api/dispatch/units` (creating a unit from DispatchPage) | No proxy rule → legacy | Legacy only registers GET `/units`. POST falls off → 404. |
| `GET /api/records/vehicles/:id/history` | No proxy rule → legacy | Not implemented → 404. |
| `POST /api/howen/enable` (DashcamPage) | No proxy rule → legacy | Not implemented → 404. |

**Fix:** Either stub these in `proxy/index.ts` (cheapest, kills console noise) or port real handlers. Body-cameras and audit logs are the most user-visible.

---

## Bucket E — 503: `POST /api/pdf-tools/sign-payload`

Routed to `env.API` per proxy line 153. Comment on that line says: *"Both currently return 503 from the rewrite (configurable in a follow-up). Routing here so the client gets a structured 'not configured' instead of a 404 it logs as a bug."* Not a regression. Leave alone unless wiring up PDF signing is in scope.

---

## Suggested order of attack

1. **Radio (Bucket B)** — most contained, restores a whole page, no cross-Worker coordination. ~15 min if option 1 (drop+recreate) is acceptable.
2. **Dispatch list (Bucket A)** — biggest user-visible impact (CAD core is broken). Port `/calls` list + `/queue` to new Worker, add proxy rules. Risk: hidden behaviors in the legacy enrichment loop. ~1-2 hr.
3. **HR benefits + arrests/recent (Bucket C)** — proxy stubs to silence console noise. ~5 min each.
4. **Body cameras + audit log (Bucket D)** — same stub treatment for unimplemented routes. ~10 min total.
5. **Fleet (Bucket D)** — heavier; FleetPage is a real page that needs handlers. Defer until the fleet rewrite slot.
6. **PDF signing (Bucket E)** — not actually broken. Skip.

If you want, I can start with **Bucket B (radio)**: confirm `radio_transmissions` row count is small/zero on live, then drop + recreate the three radio tables from `migrations/0038_radio.sql`.
