# Desktop Tab — Company Web Browser

Date: 2026-07-20

## Goal

Add an internal, general-purpose web browser app to the Desktop tab (`client/src/pages/DesktopPage.tsx`), so staff can browse arbitrary external sites (vendor portals, county records sites, general research) from inside RMPG Flex, with tabs, an address bar, bookmarks, and history — without leaving the app.

## Scope decisions

- **Runtime**: Electron desktop app only (`desktop/`). The regular web SPA (rmpgutah.us in a normal browser tab) cannot embed arbitrary external sites via `<iframe>` — most real sites send `X-Frame-Options`/CSP headers that block framing. Electron's `<webview>` tag has no such restriction. When the app is *not* running inside Electron, the Company Browser icon shows a message instead of launching.
- **URL scope**: open web browsing — any `http(s)` URL, like a real browser tab. Not restricted to a domain whitelist.
- **v1 features**: address bar with back/forward/reload, multiple tabs, a bookmarks list, and browsing history.
- **Entry point**: a new pinnable Desktop app icon in the nav catalog (`client/src/data/navCatalog.ts`), launched/pinned the same way every other module is.

## Architecture

The browser is a **separate top-level Electron `BrowserWindow`**, not another `FloatingWindow`/iframe inside the Desktop shell.

`FloatingWindow.tsx` embeds RMPG's *own* trusted routes via `<iframe>`. Nesting a `<webview>` (needed for arbitrary external sites) inside that iframe would embed untrusted content inside untrusted content, and would force `webviewTag: true` onto the *main* window's webPreferences — weakening the hardened default (`webviewTag: false`, `desktop/security/sessionHardening.js:117`) for the whole app, not just this one feature.

Instead, a dedicated `BrowserWindow` keeps that relaxation scoped to exactly one purpose-built window, following the existing `window:open-secondary` pattern (`desktop/main.js:1015`) that already spins up isolated `BrowserWindow`s for detached panels.

### New/changed pieces

1. **`desktop/main.js`** — new IPC handler `window:open-company-browser`:
   - Creates a `BrowserWindow` whose `webPreferences` = `hardenWebPreferencesDefaults({ webviewTag: true })` — every other hardened default (`contextIsolation: true`, `nodeIntegration: false`, sandbox, trusted preload) stays untouched; only `webviewTag` is overridden for this one window.
   - Loads the in-app route `/desktop-company-browser` via `buildSecondaryWindowUrl(REMOTE_SERVER_URL, ...)`, the same helper other secondary windows use — never a renderer-supplied URL for the *window's own* `src`.
   - Registers a `will-attach-webview` handler scoped to this window (see below).

2. **`desktop/security/webviewHardening.js`** (new, pure functions, unit-testable like `sessionHardening.js`):
   - `hardenGuestWebPreferences(webPreferences)` — called from `will-attach-webview`; forces every attached `<webview>` guest to `nodeIntegration: false`, `contextIsolation: true`, `plugins: false`, and strips any `preload` the guest page might request.
   - `shouldAllowGuestNavigation(url)` — allow `http:`/`https:` only; deny `file:`, `chrome:`, `javascript:`, etc. Reused by both the guest's `will-navigate` and `new-window` handling (opening a `target="_blank"` link opens a new tab in the same browser window rather than a bare new webview with no chrome).

3. **`desktop/preload.js`** — add `openCompanyBrowser: () => ipcRenderer.invoke('window:open-company-browser')` to the `contextBridge` API surface, next to the existing `openSecondaryWindow`.

4. **`client/src/pages/CompanyBrowserPage.tsx`** (new page, mounted at `/desktop-company-browser`) — the browser chrome:
   - Tab strip (open/close/switch tabs, new-tab button).
   - Address bar: submits a URL (bare domains get `https://` prepended, same normalization a real browser does) to the active tab's `<webview>` via its `loadURL`/`src`.
   - Back / forward / reload buttons, driven by each tab's `canGoBack`/`canGoForward` state.
   - Bookmarks bar: add/remove current URL, click to navigate active tab.
   - History panel: reverse-chronological list of visited URLs across all tabs this session plus persisted history; click to reopen.
   - One `<webview>` per open tab, all mounted simultaneously; only the active tab's is visible (`display: none` on the rest) so navigating away and back doesn't lose scroll/session state — mirrors how `FloatingWindow.tsx` keeps a window's iframe alive while `minimized`.

5. **Nav catalog** (`client/src/data/navCatalog.ts`) — add a `"Company Browser"` entry, `notWindowable: true`. Its click handler (in whatever activates nav functions today, e.g. `windowManager.ts`/`activateNavFunction`) special-cases this one path: if `window.electron?.isElectron`, call `window.electron.openCompanyBrowser()`; otherwise show an inline message ("Company Browser is available in the RMPG Flex desktop app") instead of navigating.

## Data flow

- **Bookmarks & history** persist server-side through the existing `UserPreferences` PUT pattern already used for desktop layout/notes/widgets (`DesktopPage.tsx:109`, debounced 800ms). Two new columns: `browser_bookmarks_json` and `browser_history_json`, added via a new migration (next free number after the current high-water mark — check `migrations/` before writing it). This makes bookmarks and history follow the user cross-device/cross-session, consistent with everything else `UserPreferences` already stores.
- **Tabs themselves** are session-only, not persisted — a stale list of `webview` `src`s isn't meaningfully restorable across app restarts (same reasoning `DesktopWindowManager` applies to its own `sessionStorage`-backed window list, which also doesn't survive a real quit).
- Each tab's state: `{ id, url, title, canGoBack, canGoForward, loading }`, driven entirely by the `<webview>`'s own DOM events (`did-navigate`, `did-navigate-in-page`, `page-title-updated`, `did-start-loading`/`did-stop-loading`). No polling needed — unlike `FloatingWindow`'s same-origin `contentWindow.location` poll (used there because same-origin RMPG iframes don't reliably fire a parent-visible nav event for client-side route changes), `<webview>` fires real events for guest content regardless of origin.

## Error handling

- Per-tab failed navigation (DNS failure, connection refused, TLS/cert errors) is shown inline in that tab via the `<webview>`'s `did-fail-load` event, filtered through the same `FATAL_NET_ERRORS` allow/deny-fatal set already defined in `main.js`, so transient errors (aborted navigation, network-changed on a Wi-Fi blip) don't flash a false error page.
- If `window.electron` is undefined, or `openCompanyBrowser()` rejects/throws, the nav-catalog click handler surfaces an inline message rather than silently doing nothing.
- `will-attach-webview`/`shouldAllowGuestNavigation` deny non-http(s) schemes silently (matching how `shouldAllowNavigation` already handles the main window) — no user-facing error needed for a blocked `file://`/`javascript:` attempt, since a legitimate user action never produces one.

## Testing

- `desktop/security/__tests__/webviewHardening.test.js` — unit tests for `hardenGuestWebPreferences` and `shouldAllowGuestNavigation` as pure functions, following the existing `sessionHardening` test style.
- `client/src/pages/CompanyBrowserPage.test.tsx` — vitest coverage for: opening/closing/switching tabs, address-bar submit (including bare-domain normalization), bookmark add/remove, history list rendering and click-to-reopen. `<webview>` isn't renderable in jsdom, so tests assert on the tab-state/props passed to it rather than actual browsing behavior — same constraint and approach as any other Electron-only UI test in this codebase.
- Manual verification (this feature can't be exercised through the web preview tooling, since it's Electron-only): launch `npm start` in `desktop/`, open Company Browser from the Desktop tab, navigate to a real external site, confirm back/forward/reload work, add/remove a bookmark, confirm history records the visit and persists across an app restart.

## Post-merge

- Apply the new migration directly to live D1 (`785de7ae`) per the standard `scripts/apply-migration.sh` flow — deploy's migration-apply step is `continue-on-error`.
