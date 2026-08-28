// ============================================================
// RMPG Flex — Shared, cross-tab-coordinated access-token refresh
// ============================================================
//
// SINGLE source of truth for "refresh the access token", used by BOTH
// `useApi` (transparent retry on a 401) and `AuthContext` (the scheduled
// pre-expiry refresh). Before this module existed, those two systems each had
// their OWN refresh path with its OWN lock — and the live `rmpg-flex` worker
// ROTATES the refresh token on every successful /refresh:
//
//     UPDATE sessions SET refresh_token_hash = <hash(newRefreshToken)>
//     ... lookup is WHERE session_id = ? AND refresh_token_hash = ?
//
// so a refresh token is single-use. With two uncoordinated refreshers and the
// constant offline-sync `apiFetch` traffic, an apiFetch-driven refresh would
// race the scheduled refresh: the first to commit rotated the token, the
// second arrived with a now-stale token whose hash matched zero rows → 401
// SESSION_INVALID → the losing path force-logged-out the user mid-shift. That
// is the `POST /api/auth/refresh 401` → `[SYNC] Stopping pull schedule` seen
// in production logs.
//
// FIX — three layers, narrowest first:
//   1. In-tab single-flight: one `_inFlight` promise; concurrent callers in
//      the same tab share it.
//   2. Cross-tab mutual exclusion via the Web Locks API: at most ONE tab runs
//      the /refresh critical section at a time. While waiting for the lock,
//      another tab may rotate the token; on acquiring the lock we re-read
//      localStorage and ADOPT a token a peer just minted instead of issuing a
//      second (doomed) refresh.
//   3. Propagation: when any tab rotates the token (or auth is cleared), a
//      BroadcastChannel message — with a `storage` event as the fallback for
//      engines lacking BroadcastChannel — lets every other tab's AuthContext
//      sync its React state (reschedule on the new token, or log out).
//
// Net effect: the worker's single-use rotation can no longer produce a
// race-loss logout, in one tab or across many.

const TOKEN_KEY = 'rmpg_token';
const REFRESH_TOKEN_KEY = 'rmpg_refresh_token';
const SESSION_ID_KEY = 'rmpg_session_id';

// 15s — bounds a hung /refresh so the in-flight promise (and the Web Lock)
// can't pin the whole app's auth indefinitely.
const REFRESH_TIMEOUT_MS = 15_000;

// Name of the cross-tab Web Lock guarding the /refresh critical section.
const LOCK_NAME = 'rmpg_token_refresh';

// Access window.electron safely (only present in the Electron desktop app).
const electron = typeof window !== 'undefined' ? (window as any).electron : null;

// ─── Cross-tab auth event bus ───────────────────────────────
export type AuthEvent = { type: 'token'; token: string } | { type: 'logout' };
type AuthListener = (e: AuthEvent) => void;

const listeners = new Set<AuthListener>();

/**
 * Subscribe to auth events originating from ANY tab (this one included):
 *   - `{ type: 'token', token }` — the access token was rotated; adopt it.
 *   - `{ type: 'logout' }`       — auth was cleared; tear down the session.
 * Returns an unsubscribe function.
 */
export function onAuthEvent(fn: AuthListener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function emitLocal(e: AuthEvent): void {
  listeners.forEach((fn) => { try { fn(e); } catch { /* listener threw — ignore */ } });
}

const channel: BroadcastChannel | null =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('rmpg_auth') : null;

if (channel) {
  // Messages from OTHER tabs (BroadcastChannel does not echo to the sender).
  channel.onmessage = (ev: MessageEvent) => {
    const data = ev.data as AuthEvent | undefined;
    if (data && (data.type === 'token' || data.type === 'logout')) emitLocal(data);
  };
} else if (typeof window !== 'undefined') {
  // Fallback for engines without BroadcastChannel: `storage` events fire in
  // OTHER tabs whenever this tab writes/removes the token in localStorage.
  window.addEventListener('storage', (e) => {
    if (e.key !== TOKEN_KEY) return;
    emitLocal(e.newValue ? { type: 'token', token: e.newValue } : { type: 'logout' });
  });
}

/** Broadcast to other tabs (channel) and notify this tab's own listeners. */
function broadcast(e: AuthEvent): void {
  try { channel?.postMessage(e); } catch { /* channel closed — ignore */ }
  emitLocal(e);
}

// ─── localStorage helpers ───────────────────────────────────
function safeSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* quota / private mode */ }
}

function clearAuth(): void {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  try { localStorage.removeItem(REFRESH_TOKEN_KEY); } catch { /* ignore */ }
  try { localStorage.removeItem(SESSION_ID_KEY); } catch { /* ignore */ }
  // Tells AuthContext (this tab + peers) to drop user state → route guard
  // surfaces the login screen. We intentionally do NOT hard-redirect here so
  // React Router stays the single owner of navigation.
  broadcast({ type: 'logout' });
}

/**
 * Should a 401/403 from /refresh actually log the user out? Only when we're
 * genuinely online — a flaky-cellular blip or a false-offline window must keep
 * the cached session alive (especially in Electron, whose connectivity probes
 * are conservative). Mirrors the old useApi/AuthContext offline guards.
 */
async function shouldLogoutOnAuthFailure(): Promise<boolean> {
  if (!navigator.onLine) return false;
  if (electron?.getOfflineState) {
    try {
      const state = await electron.getOfflineState();
      if (!state.isOnline) return false;
    } catch { /* fall through — treat as online */ }
  }
  // Double-check: can we actually reach the server? navigator.onLine only
  // checks for a local NIC — it says true even when cellular has no route.
  // A quick HEAD to /api/health avoids logging out on a false-online blip.
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 5000);
    const probe = await fetch('/api/health', { method: 'HEAD', signal: ac.signal });
    clearTimeout(t);
    if (!probe.ok && probe.status >= 500) return false;
  } catch {
    return false;
  }
  return true;
}

// ─── The refresh itself ─────────────────────────────────────
let _inFlight: Promise<string | null> | null = null;

/**
 * Refresh the access token. Guarantees AT MOST ONE /api/auth/refresh in flight
 * across every open tab, so the worker's single-use refresh-token rotation can
 * never trigger a race-loss logout.
 *
 * Returns the fresh access token on success, or `null` on:
 *   - genuine auth failure (tokens cleared, `logout` event emitted), or
 *   - a transient failure (network/timeout/5xx) — the current token is KEPT so
 *     the caller can retry later.
 */
export function refreshAccessToken(): Promise<string | null> {
  if (_inFlight) return _inFlight;            // in-tab single-flight
  _inFlight = runCoordinated().finally(() => { _inFlight = null; });
  return _inFlight;
}

async function runCoordinated(): Promise<string | null> {
  const staleToken = localStorage.getItem(TOKEN_KEY);
  const locks = (typeof navigator !== 'undefined' ? (navigator as any).locks : null);

  if (locks?.request) {
    // Cross-tab critical section. If a peer rotates the token while we wait for
    // the lock, adopt its result instead of firing a second, doomed refresh.
    return locks.request(LOCK_NAME, async () => {
      const current = localStorage.getItem(TOKEN_KEY);
      if (current && current !== staleToken) return current; // peer already rotated
      return performRefresh();
    });
  }

  // Web Locks unavailable (old Safari / old Electron Chromium) → best-effort
  // single-tab refresh. The in-tab `_inFlight` guard still prevents self-races.
  return performRefresh();
}

async function performRefresh(): Promise<string | null> {
  // Cellular drop: navigator.onLine is false, or a false-online blip is
  // about to 401. Don't burn the single-use refresh token or log two
  // consecutive POST /api/auth/refresh 401s while the radio is down.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return null;
  }

  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
  const sessionId = localStorage.getItem(SESSION_ID_KEY);

  if (!refreshToken) {
    // No refresh token = effectively logged out.
    if (await shouldLogoutOnAuthFailure()) clearAuth();
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      // Send both spellings: the live legacy worker reads `refreshToken`
      // (+ `sessionId`, REQUIRED by its `WHERE session_id=? AND
      // refresh_token_hash=?` lookup); the /src/ rewrite reads `refresh_token`.
      body: JSON.stringify({ refreshToken, refresh_token: refreshToken, sessionId }),
      signal: controller.signal,
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({} as any));
      if (data.token) safeSet(TOKEN_KEY, data.token);
      if (data.refreshToken) safeSet(REFRESH_TOKEN_KEY, data.refreshToken);
      if (data.sessionId) safeSet(SESSION_ID_KEY, data.sessionId);
      if (data.token) broadcast({ type: 'token', token: data.token });
      // Keep the desktop shell's local_config cache (auth_token,
      // refresh_token, current_user_id, current_user_role) current on every
      // rotation — this is the SINGLE renderer-side refresh path (see the
      // module header), so without this the cache would only ever reflect
      // whatever token AuthContext's login() call seeded it with, going
      // stale the moment the worker rotates the token here instead.
      if (data.token && electron?.storeAuthSession) {
        electron.storeAuthSession(data.token, data.refreshToken ?? null).catch(() => { /* offline cache sync is best-effort */ });
      }
      return data.token ?? null;
    }

    // Web Locks serialized us and we re-read the freshest token under the lock,
    // so a 401/403 here is a GENUINE invalid/expired session — not a rotation
    // race. But in the field, transient D1 errors or proxy issues can produce
    // a false 401. Retry once after a brief delay before clearing auth.
    if (res.status === 401 || res.status === 403) {
      // One immediate retry — if it's a transient D1/proxy glitch, this catches it.
      await new Promise(r => setTimeout(r, 1000));
      try {
        const retryRes = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          body: JSON.stringify({ refreshToken, refresh_token: refreshToken, sessionId }),
          signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
        });
        if (retryRes.ok) {
          const data = await retryRes.json().catch(() => ({} as any));
          if (data.token) safeSet(TOKEN_KEY, data.token);
          if (data.refreshToken) safeSet(REFRESH_TOKEN_KEY, data.refreshToken);
          if (data.sessionId) safeSet(SESSION_ID_KEY, data.sessionId);
          if (data.token) broadcast({ type: 'token', token: data.token });
          if (data.token && electron?.storeAuthSession) {
            electron.storeAuthSession(data.token, data.refreshToken ?? null).catch(() => {});
          }
          return data.token ?? null;
        }
      } catch { /* retry also failed — fall through to clear auth */ }
      if (await shouldLogoutOnAuthFailure()) clearAuth();
      return null;
    }

    // 5xx / other → transient. Keep the token; the caller can retry later.
    return null;
  } catch {
    // Network / timeout / abort → transient. Keep the token.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
