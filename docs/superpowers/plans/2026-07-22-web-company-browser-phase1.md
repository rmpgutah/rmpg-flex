# Web Company Browser Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Company Browser reachable from a plain web-app tab (not just Electron) by streaming a real headless Chrome session — one per user, held in a new Durable Object, driven via Cloudflare's Browser Rendering API — instead of trying to proxy/rewrite arbitrary HTML.

**Architecture:** A new `WebBrowserSessionDO` holds one Puppeteer `Browser`/`Page` per session, reached via a bare (no-JWT-in-URL) WebSocket upgrade forwarded straight from `src/index.ts`'s top-level `fetch()` — mirroring the exact pattern `VoiceHubDO`/`AlertHubDO` already use in this codebase (message-based `authenticate` frame verified with `jose`, everything else trusted after that). The client renders incoming screenshot frames on a `<canvas>` and forwards pointer/keyboard events back as messages.

**Tech Stack:** Hono/D1 (`src/`), Durable Objects, `@cloudflare/puppeteer` (Browser Rendering), `jose` (JWT), React/TypeScript (`client/src/`), vitest.

## Global Constraints

- URL scope: any URL, no domain allowlist — matches the Electron version.
- Role restriction: `client_viewer` and `contract_manager` are blocked from creating a session; every other authenticated role has access — same two roles Company Browser already blocks on Electron.
- Phase 1 only: one session per user (creating a new one tears down any prior one), no tabs, no bookmarks, no history. Do not build any of those — they are explicitly out of scope for this plan.
- Message-based WebSocket auth only — no JWT in the URL (this codebase's existing 2026-04-15 policy, already followed by `VoiceHubDO`/`AlertHubDO`). The DO verifies the first `authenticate` frame itself; the HTTP-level upgrade route does NOT run through Hono's `authMiddleware`.
- Idle timeout: 5 minutes of no input closes the browser and ends the session (DO alarm). Any WebSocket close (for any reason) tears down the Puppeteer browser immediately — never wait for the idle alarm to free a browser instance whose socket already closed.
- **Cannot be fully tested without a live Cloudflare account with Browser Rendering enabled** — the `BROWSER` binding does not exist in this repo yet and must be provisioned on the account before Task 6 (manual verification) can run for real. This is a real prerequisite, not something any task in this plan resolves.

---

### Task 1: `WebBrowserSessionDO` pure helpers + wrangler.toml/package.json wiring

**Files:**
- Create: `src/durable-objects/webBrowserSession/pureHelpers.ts`
- Create: `tests/webBrowserSessionPureHelpers.test.ts`
- Modify: `wrangler.toml`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `isIdleTimedOut(lastInputAt: number, now: number): boolean`, `shapeFrameMessage(base64Jpeg: string): { type: 'frame'; data: string }`, `shapeErrorMessage(message: string): { type: 'error'; message: string }`, `shapeSessionEndedMessage(reason: 'idle_timeout' | 'closed'): { type: 'session_ended'; reason: string }` — all consumed by Task 2's `WebBrowserSessionDO`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/webBrowserSessionPureHelpers.test.ts
import { describe, it, expect } from 'vitest';
import { isIdleTimedOut, shapeFrameMessage, shapeErrorMessage, shapeSessionEndedMessage, IDLE_TIMEOUT_MS } from '../src/durable-objects/webBrowserSession/pureHelpers';

describe('isIdleTimedOut', () => {
  it('is false right at lastInputAt', () => {
    expect(isIdleTimedOut(1000, 1000)).toBe(false);
  });
  it('is false just under the timeout', () => {
    expect(isIdleTimedOut(1000, 1000 + IDLE_TIMEOUT_MS - 1)).toBe(false);
  });
  it('is true at exactly the timeout', () => {
    expect(isIdleTimedOut(1000, 1000 + IDLE_TIMEOUT_MS)).toBe(true);
  });
  it('is true well past the timeout', () => {
    expect(isIdleTimedOut(1000, 1000 + IDLE_TIMEOUT_MS * 10)).toBe(true);
  });
});

describe('message shaping', () => {
  it('shapeFrameMessage wraps base64 jpeg data', () => {
    expect(shapeFrameMessage('abc123==')).toEqual({ type: 'frame', data: 'abc123==' });
  });
  it('shapeErrorMessage wraps a message string', () => {
    expect(shapeErrorMessage('bad url')).toEqual({ type: 'error', message: 'bad url' });
  });
  it('shapeSessionEndedMessage carries the reason', () => {
    expect(shapeSessionEndedMessage('idle_timeout')).toEqual({ type: 'session_ended', reason: 'idle_timeout' });
    expect(shapeSessionEndedMessage('closed')).toEqual({ type: 'session_ended', reason: 'closed' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/webBrowserSessionPureHelpers.test.ts`
Expected: FAIL — `Cannot find module '../src/durable-objects/webBrowserSession/pureHelpers'`

- [ ] **Step 3: Implement the pure helpers**

```ts
// src/durable-objects/webBrowserSession/pureHelpers.ts
// Pure, dependency-free helpers for WebBrowserSessionDO — kept separate so
// they're unit-testable without a live Durable Object or Browser Rendering
// binding, matching this codebase's existing pattern of pulling pure logic
// out of DO files (see desktop/windowManager.js's role in the desktop app
// for the same idea, or WelfareWatchDO's own escalation-timing constants).

/** 5 minutes of no input (navigate/click/type/scroll) ends the session. */
export const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

export function isIdleTimedOut(lastInputAt: number, now: number): boolean {
  return now - lastInputAt >= IDLE_TIMEOUT_MS;
}

export function shapeFrameMessage(base64Jpeg: string): { type: 'frame'; data: string } {
  return { type: 'frame', data: base64Jpeg };
}

export function shapeErrorMessage(message: string): { type: 'error'; message: string } {
  return { type: 'error', message };
}

export function shapeSessionEndedMessage(reason: 'idle_timeout' | 'closed'): { type: 'session_ended'; reason: string } {
  return { type: 'session_ended', reason };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/webBrowserSessionPureHelpers.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Add the Durable Object binding + Browser Rendering binding to `wrangler.toml`**

Find the existing Durable Object bindings block (search for `[[durable_objects.bindings]]` — there are several already, e.g. `WELFARE_WATCH`, `VOICE_HUB`, `ALERT_HUB`). Add a new one alongside them:

```toml
# WebBrowserSessionDO — one instance per active web-based Company Browser
# session (idFromName(sessionId)), holding a real headless Chrome instance
# via Cloudflare's Browser Rendering API. Session-scoped, not global —
# unlike VOICE_HUB/ALERT_HUB, a new id is minted per POST /api/web-browser/session.
[[durable_objects.bindings]]
name = "WEB_BROWSER_SESSION"
class_name = "WebBrowserSessionDO"
```

Find the existing `[[migrations]]` block with `new_sqlite_classes = ["WelfareWatchDO"]` (there may be several `[[migrations]]` blocks in this file for different DO classes added over time — do NOT edit the existing one; Cloudflare requires each new DO class added after the first deploy to get its OWN new `[[migrations]]` block with an incremented `tag`). Find the highest existing `tag = "vN"` value across all `[[migrations]]` blocks in this file, and add a new block with `tag` one higher:

```toml
[[migrations]]
tag = "v2"
new_sqlite_classes = ["WebBrowserSessionDO"]
```

(If the highest existing tag is NOT `"v1"` by the time you do this — other DOs may have been added between when this plan was written and now — use the next integer after whatever the actual highest tag in the file is, not literally `"v2"`.)

Add the Browser Rendering binding (a new top-level section, not nested under anything else):

```toml
# Browser Rendering — powers the web-based Company Browser (Phase 1).
# Requires Browser Rendering to be enabled on the Cloudflare account
# (billed separately, per browser-minute) before this binding resolves
# in a deployed Worker. See docs/superpowers/specs/2026-07-22-web-company-browser-phase1-design.md.
[browser]
binding = "BROWSER"
```

- [ ] **Step 6: Add the `@cloudflare/puppeteer` dependency**

Run: `npm install @cloudflare/puppeteer`

- [ ] **Step 7: Commit**

```bash
git add src/durable-objects/webBrowserSession/pureHelpers.ts tests/webBrowserSessionPureHelpers.test.ts wrangler.toml package.json package-lock.json
git commit -m "feat(web-browser): add pure helpers + DO/Browser Rendering bindings"
```

---

### Task 2: `WebBrowserSessionDO` — session lifecycle, auth, Puppeteer session

**Files:**
- Create: `src/durable-objects/WebBrowserSessionDO.ts`
- Modify: `src/types.ts`

**Interfaces:**
- Consumes: `isIdleTimedOut`, `shapeFrameMessage`, `shapeErrorMessage`, `shapeSessionEndedMessage`, `IDLE_TIMEOUT_MS` from Task 1.
- Produces: `WebBrowserSessionDO` class (default export), consumed by Task 3's route wiring in `src/index.ts` via `env.WEB_BROWSER_SESSION`.

This task has no dedicated automated test — real Puppeteer/Browser Rendering behavior cannot be exercised without a live `BROWSER` binding, consistent with how this codebase already has no test coverage for its other DOs' real WebSocket/session behavior (`VoiceHubDO`, `AlertHubDO`). Task 1's pure helpers carry the tested logic; Task 6 (manual verification) covers this end-to-end against a real deployed Worker.

- [ ] **Step 1: Add the `WEB_BROWSER_SESSION` and `BROWSER` binding types to `src/types.ts`**

Find the `Bindings` interface (it already has `DB: D1Database;` and `JWT_SECRET: string;` near the top). Add:

```ts
  WEB_BROWSER_SESSION: DurableObjectNamespace;
  BROWSER: Fetcher;
```

(`Fetcher` is the correct TypeScript type for a Browser Rendering binding in `@cloudflare/workers-types` — it's the same type used for service bindings; `@cloudflare/puppeteer`'s `puppeteer.launch()` accepts it directly.)

- [ ] **Step 2: Implement `WebBrowserSessionDO`**

```ts
// src/durable-objects/WebBrowserSessionDO.ts
// ============================================================
// RMPG Flex — WebBrowserSessionDO
// One instance per active web-based Company Browser session
// (env.WEB_BROWSER_SESSION.idFromName(sessionId)). Holds a real
// headless Chrome instance via Cloudflare's Browser Rendering
// API (@cloudflare/puppeteer) and streams screenshot frames to
// exactly one connected client, forwarding that client's
// navigate/click/type/scroll commands into the page.
//
// Auth: message-based, mirroring VoiceHubDO/AlertHubDO in this
// codebase — the socket connects with no JWT in the URL (2026-04-15
// policy) and sends an `authenticate` frame this DO verifies with
// jose against env.JWT_SECRET. Only an authenticated socket is
// wired up to the browser session; an unauthenticated one that
// never sends `authenticate` is force-closed after 10s, matching
// VoiceHubDO's own timeout value and rationale (an attacker must
// not be able to hold unauthenticated sockets open indefinitely).
//
// Role check: client_viewer/contract_manager are rejected at the
// HTTP route level (src/routes/webBrowser.ts), before a session is
// ever created — this DO does not re-check role, since by the time
// a socket reaches here a session was already created for an
// allowed role.
// ============================================================

import { jwtVerify } from 'jose';
import puppeteer, { type Browser, type Page } from '@cloudflare/puppeteer';
import { getDb, queryFirst } from '../utils/db';
import { isIdleTimedOut, shapeFrameMessage, shapeErrorMessage, shapeSessionEndedMessage, IDLE_TIMEOUT_MS } from './webBrowserSession/pureHelpers';

interface WebBrowserEnv {
  JWT_SECRET: string;
  BROWSER: Fetcher;
  DB: D1Database;
}

const FRAME_INTERVAL_MS = 300;
const AUTH_TIMEOUT_MS = 10_000;

export class WebBrowserSessionDO {
  state: DurableObjectState;
  env: WebBrowserEnv;
  socket: WebSocket | null = null;
  authenticated = false;
  browser: Browser | null = null;
  page: Page | null = null;
  lastInputAt = Date.now();
  frameTimer: ReturnType<typeof setInterval> | null = null;

  constructor(state: DurableObjectState, env: WebBrowserEnv) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }
    // Only one client per session — a session id is minted fresh per
    // POST /api/web-browser/session, so a second upgrade to the same
    // session is unexpected; reject rather than silently replacing.
    if (this.socket) {
      return new Response('Session already connected', { status: 409 });
    }

    const pair = new (globalThis as any).WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    (server as any).accept();
    this.socket = server;

    setTimeout(() => {
      if (!this.authenticated && this.socket === server) {
        try { (server as any).close(4001, 'Authentication timeout'); } catch { /* already closed */ }
        this.teardown('closed');
      }
    }, AUTH_TIMEOUT_MS);

    server.addEventListener('message', (ev: MessageEvent) => {
      this.onMessage(ev).catch((err) => console.error('[WebBrowserSessionDO] msg', err));
    });
    server.addEventListener('close', () => this.teardown('closed'));
    server.addEventListener('error', () => this.teardown('closed'));

    return new Response(null, { status: 101, webSocket: client });
  }

  private send(obj: unknown): void {
    try { if (this.socket && (this.socket as any).readyState === 1) this.socket.send(JSON.stringify(obj)); } catch { /* in-flight */ }
  }

  private async onMessage(ev: MessageEvent): Promise<void> {
    let msg: any;
    try {
      msg = JSON.parse(typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer));
    } catch {
      return;
    }

    if (msg.type === 'authenticate') {
      if (this.authenticated) return;
      try {
        const secret = new TextEncoder().encode(this.env.JWT_SECRET);
        const { payload } = await jwtVerify(msg.token, secret);
        const p = payload as unknown as { user_id?: number; userId?: number };
        const claimed = p.user_id ?? p.userId;
        if (claimed == null) { this.send(shapeErrorMessage('AUTH_FAILED')); return; }

        const db = getDb(this.env as any);
        const user = await queryFirst<{ id: number; status: string }>(
          db, 'SELECT id, status FROM users WHERE id = ? AND status = ?', claimed, 'active',
        );
        if (!user) { this.send(shapeErrorMessage('AUTH_FAILED')); return; }

        this.authenticated = true;
        await this.startBrowser();
      } catch {
        this.send(shapeErrorMessage('AUTH_FAILED'));
      }
      return;
    }

    if (!this.authenticated) { this.send(shapeErrorMessage('NOT_AUTHENTICATED')); return; }
    this.lastInputAt = Date.now();
    await this.state.storage.setAlarm(Date.now() + IDLE_TIMEOUT_MS);

    if (msg.type === 'navigate' && typeof msg.url === 'string') {
      try {
        await this.page!.goto(msg.url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      } catch (err) {
        this.send(shapeErrorMessage(err instanceof Error ? err.message : 'Navigation failed'));
      }
      return;
    }
    if (msg.type === 'click' && typeof msg.x === 'number' && typeof msg.y === 'number') {
      try { await this.page!.mouse.click(msg.x, msg.y); } catch { /* page may have navigated away mid-click */ }
      return;
    }
    if (msg.type === 'type' && typeof msg.text === 'string') {
      try { await this.page!.keyboard.type(msg.text); } catch { /* ignore */ }
      return;
    }
    if (msg.type === 'scroll' && typeof msg.dx === 'number' && typeof msg.dy === 'number') {
      try { await this.page!.evaluate((dx: number, dy: number) => window.scrollBy(dx, dy), msg.dx, msg.dy); } catch { /* ignore */ }
      return;
    }
  }

  private async startBrowser(): Promise<void> {
    try {
      this.browser = await puppeteer.launch(this.env.BROWSER);
      this.page = await this.browser.newPage();
    } catch (err) {
      this.send(shapeErrorMessage('Unable to start browser session, try again.'));
      try { this.socket?.close(1011, 'Browser launch failed'); } catch { /* ignore */ }
      return;
    }

    this.frameTimer = setInterval(async () => {
      if (!this.page) return;
      try {
        const shot = await this.page.screenshot({ type: 'jpeg', quality: 60 });
        const base64 = typeof shot === 'string' ? shot : Buffer.from(shot as Uint8Array).toString('base64');
        this.send(shapeFrameMessage(base64));
      } catch { /* page mid-navigation — skip this tick */ }
    }, FRAME_INTERVAL_MS);

    await this.state.storage.setAlarm(Date.now() + IDLE_TIMEOUT_MS);
  }

  // alarm() fires when the idle timer set in onMessage()/startBrowser()
  // expires without being re-armed by another input message in the
  // meantime — i.e. IDLE_TIMEOUT_MS of no navigate/click/type/scroll.
  async alarm(): Promise<void> {
    if (isIdleTimedOut(this.lastInputAt, Date.now())) {
      this.send(shapeSessionEndedMessage('idle_timeout'));
      await this.teardown('idle_timeout');
    }
  }

  private async teardown(reason: 'idle_timeout' | 'closed'): Promise<void> {
    if (this.frameTimer) { clearInterval(this.frameTimer); this.frameTimer = null; }
    if (this.browser) {
      try { await this.browser.close(); } catch { /* already closed */ }
      this.browser = null;
      this.page = null;
    }
    if (reason === 'closed') {
      try { this.socket?.close(); } catch { /* already closed */ }
    }
    this.socket = null;
    this.authenticated = false;
  }
}
```

- [ ] **Step 3: Sanity-check the Worker still typechecks**

Run: `npm run typecheck`
Expected: 0 new errors from this file. If `@cloudflare/puppeteer`'s exported types don't exactly match `Browser`/`Page` names used above (package APIs shift between versions), adjust the import to whatever that package's installed version actually exports — check `node_modules/@cloudflare/puppeteer/dist/*.d.ts` for the real type names if the import fails, rather than guessing further.

- [ ] **Step 4: Commit**

```bash
git add src/durable-objects/WebBrowserSessionDO.ts src/types.ts
git commit -m "feat(web-browser): implement WebBrowserSessionDO"
```

---

### Task 3: `/api/web-browser` route + upgrade wiring

**Files:**
- Create: `src/routes/webBrowser.ts`
- Create: `tests/webBrowserRoute.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `env.WEB_BROWSER_SESSION` (Task 1/2's DO binding).
- Produces: `POST /api/web-browser/session` (creates a session, returns `{ sessionId }`), `GET /api/web-browser-ws?sessionId=<id>` (WebSocket upgrade, forwarded straight to the DO — consumed by Task 4's client code).

- [ ] **Step 1: Write the failing test for the role check**

```ts
// tests/webBrowserRoute.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import webBrowser from '../src/routes/webBrowser';

function buildApp(role: string) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('user', { id: 1, role });
    await next();
  });
  app.route('/', webBrowser);
  return app;
}

describe('POST /session role restriction', () => {
  it('blocks client_viewer', async () => {
    const app = buildApp('client_viewer');
    const res = await app.request('/session', { method: 'POST' });
    expect(res.status).toBe(403);
  });

  it('blocks contract_manager', async () => {
    const app = buildApp('contract_manager');
    const res = await app.request('/session', { method: 'POST' });
    expect(res.status).toBe(403);
  });

  it('allows officer', async () => {
    const env = { WEB_BROWSER_SESSION: { idFromName: () => 'fake-id', get: () => ({ fetch: vi.fn() }) } };
    const app = buildApp('officer');
    const res = await app.request('/session', { method: 'POST' }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { sessionId: string };
    expect(typeof body.sessionId).toBe('string');
    expect(body.sessionId.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/webBrowserRoute.test.ts`
Expected: FAIL — `Cannot find module '../src/routes/webBrowser'`

- [ ] **Step 3: Implement the route**

```ts
// src/routes/webBrowser.ts
// ============================================================
// RMPG Flex — Web Company Browser session route
// POST /session creates a fresh session id and forwards it to a
// new WebBrowserSessionDO instance (idFromName(sessionId)). The
// actual WebSocket upgrade to that DO is handled at the top-level
// fetch() in src/index.ts (mirroring /api/voice-ws / /api/alerts-ws
// — bare, no-JWT-in-URL upgrades bypass Hono's authMiddleware
// entirely; the DO itself verifies the first `authenticate` frame).
// This route only issues the session id and enforces the role
// restriction BEFORE a session (and its Browser Rendering instance)
// is ever created.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';

const webBrowser = new Hono<Env>();

const BLOCKED_ROLES = new Set(['client_viewer', 'contract_manager']);

webBrowser.post('/session', async (c) => {
  const user = c.get('user') as { id: number; role: string } | undefined;
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  if (BLOCKED_ROLES.has(user.role)) {
    return c.json({ error: 'Insufficient permissions' }, 403);
  }

  const sessionId = crypto.randomUUID();
  return c.json({ sessionId });
});

export default webBrowser;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/webBrowserRoute.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Mount the route and wire the WebSocket upgrade in `src/index.ts`**

Find the import line for `handleWebSocket` near the top of `src/index.ts` and add a new import next to it:

```ts
import webBrowser from './routes/webBrowser';
```

Find where other route prefixes get `authMiddleware` mounted (e.g. `app.use('/api/dispatch', authMiddleware)`) and add:

```ts
app.use('/api/web-browser', authMiddleware);
app.route('/api/web-browser', webBrowser);
```

Find the `/api/voice-ws` block inside the exported `fetch()` handler (the one reading `?room=` and forwarding to `env.VOICE_HUB`). Add a new block right after it, following the exact same shape but keyed by `sessionId` instead of `room`:

```ts
    if (url.pathname === '/api/web-browser-ws') {
      const sessionId = url.searchParams.get('sessionId') || '';
      if (!sessionId) return new Response('Missing sessionId query parameter', { status: 400 });
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected WebSocket', { status: 426 });
      }
      const id = env.WEB_BROWSER_SESSION.idFromName(sessionId);
      return env.WEB_BROWSER_SESSION.get(id).fetch(request);
    }
```

- [ ] **Step 6: Run Worker typecheck**

Run: `npm run typecheck`
Expected: 0 new errors

- [ ] **Step 7: Commit**

```bash
git add src/routes/webBrowser.ts tests/webBrowserRoute.test.ts src/index.ts
git commit -m "feat(web-browser): add /api/web-browser session route + WS upgrade wiring"
```

---

### Task 4: `WebCompanyBrowserPage.tsx` — canvas streaming client

**Files:**
- Create: `client/src/pages/WebCompanyBrowserPage.tsx`
- Create: `client/src/pages/WebCompanyBrowserPage.test.tsx`
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `apiFetch` (`POST /web-browser/session` → `{ sessionId }`), then a raw `WebSocket` to `wss://api.rmpgutah.us/api/web-browser-ws?sessionId=<id>` (prod) / `ws://localhost:8787/api/web-browser-ws?sessionId=<id>` (dev) sending `{type:'authenticate', token}` / `{type:'navigate', url}` / `{type:'click', x, y}` / `{type:'type', text}` / `{type:'scroll', dx, dy}`, receiving `{type:'frame', data}` / `{type:'error', message}` / `{type:'session_ended', reason}` — all message shapes defined by Task 1/2/3.
- Produces: default export `WebCompanyBrowserPage`, mounted at `/web-desktop-company-browser`, consumed by Task 5's nav-catalog dispatcher.

- [ ] **Step 1: Check how this codebase already gets the raw JWT for a manual WebSocket connection**

Before writing this page, find how existing client code opens a WebSocket to `/api/voice-ws` or `/api/alerts-ws` (search `client/src` for `alerts-ws` or `voice-ws`) and see exactly where it reads the stored JWT from (localStorage key name) to send in its own `authenticate` frame. Use that SAME localStorage key and the SAME base-URL-resolution helper this codebase already has for WebSocket connections (do not hardcode `wss://api.rmpgutah.us` — there should already be a dev/prod URL-resolution helper alongside `apiFetch` in `client/src/hooks/useApi.ts`; if a WS-specific base-URL helper exists there or in a sibling file, reuse it verbatim rather than duplicating the dev/prod branching logic).

- [ ] **Step 2: Write the failing tests**

```tsx
// client/src/pages/WebCompanyBrowserPage.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WebCompanyBrowserPage from './WebCompanyBrowserPage';

vi.mock('../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue({ sessionId: 'test-session-id' }),
}));

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) { FakeWebSocket.instances.push(this); }
  send(data: string) { this.sent.push(data); }
  close() { this.onclose?.(); }
}

describe('WebCompanyBrowserPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeWebSocket.instances = [];
    (globalThis as any).WebSocket = FakeWebSocket;
    localStorage.setItem('rmpg_token', 'fake-jwt-token');
  });

  it('creates a session and opens a WebSocket to it', async () => {
    render(<WebCompanyBrowserPage />);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    expect(FakeWebSocket.instances[0].url).toContain('sessionId=test-session-id');
  });

  it('sends an authenticate frame once the socket opens', async () => {
    render(<WebCompanyBrowserPage />);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    FakeWebSocket.instances[0].onopen?.();
    const sent = FakeWebSocket.instances[0].sent.map((s) => JSON.parse(s));
    expect(sent).toContainEqual({ type: 'authenticate', token: 'fake-jwt-token' });
  });

  it('sends a navigate message when the address bar is submitted', async () => {
    render(<WebCompanyBrowserPage />);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const addressBar = screen.getByRole('textbox', { name: /address/i });
    fireEvent.change(addressBar, { target: { value: 'https://example.com' } });
    fireEvent.submit(addressBar.closest('form')!);
    const sent = FakeWebSocket.instances[0].sent.map((s) => JSON.parse(s));
    expect(sent).toContainEqual({ type: 'navigate', url: 'https://example.com' });
  });

  it('shows an inline error banner on an error message', async () => {
    render(<WebCompanyBrowserPage />);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    FakeWebSocket.instances[0].onmessage?.({ data: JSON.stringify({ type: 'error', message: 'Navigation failed' }) });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Navigation failed'));
  });

  it('shows a session-ended state on a session_ended message', async () => {
    render(<WebCompanyBrowserPage />);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    FakeWebSocket.instances[0].onmessage?.({ data: JSON.stringify({ type: 'session_ended', reason: 'idle_timeout' }) });
    await waitFor(() => expect(screen.getByText(/session ended/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/WebCompanyBrowserPage.test.tsx`
Expected: FAIL — `Cannot find module './WebCompanyBrowserPage'`

- [ ] **Step 4: Implement `WebCompanyBrowserPage.tsx`**

Use whatever the actual localStorage token key and WS-base-URL-resolution helper turned out to be from Step 1 — the code below uses placeholder names `TOKEN_STORAGE_KEY` and `resolveWsBaseUrl()` that MUST be replaced with the real ones found in Step 1 before this compiles against the real codebase; do not invent a new token-storage key or a new dev/prod URL-branching scheme if one already exists.

```tsx
// client/src/pages/WebCompanyBrowserPage.tsx
// ============================================================
// RMPG Flex — Web Company Browser (Phase 1)
// Non-Electron path for Company Browser: streams a real headless
// Chrome session (server-side, via WebBrowserSessionDO) onto a
// <canvas>, forwarding pointer/keyboard input back over the same
// WebSocket. See docs/superpowers/specs/2026-07-22-web-company-browser-phase1-design.md.
// No tabs/bookmarks/history in this phase — single session only.
// ============================================================

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';

// TODO(implementer): replace with this codebase's REAL token storage key —
// found in Task 4 Step 1 by checking how existing WS clients (voice/alerts)
// read their JWT.
const TOKEN_STORAGE_KEY = 'rmpg_token';

// TODO(implementer): replace with this codebase's REAL WS base-url resolver
// (dev → ws://localhost:8787, prod → wss://api.rmpgutah.us) — found in
// Task 4 Step 1. Do not hand-roll a new one if a helper already exists.
function resolveWsBaseUrl(): string {
  return import.meta.env.DEV ? 'ws://localhost:8787' : 'wss://api.rmpgutah.us';
}

export default function WebCompanyBrowserPage() {
  const [addressInput, setAddressInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sessionEnded, setSessionEnded] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ sessionId: string }>('/web-browser/session', { method: 'POST' }).then((res) => {
      if (cancelled) return;
      const token = localStorage.getItem(TOKEN_STORAGE_KEY) || '';
      const ws = new WebSocket(`${resolveWsBaseUrl()}/api/web-browser-ws?sessionId=${res.sessionId}`);
      socketRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'authenticate', token }));
      };

      ws.onmessage = (ev) => {
        let msg: any;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === 'frame') {
          const img = new Image();
          img.onload = () => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            canvas.width = img.width;
            canvas.height = img.height;
            canvas.getContext('2d')?.drawImage(img, 0, 0);
          };
          img.src = `data:image/jpeg;base64,${msg.data}`;
        } else if (msg.type === 'error') {
          setError(msg.message);
        } else if (msg.type === 'session_ended') {
          setSessionEnded(msg.reason);
        }
      };

      ws.onclose = () => { socketRef.current = null; };
    }).catch(() => setError('Unable to start browser session, try again.'));

    return () => { cancelled = true; socketRef.current?.close(); };
  }, []);

  const send = useCallback((obj: unknown) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify(obj));
  }, []);

  const handleAddressSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    send({ type: 'navigate', url: addressInput });
  }, [addressInput, send]);

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    send({ type: 'click', x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, [send]);

  if (sessionEnded) {
    return (
      <div className="flex items-center justify-center h-full" style={{ background: 'var(--surface-base)', color: 'var(--text-primary)' }}>
        Session ended due to inactivity. Reload to start a new one.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--surface-base)' }}>
      <form onSubmit={handleAddressSubmit} className="flex items-center gap-1 px-2 py-1" style={{ background: 'var(--surface-overlay)', borderBottom: '1px solid var(--border-subtle)' }}>
        <input
          type="text"
          role="textbox"
          aria-label="Address"
          value={addressInput}
          onChange={(e) => setAddressInput(e.target.value)}
          placeholder="Enter a URL"
          className="flex-1 px-2 py-1 text-[11px]"
          style={{ background: 'var(--surface-base)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
        />
      </form>
      <div className="flex-1 relative">
        <canvas ref={canvasRef} onClick={handleCanvasClick} style={{ width: '100%', height: '100%' }} />
        {error && (
          <div role="alert" style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '8px 12px', background: 'var(--sev-critical)', color: 'var(--text-primary)', fontSize: 11 }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Replace the two `TODO(implementer)` placeholders with the real values found in Step 1**, then confirm the tests pass.

Run: `cd client && npx vitest run src/pages/WebCompanyBrowserPage.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 6: Register the route in `App.tsx`**

Add the lazy import near other page imports:

```ts
const WebCompanyBrowserPage = lazyRetry(() => import('./pages/WebCompanyBrowserPage'));
```

Add the route in the "Detached windows — no Layout wrapper" block, alongside `/desktop-company-browser`:

```tsx
          <Route path="/web-desktop-company-browser" element={<ProtectedRoute><CompanyBrowserRoleGuard><RouteErrorBoundary><WebCompanyBrowserPage /></RouteErrorBoundary></CompanyBrowserRoleGuard></ProtectedRoute>} />
```

(`CompanyBrowserRoleGuard` already exists in this file from the Electron Company Browser hardening work — reuse it verbatim; it already encodes the exact `client_viewer`/`contract_manager` block this phase also requires.)

- [ ] **Step 7: Run client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: 0 new errors

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/WebCompanyBrowserPage.tsx client/src/pages/WebCompanyBrowserPage.test.tsx client/src/App.tsx
git commit -m "feat(web-browser): add WebCompanyBrowserPage canvas streaming client"
```

---

### Task 5: Non-Electron nav-catalog dispatch to `WebCompanyBrowserPage`

**Files:**
- Modify: `client/src/utils/windowManager.ts`
- Modify: `client/src/utils/windowManager.test.ts`

**Interfaces:**
- Consumes: nothing new from other tasks — this task only changes what `activateNavFunction` does in the non-Electron branch of the existing `fn.electronOnly === 'company-browser'` case.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Read the current `activateNavFunction` implementation**

Find the current `if (fn.electronOnly === 'company-browser')` branch in `client/src/utils/windowManager.ts` (it was last modified by the Company Browser hardening work — it currently calls `handlers.onElectronOnlyUnavailable?.(fn)` when `window.electron` isn't present or `isElectron` is false). This task changes that non-Electron path to navigate to the new web page instead of only showing the toast.

- [ ] **Step 2: Write the failing test**

Add to the existing `activateNavFunction — electronOnly` describe block in `client/src/utils/windowManager.test.ts`:

```ts
  it('navigates to the web Company Browser page when not running in Electron', () => {
    (window as any).electron = undefined;
    const navigate = vi.fn();
    activateNavFunction(COMPANY_BROWSER_FN, { openWindow: vi.fn(), navigate, currentUserRole: 'officer' });
    expect(navigate).toHaveBeenCalledWith('/web-desktop-company-browser');
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/windowManager.test.ts`
Expected: FAIL — the non-Electron path currently calls `onElectronOnlyUnavailable`, not `navigate('/web-desktop-company-browser')`.

- [ ] **Step 4: Update `activateNavFunction`**

Find:

```ts
  if (fn.electronOnly === 'company-browser') {
    const electron = (window as any).electron;
    if (electron?.isElectron && typeof electron.openCompanyBrowser === 'function') {
      Promise.resolve(electron.openCompanyBrowser(handlers.currentUserRole)).catch(() => handlers.onElectronOnlyUnavailable?.(fn));
    } else {
      handlers.onElectronOnlyUnavailable?.(fn);
    }
    return;
  }
```

Change the `else` branch:

```ts
  if (fn.electronOnly === 'company-browser') {
    const electron = (window as any).electron;
    if (electron?.isElectron && typeof electron.openCompanyBrowser === 'function') {
      Promise.resolve(electron.openCompanyBrowser(handlers.currentUserRole)).catch(() => handlers.onElectronOnlyUnavailable?.(fn));
    } else {
      handlers.navigate('/web-desktop-company-browser');
    }
    return;
  }
```

(The toast-showing `onElectronOnlyUnavailable` callback stays defined in the handlers type and at its call sites — it's just no longer invoked for this specific case, since there's now a real destination instead of "unavailable." Do not remove `onElectronOnlyUnavailable` from the type or from `DesktopIconGrid.tsx`/`DesktopTaskbar.tsx`'s call sites; it may still be used by other `electronOnly` values in the future.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/windowManager.test.ts`
Expected: PASS (all tests, including pre-existing ones — confirm no regression to the Electron-path tests)

- [ ] **Step 6: Run client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: 0 new errors

- [ ] **Step 7: Commit**

```bash
git add client/src/utils/windowManager.ts client/src/utils/windowManager.test.ts
git commit -m "feat(web-browser): navigate to WebCompanyBrowserPage instead of toast on non-Electron"
```

---

### Task 6: Manual verification (requires live Browser Rendering)

**Files:** none (manual verification only, and provisioning steps)

This entire feature cannot be verified without Cloudflare's Browser Rendering product enabled on the live account — the `BROWSER` binding literally does not resolve otherwise. No prior task in this plan can substitute for this.

- [ ] **Step 1: Confirm Browser Rendering is enabled on the account**

In the Cloudflare dashboard, confirm Browser Rendering is enabled for this account (Workers & Pages → your account → Browser Rendering, or via `wrangler` if it surfaces binding validation on deploy). If it is not enabled, this feature cannot be deployed — stop here and get it enabled first.

- [ ] **Step 2: Deploy and verify the binding resolves**

After merging and deploying (`git push origin main` → `deploy.yml`), run:

Run: `curl -sf https://api.rmpgutah.us/api/health` (per this repo's documented health-check WAF exception)
Expected: `{"status":"ok",...}` — confirms the Worker deployed at all. The `BROWSER`/`WEB_BROWSER_SESSION` bindings themselves aren't checked by `/api/health` — the next step is the real test.

- [ ] **Step 3: Open Company Browser from a plain browser tab**

Log into `https://rmpgutah.us` in a normal Chrome/Safari tab (not Electron) as a role other than `client_viewer`/`contract_manager`. Launch "Company Browser" from Module Directory or the taskbar search. Confirm it navigates to `/web-desktop-company-browser` (not the "available in the desktop app" toast).

- [ ] **Step 4: Verify real browsing works**

Type a real URL (e.g. `https://example.com`) into the address bar and submit. Confirm the canvas shows the real rendered page within ~1 second (one `FRAME_INTERVAL_MS` tick). Click somewhere on the canvas and confirm the click actually reaches the remote page (e.g. click a link and confirm the page navigates, visible on the next frame).

- [ ] **Step 5: Verify role restriction**

Log in as `client_viewer` or `contract_manager`. Confirm `POST /api/web-browser/session` returns 403 (check the Network tab), and that Company Browser is not reachable at all for that role (same restriction as the Electron path, from the existing `CompanyBrowserRoleGuard`).

- [ ] **Step 6: Verify idle timeout and cost-control teardown**

Open a session, then stop interacting entirely for 5+ minutes. Confirm a `session_ended` message arrives and the page shows "Session ended due to inactivity." Separately, open a session and simply close the browser tab (not idle — an active disconnect) — then check (via Cloudflare's Browser Rendering usage dashboard, or Worker logs if instrumented) that the browser instance was torn down immediately, not left running for the remainder of the 5-minute window.
