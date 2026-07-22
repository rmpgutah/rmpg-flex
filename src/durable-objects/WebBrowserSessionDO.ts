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
// Both `user_id` and `userId` claim names are accepted, matching
// VoiceHubDO/AlertHubDO ([[feedback-jwt-claim-naming-mismatch]]).
//
// Role check: client_viewer/contract_manager are rejected at the
// HTTP route level (src/routes/webBrowser.ts, Task 3) as a first line
// of defense, AND re-checked here in authenticate() — the WS route in
// src/index.ts forwards /api/web-browser-ws?sessionId=<anything> to
// this DO for ANY sessionId string, so a blocked-role user could skip
// POST /session entirely and connect with a self-invented sessionId
// (Finding 1, 2026-07-22 final review). BLOCKED_ROLES is imported from
// webBrowser.ts so the two checks can never drift out of sync.
// ============================================================

import { jwtVerify } from 'jose';
import puppeteer, { type Browser, type Page } from '@cloudflare/puppeteer';
import { getDb, queryFirst } from '../utils/db';
import { BLOCKED_ROLES } from '../routes/webBrowser';
import {
  isIdleTimedOut,
  shapeFrameMessage,
  shapeErrorMessage,
  shapeSessionEndedMessage,
  IDLE_TIMEOUT_MS,
} from './webBrowserSession/pureHelpers';

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
  // Set synchronously (before any await) the instant an `authenticate`
  // frame is accepted for processing, so a second `authenticate` frame
  // arriving while the first is still mid-flight (jwtVerify/DB/startBrowser
  // are all async and yield) is rejected immediately instead of racing
  // startBrowser() and orphaning a browser instance (Finding 2, 2026-07-22
  // final review). This is a one-shot per-connection guard, never reset
  // back to false — a real client only ever sends one `authenticate` frame,
  // so there is no legitimate retry case to preserve within a single socket.
  authStarted = false;
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
      if (this.authenticated || this.authStarted) return;
      this.authStarted = true; // synchronous — set before any await, see field comment
      try {
        const secret = new TextEncoder().encode(this.env.JWT_SECRET);
        const { payload } = await jwtVerify(msg.token, secret);
        const p = payload as unknown as { user_id?: number; userId?: number };
        const claimed = p.user_id ?? p.userId; // accept both claim names ([[feedback-jwt-claim-naming-mismatch]])
        if (claimed == null) { this.send(shapeErrorMessage('AUTH_FAILED')); return; }

        const db = getDb(this.env as any);
        const user = await queryFirst<{ id: number; status: string; role: string }>(
          db, 'SELECT id, status, role FROM users WHERE id = ? AND status = ?', claimed, 'active',
        );
        if (!user) { this.send(shapeErrorMessage('AUTH_FAILED')); return; }
        if (BLOCKED_ROLES.has(user.role)) { this.send(shapeErrorMessage('AUTH_FAILED')); return; }

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
      // `window` only exists in the evaluated browser-page context, not in
      // this Worker file's own dom-less tsconfig — hence the `any` cast
      // rather than a real DOM lib reference.
      try {
        await this.page!.evaluate(
          (dx: number, dy: number) => (globalThis as any).scrollBy(dx, dy),
          msg.dx, msg.dy,
        );
      } catch { /* ignore */ }
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
        // encoding:'base64' returns a string directly — avoids a Buffer
        // round-trip (Buffer is available via nodejs_compat, but the
        // library's own base64 path is simpler and one fewer conversion).
        const base64 = await this.page.screenshot({ type: 'jpeg', quality: 60, encoding: 'base64' });
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
    try { this.socket?.close(); } catch { /* already closed */ }
    this.socket = null;
    this.authenticated = false;
  }
}

export default WebBrowserSessionDO;
