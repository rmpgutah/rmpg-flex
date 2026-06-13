# Intel Portal — Command Center Redesign (Design Spec)

**Date:** 2026-06-13
**Author:** Christopher Zamora + Claude (brainstorming session)
**Status:** Design — pending user approval
**Scope decision:** "Go big" — one cohesive mega build, shipped as a single feature branch + PR.

---

## 1. Overview & Goals

Today `/intel` is a 119-line page: a search box, 11 filter chips, and a flat result
list. Underneath it sits a rich, resilient backend — 360° dossiers, a connections
graph, watchlist alerting, entity resolution, narrative extraction, escalation
scoring, plate sightings, jail ingest, quick-capture, and interaction recording —
almost none of which is surfaced where an analyst lands.

This project transforms `/intel` into a **tri-pane intelligence command center**:
a persistent left rail, a center work surface, and a docked right context panel
that live-loads the selected entity. It (a) surfaces every existing capability as a
first-class section, and (b) adds four net-new capabilities: a **supercharged
search**, a **BOLO Board**, a **Map / Geospatial Intel** view, and an **AI Analyst**
surface (built real, shipped in an "engine offline" state until Anthropic billing is
funded, then lights up automatically).

### Success criteria

- `/intel` renders the tri-pane shell; the left rail navigates all sections without
  full-page reloads (nested routes), and deep links (e.g. `/intel/jail`) still work.
- The **Intelligence Dashboard** is the default landing surface and shows live data
  from a single new aggregate endpoint (`GET /api/intel/overview`).
- Selecting any person from any list/search hit populates the **right context panel**
  (Dossier Peek ↔ Mini Graph), reusing the existing dossier endpoint and graph panel.
- **Supercharged search** parses operators + plain language, returns ranked/faceted
  results as rich preview cards, clusters same-entity hits, and supports saved
  searches + history.
- **BOLO Board** can create/edit/expire BOLOs; active high-priority BOLOs surface on
  the dashboard and as an app-wide officer banner.
- **Map** plots plate sightings, escalation hotspots, recent-event clusters, and
  watchlist subjects' last-known locations on the existing Mapbox stack.
- **AI Analyst** endpoints + UI exist and degrade gracefully to a clear offline state
  with zero crashes when no AI provider is available.
- Worker `npm run typecheck` and client `tsc --noEmit` + `vitest` + `vite build` all
  pass. New backend logic has at least smoke coverage; pure helpers are unit-tested.

### Non-goals (explicitly out of scope)

- No changes to the global app mega-nav/header — the portal lives inside the existing
  chrome, in the page body.
- No new realtime WebSocket transport. Live data uses polling (see §11; live `/api/ws`
  is on the legacy worker and the rewrite's broadcast is dead).
- No rebuild of components that already work (PlateLogPage, JailRecordsPage,
  QuickCapturePage, InteractionRecorderPage, ConnectionsPage, PersonDossierPage,
  IntelReportsPage). They are adopted, not rewritten.
- No training/hosting of AI models. The AI Analyst calls the configured Anthropic API
  (or a Workers-AI fallback) when available; otherwise it reports offline.
- No `ALTER TABLE` against `calls_for_service` or `persons` (D1 100-column cap).

---

## 2. Information Architecture

### Tri-pane shell

```
┌───────────────────────────── existing global app header (unchanged) ──────────────────────────────┐
├──────────────┬─────────────────────────────────────────────────┬───────────────────────────────────┤
│  LEFT RAIL   │  CENTER  (nested route outlet)                  │  RIGHT CONTEXT PANEL (collapsible)│
│  (sections)  │  Dashboard / Search / Connections / Jail / …    │  Dossier Peek  ↔  Mini Graph      │
└──────────────┴─────────────────────────────────────────────────┴───────────────────────────────────┘
```

- **Left rail** — grouped section nav with live badge counts (watchlist, BOLOs,
  alerts, review queues). Collapses to an icon rail on narrow viewports.
- **Center** — a React Router `<Outlet/>`. Each rail item maps to a nested route.
- **Right context panel** — shared across all sections, driven by a React context
  (`IntelContext`). Collapsible with a chevron; remembers collapsed state in
  `localStorage`. Two modes: **Dossier Peek** (default for a person) and **Mini Graph**.

### Rail sections → routes

| Group        | Section          | Route                    | Component (new / adopted)                  |
|--------------|------------------|--------------------------|--------------------------------------------|
| Workspace    | Dashboard        | `/intel` (index)         | **`IntelDashboard`** (new)                 |
| Workspace    | Search           | `/intel/search`          | **`IntelSearch`** (new, supercharged)      |
| Workspace    | Connections      | `/intel/connections`     | `ConnectionsPage` (adopted; `/connections` kept as alias) |
| Watch&Alert  | Watchlist        | `/intel/watchlist`       | **`WatchlistSection`** (new, thin)         |
| Watch&Alert  | BOLO Board       | `/intel/bolos`           | **`BoloBoard`** (new)                      |
| Watch&Alert  | Alerts           | `/intel/alerts`          | **`AlertsSection`** (new; reads notifications) |
| Sources      | Jail / Bookings  | `/intel/jail`            | `JailRecordsPage` (adopted)                |
| Sources      | Plate Sightings  | `/intel/plate-log`       | `PlateLogPage` (adopted)                   |
| Sources      | Review Queues    | `/intel/queues`          | **`ReviewQueues`** (new; wraps existing ResolutionReviewPanel + SuggestedLinksPanel) |
| Intelligence | Map              | `/intel/map`             | **`IntelMap`** (new, Mapbox)               |
| Intelligence | AI Analyst       | `/intel/ai`              | **`AiAnalyst`** (new, offline-gated)       |
| Intelligence | Intel Products   | `/intel/reports`         | `IntelReportsPage` (adopted)               |

Deep links preserved: `/intel/person/:id`, `/intel/quick-capture`, `/intel/record`,
`/intel/reports/:id`, `/intel/sources`, `/connections`, `/intel/workbench` all keep
working (the layout wraps them; standalone routes that predate the portal redirect
into the shell where it improves UX, otherwise remain).

### Routing implementation

`/intel` becomes a **layout route** (`IntelPortalLayout`) with the rail + context
panel as persistent chrome and an `<Outlet/>` in the center. Adopted pages are
lightly adapted to drop their own outer `PanelTitleBar`/padding when rendered inside
the shell (they detect shell context via `IntelContext`), so they still render
standalone if visited directly during the transition.

---

## 3. Component Architecture

### New components (client)

```
client/src/pages/intel/
  IntelPortalLayout.tsx     # tri-pane shell: rail + outlet + context panel; mounts IntelProvider
  IntelRail.tsx             # left rail nav + live badge counts (from /overview)
  IntelContextPanel.tsx     # right docked panel; Dossier Peek ↔ Mini Graph switch
  IntelDashboard.tsx        # landing: stat tiles + widget grid
  IntelSearch.tsx           # supercharged search (replaces old IntelSearchPage body)
  BoloBoard.tsx             # BOLO list + create/edit modal
  IntelMap.tsx              # Mapbox geospatial intel
  AiAnalyst.tsx             # AI surfaces, offline-gated
  WatchlistSection.tsx      # thin list over /intel/watchlist
  AlertsSection.tsx         # notifications filtered to intel alerts
  ReviewQueues.tsx          # wraps ResolutionReviewPanel + SuggestedLinksPanel
  widgets/                  # dashboard widget components (one file each)
    WatchlistActivityWidget.tsx
    ActiveAlertsWidget.tsx
    EscalationLeaderboardWidget.tsx
    JailCrossHitsWidget.tsx
    PlateSightingsWidget.tsx
    ReviewQueuesWidget.tsx
  hooks/
    useIntelOverview.ts     # polling hook for /api/intel/overview
    useIntelContext.ts      # selected-entity context consumer
    useQueryParser.ts       # parse operators + plain language → structured query
```

Shared state: **`IntelContext`** exposes `{ selected, selectEntity(type,id), panelMode,
setPanelMode, panelCollapsed, togglePanel }`. Any widget/result card calls
`selectEntity('person', id)` to drive the right panel. This is the single seam that
keeps the three panes decoupled — center surfaces never reach into the panel directly.

### Reused / adopted (no rewrite)

- `ConnectionsGraphPanel.tsx` → embedded as the right panel's **Mini Graph** mode.
- Dossier data via `GET /api/intel/dossier/person/:id` → drives **Dossier Peek**.
- `PersonDossierPage`, `JailRecordsPage`, `PlateLogPage`, `IntelReportsPage`,
  `QuickCapturePage`, `InteractionRecorderPage`, `ConnectionsPage` → adopted as routes.
- `ResolutionReviewPanel`, `SuggestedLinksPanel` → composed into `ReviewQueues`.
- `dossierPdfGenerator`, `intelProductPdf` → reused for exports (Arial-only per repo rule).
- `apiFetch` (`hooks/useApi.ts`) for all calls; `useLiveSync` pattern where applicable.

### File-size discipline

`IntelSearchPage.tsx` is replaced; its `recordPath()` and `IntelHit` type are lifted
into a shared `client/src/pages/intel/intelTypes.ts`. **`GlobalSearch` imports
`recordPath` from the old path today** — update that import (or re-export from the old
module) so it never breaks. No single new file should approach the megafile sizes the
repo warns about; widgets are one-purpose files.

---

## 4. Intelligence Dashboard + `/api/intel/overview`

The dashboard is the default surface. It renders **3 stat tiles** + **6 widgets**
from one aggregate call so the landing is a single round-trip.

### `GET /api/intel/overview`  → single JSON payload

```ts
{
  stats: { active_warrants: number; on_watchlist: number; gang_flagged: number },
  watchlist_activity: Array<{ entity_type, entity_id, label, event, when }>,   // recent new activity on watched entities
  alerts: Array<{ kind:'warrant'|'officer_safety'|'gang'|'bolo', person_id?, label, detail, when }>,
  escalation_leaderboard: Array<{ person_id, label, score, trend:'rising'|'flat' }>, // top N by escalation index, 30d
  jail_cross_hits: Array<{ booking_id, name, person_id?|null, booked_at, match:'exact'|'possible' }>,
  plate_sightings: Array<{ plate, state, flag?, location_text, when }>,         // recent N
  queues: { link_suggestions: number; resolution_pairs: number },
  bolos: { active: number; high_priority: number }
}
```

Each section is computed in its own try/catch and defaults to `[]`/`0` on failure, so
one bad table never blanks the dashboard (mirrors the dossier endpoint's resilience).
Reuses existing helpers: `intelPatterns` (escalation), `intelScreen` (flags),
`intelWatchlist` (recent activity), jail tables, `vehicle_sightings`,
`intel_link_suggestions`, `entity_resolution_suggestions`.

Widget → data source mapping is 1:1 with the payload keys above. Polling: every 20 s
(see §11). Each widget row is clickable → `selectEntity()` opens the right panel.

> **Decision point reserved for you (domain logic):** the **escalation leaderboard
> ranking weight** — current `intelPatterns` scores 30d-vs-prior tempo. During build
> I'll surface the scoring function so you can tune what "rising" means for RMPG
> (e.g. weight violent CFS types higher). 5–10 lines, shapes the whole leaderboard.

---

## 5. Supercharged Search

Replaces the flat list with a parser + ranked, faceted, card-based results.

### Query parsing (`useQueryParser.ts`, pure + unit-tested)

- **Operators:** `plate:8XQ220`, `dob:1991-08-02`, `phone:5550101`, `vin:…`,
  `type:person`, `name:"hale vincent"`, `flag:warrant`. Unrecognized tokens fall
  through to free text.
- **Plain language** (non-AI): the existing identifier sniffing (`intelMatch.ts`)
  already detects phone/DOB/VIN/plate/record#; the parser front-ends it so an analyst
  can type naturally and still get exact-hit boosting.
- Parser output: `{ text, filters: {type?, flag?}, identifiers: {...} }` → passed to
  `/api/intel/search` as query params (extends existing endpoint, backward compatible).

### Results UX

- **Facets** (left of results inside center pane): result counts per entity type +
  per flag; clicking narrows (client-side over the returned set, like today's filter
  but richer).
- **Preview cards** instead of rows: person cards show photo, name, DOB/sex,
  flag chips, escalation chip, and a "shared-with N" hint; vehicle cards show plate,
  make/model, stolen/watch flag. Cards are denser than dossiers, richer than rows.
- **Cross-entity clustering:** person hits that resolve to the same canonical identity
  (via `person_canonical`) collapse into one card with a "N linked identities" badge —
  reuses cluster data already returned by `/search`.
- Clicking a card → `selectEntity()` (right panel peek) ; double-click / "Open" →
  full record/dossier route.

### Saved searches + history (new tables, see §10)

- `POST /api/intel/saved-searches` / `GET` / `DELETE` — named, per-user saved queries.
- Search history auto-records the last N executed queries per user
  (`POST` on execute, `GET` for the recents dropdown). Privacy: history is per-user,
  not shared; supervisors do not see others' history.

---

## 6. Right Context Panel

- **Dossier Peek** (default): calls `GET /api/intel/dossier/person/:id`; renders photo,
  identity, flag chips, **escalation index box**, recent timeline (top 5), top
  associates (top 3), and action buttons → Full Dossier / Graph / Watch toggle.
- **Mini Graph:** embeds `ConnectionsGraphPanel` seeded with the selected entity
  (1-hop). Toggling to graph keeps the same selection.
- **Collapsible:** chevron collapses to a thin strip; state persisted in `localStorage`
  (`rmpg-intel-panel-collapsed`). Default expanded on wide, collapsed on narrow.
- **Watch toggle** in the panel calls existing `POST/DELETE /api/intel/watchlist`.

No new backend for the panel — it composes endpoints that already exist.

---

## 7. BOLO Board (net-new)

Be-On-the-LookOut alerts for persons / vehicles / plates with priority + expiry.

### Data — `bolos` table (migration 0106)

```sql
CREATE TABLE IF NOT EXISTS bolos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  bolo_type    TEXT NOT NULL,                 -- 'person' | 'vehicle' | 'plate' | 'other'
  subject_label TEXT NOT NULL,                -- denormalized display (e.g. "HALE, Vincent" / "UT 8XQ-220")
  person_id    INTEGER,                       -- optional FK-ish link
  vehicle_id   INTEGER,
  plate        TEXT,
  priority     TEXT NOT NULL DEFAULT 'medium',-- 'critical' | 'high' | 'medium' | 'low'
  title        TEXT NOT NULL,
  details      TEXT,                           -- narrative (Phase-1 grammar reuse optional)
  status       TEXT NOT NULL DEFAULT 'active', -- 'active' | 'expired' | 'cancelled' | 'resolved'
  issued_by    INTEGER NOT NULL,
  issued_at    TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT,                           -- null = until cancelled
  resolved_by  INTEGER, resolved_at TEXT, resolution_note TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bolos_status ON bolos(status, priority);
CREATE INDEX IF NOT EXISTS idx_bolos_person ON bolos(person_id);
```

### Endpoints (under `/api/intel/bolos`)

| Method | Path | Role | Purpose |
|--------|------|------|---------|
| GET | `/bolos` | operational | list (filter by status/priority/type) |
| GET | `/bolos/active` | operational | active + non-expired (for banner + dashboard) |
| POST | `/bolos` | operational | create |
| PUT | `/bolos/:id` | operational (own) / supervisor+ (any) | edit |
| POST | `/bolos/:id/resolve` | operational | mark resolved w/ note |
| DELETE | `/bolos/:id` | supervisor+ | cancel |

A cron (or the existing pattern sweep) flips `active`→`expired` past `expires_at`.

### UI + integration

- `BoloBoard.tsx` — card grid by priority; create/edit modal; resolve flow.
- **Dashboard:** active BOLOs feed the Active Alerts widget (kind `'bolo'`) and the
  rail badge.
- **App-wide officer banner:** a small, dismissible banner component (mirrors the
  existing Announcements officer banner pattern) shows count of active **critical/high**
  BOLOs; reuses the established banner mechanism rather than inventing a new one.

> **Decision point reserved for you:** BOLO **priority → banner/notification behavior**
> (which priorities page everyone vs. just appear on the board, default expiry per
> priority). 5–10 lines in the create handler; pure policy, your call.

---

## 8. Map / Geospatial Intel (net-new)

A Mapbox view (reuses `client/src/utils/mapbox*` + existing map hooks) plotting intel
layers. Mapbox token already wired via `VITE_MAPBOX_ACCESS_TOKEN`.

### Layers (toggleable)

1. **Plate sightings** — points from `vehicle_sightings` (lat/lng), color by flag
   (stolen / watchlist / normal).
2. **Escalation hotspots** — heat/cluster layer from recent event locations of high-
   escalation persons (addresses already computed in the dossier/patterns code).
3. **Recent-event clusters** — CFS/incident points over a selectable window.
4. **Watchlist last-known** — last sighting/event location per watched subject.

### Endpoint — `GET /api/intel/map?layers=…&since=…`

Returns GeoJSON-ready features per requested layer, each computed in its own
try/catch. Points carry `{ entity_type, entity_id, label, lat, lng, flag? }` so a
click → `selectEntity()` opens the right panel. Sentinel-guarded coordinate parsing
(repo has a history of `$NaN`/sentinel-toFixed crashes — guard lat/lng before use).

No new core tables; reads existing location data. Respects the pure-black/gold theme
for map chrome and uses the project's Mapbox style conventions.

---

## 9. AI Analyst (net-new, offline-gated)

Real surfaces + endpoints, built to **degrade to a clear offline state** until an AI
provider is available. This is the honest "go big": no faked output.

### Provider detection

A single server-side `aiProvider()` resolver checks, in order: configured
`anthropic_api_key` (the OCR subsystem's config seam) → Workers-AI binding (if license
accepted) → **offline**. Every AI endpoint returns
`{ available: false, reason: '…' }` when offline; the UI renders an "AI engine offline
— add Anthropic credits in Admin → API Integrations" state with a link, never an error
or a spinner that hangs.

### Features → endpoints (under `/api/intel/ai`)

| Feature | Endpoint | Offline behavior |
|---------|----------|------------------|
| Natural-language query → structured search | `POST /ai/query` | falls back to the §5 operator parser (still useful!) |
| Dossier summarization / threat narrative | `POST /ai/summarize-person` | shows "offline" + the raw dossier remains fully usable |
| Link prediction ("who should connect") | `POST /ai/predict-links` | shows "offline"; the derived graph edges still exist |
| Threat / pattern narrative cards | `POST /ai/patterns` | shows "offline"; `intelPatterns` numeric scores still show |

Note that **NL-query degrades to the deterministic parser**, so even offline the AI tab
does something real. Outputs that suggest actions (e.g. predicted links) are
**suggestions only** — they never auto-write; an analyst confirms, reusing the existing
suggestion-confirm pattern.

### Cost / safety

- Calls are explicit (button press), never automatic, to avoid burning credits.
- Person-level AI summaries are gated to supervisor+ initially (28 CFR-adjacent
  caution; matches the intel program's existing sanitization posture).
- Responses cached briefly in KV to avoid duplicate spend.

---

## 10. Data Model (migrations)

All new tables; **no ALTER on `calls_for_service` / `persons`**. Next free prefix is
`0106`. Idempotent DDL (`CREATE TABLE IF NOT EXISTS`).

```
migrations/0106_intel_portal.sql
  - bolos                (see §7)
  - intel_saved_searches (id, user_id, name, query_json, created_at)  UNIQUE(user_id, name)
  - intel_search_history (id, user_id, query_text, query_json, executed_at)  -- capped per-user in code
  - (indexes for each: by user_id; bolos by status/priority/person)
```

Per the repo's hard-won migration rule: after merge, **also apply 0106 DDL directly to
live D1 `785de7ae`** via the Cloudflare D1 API and verify with
`pragma_table_info('bolos')` etc. — the deploy migration step is `continue-on-error`
and has historically not reached live silently.

The Worker boot reconciler / route code must tolerate the tables being briefly absent
(LIKE-fallback pattern, as `/search` already does for `intel_index`).

---

## 11. Real-time Strategy

Live `/api/ws` runs on the **legacy** worker and the rewrite's broadcast is dead
(documented in project memory). Therefore:

- Dashboard + rail badges **poll** `GET /api/intel/overview` every **20 s**
  (`useIntelOverview` with `setInterval`, paused when tab hidden via
  `document.visibilityState`).
- The BOLO officer banner polls `GET /api/intel/bolos/active` on the same cadence.
- No new WebSocket work. If/when the WS cutover lands, the polling hook is the single
  place to swap in a subscription.

---

## 12. Auth & Roles

- All `/api/intel/*` endpoints stay behind the existing per-prefix `authMiddleware`.
- Reuse the route's existing role gates: `operational` = admin/manager/supervisor/
  officer/dispatcher; `supervisorPlus` = admin/manager/supervisor.
- `client_viewer`, `contract_manager`, `human_resources` remain excluded from intel.
- BOLO create = operational; cancel = supervisor+. AI person-summaries = supervisor+.

---

## 13. Design System Compliance

- Pure-black theme: `#000` base, `#0b0b0b` raised, `#d4a017` gold, `#888` gray,
  **zero blue**. Borders `#232323` / `#3a3a3a` strong. **2 px radius everywhere**
  (never `rounded-lg`). Tables/labels follow the 9 px header / 11 px row convention.
- Icon-only buttons use `<IconButton aria-label=…>`.
- All PDF exports register Arial (repo-wide rule) and reuse existing generators.
- The mockup at `.superpowers/brainstorm/.../portal-mock.html` is the visual target.

---

## 14. Backend Wiring

- New endpoints added to `src/routes/intel.ts` (or split files imported by it) so they
  inherit the **already-registered `/api/intel` prefix** in `src/routesConfig.ts` — no
  new top-level prefix, no new proxy rule needed (avoids the routing-gap bug class).
- `routesConfig.ts` note for `/api/intel` updated to mention overview/bolos/map/ai.
- New pure helpers (`intelOverview.ts`, `boloPolicy.ts`, `aiProvider.ts`) live in
  `src/utils/` and are unit-testable without Miniflare.

---

## 15. Testing

- **Client:** `vitest` unit tests for `useQueryParser` (operator/NL parsing — many
  cases), the `IntelContext` reducer, and dashboard widget rendering with mock data.
  Existing `IntelSearchPage.test.tsx` is updated/retargeted to the new search.
- **Worker:** `npm run typecheck` must pass; add pure-function tests for
  `boloPolicy`, escalation weighting, and `aiProvider` offline resolution.
- **Manual verify:** drive the logged-in browser (WAF blocks curl) to confirm the
  portal boots, dashboard loads, search returns cards, panel peeks, BOLO create works,
  map renders, AI tab shows offline state cleanly.

---

## 16. Deploy & Rollout

- Ship as **one feature branch → `gh pr create`** (per user's PR-flow preference), not
  a direct push to main. PR runs `pr-tests.yml`; merge triggers `deploy.yml`.
- **Bump `CACHE_NAME` in `client/public/sw.js`** (next version) — mandatory on every
  client change.
- After merge: apply migration `0106` to live D1 `785de7ae` and verify columns.
- Verify boot in a real browser after deploy (Pages + Worker each can fail
  independently).

---

## 17. Build Sequence (high level — detailed plan via writing-plans)

1. **Shell + context** — `IntelPortalLayout`, `IntelRail`, `IntelContext`,
   `IntelContextPanel`; nested routing in `App.tsx`; adopt existing pages.
2. **Dashboard + `/api/intel/overview`** — endpoint + 6 widgets + stat tiles + polling.
   *(Migration `0106_intel_portal.sql` — containing `bolos`, `intel_saved_searches`,
   and `intel_search_history` — is authored once in this step and applied before the
   features that read those tables.)*
3. **Supercharged search** — parser, cards, facets, clustering; saved searches +
   history (uses `intel_saved_searches` / `intel_search_history`).
4. **BOLO Board** — endpoints over `bolos`, board UI, officer banner.
5. **Map** — `/api/intel/map` + `IntelMap` Mapbox layers.
6. **AI Analyst** — `aiProvider` + `/api/intel/ai/*` + offline-gated UI.
7. **Polish + tests + SW bump + PR.**

Each step is independently shippable in principle; we build them as one PR but in this
order so the shell lands first and everything hangs off it.

---

## 18. Risks & Open Questions

- **AI funding** — Phase-3 surfaces are inert until Anthropic credits / Workers-AI
  license. Mitigated by the offline-gate design; not a blocker for the rest.
- **Adopted-page chrome** — adapting existing pages to render cleanly inside the shell
  without breaking their standalone routes needs care (context-aware chrome). Low risk,
  some fiddly CSS.
- **Live-DB migration drift** — must hand-apply 0106 to live; verify with pragma.
- **Map data quality** — many records may lack lat/lng; layers must no-op gracefully
  on missing coords (sentinel guards).
- **Blast radius** — this is a large single PR. Mitigation: build in an isolated
  worktree (already on `claude/hopeful-bhabha-b1ccce`), keep the shell + adopted pages
  backward-compatible, and lean on typecheck + vitest before PR.

---

## 19. Decision Points Reserved For You (domain logic)

During implementation I'll hand you these small, high-leverage choices (5–10 lines
each) rather than guess — they encode RMPG's operational judgment:

1. **Escalation leaderboard weighting** (§4) — what makes a subject "rising."
2. **BOLO priority → broadcast policy** (§7) — who gets paged vs. board-only, default
   expiries.
3. **Query-parser operator grammar** (§5) — confirm/extend the operator set analysts
   will actually type.
