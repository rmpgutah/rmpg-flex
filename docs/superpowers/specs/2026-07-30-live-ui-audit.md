# Live UI Audit — 2026-07-30

Authenticated walk of production (`rmpgutah.us`) as ADMIN, page by page.
## Read this first — check `origin/main` before auditing

This audit initially re-derived ~38 "missing D1 column" defects that
**PR #3179 (`repair all 66 nonexistent column references`) and #3183 had already
fixed on main.** The branch was cut from `f0fcb00`, one commit before #3179
landed, so the worktree's code looked broken while production was healthy —
which also explains why live pages kept working against "broken" queries.

Main's fixes were equal or better: `adminDev.ts` uses
`SELECT id, call_sign AS unit_number` (aliased, preserving response shape), and
the fleet cost-per-mile denominator is already `MAX(odometer) - MIN(odometer)`
in 8 places rather than the meaningless `SUM(odometer)`.

Main also resolved the "no live equivalent" columns by **fixing the code, not
adding columns** — `bolos` uses the existing `expired_at`; `serve_attempts` has a
comment stating `planned_at` does not exist and the planned time lives elsewhere;
`company_documents` dropped the phantom `file_name`/`mime_type`/`file_size` from
its SELECT. A migration adding those columns was drafted and **correctly
discarded** — it would have added dead columns to production.

**Lesson: `git fetch origin main` and diff BEFORE auditing a long-lived branch.**
Everything below is what survived that check as genuinely novel.

## 🔴 INCIDENT — INITIALIZING wedge (root cause: Rocket Loader — see correction below)

**Symptom:** any hard navigation stranded permanently on the `INITIALIZING`
splash. Reproduced in a clean tab. No console error, no failed request visible.

**Evidence:**
- `#root` contained only `#pre-splash` + a `<style>` — React never mounted.
- `performance.getEntriesByType('resource')`: entry bundle `index-DjpfPmri.js`
  → **`decodedBodySize: 0`**. Previous bundle `index-BmHgttja.js` → 941,093 bytes,
  served from SW cache. Pages already open kept working on the OLD bundle;
  only hard navigations broke.
- Server was healthy the whole time: `curl` returned **HTTP 200, 941,093 bytes,
  `application/javascript`** for BOTH hashes.
- SW cache name changed mid-session (`rmpg-flex-f0fcb00` → `rmpg-flex-8b458c2`),
  confirming a deploy rotated underneath the open session.

### ⚠️ ROOT CAUSE CORRECTION — it was Rocket Loader, not the service worker

An earlier revision of this document blamed `sw.js`'s poison guard. **That was
wrong.** PR #3186 (`opt every script out of Cloudflare Rocket Loader`, merged to
main 2026-07-31) identified the real cause:

Cloudflare **Rocket Loader** is enabled on the `rmpgutah.us` zone and rewrites
the entry script's type attribute —
`type="module"` → `type="<cf-hash>-module"`. A mangled type is not a module
type, so the browser **fetches the bundle (clean 200) but never EXECUTES it**.
React never mounts and the page sits on `#pre-splash`.

**Why that beats the SW theory:** #3186 reproduced it on a **fresh profile with
no service worker and no caches**, which rules the SW out as cause. This audit
never ran that control — the SW was simply where I happened to be looking, and
the empty-body poison guard was a plausible-looking culprit. Every symptom
recorded here fits Rocket Loader at least as well: splash forever, `#root`
holding only `#pre-splash`, healthy 200s from the server, an older cached bundle
still working, and the cache name flipping on deploy.

#3186 also explains the confusing part: *"a warm service worker kept serving the
app until a deploy rotated the cache and pushed every client back through the
rewritten HTML."* The SW was **masking** the bug, not causing it — so the root
cause is a zone setting while the trigger is ANY deploy. `sw.js`'s cache name is
stamped from the git SHA, which is why the failure tracks deploys.

**Fix for the actual outage is #3186 (already on main), not this branch.**

### Secondary gap this branch does address (defense-in-depth)

Independently of the above, `sw.js:348`'s poison guard has no recovery path. If a
`/assets/*.js` request returns `text/html` it correctly refuses to cache and
returns `new Response('', {status: 404})`; its offline path returns an empty 503.
`client/index.html:144` documents the dead end — *"stranded forever with no error
and no recovery path"* — because the entry handler's bare `reload()` re-enters
the same SW, changes nothing, and spends the once-per-30s budget.

That gap is real and worth closing, but it is **not** what caused the 2026-07-30
incident. This branch's changes cannot fire during a Rocket Loader outage at all:
a mangled script type produces no `error` event, so the handler never runs and
cannot destroy the warm SW cache that is keeping clients alive.

Compatibility with #3186 verified: the `stampCfAsync` vite plugin adds
`data-cfasync="false"` to EVERY script in `index.html`, including this inline
handler (confirmed in `dist/index.html`).

**Immediate remediation applied (before the true cause was known):** unregistered the SW and deleted its caches in
the operator's browser. Cookies/localStorage untouched (auth is 55 localStorage
keys, 0 cookies) so the session survived. `/records` loaded immediately after.

**✅ SECONDARY GAP CLOSED (two halves) — this is hardening, NOT the outage fix.**
The 2026-07-30 outage is fixed by #3186 on main. The two changes below close a
separate, genuine dead end in the stale-chunk recovery path.

1. **Recovery — `client/index.html` entry `error` handler.** It previously called
   a bare `window.location.reload()`. When the entry module fails *because the SW
   served an empty body*, that reload re-enters the SAME service worker, gets the
   SAME empty body, changes nothing, and spends the once-per-30s budget on a
   no-op — leaving the next failure with no recovery left. It now purges the SW
   registration and all caches FIRST, then reloads — a reload that can actually
   reach the network. Bounded by a 3s ceiling so a hung `caches`/SW API can never
   block the reload it exists to enable. Cookies/localStorage untouched, so the
   user stays signed in.

   Note the guard's fail-safe: if `sessionStorage` is unavailable (private mode,
   blocked storage) it does **not** reload, because the once-per-30s guard can't
   be enforced and an unguarded reload could loop.

2. **Prevention — `client/public/sw.js` `purgeCachedShell()`.** When the poison
   guard sees HTML for a `/assets/*.js` request, the actual culprit is the cached
   navigation shell whose entry `<script>` points at a hash the current deploy no
   longer serves. The guard now evicts cached navigation entries (`/` and
   extensionless SPA routes) via `event.waitUntil`, so the next navigation
   refetches fresh HTML instead of re-serving the dead pointer. Best-effort and
   fully swallowed — it can never affect the response.

**Verification:** `node --check` on sw.js and on the extracted inline block;
`vite build` succeeds; `dist/index.html` contains the purge logic, `dist/sw.js`
contains `purgeCachedShell`, and `CACHE_NAME` still auto-stamps
(`rmpg-flex-f0fcb0037f`). Full client suite 507 files / 3787 tests green.

⚠️ Neither file is covered by tsc or vitest — **the production build is their only
gate.** A syntax error in the inline script would strand every user at boot, so
re-run `vite build` and grep `dist/` after any edit here.

## Fixed

### Reports → "Calls by Priority" ignored the date-range selector
`ReportsPage.tsx:1222` sourced `priorityChartData` from
`dashboardData.callsByPriority`, which the server scopes to **currently-active**
calls (`ACTIVE_CALL_WHERE`). With 0 active calls the chart rendered *"No data for
selected filters"* while the same page showed **TOTAL CALLS 23** for the window —
and the empty-state message was actively misleading, since the filter was never
applied.

`callsByPriority` is correct for its two other consumers (`StatusBar`,
`DashboardPage` P1–P4 tiles), so the server was left alone. Repointed the chart
at `responseTimesData.byPriority` — already fetched, already date-ranged
(live: P2×7 @30.2m, P3×13 @31.2m, P4×2 @45.5m). The identical fix had already
been applied to `totalCalls` on the same page; this chart was left behind.

## Verified correct — do not re-file

- **F-011 (Records count mismatch) — RESOLVED, not a bug.** Records shows
  Individuals **81**; `persons` has **83**. Exactly **2** rows carry
  `flags LIKE '%archived%'`, which `records.ts:2893` deliberately excludes.
  Vehicles 42, Properties 153, Business 53, Evidence 4 all match live exactly.
- **Dispatch call timeline math is correct.** Dispatched 15:02:22 → on-scene
  15:49:27 = the 47:05 response displayed.
- **Court Tracker `UPCOMING (0)` is correct** — all 5 events are past-dated.
  `COURT CASE #` showing `--` matches live data (`court_case_number` null/empty).
- **Personnel + Training render correctly.** Roster 3 ACTIVE + 1 OFF = 4 TOTAL;
  Training records 1 total / 1 completed; org compliance 25% = 1 of 4 officers at
  100%. **Training Materials Library is populated** (HR Volume 001/002 handbooks,
  Utah Process Service Handbook) — it was predicted empty from the pre-#3179
  worktree, which is what exposed the branch-staleness problem above.
- **Mini-map is not broken.** The `bg-[#0a0a0a] z-20` veil in
  `MapboxMiniMap.tsx:443` is a *slow* load, not a hang — it clears on its own and
  the map renders correctly (canvas 488×984, navy basemap, call marker). Same on
  the Dashboard. Log as latency, alongside known F-009 (Warrants KPIs ~30s).

## Open — found, not fixed

- **Pagination totals misreport.** `records.ts:1564`, `:2905`, `:2936` return
  `pagination: { total: rows.length }` — the PAGE size, not the true count.
  Harmless today (81 persons < 500 default limit); silently truncates and
  reports a wrong total once any of those tables exceeds the limit.
- **GPS warning flood.** 120 console warnings in one session, all
  `[GPS] No position callback in 31s (connection: cellular)`, repeating every
  31s. Consoles stay open all shift (cf. known F-006).
- **Reports "SLA MET 0%"** with 23 calls and a 31.9m average — plausible if the
  SLA target is 5 min (`targetMinutes: 5` in the trend chart), but unverified.

## Pages not yet walked

MAP, MDT, NCIC, ENFORCE, COMMS, OVERWATCH, CONNECTIONS, JAIL/IA,
SERVICES, AUDIT, ADMIN, NAV INDEX, DESKTOP, CRM.
