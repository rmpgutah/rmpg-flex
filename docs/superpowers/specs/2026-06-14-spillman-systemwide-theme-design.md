# System-Wide Spillman Theme — Design (Phase 1)

**Date:** 2026-06-14
**Status:** Approved (design); safeguard-hardened per operator mandate
**Branch/worktree:** `claude/spillman-systemwide` (isolated worktree off `origin/main` @ `0c441bc18`)

## Goal

Make the Spillman visual system **app-wide** with a **day (light grey) / night (dark
steel-blue)** theme switcher that auto-follows shift time, keeps tactical surfaces
dark for night-driving safety, and transitions **without breaking any of the ~122
pages** — every risk mitigated with an explicit safeguard.

## Locked decisions (from brainstorming)

- **Night theme** = dark steel-blue Spillman (an *upgrade* of the current dark, not the
  old pure-black). **Default theme = night.**
- **Day theme** = light grey Spillman (the merged Records look, generalized).
- **Switching** = auto by time (night 18:00–06:00 America/Denver, configurable) **+**
  manual override that wins until the next scheduled boundary.
- **Tactical surfaces** (live Map, dashcam/body-cam HUD, in-vehicle MDT) = **force-dark
  always**, regardless of theme.
- Day and night share one steel-blue identity; **muted gold `#d4a017` retained** for
  status/alerts in both.

## Grounding facts

- An existing theme system already exists: `client/src/utils/theme.ts` toggles
  `html.theme-dark` / `html.theme-light` (localStorage `rmpg_theme_preference`, native
  status-bar sync via Capacitor). Today both are dark-on-dark. **We extend this, not
  replace it.**
- `surface-*` Tailwind colors are **already CSS-variable-backed**
  (`rgb(var(--surface-base-rgb) / <alpha-value>)`) with per-theme values under
  `html.theme-light` — proving the var-backed pattern works in this codebase.
- `rmpg-*`, `brand-*`, `blue-*`, `brand-gold-*` are **hardcoded hex** in
  `client/tailwind.config.js` — they do NOT re-theme today.
- The Records `client/src/styles/spillman.css` chrome currently uses **hardcoded light
  hex** scoped under `.spillman-theme`. At night this would render a blinding-white
  Records page — it MUST be reconciled to shared theme vars.
- **~493 client `.tsx` files contain raw 6-digit hex.** Most are not color-critical, but
  this quantifies the long tail that token-swapping cannot reach (drives Phase 2/3 and
  the audit safeguard).

## Architecture

### 1. Variable-backed token foundation (the core enabler)
Convert `rmpg-*`, `brand-*`, `blue-*`, `brand-gold-*` in `tailwind.config.js` from
hardcoded hex to `rgb(var(--<token>-rgb) / <alpha-value>)` (the existing `surface-*`
pattern). Declare channel values per theme:
- `html.theme-night` (default, also set on `:root` so SSR/first-paint = night) → dark
  steel-blue palette.
- `html.theme-day` → light grey palette.

Result: every `bg-rmpg-700`, `text-brand-400`, `border-rmpg-600`, etc. across **all 122
pages** re-themes by swapping variables — no override sheets, no `!important`.

**Token API is unchanged** — class names like `bg-rmpg-700` stay identical, so **zero
component code changes** are required for the recolor (keeps TypeScript/JSX untouched →
low regression risk). Only the channel *values* move into CSS vars.

### 2. Two palettes (anchors; exact values finalized in the plan)

**Night — dark steel-blue Spillman (default):**
surface base `#0d1722`, raised `#15212e`, sunken `#0a1018`, deep `#060b10`;
borders `#2a3a4d`/`#1e2b3a`/`#3a4f66`; text `#e6edf5`, muted `#8fa3b8`; accent steel
`#5a85b8`; gold `#d4a017` (muted). Spillman chrome: group-head dark steel gradient,
field `#101a26`.

**Day — light grey Spillman (Records look generalized):**
chrome `#d6d3c8`, form `#ece9dd`, field `#f7f9fb`, white `#ffffff`; borders
`#9a958a`/`#c3cdd8`; text `#1a1a1a`, muted `#555555`; accent steel `#2e4a66`, select
`#316ac5`; gold `#d4a017` (status).

Both reference the **same semantic var names**; toggling swaps values.

### 3. Records chrome reconciliation
Rewrite `client/src/styles/spillman.css` so its hardcoded light hex becomes the shared
`--spm-*` vars, and promote those vars from `.spillman-theme` scope to
`html.theme-day` / `html.theme-night` (with day = current light values, night = dark
steel-blue equivalents). Concretely: the Records `.spillman-theme` wrapper class is
**removed** from `RecordsPage`, and its CSS rules either (a) fold into the global
`html.theme-*` definitions where they restyle shared components (e.g. the
`CollapsibleSection` group-box), or (b) keep their existing Records-only selectors but
swap every hardcoded hex for a `--spm-*` var. Records then follows day/night like every
page, with no separate wrapper to maintain.

### 4. Theme engine (`theme.ts` + a small React provider/hook)
- Keep `html.theme-*` class + `rmpg_theme_preference` persistence; internal values stay
  `'dark'`/`'light'` to avoid churn across existing consumers (`radio`,
  `DocumentWriter`). **UI labels say "Night"/"Day".** A normalize maps legacy values.
- `resolveScheduledTheme(now, { nightStart, dayStart, tz })` — **pure, unit-tested**;
  handles midnight wrap and boundary equality. Default night 18:00, day 06:00,
  America/Denver.
- **Manual override** stored separately (`rmpg_theme_override` = `{theme, untilBoundaryTs}`);
  override wins until the next scheduled boundary, then auto resumes. Pure
  `resolveEffectiveTheme(now, schedule, override)`.
- A periodic tick (e.g. every 60s, plus on focus/visibility) re-evaluates and applies.
- **Default = night.**

### 5. Theme toggle UI
A compact Day/Night control in the app header + a Settings entry, showing current mode
and whether it is auto or manually overridden, with a "back to auto" affordance. Extends
the existing toggle plumbing.

### 6. Tactical force-dark (`.tactical-dark`)
A class that **locally re-declares the night-palette vars** and `color-scheme: dark` on
its subtree, independent of `html.theme-*`. Applied to the live Map container, dashcam/
body-cam HUD overlays, and the in-vehicle MDT view. Because tokens are now vars, this is
a clean local override. (Default is night, so these are already dark by default; the
override only matters in day theme.)

## Phase 1 deliverables (this spec/plan)
- Var-backed token refactor + both palettes on `html.theme-night`/`html.theme-day`.
- Records `spillman.css` reconciled to theme vars (no blinding-white Records at night).
- Theme engine: schedule + manual override + periodic re-eval, default night.
- Day/Night toggle UI (header + settings).
- `.tactical-dark` applied to Map / dashcam-HUD / MDT.
- App-wide default becomes **dark steel-blue Spillman**; day mode works.
- **Hex-coverage audit script** (see Safeguards) + its baseline report committed.

## Explicitly deferred
- **Phase 2** — light-mode polish sweep: components whose hardcoded hex doesn't re-theme
  (sized by the audit), fixed per page. Own spec/plan.
- **Phase 3** — "no misconfigurations" QA sweep: systematic both-themes verification
  across every route + contrast pass. Own spec/plan.

---

## Safeguards & rollback (operator mandate: error-free transition)

Each risk has a concrete, testable safeguard. These are **requirements**, not nice-to-haves.

| # | Risk | Safeguard |
|---|------|-----------|
| S1 | A component's hardcoded hex won't re-theme → looks wrong in one mode | **Automated audit script** `scripts/theme-hex-audit.mjs` that scans `client/src/**` for raw hex in color contexts and emits a coverage report; baseline committed. A CI check warns when a PR *adds* raw hex to color props. Phase 3 sweeps both themes per route. |
| S2 | The token refactor changes the default look unexpectedly / contrast regressions | **Kill-switch**: a `theme-legacy-black` class + a localStorage escape hatch (`rmpg_theme_legacy=1`) that restores the pre-refactor pure-black palette instantly in prod if anything looks wrong. **WCAG contrast check** on both palettes for text/border pairs as a unit test. |
| S3 | Var-backed Tailwind colors break the `/alpha` opacity modifier or some utilities | The `surface-*` tokens already use this exact pattern in prod — proven. Add a vitest/Storybook-free **render smoke check** asserting representative `bg-*/NN` utilities resolve. Build gate. |
| S4 | Theme flash (FOUC) — wrong theme painted before JS runs | **Inline pre-paint bootstrap** in `client/index.html` `<head>` that synchronously reads stored pref + schedule and sets `html.theme-*` before first paint. `bootstrapThemePreference()` reused. |
| S5 | Tactical force-dark fails → blinding map/HUD at night in day theme | `.tactical-dark` is self-contained (re-declares all vars + `color-scheme`). **Explicit day-theme verification** on Map/HUD/MDT in Phase 1 acceptance. Default night means the failure window is day-theme only. |
| S6 | Auto-schedule edge cases (midnight wrap, boundary, DST, override expiry) | `resolveScheduledTheme` / `resolveEffectiveTheme` are **pure functions with exhaustive unit tests** (pre-night, post-night, exact boundary, midnight wrap, override-active, override-expired, DST day). America/Denver via a tz-safe hour computation. |
| S7 | Existing users' stored `'dark'`/`'light'` preference semantics shift | Storage values kept (`'dark'`→night, `'light'`→day); `normalizeThemePreference` handles legacy + unknown → night. Documented; no destructive migration. |
| S8 | Native (Capacitor) status bar / chrome mismatch in **day** (light) theme | Update `syncNativeStatusBar` + `theme-color`/`apple-status-bar` meta to flip to **dark icons on light chrome** for day, light icons for night. Currently hard-pinned dark — fix as part of engine. |
| S9 | Huge blast radius / unreviewable | **Isolated worktree** (done) + **subagent-driven execution with two-stage review per task** + incremental commits + PR review gate. Token refactor isolated to config+CSS (component code untouched). |
| S10 | Build/typecheck break across 122 pages | Refactor is **config + CSS only** (no TS API surface change). Gates per task: `tsc --noEmit` + full `vitest run` + `vite build`. |
| S11 | SW cache serves stale CSS → half-themed app | **SW `CACHE_NAME` bump**; `_headers` no-store on `/sw.js` already prevents the per-colo reload loop (verified prior). |
| S12 | Main moved / concurrent sessions clobber work | Branch is fresh off **latest** `origin/main`; rebase before push; **verify main compiles after merge** (squash-merge hunk-drop hazard). All file-mutating work in the isolated worktree, never the shared main tree. |
| S13 | Partial rollout leaves app in a mixed/broken state mid-PR | Phase 1 is **atomic per PR**: the refactor + both palettes + engine land together; the app is never shipped with tokens var-backed but palettes undefined. Each task commits a working tree; the PR is the integration gate. |

**Rollback plan:** if a regression reaches prod, (a) flip the `rmpg_theme_legacy` escape
hatch (S2) for instant pure-black restore without a deploy, and/or (b) revert the PR
merge commit (single squashed commit) and re-deploy. Because the change is
config+CSS+engine (no schema, no API, no data), revert is clean and total.

## Testing / verification (Phase 1 acceptance)
- `tsc --noEmit` clean; full `vitest run` green (incl. new engine + contrast tests);
  `vite build` clean.
- Engine unit tests: schedule/override/midnight/DST/legacy-normalize (S6, S7).
- Contrast unit test on both palettes (S2).
- Manual acceptance (browser): default loads **night steel-blue** app-wide with no FOUC;
  toggle to **day grey** re-themes every primary route (Dashboard, Dispatch, Records,
  Reports, Admin); Map/HUD/MDT **stay dark in day** (S5); native status bar correct both
  ways (S8).
- SW `CACHE_NAME` bumped (S11). Ships via PR off latest `origin/main` (S12).

## Out of scope (Phase 1)
- Per-page hardcoded-hex fixes beyond Records reconciliation (Phase 2).
- Full route-by-route both-theme QA matrix (Phase 3).
- Any API/D1/Worker change. This is client presentation + theme engine only.
