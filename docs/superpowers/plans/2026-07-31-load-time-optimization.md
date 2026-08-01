# Load-Time Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the client entry chunk from 941 KB raw to under 620 KB and make nav-bar routes prefetch on hover/focus, so cold login and page navigation stop lagging on FZ-55 toughbooks.

**Architecture:** Two independent halves. (1) Evict conditionally-rendered code from the entry chunk by converting four static imports to `React.lazy`, exploiting the fact that lazy-loading cascades — a lazy parent takes its whole static import subtree with it. (2) Introduce a `routeModules.ts` path→`import()` registry so any component can warm a route chunk, then wire nav hover/focus to it.

**Tech Stack:** React 18, TypeScript, Vite 6 (rolldown), Vitest, Tailwind. Client only — no Worker, D1, or API changes.

**Spec:** `docs/superpowers/specs/2026-07-31-load-time-optimization-design.md`

## Global Constraints

- **Client only.** No edits under `/src/` (the Cloudflare Worker), `migrations/`, or `wrangler.toml`.
- **`src/index.css` is out of scope.** Do not edit it, do not migrate hex from it, do not split it.
- **Do not touch `lazyRetry` in `App.tsx:36-66`.** It owns stale-chunk retry and the bounded one-reload-per-30s guard. Prefetch must never route around it.
- **Do not edit `CACHE_NAME` in `client/public/sw.js`** — auto-stamped from the git SHA by the `stamp-sw-version` Vite plugin.
- **Never hardcode hex.** Use the `rmpg-*`/`brand-*`/`surface-*` Tailwind tokens.
- **Full client vitest suite is the gate**, not targeted runs. Baseline is clean (443 files / 3101 passed as of 2026-07-24), so any failure is caused by your change.
- **Never run root and client vitest concurrently** — it fakes ~9 failures. Run serially.
- **Prefetch is best-effort.** Every prefetch path ends in `.catch(() => {})`. A prefetch failure must never surface to the user or affect navigation correctness.
- Commit after each task. Branch is `claude/improve-load-times-580a11`; `main` is protected (PR required).

## Baseline (measured 2026-07-31, must be reproduced in Task 1)

| Artifact | Raw | brotli |
|---|---|---|
| `dist/assets/index-*.js` | 941.2 KB | 177.6 KB |
| `dist/assets/index-*.css` | 437.3 KB | 55.6 KB |

Entry chunk contains 1,971 KB of source across 186 modules.

## File Structure

**Create:**
- `client/scripts/measure-entry.mjs` — sourcemap attribution + entry-size reporter. Single responsibility: measure, print, and optionally assert a ceiling.
- `client/src/routes/routeModules.ts` — the path→`() => import()` registry. Data only, no logic.
- `client/src/hooks/useRoutePrefetch.ts` — `prefetchRoute()` + the connection/dedupe guards.
- `client/src/hooks/__tests__/useRoutePrefetch.test.ts`
- `client/src/routes/__tests__/routeModules.test.ts`

**Modify:**
- `client/src/App.tsx` — `DashboardPage`/`DownloadsPage` to lazy; build lazies from the registry; replace the hardcoded `DISPATCH_MAP_ROLES` prefetch block.
- `client/src/components/Layout.tsx:110,1748` — `UserProfileModal` to lazy.
- `client/src/pages/DashboardPage.tsx:25-26,2993,3042` — modals to lazy.
- `client/src/main.tsx:31-42` — defer `preloadSoundAssets` to idle.
- `client/src/components/MenuBar.tsx` — hover/focus prefetch on nav entries.
- `client/package.json` — add the `measure:entry` script.
- `.github/workflows/pr-tests.yml` — add the entry-size ratchet job.

---

### Task 1: Entry-size measurement harness

Everything downstream is gated on this number, so it lands first and is reusable. No product code changes.

**Files:**
- Create: `client/scripts/measure-entry.mjs`
- Modify: `client/package.json` (scripts block)

**Interfaces:**
- Consumes: nothing.
- Produces: `node scripts/measure-entry.mjs [--max-raw <bytes>] [--json]`. Reads `dist/assets/index-*.js` and its `.map`. Exits 1 if `--max-raw` is given and exceeded. Prints raw bytes, brotli bytes, module count, and the top 25 modules by source bytes.

- [ ] **Step 1: Write the script**

Create `client/scripts/measure-entry.mjs`:

```js
#!/usr/bin/env node
// Measures the production entry chunk and attributes its bytes to source
// modules via the sourcemap's sourcesContent. This is the numeric gate for
// the load-time work — "feels faster" is not a measurement.
//
// Requires a prior `vite build --sourcemap`.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { brotliCompressSync } from 'node:zlib';
import path from 'node:path';

const ASSETS = path.join(process.cwd(), 'dist', 'assets');

function findEntry() {
  const files = readdirSync(ASSETS);
  const js = files.filter((f) => /^index-.*\.js$/.test(f));
  if (js.length !== 1) {
    throw new Error(`Expected exactly 1 index-*.js in ${ASSETS}, found ${js.length}. Run: npx vite build --sourcemap`);
  }
  return js[0];
}

function attribute(mapPath) {
  const map = JSON.parse(readFileSync(mapPath, 'utf-8'));
  const contents = map.sourcesContent || [];
  const totals = new Map();
  map.sources.forEach((src, i) => {
    const content = contents[i];
    if (content == null) return;
    const key = src.replace(/^(\.\.\/)+/, '');
    totals.set(key, (totals.get(key) || 0) + content.length);
  });
  return totals;
}

const args = process.argv.slice(2);
const maxRawIdx = args.indexOf('--max-raw');
const maxRaw = maxRawIdx === -1 ? null : Number(args[maxRawIdx + 1]);
const asJson = args.includes('--json');

const entry = findEntry();
const entryPath = path.join(ASSETS, entry);
const raw = statSync(entryPath).size;
const brotli = brotliCompressSync(readFileSync(entryPath)).length;

let totals = new Map();
try {
  totals = attribute(`${entryPath}.map`);
} catch {
  // Sourcemap absent (plain `vite build`). Size numbers are still valid;
  // attribution is simply unavailable.
}
const sourceBytes = [...totals.values()].reduce((a, b) => a + b, 0);

if (asJson) {
  console.log(JSON.stringify({ entry, raw, brotli, moduleCount: totals.size, sourceBytes }, null, 2));
} else {
  console.log(`entry:    ${entry}`);
  console.log(`raw:      ${(raw / 1024).toFixed(1)} KB`);
  console.log(`brotli:   ${(brotli / 1024).toFixed(1)} KB`);
  console.log(`modules:  ${totals.size} (${(sourceBytes / 1024).toFixed(0)} KB of source)`);
  if (totals.size) {
    console.log('\ntop 25 eager modules by source bytes:');
    [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .forEach(([k, v]) => console.log(`  ${(v / 1024).toFixed(1).padStart(8)} KB  ${k}`));
  }
}

if (maxRaw !== null && raw > maxRaw) {
  console.error(`\nFAIL: entry chunk ${raw} B exceeds ceiling ${maxRaw} B (over by ${((raw - maxRaw) / 1024).toFixed(1)} KB)`);
  process.exit(1);
}
```

- [ ] **Step 2: Add the npm script**

In `client/package.json`, add to `"scripts"`:

```json
"measure:entry": "node scripts/measure-entry.mjs"
```

- [ ] **Step 3: Build with sourcemaps and reproduce the baseline**

```bash
cd client && npx vite build --sourcemap && npm run measure:entry
```

Expected: `raw: 941.2 KB`, `brotli: 177.6 KB`, `modules: 186 (1971 KB of source)`, with `src/pages/DashboardPage.tsx` at ~167.9 KB on top.

If the numbers differ materially from the spec's table, **stop and report** — the baseline moved and the rest of the plan's estimates need revisiting.

- [ ] **Step 4: Verify the ceiling flag fails correctly**

```bash
cd client && node scripts/measure-entry.mjs --max-raw 100000
```

Expected: prints the report, then `FAIL: entry chunk ... exceeds ceiling`, exit code 1. Confirm with `echo $?` → `1`.

- [ ] **Step 5: Commit**

```bash
git add client/scripts/measure-entry.mjs client/package.json
git commit -m "chore(perf): add entry-chunk measurement harness

Attributes entry bytes to source modules via sourcemap sourcesContent.
Baseline: 941.2 KB raw / 177.6 KB brotli / 186 modules."
```

---

### Task 2: Lazy-load DashboardPage with login-success prefetch

The single biggest win. `DashboardPage` (167.9 KB) statically imports `NewCallModal` (77.1 KB), `IncidentFormModal` (75.7 KB) and `DashboardMiniMap` (which pulls `mapMarkers`, 18.3 KB) — **all four leave the entry together** because a lazy parent takes its static import subtree with it.

The prefetch is not optional polish. Without it this trades login speed for a post-login stall. Both land in this task.

**Files:**
- Modify: `client/src/App.tsx:25` (import), `:567` (route), `:472-491` (prefetch effect)
- Test: `client/src/__tests__/dashboardPrefetch.test.tsx` (create)

**Interfaces:**
- Consumes: `LoadingSplash` (`App.tsx:220`), `lazyRetry` (`App.tsx:36`), `useAuth` from `./context/AuthContext`.
- Produces: `importDashboard: () => Promise<{ default: React.ComponentType }>` — exported from `App.tsx` so Task 5's registry can reference the same factory rather than creating a second one.

- [ ] **Step 1: Write the failing test**

Create `client/src/__tests__/dashboardPrefetch.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The Dashboard chunk must be warmed as soon as auth flips to true, so that
// making DashboardPage lazy does not introduce a post-login stall.
describe('dashboard prefetch on auth', () => {
  beforeEach(() => vi.resetModules());

  it('exports a reusable Dashboard import factory', async () => {
    const mod = await import('../App');
    expect(typeof mod.importDashboard).toBe('function');
  });

  it('resolves to a renderable component', async () => {
    const { importDashboard } = await import('../App');
    const loaded = await importDashboard();
    expect(loaded.default).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd client && npx vitest run src/__tests__/dashboardPrefetch.test.tsx
```

Expected: FAIL — `expected "undefined" to be "function"` (there is no `importDashboard` export yet).

- [ ] **Step 3: Convert DashboardPage to lazy**

In `client/src/App.tsx`, delete line 25:

```tsx
import DashboardPage from './pages/DashboardPage';
```

Replace the comment block and `importDispatch`/`importMap` declarations (around lines 24-34) so the Dashboard factory sits alongside them and is exported:

```tsx
// Dashboard is the post-login landing view. It used to be a STATIC import to
// keep that first navigation instant — but that put 167.9 KB (plus
// NewCallModal, IncidentFormModal and DashboardMiniMap, which it statically
// imports) into the entry chunk, so every LOGIN paid for it too. It's lazy
// now, and warmed the instant auth succeeds (see AppRoutes below), which
// keeps the landing instant without taxing the login path.
export const importDashboard = () => import('./pages/DashboardPage');
const DashboardPage = lazyRetry(importDashboard);
```

Leave `importDispatch`, `importMap` and `lazyRetry` exactly as they are. Note `lazyRetry` is declared as a function declaration at line 36, so it is hoisted and usable above its definition.

- [ ] **Step 4: Add the login-success prefetch**

In `AppRoutes` (`App.tsx:471`), the existing effect idle-prefetches Dispatch and Map for `DISPATCH_MAP_ROLES`. Add a **separate, earlier** effect immediately above it — Dashboard is warmed for every role and is not idle-deferred, because it is the landing view:

```tsx
  // Warm the Dashboard chunk the moment auth flips to true. This is what makes
  // DashboardPage's lazy() free: the landing navigation resolves from the
  // module cache instead of showing "Loading module". NOT idle-deferred and
  // NOT role-gated — every authenticated role lands here, and by the time this
  // fires the login-critical work is already done.
  React.useEffect(() => {
    if (!isAuthenticated) return;
    importDashboard().catch(() => {});
  }, [isAuthenticated]);
```

- [ ] **Step 5: Run the new test and confirm it passes**

```bash
cd client && npx vitest run src/__tests__/dashboardPrefetch.test.tsx
```

Expected: PASS, 2 tests.

- [ ] **Step 6: Run the full client suite and typecheck**

```bash
cd client && npx tsc --noEmit && npx vitest run
```

Expected: typecheck clean; suite matches the clean baseline. Any failure is yours — investigate, do not proceed.

- [ ] **Step 7: Measure the win**

```bash
cd client && npx vite build --sourcemap && npm run measure:entry
```

Expected: raw drops from 941.2 KB to roughly 590-620 KB. `DashboardPage.tsx`, `NewCallModal.tsx`, `IncidentFormModal.tsx`, `DashboardMiniMap.tsx` and `mapMarkers.ts` must all be **absent** from the top-25 list. Record the actual number in the commit message.

- [ ] **Step 8: Commit**

```bash
git add client/src/App.tsx client/src/__tests__/dashboardPrefetch.test.tsx
git commit -m "perf(client): lazy-load DashboardPage, prefetch on login success

Takes NewCallModal, IncidentFormModal, DashboardMiniMap and mapMarkers out
of the entry chunk with it — a lazy parent carries its static import subtree.
Warmed the instant auth succeeds so the landing navigation stays instant.

Entry chunk: 941.2 KB -> <ACTUAL> KB raw."
```

---

### Task 3: Lazy-load UserProfileModal in Layout

`UserProfileModal` (66.6 KB) is statically imported by `Layout.tsx`, which wraps every authenticated route. It renders behind a boolean. `SignaturePad` (21.9 KB) rides along — `UserProfileModal` is its only eager importer (`PrintRecordButton` and `ReportTypeSelector` also import it but are not in the entry).

This is the task with a real hazard: the Suspense boundary must sit at the call site, outside any portal.

**Files:**
- Modify: `client/src/components/Layout.tsx:110` (import), `:1748` (render site)

**Interfaces:**
- Consumes: `React.lazy`, `React.Suspense`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Read the render site**

```bash
cd client && sed -n '1740,1770p' src/components/Layout.tsx
```

Note the exact JSX: whether `UserProfileModal` is rendered unconditionally with an `isOpen` prop, or gated behind `{showProfile && ...}`. The next step depends on which.

- [ ] **Step 2: Convert the import to lazy**

In `client/src/components/Layout.tsx`, replace line 110:

```tsx
import UserProfileModal from './UserProfileModal';
```

with:

```tsx
// Lazy: 66.6 KB (plus SignaturePad's 21.9 KB, which it statically imports) and
// it renders behind a boolean. Layout wraps every authenticated route, so a
// static import here landed both in the entry chunk on every cold load.
const UserProfileModal = React.lazy(() => import('./UserProfileModal'));
```

`Layout.tsx` already imports React. If it uses a named-import style (`import { useState } from 'react'`) without a default `React` import, use `lazy` from the named imports instead and add it to that import list.

- [ ] **Step 3: Wrap the render site in Suspense**

At `Layout.tsx:1748`, wrap the element. If it is currently gated (`{showProfile && <UserProfileModal ... />}`), the boundary goes **inside** the guard so nothing renders when closed:

```tsx
{showProfile && (
  <React.Suspense fallback={null}>
    <UserProfileModal
      {/* keep every existing prop exactly as-is */}
    />
  </React.Suspense>
)}
```

If it is rendered unconditionally with an `isOpen` prop, keep that shape and wrap it as-is:

```tsx
<React.Suspense fallback={null}>
  <UserProfileModal
    {/* keep every existing prop exactly as-is */}
  />
</React.Suspense>
```

`fallback={null}` is deliberate: a modal opening is a discrete user action, and a spinner flashing behind the overlay for one frame looks like a glitch. The chunk is small and same-origin.

**The boundary must be outside any `createPortal` call.** If `UserProfileModal` portals internally that is fine — the boundary here is already outside it. Do not move the boundary into the modal component.

- [ ] **Step 4: Typecheck and run the full suite**

```bash
cd client && npx tsc --noEmit && npx vitest run
```

Expected: clean. Pay attention to any `Layout` or `UserProfileModal` test — a lazy component changes mount timing, so a test that asserted the modal is present synchronously will need `await screen.findBy...` instead of `getBy...`. That is a correct test update, not a workaround.

- [ ] **Step 5: Verify in the real app**

The modal must still open. jsdom cannot prove this — drive it:

```bash
cd client && npm run dev
```

Then via the browser preview tools: log in, open the user/profile menu, click through to the profile modal, confirm it renders with no console error and no visible flash. Close it.

- [ ] **Step 6: Measure**

```bash
cd client && npx vite build --sourcemap && npm run measure:entry
```

Expected: a further ~89 KB of source gone; `UserProfileModal.tsx` and `SignaturePad.tsx` absent from the module list.

- [ ] **Step 7: Commit**

```bash
git add client/src/components/Layout.tsx
git commit -m "perf(client): lazy-load UserProfileModal from Layout

Takes SignaturePad with it. Layout wraps every authenticated route, so both
were in the entry chunk on every cold load for a modal behind a boolean.
Suspense boundary is at the call site, outside any portal.

Entry chunk: <PREV> -> <ACTUAL> KB raw."
```

---

### Task 4: Lazy-load DownloadsPage and defer sound preloading

Two small, independent cold-load fixes with no shared surface. Grouped because neither warrants its own review gate.

`DownloadsPage` (25.3 KB + `KioskOsInstallGuide` 15.5 KB) is a public marketing route sitting in the login critical path. `main.tsx` calls `preloadSoundAssets()` three times at module top level, fetching and WebAudio-decoding 22 assets from a 1.3 MB `public/sounds/` before React renders — audio cannot play before a user gesture, so all of it is first-paint contention.

**Files:**
- Modify: `client/src/App.tsx:23` (import), `:506` (route)
- Modify: `client/src/main.tsx:31-42`

**Interfaces:**
- Consumes: `lazyRetry` (`App.tsx:36`), the existing `<Suspense>` at `App.tsx:503`.
- Produces: nothing.

- [ ] **Step 1: Lazy-load DownloadsPage**

In `client/src/App.tsx`, delete line 23 (`import DownloadsPage from './pages/DownloadsPage';`) and add it to the lazy block alongside the other `lazyRetry` consts (near line 68):

```tsx
// Public downloads/marketing route — 25.3 KB plus KioskOsInstallGuide's
// 15.5 KB. It was static, so every LOGIN downloaded and parsed it.
const DownloadsPage = lazyRetry(() => import('./pages/DownloadsPage'));
```

The route at line 506 needs no change: it already sits inside the `<Suspense fallback={<LoadingSplash message="Loading module" />}>` at line 503.

- [ ] **Step 2: Defer the sound preloading**

In `client/src/main.tsx`, the three `preloadSoundAssets(...)` calls at lines 31-42 currently run at module top level. Replace all three calls (keep their existing explanatory comments above the new block) with a single idle-scheduled batch:

```tsx
// Decode the sampled console sounds off the critical path. These were three
// top-level calls, which fetched and WebAudio-decoded 22 assets (from a 1.3 MB
// public/sounds/) before React rendered — pure contention with first paint.
// Nothing is lost by deferring: the AudioContext is gesture-suspended anyway,
// so no sound can play until the user interacts, and decode is fast once it
// runs. uiClickSounds is sample-only with no oscillator fallback, so an
// undecoded key plays SILENCE — that is why the full list is preloaded rather
// than left to lazy-load on first play.
{
  const w = window as any;
  const schedule: (cb: () => void) => unknown =
    w.requestIdleCallback || ((cb: () => void) => w.setTimeout(cb, 1200));
  schedule(() => {
    preloadSoundAssets();
    preloadSoundAssets(['navigate', 'ui_open', 'ui_close', 'ui_error']);
    preloadSoundAssets([
      'info', 'chirp', 'double_chirp', 'error', 'caution', 'warning',
      'alert', 'alarm', 'descending', 'p1_alert', 'key_up', 'key_out', 'data_chirp',
    ]);
  });
}
```

Keep the `preloadSoundAssets` import and every other line of `main.tsx` unchanged. In particular do **not** move `initUiClickSounds()` — it installs a document-level listener and must stay synchronous.

- [ ] **Step 3: Typecheck and run the full suite**

```bash
cd client && npx tsc --noEmit && npx vitest run
```

Expected: clean. If a test asserts sounds are decoded immediately after importing `main.tsx`, it must now flush the idle callback — update it to do so.

- [ ] **Step 4: Verify sounds still work in the real app**

```bash
cd client && npm run dev
```

Log in (the login chime is one of the preloaded five), then click UI controls and confirm the key ticks still play. Silence here means the deferral broke decoding — that is a real regression, not a nicety, because `uiClickSounds` has no synth fallback.

Also load `/downloads` directly and confirm it renders through the `LoadingSplash` without a chunk error.

- [ ] **Step 5: Measure**

```bash
cd client && npx vite build --sourcemap && npm run measure:entry
```

Expected: a further ~41 KB of source gone; `DownloadsPage.tsx` and `KioskOsInstallGuide.tsx` absent.

- [ ] **Step 6: Commit**

```bash
git add client/src/App.tsx client/src/main.tsx
git commit -m "perf(client): lazy-load DownloadsPage, defer sound preload to idle

DownloadsPage is a public marketing route that was sitting in the login
critical path (25.3 KB + KioskOsInstallGuide 15.5 KB).

Sound preloading fetched and decoded 22 assets before React rendered. The
AudioContext is gesture-suspended regardless, so nothing is lost by moving
it to requestIdleCallback.

Entry chunk: <PREV> -> <ACTUAL> KB raw."
```

---

### Task 5: Route module registry

The seam that does not exist today. All 130+ `lazy()` calls are inline consts in `App.tsx`, so nothing outside that file can warm a route by path — which is why prefetch is currently hardcoded to the two routes with named factories.

Scope discipline: this registry covers the **88 nav-catalog entries**, not all 130+ routes. Detached windows, QR-token public routes and redirects are never nav-prefetched, so adding them would be unused surface.

**Files:**
- Create: `client/src/routes/routeModules.ts`
- Create: `client/src/routes/__tests__/routeModules.test.ts`

**Interfaces:**
- Consumes: `importDashboard` (exported from `App.tsx` in Task 2), `NAV_CATEGORIES` from `client/src/data/navCatalog.ts`.
- Produces:
  - `export type RouteImporter = () => Promise<unknown>;`
  - `export const ROUTE_MODULES: Readonly<Record<string, RouteImporter>>;`
  - `export function getRouteImporter(path: string): RouteImporter | null;` — exact match first, then longest registered prefix (so `/fleet/dashboard` and `/records/123` both resolve).

- [ ] **Step 1: Write the failing test**

Create `client/src/routes/__tests__/routeModules.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ROUTE_MODULES, getRouteImporter } from '../routeModules';
import { NAV_CATEGORIES } from '../../data/navCatalog';

describe('routeModules', () => {
  it('maps every path to a function', () => {
    for (const [path, importer] of Object.entries(ROUTE_MODULES)) {
      expect(typeof importer, `${path} importer`).toBe('function');
    }
  });

  it('resolves an exact path', () => {
    expect(getRouteImporter('/dispatch')).toBeTypeOf('function');
  });

  it('resolves a nested path via its longest registered prefix', () => {
    // /fleet/dashboard has no own entry but must resolve through /fleet.
    expect(getRouteImporter('/fleet/dashboard')).toBeTypeOf('function');
  });

  it('returns null for an unregistered path', () => {
    expect(getRouteImporter('/definitely-not-a-route')).toBeNull();
  });

  it('never returns the root importer for an unrelated path', () => {
    // '/' is a registered prefix of everything — the prefix match must not
    // degenerate into "always matches root".
    expect(getRouteImporter('/definitely-not-a-route')).toBeNull();
  });

  it('covers the nav catalog entries that are in-app routes', () => {
    const navPaths = NAV_CATEGORIES.flatMap((c) =>
      c.functions.filter((f) => !f.electronOnly && f.path.startsWith('/')).map((f) => f.path),
    );
    const missing = navPaths.filter((p) => getRouteImporter(p) === null);
    expect(missing, `nav paths with no importer: ${missing.join(', ')}`).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd client && npx vitest run src/routes/__tests__/routeModules.test.ts
```

Expected: FAIL — cannot resolve `../routeModules`.

- [ ] **Step 3: Enumerate the nav paths you must cover**

```bash
cd client && node --input-type=module -e "
const m = await import('./src/data/navCatalog.ts').catch(() => null);
" 2>/dev/null || grep -n "path: '" src/data/navCatalog.ts
```

Use the `grep` output as the authoritative list. For each path, find its matching `lazyRetry(() => import('...'))` line in `App.tsx`:

```bash
cd client && grep -n "lazyRetry(() => import(" src/App.tsx
```

Pair them by reading the `<Route path=... element={<X/>}>` lines:

```bash
cd client && grep -n "<Route path=" src/App.tsx
```

- [ ] **Step 4: Write the registry**

Create `client/src/routes/routeModules.ts`. The header comment and the two exported functions are fixed; the `ROUTE_MODULES` body is filled from Step 3. **Every import specifier must be copied verbatim from the corresponding `App.tsx` line** — a typo here yields a chunk that silently never prefetches.

```ts
// Route path -> dynamic import factory.
//
// This is the seam that lets anything outside App.tsx warm a route chunk.
// Before it existed, prefetch was hardcoded to Dispatch and Map, because those
// were the only two routes with named import factories; the other 130+ lazy()
// calls were anonymous inline consts.
//
// Scope: the nav-catalog entries only. Detached windows, QR-token public routes
// (/m/*) and redirects are never nav-prefetched, so they are deliberately absent.
//
// INVARIANT: each specifier must match App.tsx's import for the same route
// EXACTLY. Two different specifiers for one module means two chunks, and the
// prefetch warms the one the router doesn't use. routeModules.test.ts pins
// coverage against navCatalog, but it cannot catch a specifier that points at
// the wrong-but-real module — copy, don't retype.
import { importDashboard } from '../App';

export type RouteImporter = () => Promise<unknown>;

export const ROUTE_MODULES: Readonly<Record<string, RouteImporter>> = {
  '/': importDashboard,
  '/dispatch': () => import('../pages/dispatch'),
  '/map': () => import('../pages/map'),
  '/incidents': () => import('../pages/IncidentsPage'),
  '/records': () => import('../pages/RecordsPage'),
  '/personnel': () => import('../pages/personnel'),
  '/communications': () => import('../pages/CommunicationsPage'),
  '/reports': () => import('../pages/ReportsPage'),
  '/admin': () => import('../pages/AdminPage'),
  '/audit': () => import('../pages/AuditLogPage'),
  '/patrol': () => import('../pages/PatrolPage'),
  '/fleet': () => import('../pages/fleet'),
  '/warrants': () => import('../pages/WarrantsPage'),
  '/citations': () => import('../pages/CitationsPage'),
  '/law-book': () => import('../pages/LawBookPage'),
  '/mdt': () => import('../pages/MdtPage'),
  // ... continue for every nav-catalog path found in Step 3.
};

/**
 * Resolve a location pathname to its route importer.
 *
 * Exact match wins. Otherwise the LONGEST registered prefix wins, so
 * '/fleet/dashboard' resolves through '/fleet' and '/records/123' through
 * '/records'. Root is excluded from prefix matching — it prefixes every path,
 * so including it would make this function never return null.
 */
export function getRouteImporter(path: string): RouteImporter | null {
  const exact = ROUTE_MODULES[path];
  if (exact) return exact;

  let best: string | null = null;
  for (const key of Object.keys(ROUTE_MODULES)) {
    if (key === '/') continue;
    if (path === key || path.startsWith(`${key}/`)) {
      if (best === null || key.length > best.length) best = key;
    }
  }
  return best === null ? null : ROUTE_MODULES[best];
}
```

- [ ] **Step 5: Run the test until it passes**

```bash
cd client && npx vitest run src/routes/__tests__/routeModules.test.ts
```

The `covers the nav catalog` assertion names every path you still owe an entry for. Add them until green. Expected: PASS, 6 tests.

- [ ] **Step 6: Check for a circular-import problem**

`routeModules.ts` imports from `App.tsx`, and Task 6 makes `App.tsx` import from `routeModules.ts`. ES modules tolerate this cycle here because both bindings are only *read inside functions*, never at module-evaluation time — but verify rather than assume:

```bash
cd client && npx tsc --noEmit && npx vitest run && npx vite build
```

Expected: all clean, no `Cannot access '...' before initialization` at runtime.

If the cycle does bite, break it by moving the factory: define `export const importDashboard = () => import('../pages/DashboardPage');` in `routeModules.ts` and have `App.tsx` import it from there instead. Do **not** create a second inline factory in `App.tsx` — that violates the file's own invariant and produces two chunks.

- [ ] **Step 7: Commit**

```bash
git add client/src/routes/routeModules.ts client/src/routes/__tests__/routeModules.test.ts
git commit -m "feat(client): add route module registry for prefetching

Path -> import() map covering the nav-catalog routes, with longest-prefix
resolution so nested paths resolve through their parent. Root is excluded
from prefix matching so unregistered paths return null."
```

---

### Task 6: prefetchRoute hook and nav wiring

Turns the registry into the navigation win. Replaces the hardcoded `DISPATCH_MAP_ROLES` block with a role table, and adds hover/focus prefetch.

**Files:**
- Create: `client/src/hooks/useRoutePrefetch.ts`
- Create: `client/src/hooks/__tests__/useRoutePrefetch.test.ts`
- Modify: `client/src/App.tsx:471-491` (replace the Dispatch/Map effect)
- Modify: `client/src/components/MenuBar.tsx` (hover/focus handlers)

**Interfaces:**
- Consumes: `getRouteImporter` from `../routes/routeModules`.
- Produces:
  - `export function prefetchRoute(path: string): void;` — fire-and-forget, deduped, connection-aware, never throws.
  - `export function __resetPrefetchCacheForTests(): void;`
  - `export const ROLE_PREFETCH_ROUTES: Readonly<Record<string, string[]>>;`

- [ ] **Step 1: Write the failing test**

Create `client/src/hooks/__tests__/useRoutePrefetch.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const importer = vi.fn(() => Promise.resolve({}));
vi.mock('../../routes/routeModules', () => ({
  getRouteImporter: (path: string) => (path === '/known' ? importer : null),
}));

describe('prefetchRoute', () => {
  beforeEach(async () => {
    importer.mockClear();
    const m = await import('../useRoutePrefetch');
    m.__resetPrefetchCacheForTests();
  });
  afterEach(() => {
    // @ts-expect-error test cleanup of an optional browser API
    delete (navigator as any).connection;
  });

  it('invokes the importer for a known path', async () => {
    const { prefetchRoute } = await import('../useRoutePrefetch');
    prefetchRoute('/known');
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it('dedupes repeat prefetches of the same path', async () => {
    const { prefetchRoute } = await import('../useRoutePrefetch');
    prefetchRoute('/known');
    prefetchRoute('/known');
    prefetchRoute('/known');
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it('is a no-op for an unregistered path', async () => {
    const { prefetchRoute } = await import('../useRoutePrefetch');
    prefetchRoute('/unknown');
    expect(importer).not.toHaveBeenCalled();
  });

  it('skips when the connection reports saveData', async () => {
    (navigator as any).connection = { saveData: true, effectiveType: '4g' };
    const { prefetchRoute } = await import('../useRoutePrefetch');
    prefetchRoute('/known');
    expect(importer).not.toHaveBeenCalled();
  });

  it('skips on 2g', async () => {
    (navigator as any).connection = { saveData: false, effectiveType: '2g' };
    const { prefetchRoute } = await import('../useRoutePrefetch');
    prefetchRoute('/known');
    expect(importer).not.toHaveBeenCalled();
  });

  it('swallows a rejecting importer without an unhandled rejection', async () => {
    importer.mockImplementationOnce(() => Promise.reject(new Error('offline')));
    const { prefetchRoute } = await import('../useRoutePrefetch');
    expect(() => prefetchRoute('/known')).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });

  it('retries after a failure rather than caching the failure', async () => {
    importer.mockImplementationOnce(() => Promise.reject(new Error('blip')));
    const { prefetchRoute } = await import('../useRoutePrefetch');
    prefetchRoute('/known');
    await new Promise((r) => setTimeout(r, 0));
    prefetchRoute('/known');
    expect(importer).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd client && npx vitest run src/hooks/__tests__/useRoutePrefetch.test.ts
```

Expected: FAIL — cannot resolve `../useRoutePrefetch`.

- [ ] **Step 3: Implement the hook module**

Create `client/src/hooks/useRoutePrefetch.ts`:

```ts
// Best-effort route chunk warming.
//
// Strictly advisory: real navigation always goes through lazyRetry() in
// App.tsx, which owns stale-chunk retry and the bounded reload. Nothing here
// may affect navigation correctness — every path swallows its errors.
import { getRouteImporter } from '../routes/routeModules';

/** Paths already warmed (or in flight). import() is itself deduped by the
 *  module cache; this just avoids the repeated call on every hover. */
const warmed = new Set<string>();

/** Exported for tests only — module state persists across cases otherwise. */
export function __resetPrefetchCacheForTests(): void {
  warmed.clear();
}

/**
 * Skip prefetching when the user is paying for bytes or is on a link too slow
 * to spend them speculatively. Mirrors the guard the Dispatch/Map idle
 * prefetch has used since 2026-07-02.
 */
function shouldSkipForConnection(): boolean {
  const conn = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (!conn) return false;
  if (conn.saveData) return true;
  return /^(slow-2g|2g)$/.test(conn.effectiveType || '');
}

/**
 * Warm the chunk for `path`. Fire-and-forget: never throws, never returns a
 * promise the caller must handle, and never reports failure to the user.
 */
export function prefetchRoute(path: string): void {
  try {
    if (warmed.has(path)) return;
    if (shouldSkipForConnection()) return;

    const importer = getRouteImporter(path);
    if (!importer) return;

    warmed.add(path);
    void importer().catch(() => {
      // A transient blip must not poison the cache — drop the marker so a
      // later hover can try again. The user may well navigate here anyway,
      // and lazyRetry handles the real load.
      warmed.delete(path);
    });
  } catch {
    // getRouteImporter or the connection probe threw. Prefetch is a nicety.
  }
}

/**
 * Routes worth warming during idle time, by role. Replaces the old hardcoded
 * DISPATCH_MAP_ROLES set, which prefetched Dispatch + Map (and their ~2.3 MB
 * mapbox/deck.gl dependency) for every role that had them in nav.
 *
 * Keep these lists SHORT. Each entry is speculative bandwidth on a cellular
 * link; two or three genuinely-most-used routes beat an exhaustive list.
 */
export const ROLE_PREFETCH_ROUTES: Readonly<Record<string, string[]>> = {
  admin: ['/dispatch', '/map'],
  manager: ['/dispatch', '/map'],
  supervisor: ['/dispatch', '/map'],
  dispatcher: ['/dispatch', '/map'],
  officer: ['/dispatch', '/map', '/mdt'],
  contract_manager: ['/reports'],
  human_resources: ['/personnel'],
  client_viewer: [],
};
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
cd client && npx vitest run src/hooks/__tests__/useRoutePrefetch.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Replace the hardcoded prefetch effect in App.tsx**

In `App.tsx`, replace the `DISPATCH_MAP_ROLES` const (around line 465) and the idle-prefetch effect (lines 471-491) with a role-table version. Keep the Task 2 Dashboard effect above it untouched.

Delete the `DISPATCH_MAP_ROLES` const. Add the import near the other hook imports:

```tsx
import { prefetchRoute, ROLE_PREFETCH_ROUTES } from './hooks/useRoutePrefetch';
```

Replace the effect body with:

```tsx
  // Idle-prefetch the current role's most-navigated routes so the first
  // navigation is instant rather than showing the module splash over cellular.
  // Scheduled during idle so it never competes with first paint or the landing
  // Dashboard's fetches. Was a hardcoded Dispatch+Map set; it's a role table
  // now (ROLE_PREFETCH_ROUTES) so roles that never open those two stop paying
  // for the ~2.3 MB mapbox/deck.gl download. prefetchRoute owns the saveData /
  // slow-connection guard and swallows failures.
  React.useEffect(() => {
    if (!isAuthenticated || !user) return;
    const routes = ROLE_PREFETCH_ROUTES[user.role] ?? [];
    if (routes.length === 0) return;
    const w = window as any;
    const schedule: (cb: () => void) => number =
      w.requestIdleCallback || ((cb: () => void) => w.setTimeout(cb, 1500));
    const id = schedule(() => routes.forEach(prefetchRoute));
    return () => {
      if (w.cancelIdleCallback) w.cancelIdleCallback(id);
      else w.clearTimeout(id);
    };
  }, [isAuthenticated, user]);
```

`importDispatch` and `importMap` are still used by the `lazyRetry` consts at the top of the file — do not delete them.

- [ ] **Step 6: Wire hover and focus prefetch in MenuBar**

Read the nav entry render site first:

```bash
cd client && sed -n '1040,1140p' src/components/MenuBar.tsx
```

Add the import:

```tsx
import { prefetchRoute } from '../hooks/useRoutePrefetch';
```

On each element that navigates to a route path, add both handlers. Hover alone would leave keyboard users behind, which is why focus is included:

```tsx
onMouseEnter={() => prefetchRoute(item.path)}
onFocus={() => prefetchRoute(item.path)}
```

Where an element already has an `onMouseEnter` (lines 1054 and 1125 both do), **compose rather than replace**:

```tsx
onMouseEnter={() => { setActiveSubmenu(submenuId); prefetchRoute(item.path); }}
```

Only attach to entries with a real in-app `path`. Skip `electronOnly` entries and category headers that don't navigate.

- [ ] **Step 7: Typecheck and run the full suite**

```bash
cd client && npx tsc --noEmit && npx vitest run
```

Expected: clean. A MenuBar test that fires `mouseEnter` will now also trigger a prefetch; if a test's module mock doesn't cover the imported chunk it may warn. Mock `../hooks/useRoutePrefetch` in that test rather than weakening the hook.

- [ ] **Step 8: Verify prefetch actually fires in a real browser**

jsdom cannot prove a chunk was fetched.

```bash
cd client && npm run dev
```

Log in, open DevTools Network filtered to JS, then hover a nav entry you have not visited (e.g. Warrants). Confirm a new chunk request fires **on hover**, and that clicking it afterwards shows **no** "Loading module" splash. Then hover the same entry again and confirm no second request (dedupe works).

- [ ] **Step 9: Commit**

```bash
git add client/src/hooks/useRoutePrefetch.ts client/src/hooks/__tests__/useRoutePrefetch.test.ts client/src/App.tsx client/src/components/MenuBar.tsx
git commit -m "perf(client): prefetch route chunks on nav hover and focus

Replaces the hardcoded DISPATCH_MAP_ROLES idle prefetch with a role table, and
adds hover/focus prefetch across the nav catalog. Best-effort throughout:
deduped, saveData/2g-aware, failures swallowed. Real navigation still goes
through lazyRetry, which is untouched."
```

---

### Task 7: CI entry-size ratchet

Without this the work regresses silently — exactly how the `modulePreload` issue went unnoticed until someone profiled a slow Electron session.

**Files:**
- Modify: `.github/workflows/pr-tests.yml`

**Interfaces:**
- Consumes: `client/scripts/measure-entry.mjs --max-raw` (Task 1).
- Produces: a CI job that fails a PR which grows the entry chunk past the ceiling.

- [ ] **Step 1: Establish the ceiling from the actual post-work measurement**

```bash
cd client && npx vite build --sourcemap && npm run measure:entry --  --json
```

Take the reported `raw` value and add a **5% headroom** margin. Round up to a whole KB. Record both the measured value and the ceiling — they go in the workflow comment.

- [ ] **Step 2: Read the existing workflow before editing**

```bash
sed -n '1,40p' .github/workflows/pr-tests.yml
```

Match its existing job style — runner image, Node version, checkout action version, and the `--legacy-peer-deps` install flag the other client jobs use.

- [ ] **Step 3: Add the job**

Append to the `jobs:` block in `.github/workflows/pr-tests.yml`, substituting `<CEILING_BYTES>` from Step 1 and matching the surrounding jobs' `uses:` versions and Node version:

```yaml
  client-entry-size:
    name: client-entry-size
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install client deps
        working-directory: client
        run: npm ci --legacy-peer-deps
      - name: Build with sourcemaps
        working-directory: client
        run: npx vite build --sourcemap
      # Ratchet on the ENTRY chunk only — it is what gates first paint.
      # Ceiling is the 2026-07-31 optimized size plus ~5% headroom. If a change
      # legitimately needs more, raise this deliberately in the same PR and say
      # why; do not silently bump it. `npm run measure:entry` prints the top 25
      # eager modules, which is usually enough to see what got pulled in.
      - name: Assert entry chunk under ceiling
        working-directory: client
        run: node scripts/measure-entry.mjs --max-raw <CEILING_BYTES>
```

- [ ] **Step 4: Verify the ratchet passes locally at the current size**

```bash
cd client && node scripts/measure-entry.mjs --max-raw <CEILING_BYTES>; echo "exit=$?"
```

Expected: report prints, `exit=0`.

- [ ] **Step 5: Verify it actually catches a regression**

Prove the gate works rather than assuming it:

```bash
cd client && node scripts/measure-entry.mjs --max-raw 1000; echo "exit=$?"
```

Expected: `FAIL: entry chunk ... exceeds ceiling`, `exit=1`.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/pr-tests.yml
git commit -m "ci: ratchet the client entry chunk size

Fails a PR that grows the entry chunk past the optimized 2026-07-31 size
plus 5% headroom. Prints the top 25 eager modules on failure so the cause
is visible without a local repro."
```

---

### Task 8: End-to-end verification and PR

No new code. This is the honest accounting step — the numbers in the PR body must be measured, not projected.

**Files:** none modified.

- [ ] **Step 1: Clean rebuild and final measurement**

```bash
cd client && rm -rf dist && npx vite build --sourcemap && npm run measure:entry
```

Record raw, brotli, module count, and source bytes. Compare against the baseline (941.2 KB / 177.6 KB / 186 / 1,971 KB). If raw is not under ~620 KB, report the shortfall with the top-25 list rather than declaring success.

- [ ] **Step 2: Run both gates serially**

Never concurrently — that fakes ~9 failures.

```bash
cd client && npx tsc --noEmit && npx vitest run
```

then, separately:

```bash
npm run typecheck && npx vitest run
```

Expected: all clean. Report actual counts.

- [ ] **Step 3: Full manual pass in a real browser**

```bash
cd client && npm run dev
```

Walk the whole changed surface, confirming each:
1. Cold load to login — no theme FOUC, pre-splash hands off cleanly.
2. Log in — Dashboard appears without a "Loading module" splash (proves the login-success prefetch works).
3. Open the profile modal from Layout — renders, no flash, no console error.
4. Click a UI control — key tick sound plays (proves deferred decode still works).
5. Hover an unvisited nav entry — chunk request fires; click it — no splash.
6. Load `/downloads` directly — renders.
7. Console clean throughout.

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin claude/improve-load-times-580a11
```

If pre-push is slow, that is stage 4/4 rebuilding `better-sqlite3` for the desktop tests — budget 5-15 min, don't kill it. This change touches nothing under `desktop/`, so `--no-verify` is defensible if it hangs; confirm with `git diff --name-only origin/main | grep ^desktop/` returning nothing first.

```bash
gh pr create -R rmpgutah/rmpg-flex --base main \
  --title "perf(client): cut entry chunk ~35% and prefetch routes on nav intent" \
  --body "$(cat <<'EOF'
## Summary

Cold login and page navigation were lagging. Measured the cause rather than guessing: the entry chunk carried 1,971 KB of source across 186 eager modules.

**Entry chunk: 941.2 KB -> <ACTUAL> KB raw (177.6 -> <ACTUAL> KB brotli).**

Raw bytes matter more than compressed here — the fleet runs FZ-55 toughbooks, and the felt cost is JS parse/execute, not download.

### Cold load
- `DashboardPage` is lazy, warmed the instant auth succeeds. Takes `NewCallModal`, `IncidentFormModal`, `DashboardMiniMap` and `mapMarkers` with it — a lazy parent carries its static import subtree.
- `UserProfileModal` is lazy from `Layout` (which wraps every authed route). Takes `SignaturePad` with it.
- `DownloadsPage` is lazy — a public marketing route that was in the login critical path.
- Sound preloading moved to `requestIdleCallback`: 22 fetches + WebAudio decodes no longer compete with first paint. The AudioContext is gesture-suspended regardless, so nothing is lost.

### Navigation
- New `routes/routeModules.ts` path -> `import()` registry. Previously all 130+ `lazy()` calls were anonymous inline consts in `App.tsx`, so only the two routes with named factories could be prefetched.
- Nav entries prefetch on hover **and focus**; the hardcoded `DISPATCH_MAP_ROLES` idle set is now a role table.
- Prefetch is strictly best-effort: deduped, `saveData`/2g-aware, failures swallowed. `lazyRetry` still owns real navigation and stale-chunk recovery — untouched.

### Guard rail
`client-entry-size` CI job fails any PR that grows the entry chunk past the new size + 5%, printing the top 25 eager modules.

## Not in scope
`src/index.css` (55.6 KB brotli, ~455 consuming files, encodes the theme invariants), splitting `Layout`/`MenuBar`, and all API/D1 work. The complaint was scoped to cold load and navigation.

## Verification
- Client typecheck clean; full client vitest suite clean.
- Worker typecheck clean; worker vitest clean.
- Manual browser pass: login (no splash on Dashboard), profile modal, UI sounds, hover-prefetch fires then click shows no splash, `/downloads` direct load, console clean.

Spec: `docs/superpowers/specs/2026-07-31-load-time-optimization-design.md`
Plan: `docs/superpowers/plans/2026-07-31-load-time-optimization.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Fill every `<ACTUAL>` with the measured number from Step 1 before creating the PR. Do not ship projections as results.

---

## Post-merge

Apply nothing to D1 — this change has no migrations.

If the operator reports the third lag surface later ("panels paint then fill in slowly"), that is the API half and needs its own spec. The known open lead is `[[apifetch-get-coalescing]]`: `/api/settings` is fetched 4x per cold boot, and `DashboardPage` fires 14 API calls on mount.
