# Desktop Tab Company Web Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a general-purpose, tabbed web browser ("Company Browser") to the Desktop tab, launched as a dedicated Electron `BrowserWindow` using `<webview>`, with an address bar, back/forward/reload, bookmarks, and history.

**Architecture:** A new top-level Electron `BrowserWindow` (not a `FloatingWindow`/iframe inside the Desktop shell) hosts a new React page (`CompanyBrowserPage.tsx`) that renders one `<webview>` per tab. `webviewTag: true` is scoped to only this window's webPreferences; every attached guest `<webview>` is re-hardened via a `will-attach-webview` handler. Bookmarks/history persist server-side through the existing `UserPreferences` mechanism; tabs are session-only.

**Tech Stack:** Electron (`desktop/`), Hono/D1 (`src/`), React + TypeScript + Vite (`client/`), vitest, Node's built-in `node:test` (desktop tests).

## Global Constraints

- Runtime: Electron desktop app only. The web SPA (non-Electron) shows a message instead of launching the browser.
- URL scope: open web browsing — any `http(s)` URL, no domain whitelist.
- v1 features: address bar + back/forward/reload, multiple tabs, bookmarks, history.
- Entry point: a new pinnable Desktop app icon in the nav catalog.
- `webviewTag: true` must be scoped to exactly one dedicated `BrowserWindow` — never the main app window's webPreferences.
- Every attached `<webview>` guest must be hardened via `will-attach-webview` (`nodeIntegration: false`, `contextIsolation: true`, no `plugins`, no `preload`) and restricted to `http:`/`https:` navigation only.
- Bookmarks/history persist via the existing `UserPreferences` PUT-preferences debounce pattern (`DesktopPage.tsx:105-122`), not a bespoke endpoint.
- Migration: run `ls migrations | tail` before naming the new file — the number in this plan (`0196`) is based on repo state as of 2026-07-20 and may already be stale by the time this task runs.

---

### Task 1: `user_preferences` schema — bookmarks + history columns

**Files:**
- Create: `migrations/0196_browser_bookmarks_history.sql` (confirm this is still the next free integer — see Global Constraints)
- Modify: `src/routes/stubs.ts:16-18` (`PREF_DEFAULTS`)
- Test: `tests/stubsPreferences.test.ts` (new — no existing test file covers `stubs.ts`'s preferences routes, so this creates the first one)

**Interfaces:**
- Produces: `user_preferences.browser_bookmarks_json` (TEXT, nullable), `user_preferences.browser_history_json` (TEXT, nullable) — both included in `PREF_DEFAULTS` (and therefore in every `GET /preferences` / `PUT /preferences` response) as `null` by default.

- [ ] **Step 1: Write the migration**

```sql
-- migrations/0196_browser_bookmarks_history.sql
ALTER TABLE user_preferences ADD COLUMN browser_bookmarks_json TEXT;
ALTER TABLE user_preferences ADD COLUMN browser_history_json TEXT;
```

- [ ] **Step 2: Apply it locally**

Run: `npm run migrate:local`
Expected: exits 0, no errors (D1 `ALTER TABLE ADD COLUMN` has no `IF NOT EXISTS`, but this is a fresh column name so a first local apply won't collide).

- [ ] **Step 3: Add the two keys to `PREF_DEFAULTS`**

In `src/routes/stubs.ts`, change:

```ts
  desktop_layout_json: null, desktop_wallpaper: 'blue-silver-default',
  desktop_widgets_json: null,
  desktop_accent: 'default', desktop_notes_json: null,
} as const;
```

to:

```ts
  desktop_layout_json: null, desktop_wallpaper: 'blue-silver-default',
  desktop_widgets_json: null,
  desktop_accent: 'default', desktop_notes_json: null,
  browser_bookmarks_json: null, browser_history_json: null,
} as const;
```

No other change is needed in `stubs.ts` — `PREF_COLUMNS` is derived from `Object.keys(PREF_DEFAULTS)`, and the `GET`/`PUT`/`reset` handlers already read/write generically off that set.

- [ ] **Step 4: Write the failing test**

```ts
// tests/stubsPreferences.test.ts
import { describe, it, expect } from 'vitest';
import stubs from '../src/routes/stubs';

function makeEnv(overrides: { userId?: number } = {}) {
  const rows = new Map<number, Record<string, unknown>>();
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first() {
              if (sql.includes('SELECT * FROM user_preferences')) {
                return rows.get(args[0] as number) ?? null;
              }
              return null;
            },
            async run() {
              if (sql.includes('INSERT OR IGNORE INTO user_preferences')) {
                const id = args[0] as number;
                if (!rows.has(id)) rows.set(id, { user_id: id });
              }
              if (sql.includes('UPDATE user_preferences SET')) {
                const id = args[args.length - 1] as number;
                const row = rows.get(id) ?? { user_id: id };
                const setPart = sql.split('SET ')[1].split(', updated_at')[0];
                const cols = setPart.split(', ').map((c) => c.split(' = ')[0].trim());
                cols.forEach((col, i) => { row[col] = args[i]; });
                rows.set(id, row);
              }
              return { success: true };
            },
          };
        },
      };
    },
  };
  return { DB: db, userId: overrides.userId ?? 1 };
}

describe('PUT /preferences — browser bookmarks/history', () => {
  it('round-trips browser_bookmarks_json and browser_history_json', async () => {
    const env = makeEnv();
    const bookmarks = JSON.stringify([{ id: 'b1', url: 'https://example.com', title: 'Example' }]);
    const history = JSON.stringify([{ url: 'https://example.com', title: 'Example', visitedAt: '2026-07-20T00:00:00Z' }]);

    const putReq = new Request('http://x/preferences', {
      method: 'PUT',
      body: JSON.stringify({ browser_bookmarks_json: bookmarks, browser_history_json: history }),
    });
    const putRes = await stubs.fetch(putReq, env, { get: () => env.userId } as never);
    expect(putRes.status).toBe(200);
    const putBody = await putRes.json() as { preferences: Record<string, unknown> };
    expect(putBody.preferences.browser_bookmarks_json).toBe(bookmarks);
    expect(putBody.preferences.browser_history_json).toBe(history);

    const getReq = new Request('http://x/preferences');
    const getRes = await stubs.fetch(getReq, env, { get: () => env.userId } as never);
    const getBody = await getRes.json() as Record<string, unknown>;
    expect(getBody.browser_bookmarks_json).toBe(bookmarks);
    expect(getBody.browser_history_json).toBe(history);
  });

  it('defaults both to null for a user with no saved row', async () => {
    const env = makeEnv({ userId: 999 });
    const req = new Request('http://x/preferences');
    const res = await stubs.fetch(req, env, { get: () => 999 } as never);
    const body = await res.json() as Record<string, unknown>;
    expect(body.browser_bookmarks_json).toBeNull();
    expect(body.browser_history_json).toBeNull();
  });
});
```

Note: if `stubs.fetch(req, env, executionCtxLike)` doesn't match how this Hono sub-app is actually invoked elsewhere in the test suite (check an existing route test, e.g. `tests/adminMapData.test.ts`, for the real calling convention with `c.get('userId')` — it's set by upstream auth middleware, not passed as a third `fetch` arg), adjust the test's request-construction to match that project's established pattern for exercising a Hono route with a mocked `userId`. Do not invent a new pattern if one already exists.

- [ ] **Step 5: Run test to verify it fails**

Run: `npx vitest run tests/stubsPreferences.test.ts`
Expected: FAIL — `browser_bookmarks_json`/`browser_history_json` are `undefined` (not yet in `PREF_DEFAULTS`) until Step 3 lands. If you're doing TDD strictly, do Step 4 before Step 3; either order is fine here since Step 3 is a one-line data change, not logic — just make sure the test fails first before the `PREF_DEFAULTS` edit exists in the same commit.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/stubsPreferences.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 7: Commit**

```bash
git add migrations/0196_browser_bookmarks_history.sql src/routes/stubs.ts tests/stubsPreferences.test.ts
git commit -m "feat(prefs): add browser bookmarks/history columns"
```

---

### Task 2: `desktop/security/webviewHardening.js` — pure guest-hardening functions

**Files:**
- Create: `desktop/security/webviewHardening.js`
- Test: `desktop/security/__tests__/webviewHardening.test.js`

**Interfaces:**
- Consumes: nothing (pure module, no Electron dependency — same pattern as `desktop/windowManager.js`).
- Produces:
  - `hardenGuestWebPreferences(webPreferences)` → returns a new webPreferences object with `nodeIntegration: false`, `contextIsolation: true`, `plugins: false`, `preload: undefined` forced, everything else from the input passed through.
  - `shouldAllowGuestNavigation(targetUrl)` → `boolean`. `true` only for parseable `http:`/`https:` URLs.

- [ ] **Step 1: Write the failing test**

```js
// desktop/security/__tests__/webviewHardening.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { hardenGuestWebPreferences, shouldAllowGuestNavigation } = require('../webviewHardening');

test('hardenGuestWebPreferences forces safe defaults regardless of input', () => {
  const result = hardenGuestWebPreferences({
    nodeIntegration: true,
    contextIsolation: false,
    plugins: true,
    preload: '/some/malicious/preload.js',
    partition: 'persist:tab-1',
  });
  assert.equal(result.nodeIntegration, false);
  assert.equal(result.contextIsolation, true);
  assert.equal(result.plugins, false);
  assert.equal(result.preload, undefined);
  assert.equal(result.partition, 'persist:tab-1'); // non-security fields pass through
});

test('hardenGuestWebPreferences works from an empty/undefined input', () => {
  const result = hardenGuestWebPreferences();
  assert.equal(result.nodeIntegration, false);
  assert.equal(result.contextIsolation, true);
  assert.equal(result.plugins, false);
});

test('shouldAllowGuestNavigation allows http(s)', () => {
  assert.equal(shouldAllowGuestNavigation('https://example.com'), true);
  assert.equal(shouldAllowGuestNavigation('http://example.com/path?q=1'), true);
});

test('shouldAllowGuestNavigation denies non-http(s) schemes', () => {
  assert.equal(shouldAllowGuestNavigation('file:///etc/passwd'), false);
  assert.equal(shouldAllowGuestNavigation('javascript:alert(1)'), false);
  assert.equal(shouldAllowGuestNavigation('chrome://settings'), false);
});

test('shouldAllowGuestNavigation denies unparseable input', () => {
  assert.equal(shouldAllowGuestNavigation('not a url'), false);
  assert.equal(shouldAllowGuestNavigation(''), false);
  assert.equal(shouldAllowGuestNavigation(undefined), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test 'desktop/security/__tests__/webviewHardening.test.js'`
Expected: FAIL — `Cannot find module '../webviewHardening'`

- [ ] **Step 3: Write the implementation**

```js
// desktop/security/webviewHardening.js
// ============================================================
// RMPG Flex — Webview Hardening
// Pure helpers used by main.js's Company Browser window to
// re-harden every guest <webview> attached inside it (via
// 'will-attach-webview') and to gate guest navigation to
// http(s) only. Kept dependency-free (no Electron import) so
// it can be unit-tested without booting Electron — same
// pattern as desktop/windowManager.js and
// desktop/security/sessionHardening.js's pure functions.
// ============================================================

'use strict';

/**
 * Forces every attached <webview> guest's webPreferences to the same
 * security floor as the rest of this app, regardless of what the hosting
 * page (CompanyBrowserPage.tsx) requested via the <webview> tag's own
 * attributes. A guest page has no legitimate reason to run with Node
 * integration, a disabled context isolation boundary, plugins, or a
 * preload script — all of which this app's main window already forbids
 * via hardenWebPreferencesDefaults(). Non-security fields (e.g.
 * `partition`, used to give each tab its own session/cookie jar) pass
 * through untouched.
 */
function hardenGuestWebPreferences(webPreferences) {
  const prefs = webPreferences || {};
  return {
    ...prefs,
    nodeIntegration: false,
    contextIsolation: true,
    plugins: false,
    preload: undefined,
  };
}

/**
 * Gate for guest <webview> navigation (both the initial load and any
 * later navigation within it). Only http(s) is ever allowed — a guest
 * page has no legitimate reason to navigate to file:, chrome:,
 * javascript:, or any other scheme from inside this sandboxed browser
 * tab. Mirrors shouldAllowNavigation's http(s)-only scheme check in
 * security/sessionHardening.js, but WITHOUT that function's same-host
 * restriction — the whole point of this feature is browsing to
 * arbitrary external hosts.
 */
function shouldAllowGuestNavigation(targetUrl) {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return false;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

module.exports = {
  hardenGuestWebPreferences,
  shouldAllowGuestNavigation,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test 'desktop/security/__tests__/webviewHardening.test.js'`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add desktop/security/webviewHardening.js desktop/security/__tests__/webviewHardening.test.js
git commit -m "feat(desktop): add webview guest-hardening helpers"
```

---

### Task 3: `desktop/main.js` + `desktop/preload.js` — Company Browser window

**Files:**
- Modify: `desktop/main.js` (add IPC handler near the existing `window:open-secondary` handler, `main.js:1015-1051`)
- Modify: `desktop/preload.js` (add `openCompanyBrowser`, near `openSecondaryWindow`)

**Interfaces:**
- Consumes: `hardenGuestWebPreferences`, `shouldAllowGuestNavigation` from Task 2 (`desktop/security/webviewHardening.js`); `buildSecondaryWindowUrl` from `desktop/windowManager.js`; `hardenWebPreferencesDefaults`, `resolveTrustedPreloadPath` from `desktop/security/sessionHardening.js`; `REMOTE_SERVER_URL`, `guardedHandle` already in scope in `main.js`.
- Produces: IPC channel `window:open-company-browser` (no args, returns `{ ok: true }` or `{ ok: false, error }`); renderer-facing `window.electron.openCompanyBrowser()` (returns a `Promise` resolving to that same shape).

This task has no isolated unit test of its own — `main.js`'s IPC wiring isn't covered by the existing `node --test` suite (it requires a running Electron main process), consistent with how `window:open-secondary` itself has no dedicated test either. Task 2's pure functions carry the tested logic; this task is manual-verified in Task 6.

- [ ] **Step 1: Add the IPC handler in `main.js`**

Add this import at the top of `desktop/main.js`, alongside the existing `require('./security/sessionHardening')` line:

```js
const { hardenGuestWebPreferences, shouldAllowGuestNavigation } = require('./security/webviewHardening');
```

Then, directly after the existing `guardedHandle('window:close-secondary', ...)` block (`main.js:1053-1055`), add:

```js
// Opens the Company Browser: a dedicated BrowserWindow with webviewTag
// enabled, used ONLY for this feature. webviewTag stays false on every
// other window this app creates (see hardenWebPreferencesDefaults) —
// this is the single, intentional, narrowly-scoped exception, which is
// why this handler builds its own webPreferences object rather than
// reusing assertWebPreferencesNotWeaker (that assertion would always
// fail here, since it exists specifically to catch an ACCIDENTAL
// weakening relative to the secure default, and enabling webviewTag is
// a deliberate one). Every guest <webview> opened inside this window is
// re-hardened individually via the 'will-attach-webview' handler below,
// which is what actually keeps this safe.
let companyBrowserWindow = null;
guardedHandle('window:open-company-browser', () => {
  if (companyBrowserWindow && !companyBrowserWindow.isDestroyed()) {
    companyBrowserWindow.focus();
    return { ok: true };
  }
  const built = buildSecondaryWindowUrl(REMOTE_SERVER_URL, '/desktop-company-browser');
  if (typeof built !== 'string') {
    return { ok: false, error: built && built.error ? built.error : 'invalid route' };
  }
  companyBrowserWindow = new BrowserWindow({
    width: 1200,
    height: 850,
    title: 'Company Browser — RMPG Flex',
    webPreferences: hardenWebPreferencesDefaults({
      webviewTag: true,
      preload: resolveTrustedPreloadPath(path.join(__dirname, 'preload.js'), path.join(__dirname, 'preload.js')),
    }),
  });
  companyBrowserWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    Object.assign(webPreferences, hardenGuestWebPreferences(webPreferences));
    if (!shouldAllowGuestNavigation(params.src)) {
      event.preventDefault();
    }
  });
  companyBrowserWindow.on('closed', () => { companyBrowserWindow = null; });
  companyBrowserWindow.loadURL(built).catch((err) => {
    console.warn('[APP] Company Browser loadURL failed:', err && err.message);
  });
  return { ok: true };
});
```

Note the `will-attach-webview` handler above governs the *initial* attach of each `<webview>` element (its first `src`). Per-tab in-page navigation after that is governed by each guest `webContents`' own `will-navigate`/`did-fail-load` events — those are wired inside `CompanyBrowserPage.tsx` itself (Task 5) via the `<webview>` element's DOM event listeners (`webview.addEventListener('will-navigate', ...)`), not from `main.js`, since that's where the per-tab UI state (address bar, back/forward enablement) lives anyway.

- [ ] **Step 2: Expose it from `preload.js`**

In `desktop/preload.js`, directly after the existing `closeSecondaryWindow` line, add:

```js
  // Opens the Company Browser — a dedicated window for general external
  // web browsing (vendor portals, county sites, etc.) via <webview>.
  // Electron-only; the web SPA build has no window.electron at all, so
  // callers must feature-detect (window.electron?.isElectron) before
  // calling this. See client/src/utils/windowManager.ts's
  // activateNavFunction for that gate.
  openCompanyBrowser: () => ipcRenderer.invoke('window:open-company-browser'),
```

- [ ] **Step 3: Sanity-check the diff compiles**

Run: `cd desktop && node -e "require('./main.js')" 2>&1 | head -20`
Expected: no `SyntaxError` or `Cannot find module` output (this will likely print other runtime errors from trying to boot outside a real Electron process and app-ready lifecycle — that's fine; you're only checking the `require` graph resolves and there's no syntax error before Electron's own APIs get touched).

- [ ] **Step 4: Commit**

```bash
git add desktop/main.js desktop/preload.js
git commit -m "feat(desktop): add Company Browser window + IPC handler"
```

---

### Task 4: Nav catalog entry + `activateNavFunction` electron-only launch

**Files:**
- Modify: `client/src/data/navCatalog.ts` (add `electronOnly` field to `NavFunction`, add the Company Browser entry)
- Modify: `client/src/utils/windowManager.ts` (`activateNavFunction`)
- Modify: `client/src/components/desktop/DesktopIconGrid.tsx:33` (wire the new handler)
- Modify: `client/src/components/desktop/DesktopTaskbar.tsx:85-91` (wire the new handler)
- Test: `client/src/utils/windowManager.test.ts` (new — add alongside whatever test file already exists for this util; if none exists, create it)

**Interfaces:**
- Consumes: nothing new from other tasks (independent of Tasks 1-3; only Task 3's `window.electron.openCompanyBrowser` is called at runtime, not at compile time).
- Produces: `NavFunction.electronOnly?: 'company-browser'`; `activateNavFunction(fn, handlers)` where `handlers` gains an optional `onElectronOnlyUnavailable?: (fn: NavFunction) => void`.

- [ ] **Step 1: Add the `electronOnly` field and the catalog entry**

In `client/src/data/navCatalog.ts`, change the `NavFunction` interface:

```ts
export interface NavFunction {
  path: string;
  label: string;
  icon: React.ElementType;
  shortcut?: string;
  description: string;
  adminOnly?: boolean;
  badgeKey?: string;
  /** In-desktop floating window size. Omit for the default 1050x800. */
  windowSize?: { width: number; height: number };
  /** Non-empty reason this page must NOT open in a floating desktop window (falls back to navigate()). */
  notWindowable?: string;
  /** This function launches an Electron-only feature via window.electron rather than an in-app route. Currently only 'company-browser'. */
  electronOnly?: 'company-browser';
}
```

Then add a new entry. Place it in the `ops` category (alongside Dispatch Console / Tactical Map — general-purpose staff tooling, not records-specific), right after the `/geography` entry:

```ts
      { path: '/geography', label: 'Dispatch Geography', icon: Map, description: 'Sector, zone, and beat boundary management for dispatch geography' },
      { path: '/desktop-company-browser', label: 'Company Browser', icon: Globe, description: 'General-purpose web browser for vendor portals, county sites, and research — desktop app only', notWindowable: 'Launches a dedicated Electron BrowserWindow via window.electron.openCompanyBrowser() instead of an in-app floating window or route navigation.', electronOnly: 'company-browser' },
```

(`Globe` is already imported at the top of `navCatalog.ts` — check the import list; if it isn't there, add it to the existing `lucide-react` import.)

- [ ] **Step 2: Write the failing test for `activateNavFunction`**

```ts
// client/src/utils/windowManager.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { activateNavFunction } from './windowManager';
import type { NavFunction } from '../data/navCatalog';
import { Globe } from 'lucide-react';

const COMPANY_BROWSER_FN: NavFunction = {
  path: '/desktop-company-browser',
  label: 'Company Browser',
  icon: Globe,
  description: 'test',
  notWindowable: 'test',
  electronOnly: 'company-browser',
};

describe('activateNavFunction — electronOnly', () => {
  const originalElectron = (window as any).electron;
  afterEach(() => { (window as any).electron = originalElectron; });

  it('calls window.electron.openCompanyBrowser when running in Electron', () => {
    const openCompanyBrowser = vi.fn().mockResolvedValue({ ok: true });
    (window as any).electron = { isElectron: true, openCompanyBrowser };
    const openWindow = vi.fn();
    const navigate = vi.fn();
    const onElectronOnlyUnavailable = vi.fn();

    activateNavFunction(COMPANY_BROWSER_FN, { openWindow, navigate, onElectronOnlyUnavailable });

    expect(openCompanyBrowser).toHaveBeenCalledTimes(1);
    expect(openWindow).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(onElectronOnlyUnavailable).not.toHaveBeenCalled();
  });

  it('calls onElectronOnlyUnavailable when NOT running in Electron', () => {
    (window as any).electron = undefined;
    const openWindow = vi.fn();
    const navigate = vi.fn();
    const onElectronOnlyUnavailable = vi.fn();

    activateNavFunction(COMPANY_BROWSER_FN, { openWindow, navigate, onElectronOnlyUnavailable });

    expect(onElectronOnlyUnavailable).toHaveBeenCalledWith(COMPANY_BROWSER_FN);
    expect(openWindow).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not throw when onElectronOnlyUnavailable is omitted and Electron is absent', () => {
    (window as any).electron = undefined;
    expect(() => activateNavFunction(COMPANY_BROWSER_FN, { openWindow: vi.fn(), navigate: vi.fn() })).not.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/windowManager.test.ts`
Expected: FAIL — `activateNavFunction` currently has no `electronOnly` branch, so it falls through to `handlers.navigate(fn.path)` for all three cases (since `getWindowConfig` returns `null` for a `notWindowable` entry), and `openCompanyBrowser`/`onElectronOnlyUnavailable` are never called.

- [ ] **Step 4: Implement the branch in `activateNavFunction`**

In `client/src/utils/windowManager.ts`, change:

```ts
export function activateNavFunction(
  fn: NavFunction,
  handlers: {
    openWindow: (path: string, title: string, size?: { width: number; height: number }) => void;
    navigate: (path: string) => void;
  },
): void {
  const config = getWindowConfig(fn);
  if (config) {
    handlers.openWindow(fn.path, config.title, { width: config.width, height: config.height });
  } else {
    handlers.navigate(fn.path);
  }
}
```

to:

```ts
export function activateNavFunction(
  fn: NavFunction,
  handlers: {
    openWindow: (path: string, title: string, size?: { width: number; height: number }) => void;
    navigate: (path: string) => void;
    /** Called instead of navigate() when fn.electronOnly is set and window.electron is unavailable/fails. */
    onElectronOnlyUnavailable?: (fn: NavFunction) => void;
  },
): void {
  if (fn.electronOnly === 'company-browser') {
    const electron = (window as any).electron;
    if (electron?.isElectron && typeof electron.openCompanyBrowser === 'function') {
      Promise.resolve(electron.openCompanyBrowser()).catch(() => handlers.onElectronOnlyUnavailable?.(fn));
    } else {
      handlers.onElectronOnlyUnavailable?.(fn);
    }
    return;
  }
  const config = getWindowConfig(fn);
  if (config) {
    handlers.openWindow(fn.path, config.title, { width: config.width, height: config.height });
  } else {
    handlers.navigate(fn.path);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/windowManager.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Wire the toast in `DesktopIconGrid.tsx`**

In `client/src/components/desktop/DesktopIconGrid.tsx`, add the toast import and hook, and pass `onElectronOnlyUnavailable`:

```ts
import { useToast } from '../ToastProvider';
```

```ts
  const { addToast } = useToast();

  const handleActivate = useCallback((fn: NavFunction) => {
    activateNavFunction(fn, {
      openWindow,
      navigate,
      onElectronOnlyUnavailable: () => addToast('Company Browser is available in the RMPG Flex desktop app', 'error'),
    });
  }, [navigate, openWindow, addToast]);
```

- [ ] **Step 7: Wire the toast in `DesktopTaskbar.tsx`**

In `client/src/components/desktop/DesktopTaskbar.tsx`, `handleSelectResult` already has `addToast` in scope (imported at the top). Change:

```ts
  const handleSelectResult = useCallback((fn: NavFunction) => {
    let capHit = false;
    activateNavFunction(fn, {
      navigate,
      openWindow: (path, title, size) => {
        if (!openWindow(path, title, size)) capHit = true;
      },
    });
    if (capHit) addToast('Close a window to open another', 'error');
    setLauncherOpen(false);
    setQuery('');
  }, [navigate, openWindow, addToast]);
```

to:

```ts
  const handleSelectResult = useCallback((fn: NavFunction) => {
    let capHit = false;
    activateNavFunction(fn, {
      navigate,
      openWindow: (path, title, size) => {
        if (!openWindow(path, title, size)) capHit = true;
      },
      onElectronOnlyUnavailable: () => addToast('Company Browser is available in the RMPG Flex desktop app', 'error'),
    });
    if (capHit) addToast('Close a window to open another', 'error');
    setLauncherOpen(false);
    setQuery('');
  }, [navigate, openWindow, addToast]);
```

- [ ] **Step 8: Run the full client test suite for touched files**

Run: `cd client && npx vitest run src/utils/windowManager.test.ts src/components/desktop/DesktopIconGrid.test.tsx src/components/desktop/DesktopTaskbar.test.tsx src/components/desktop/DesktopTaskbar.commandBar.test.tsx`
Expected: all PASS — confirm the existing `DesktopIconGrid`/`DesktopTaskbar` tests don't break from the added `useToast`/`addToast` wiring (they may need `ToastProvider` in their render wrapper if they don't already have it — check the existing test setup for how other components using `useToast` are wrapped, e.g. search for `ToastProvider` in `DesktopTaskbar.test.tsx`'s render helper).

- [ ] **Step 9: Commit**

```bash
git add client/src/data/navCatalog.ts client/src/utils/windowManager.ts client/src/utils/windowManager.test.ts client/src/components/desktop/DesktopIconGrid.tsx client/src/components/desktop/DesktopTaskbar.tsx
git commit -m "feat(desktop): add Company Browser nav entry + electron-only launch path"
```

---

### Task 5: `CompanyBrowserPage.tsx` — tabs, address bar, bookmarks, history

**Files:**
- Create: `client/src/pages/CompanyBrowserPage.tsx`
- Modify: `client/src/App.tsx` (register the route)
- Test: `client/src/pages/CompanyBrowserPage.test.tsx`

**Interfaces:**
- Consumes: `apiFetch` (`client/src/hooks/useApi.ts`) for reading/writing `browser_bookmarks_json`/`browser_history_json` (Task 1's columns).
- Produces: default export `CompanyBrowserPage`, mounted at `/desktop-company-browser`.

- [ ] **Step 1: Write the failing test**

`<webview>` doesn't render meaningfully in jsdom (no real navigation, no `did-navigate` events), so this test asserts on tab-management UI state and the props/attributes passed to each `<webview>` element, not real browsing behavior — consistent with how this plan's design doc scopes testing for this component.

```tsx
// client/src/pages/CompanyBrowserPage.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CompanyBrowserPage from './CompanyBrowserPage';

vi.mock('../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue({ browser_bookmarks_json: null, browser_history_json: null }),
}));

describe('CompanyBrowserPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('starts with one tab on the new-tab page', () => {
    render(<CompanyBrowserPage />);
    expect(screen.getAllByRole('tab')).toHaveLength(1);
  });

  it('opens a new tab on new-tab button click', () => {
    render(<CompanyBrowserPage />);
    fireEvent.click(screen.getByRole('button', { name: /new tab/i }));
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });

  it('closes a tab, keeping at least one open', () => {
    render(<CompanyBrowserPage />);
    fireEvent.click(screen.getByRole('button', { name: /new tab/i }));
    const closeButtons = screen.getAllByRole('button', { name: /close tab/i });
    fireEvent.click(closeButtons[0]);
    expect(screen.getAllByRole('tab')).toHaveLength(1);
  });

  it('navigates the active tab when the address bar is submitted, normalizing a bare domain to https', () => {
    render(<CompanyBrowserPage />);
    const addressBar = screen.getByRole('textbox', { name: /address/i });
    fireEvent.change(addressBar, { target: { value: 'example.com' } });
    fireEvent.submit(addressBar.closest('form')!);
    const webview = document.querySelector('webview');
    expect(webview?.getAttribute('src')).toBe('https://example.com');
  });

  it('adds and removes a bookmark for the active tab URL', () => {
    render(<CompanyBrowserPage />);
    const addressBar = screen.getByRole('textbox', { name: /address/i });
    fireEvent.change(addressBar, { target: { value: 'https://example.com' } });
    fireEvent.submit(addressBar.closest('form')!);

    fireEvent.click(screen.getByRole('button', { name: /add bookmark/i }));
    expect(screen.getByRole('link', { name: /example\.com/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /remove bookmark/i }));
    expect(screen.queryByRole('link', { name: /example\.com/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/CompanyBrowserPage.test.tsx`
Expected: FAIL — `Cannot find module './CompanyBrowserPage'`

- [ ] **Step 3: Implement `CompanyBrowserPage.tsx`**

```tsx
// client/src/pages/CompanyBrowserPage.tsx
// ============================================================
// RMPG Flex — Company Browser
// General-purpose external web browsing, rendered inside a
// dedicated Electron BrowserWindow (see desktop/main.js's
// 'window:open-company-browser' handler). Never rendered inside
// the main app window or a FloatingWindow iframe — <webview> is
// only enabled on this one window's webPreferences.
// ============================================================

import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, X, Plus, Star, Trash2, Clock } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';

interface BrowserTab {
  id: string;
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}

interface Bookmark {
  id: string;
  url: string;
  title: string;
}

interface HistoryEntry {
  url: string;
  title: string;
  visitedAt: string;
}

const NEW_TAB_URL = 'about:blank';
const MAX_HISTORY_ENTRIES = 200;
const BOOKMARKS_SAVE_DEBOUNCE_MS = 800;

function makeTabId(): string {
  return `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Bare domains ("example.com") get https:// prepended, like a real browser's address bar. Anything that already looks like a URL (has a scheme) passes through unchanged. */
function normalizeAddressInput(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') return NEW_TAB_URL;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function parseJsonArray<T>(raw: string | null | undefined): T[] {
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function CompanyBrowserPage() {
  const [tabs, setTabs] = useState<BrowserTab[]>(() => [{
    id: makeTabId(), url: NEW_TAB_URL, title: 'New Tab', canGoBack: false, canGoForward: false, loading: false,
  }]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].id);
  const [addressInput, setAddressInput] = useState('');
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const webviewRefs = useRef<Record<string, HTMLWebViewElement | null>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstLoad = useRef(true);

  const activeTab = useMemo(() => tabs.find(t => t.id === activeTabId) ?? tabs[0], [tabs, activeTabId]);

  useEffect(() => {
    setAddressInput(activeTab.url === NEW_TAB_URL ? '' : activeTab.url);
  }, [activeTab.id, activeTab.url]);

  useEffect(() => {
    apiFetch<{ browser_bookmarks_json: string | null; browser_history_json: string | null }>('/preferences')
      .then((prefs) => {
        setBookmarks(parseJsonArray<Bookmark>(prefs.browser_bookmarks_json));
        setHistory(parseJsonArray<HistoryEntry>(prefs.browser_history_json));
      })
      .catch(() => { /* start empty on failure — non-blocking, same tolerance as DesktopPage's preferences load */ });
  }, []);

  useEffect(() => {
    if (isFirstLoad.current) { isFirstLoad.current = false; return; }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      apiFetch('/preferences', {
        method: 'PUT',
        body: JSON.stringify({
          browser_bookmarks_json: JSON.stringify(bookmarks),
          browser_history_json: JSON.stringify(history),
        }),
      }).catch(() => { /* non-blocking — retried on next change, same pattern as DesktopPage */ });
    }, BOOKMARKS_SAVE_DEBOUNCE_MS);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [bookmarks, history]);

  const updateTab = useCallback((id: string, patch: Partial<BrowserTab>) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
  }, []);

  const recordHistory = useCallback((url: string, title: string) => {
    if (url === NEW_TAB_URL) return;
    setHistory(prev => [{ url, title, visitedAt: new Date().toISOString() }, ...prev].slice(0, MAX_HISTORY_ENTRIES));
  }, []);

  const navigateActiveTab = useCallback((rawUrl: string) => {
    const url = normalizeAddressInput(rawUrl);
    updateTab(activeTab.id, { url, loading: true });
  }, [activeTab.id, updateTab]);

  const handleAddressSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    navigateActiveTab(addressInput);
  }, [addressInput, navigateActiveTab]);

  const openNewTab = useCallback(() => {
    const tab: BrowserTab = { id: makeTabId(), url: NEW_TAB_URL, title: 'New Tab', canGoBack: false, canGoForward: false, loading: false };
    setTabs(prev => [...prev, tab]);
    setActiveTabId(tab.id);
  }, []);

  const closeTab = useCallback((id: string) => {
    setTabs(prev => {
      if (prev.length <= 1) return prev; // always keep at least one tab open
      const next = prev.filter(t => t.id !== id);
      if (id === activeTabId) setActiveTabId(next[next.length - 1].id);
      delete webviewRefs.current[id];
      return next;
    });
  }, [activeTabId]);

  const goBack = useCallback(() => webviewRefs.current[activeTab.id]?.goBack(), [activeTab.id]);
  const goForward = useCallback(() => webviewRefs.current[activeTab.id]?.goForward(), [activeTab.id]);
  const reload = useCallback(() => webviewRefs.current[activeTab.id]?.reload(), [activeTab.id]);

  const isBookmarked = bookmarks.some(b => b.url === activeTab.url);
  const toggleBookmark = useCallback(() => {
    if (isBookmarked) {
      setBookmarks(prev => prev.filter(b => b.url !== activeTab.url));
    } else {
      setBookmarks(prev => [...prev, { id: makeTabId(), url: activeTab.url, title: activeTab.title }]);
    }
  }, [isBookmarked, activeTab.url, activeTab.title]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--surface-base)' }}>
      <div role="tablist" className="flex items-center" style={{ background: 'var(--surface-overlay)', borderBottom: '1px solid var(--border-subtle)' }}>
        {tabs.map(tab => (
          <div
            key={tab.id}
            role="tab"
            aria-selected={tab.id === activeTabId}
            onClick={() => setActiveTabId(tab.id)}
            className="flex items-center gap-1 px-2 py-1 text-[11px] cursor-pointer"
            style={{
              maxWidth: 180, borderRight: '1px solid var(--border-subtle)',
              background: tab.id === activeTabId ? 'var(--surface-raised)' : 'transparent',
              color: 'var(--text-primary)',
            }}
          >
            <span className="truncate">{tab.title}</span>
            <button
              type="button"
              aria-label="Close tab"
              onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
            >
              <X className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
            </button>
          </div>
        ))}
        <button type="button" aria-label="New tab" onClick={openNewTab} className="p-1.5">
          <Plus className="w-3.5 h-3.5" style={{ color: 'var(--rmpg-400)' }} />
        </button>
      </div>

      <div className="flex items-center gap-1 px-2 py-1" style={{ background: 'var(--surface-overlay)', borderBottom: '1px solid var(--border-subtle)' }}>
        <button type="button" aria-label="Back" onClick={goBack} disabled={!activeTab.canGoBack} className="p-1">
          <ArrowLeft className="w-3.5 h-3.5" style={{ color: activeTab.canGoBack ? 'var(--rmpg-400)' : 'var(--text-muted)' }} />
        </button>
        <button type="button" aria-label="Forward" onClick={goForward} disabled={!activeTab.canGoForward} className="p-1">
          <ArrowRight className="w-3.5 h-3.5" style={{ color: activeTab.canGoForward ? 'var(--rmpg-400)' : 'var(--text-muted)' }} />
        </button>
        <button type="button" aria-label="Reload" onClick={reload} className="p-1">
          <RotateCw className="w-3.5 h-3.5" style={{ color: 'var(--rmpg-400)' }} />
        </button>
        <form onSubmit={handleAddressSubmit} className="flex-1">
          <input
            type="text"
            role="textbox"
            aria-label="Address"
            value={addressInput}
            onChange={(e) => setAddressInput(e.target.value)}
            placeholder="Enter a URL"
            className="w-full px-2 py-1 text-[11px]"
            style={{ background: 'var(--surface-base)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
          />
        </form>
        <button type="button" aria-label={isBookmarked ? 'Remove bookmark' : 'Add bookmark'} onClick={toggleBookmark} className="p-1">
          <Star className="w-3.5 h-3.5" fill={isBookmarked ? 'currentColor' : 'none'} style={{ color: 'var(--brand-gold)' }} />
        </button>
        <button type="button" aria-label="History" onClick={() => setHistoryOpen(o => !o)} className="p-1">
          <Clock className="w-3.5 h-3.5" style={{ color: 'var(--rmpg-400)' }} />
        </button>
      </div>

      {bookmarks.length > 0 && (
        <div className="flex items-center gap-3 px-2 py-1" style={{ background: 'var(--surface-overlay)', borderBottom: '1px solid var(--border-subtle)' }}>
          {bookmarks.map(b => (
            <a
              key={b.id}
              role="link"
              href="#"
              onClick={(e) => { e.preventDefault(); navigateActiveTab(b.url); }}
              className="text-[11px] truncate"
              style={{ color: 'var(--text-primary)', maxWidth: 160 }}
            >
              {b.title || b.url}
            </a>
          ))}
        </div>
      )}

      <div className="flex-1 relative">
        {tabs.map(tab => (
          <webview
            key={tab.id}
            ref={(el) => { webviewRefs.current[tab.id] = el; }}
            src={tab.url}
            style={{ position: 'absolute', inset: 0, display: tab.id === activeTabId ? 'block' : 'none' }}
            // eslint-disable-next-line react/no-unknown-property
            partition={`persist:company-browser-${tab.id}`}
          />
        ))}

        {historyOpen && (
          <div
            style={{
              position: 'absolute', top: 0, right: 0, bottom: 0, width: 280,
              background: 'var(--surface-raised)', borderLeft: '1px solid var(--border-strong)', overflowY: 'auto',
            }}
          >
            <div className="flex items-center justify-between px-2 py-1" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <span className="text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>History</span>
              <button type="button" aria-label="Clear history" onClick={() => setHistory([])}>
                <Trash2 className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>
            {history.map((h, i) => (
              <div
                key={`${h.url}_${h.visitedAt}_${i}`}
                onClick={() => navigateActiveTab(h.url)}
                className="px-2 py-1 text-[11px] truncate cursor-pointer"
                style={{ color: 'var(--text-primary)', borderBottom: '1px solid var(--border-subtle)' }}
              >
                {h.title || h.url}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire `<webview>` DOM events imperatively**

`<webview>` fires plain DOM events, not React synthetic events, and its ref type isn't a standard `HTMLElement` subtype React/TypeScript knows about — this needs a small ambient type plus an effect that attaches listeners via `addEventListener`. Add this effect and type declaration to the file from Step 3:

At the top of `CompanyBrowserPage.tsx`, add (near the other type declarations):

```ts
// <webview> isn't in React's JSX.IntrinsicElements or lib.dom.d.ts's element
// map by default — Electron ships its own type augmentation normally, but
// this file needs a minimal shape for the imperative ref usage below.
type HTMLWebViewElement = HTMLElement & {
  src: string;
  goBack(): void;
  goForward(): void;
  reload(): void;
  getURL(): string;
  getTitle(): string;
  canGoBack(): boolean;
  canGoForward(): boolean;
};
```

Then, inside the component, add this effect (near the other `useEffect`s):

```ts
  useEffect(() => {
    const el = webviewRefs.current[activeTab.id];
    if (!el) return;

    const onDidNavigate = () => {
      const url = el.getURL();
      updateTab(activeTab.id, {
        url, loading: false, canGoBack: el.canGoBack(), canGoForward: el.canGoForward(),
      });
    };
    const onTitleUpdated = (e: Event) => {
      const title = (e as CustomEvent & { title?: string }).title ?? el.getTitle();
      updateTab(activeTab.id, { title });
      recordHistory(el.getURL(), title);
    };
    const onStartLoading = () => updateTab(activeTab.id, { loading: true });
    const onStopLoading = () => updateTab(activeTab.id, {
      loading: false, canGoBack: el.canGoBack(), canGoForward: el.canGoForward(),
    });

    el.addEventListener('did-navigate', onDidNavigate);
    el.addEventListener('did-navigate-in-page', onDidNavigate);
    el.addEventListener('page-title-updated', onTitleUpdated);
    el.addEventListener('did-start-loading', onStartLoading);
    el.addEventListener('did-stop-loading', onStopLoading);
    return () => {
      el.removeEventListener('did-navigate', onDidNavigate);
      el.removeEventListener('did-navigate-in-page', onDidNavigate);
      el.removeEventListener('page-title-updated', onTitleUpdated);
      el.removeEventListener('did-start-loading', onStartLoading);
      el.removeEventListener('did-stop-loading', onStopLoading);
    };
  }, [activeTab.id, updateTab, recordHistory]);
```

- [ ] **Step 5: Register the route in `App.tsx`**

Add the lazy import near the other detached-window imports (`client/src/App.tsx:182-183`):

```ts
const CompanyBrowserPage = lazyRetry(() => import('./pages/CompanyBrowserPage'));
```

Add the route in the "Detached windows — no Layout wrapper" block (`client/src/App.tsx:506-508`):

```tsx
          <Route path="/detached/incident/:id" element={<ProtectedRoute><RouteErrorBoundary><IncidentDetailWindow /></RouteErrorBoundary></ProtectedRoute>} />
          <Route path="/detached/record/:type/:id" element={<ProtectedRoute><RouteErrorBoundary><RecordDetailWindow /></RouteErrorBoundary></ProtectedRoute>} />
          <Route path="/desktop-company-browser" element={<ProtectedRoute><RouteErrorBoundary><CompanyBrowserPage /></RouteErrorBoundary></ProtectedRoute>} />
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/CompanyBrowserPage.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 7: Run client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: 0 new errors introduced by this file (the codebase has some pre-existing errors per CLAUDE.md's Phase 5 verification note — confirm the count doesn't increase from this change, not that it's zero).

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/CompanyBrowserPage.tsx client/src/pages/CompanyBrowserPage.test.tsx client/src/App.tsx
git commit -m "feat(desktop): add CompanyBrowserPage with tabs, bookmarks, history"
```

---

### Task 6: Manual verification (Electron)

This feature is Electron-only and cannot be exercised through the web preview tooling. No automated test replaces this step.

**Files:** none (manual verification only)

- [ ] **Step 1: Rebuild native deps and start the desktop app**

Run: `cd desktop && npm rebuild better-sqlite3 && npm start`
Expected: app window opens, logs in normally.

- [ ] **Step 2: Launch Company Browser**

Pin "Company Browser" from Module Directory (or find it via the taskbar launcher search) onto the Desktop tab, then click its icon.
Expected: a new, separate OS-level window opens (not a `FloatingWindow` inside the Desktop tab), titled "Company Browser — RMPG Flex".

- [ ] **Step 3: Browse to a real external site**

Type `example.com` into the address bar and submit.
Expected: the bare domain resolves to `https://example.com`, the page loads, the tab title updates to "Example Domain", back/forward buttons reflect actual history state.

- [ ] **Step 4: Multi-tab**

Click "New tab", browse to a second site, switch between tabs.
Expected: each tab keeps its own independent navigation state; switching tabs doesn't reload the inactive one (its scroll position, if any, is preserved).

- [ ] **Step 5: Bookmarks**

Click the star icon to bookmark the current page; confirm it appears in the bookmarks bar; click it to navigate back; click the star again to remove it.
Expected: bookmark add/remove reflected immediately in the UI.

- [ ] **Step 6: History + persistence across restart**

Open the History panel, confirm the visited URLs appear. Quit the app fully (not just close-to-tray — use the tray icon's real Quit, or `Cmd+Q`/`Alt+F4`) and relaunch.
Expected: reopening Company Browser and the History panel shows the same history entries and the same bookmarks as before restart (proves the `UserPreferences` round-trip from Task 1 actually persisted server-side, not just in memory).

- [ ] **Step 7: Blocked navigation**

In the address bar, try navigating to `file:///etc/passwd` (or any `file://` path).
Expected: navigation is silently blocked (page stays on its current URL) — confirms `shouldAllowGuestNavigation`/`will-attach-webview` wiring from Tasks 2-3 is actually active, not just unit-tested in isolation.

- [ ] **Step 8: Non-Electron fallback**

Open the same "Company Browser" icon from a plain browser tab pointed at the deployed web SPA (rmpgutah.us), not the Electron app.
Expected: a toast reads "Company Browser is available in the RMPG Flex desktop app" — no navigation, no crash.

---

### Task 7: Post-merge live migration

**Files:** none (ops step, matches CLAUDE.md's standard migration rollout)

- [ ] **Step 1: Apply the migration directly to live D1**

Run: `scripts/apply-migration.sh 0196_browser_bookmarks_history.sql` (adjust the filename here if Task 1 ended up using a different number after checking `ls migrations | tail`)

- [ ] **Step 2: Verify the columns landed**

Run: `wrangler d1 execute rmpg-flex --remote --command "SELECT name FROM pragma_table_info('user_preferences') WHERE name IN ('browser_bookmarks_json','browser_history_json')"`
Expected: both column names returned.
