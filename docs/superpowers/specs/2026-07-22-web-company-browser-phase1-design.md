# Web Company Browser — Phase 1 (Remote Headless-Browser Streaming)

Date: 2026-07-22

## Goal

Company Browser (the general-purpose external web browser on the Desktop tab) is currently Electron-only, since a plain `<iframe>` can't embed most external sites (X-Frame-Options/CSP). This phase adds a working version reachable from a normal browser tab on `rmpgutah.us`, by streaming a real headless Chrome session running server-side (via Cloudflare's Browser Rendering product) rather than trying to proxy/rewrite HTML.

## Scope decisions

- **URL scope**: any URL, same as the Electron version — no domain allowlist.
- **Fidelity bar**: needs to work like a real browser for almost anything (the reason this is a real headless-browser-streaming build, not an HTML-rewriting proxy — a rewriting proxy cannot reliably support modern JS-heavy sites).
- **Phase 1 only**: single session per user, screenshot-frame streaming + input forwarding, no tabs, no bookmarks, no history. Multi-tab and bookmarks/history parity with the Electron version are explicitly out of scope for this phase — separate future work.
- **Role restriction**: matches the Electron version exactly — `client_viewer` and `contract_manager` are blocked, every other authenticated role has access.
- **Prerequisite**: Cloudflare's Browser Rendering product must be enabled on the account before this can be implemented or tested against a live environment — it is billed separately (per browser-minute), and is a distinct product/binding from anything currently used in this Worker. This is an operational dependency, not something resolved by code.

## Architecture

A new Durable Object, `WebBrowserSessionDO`, holds one real headless Chrome instance (via `@cloudflare/puppeteer` against a `BROWSER` binding) per active session. The client connects over WebSocket, sends navigation/input commands, and receives periodic screenshot frames back — the DO owns the entire browser lifecycle for that session.

This follows the same pattern already established by `src/durable-objects/VoiceHubDO.ts` in this codebase: message-based authentication (the WebSocket connects with no JWT in the URL — avoiding a JWT ever appearing in logs/referrers, per this codebase's existing 2026-04-15 policy — then sends an `authenticate` frame verified server-side via `jose` against `env.JWT_SECRET`), one Durable Object instance per session with in-memory state, no shared state across isolates.

**Why a real headless browser, not a rewriting proxy, is actually the safer choice here**: with a rewriting proxy, the Worker's own `fetch()` — running in the same isolate that holds the D1/KV/R2 bindings — would be the thing reaching out to arbitrary user-supplied URLs, a direct SSRF exposure. Here, the actual page-fetching happens inside Cloudflare's own isolated Browser Rendering sandbox; the headless Chrome instance has no access to this Worker's bindings at all, so even a successful "browse to an internal-looking address" attempt has nothing sensitive to reach.

### New/changed pieces

1. **`src/durable-objects/WebBrowserSessionDO.ts`** (new) — holds the Puppeteer `Browser`/`Page` instance for one session. WebSocket message handlers:
   - `authenticate` — verifies the JWT (mirroring `VoiceHubDO`'s existing pattern), rejects/closes the socket on failure.
   - `navigate` — `page.goto(url)`, replies with an `error` frame on failure (bad URL, timeout, DNS failure).
   - `click` / `type` / `scroll` — translated to Puppeteer's `page.mouse.click(x, y)`, `page.keyboard.type(text)`, `page.evaluate(() => window.scrollBy(dx, dy))` respectively.
   - Screenshot loop: on an interval (~300ms) while the session is active, calls `page.screenshot({ type: 'jpeg', quality: 60 })`, base64-encodes it, and sends a `frame` message over the socket.
   - A DO alarm (matching the alarm pattern `WelfareWatchDO` already uses in this codebase) fires after 5 minutes of no input messages, closes the Puppeteer browser, sends a `session-ended` message, and closes the socket — bounding per-session cost.

2. **`src/routes/webBrowser.ts`** (new) — mounted at `/api/web-browser` in `src/index.ts`, `auth: 'required'`. Role check excludes `client_viewer`/`contract_manager` (same two roles Company Browser already blocks on Electron), matching the pattern used by other role-restricted routes in this codebase (e.g. `/api/legal-data-hunter`).
   - `POST /session` — creates a new session id, tears down any existing session Durable Object for this user first (one concurrent session per user, for simplicity and cost control), returns `{ sessionId }`.

3. **`wrangler.toml`** — add the `WebBrowserSessionDO` Durable Object binding + `new_sqlite_classes` migration entry (matching the existing DO binding pattern in this file), and the `BROWSER` Browser Rendering binding.

4. **`client/src/pages/WebCompanyBrowserPage.tsx`** (new) — the non-Electron browsing UI: a `<canvas>` element that paints each incoming `frame` message, with `pointerdown`/`pointermove`/`keydown` (etc.) listeners translating native DOM events into the WebSocket message protocol above. An address bar submits a `navigate` message. No tabs, bookmarks, or history UI in this phase.

5. **Nav-catalog activation path** (`client/src/utils/windowManager.ts`'s `activateNavFunction`, already handling the `electronOnly: 'company-browser'` case) — when `window.electron?.isElectron` is false, instead of only showing the "available in the desktop app" toast, navigate to the new `WebCompanyBrowserPage` route. The Electron path is completely unchanged.

## Data flow

`POST /api/web-browser/session` → Worker creates/looks up the `WebBrowserSessionDO` instance for a fresh session id → client opens a WebSocket to that DO (via the Worker's existing WebSocket-upgrade routing pattern, `src/routes/ws.ts`) → sends `authenticate` → sends `navigate` commands, driving `page.goto()` inside the DO → DO's screenshot loop streams `frame` messages back → client canvas repaints on each frame. No D1/R2 persistence in this phase — nothing about a web session's browsing state survives past the session ending.

## Error handling

- Puppeteer/Browser Rendering launch failure (e.g., no `BROWSER` binding provisioned, quota exhausted) → the DO closes the WebSocket with an error reason the client surfaces as "Unable to start browser session, try again."
- Navigation failure (bad URL, DNS failure, timeout) → an `error` frame, rendered inline on the canvas view the same way Electron's per-tab error banner already works (reusing the same visual treatment, not the same code, since this is a canvas not a DOM tree).
- Idle timeout (5 minutes, no input) → `session-ended` message before the socket closes; client shows a simple "session ended due to inactivity, reload to start a new one" state.
- WebSocket disconnect for any other reason (network drop, tab closed) → the DO's own socket-close handler tears down the Puppeteer browser immediately, rather than waiting for the idle alarm, so a closed tab doesn't leave a billed browser instance running for the full 5 minutes.

## Testing

- Pure logic extracted into testable functions where possible: input-coordinate translation (client screen coords → page coords, accounting for canvas scaling), idle-timeout calculation, and the frame/error/session-ended message-shape helpers — unit-tested the same way this codebase already tests other DOs' pure logic (see the pattern in this repo's existing DO-adjacent test files).
- The DO itself (real Puppeteer session lifecycle, actual WebSocket message loop) is not unit-testable without a live Browser Rendering binding — consistent with this codebase's existing gap (no Worker test suite for DO-heavy features; CLAUDE.md documents this as accepted, ongoing tech debt). Manual verification is the real test for this phase: open the page in a plain browser tab (not Electron), submit a URL, confirm the page renders and that clicking/typing/scrolling actually drives the remote page.
- Manually verify the 5-minute idle-timeout and immediate-teardown-on-disconnect behaviors, since a bug in either directly costs real money (an orphaned browser instance billing indefinitely).

## Post-merge

- Confirm Cloudflare's Browser Rendering product is enabled on the account and the `BROWSER` binding resolves in the deployed Worker before considering this shippable — this cannot be verified in CI, only against the live account.
- No new migration needed for D1 (this phase persists nothing to D1) — only the `wrangler.toml` Durable Object migration entry for `WebBrowserSessionDO`, applied the same way other DO migrations in this file already are.
