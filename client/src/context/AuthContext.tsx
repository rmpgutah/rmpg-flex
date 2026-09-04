import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { User } from '../types';
import { resetVoiceState } from '../utils/voiceAlerts';
import { playStartupSound } from '../utils/startupSound';
import { refreshAccessToken, onAuthEvent } from '../utils/tokenRefresh';
import { importWithRetry } from '../utils/importWithRetry';
import { warmOfflineCache } from '../utils/offlineCacheWarm';

export type LoginStep =
  | 'username'
  | 'password'
  | 'verify_2fa'
  | 'setup_2fa'
  | 'confirm_setup_2fa'
  | 'show_backup_codes'
  | 'password_change'
  | 'complete';

interface LoginResult {
  requires2FA: boolean;
  success: boolean;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  loginBusy: boolean;
  login: (username: string, password: string) => Promise<LoginResult>;
  verify2FA: (code: string, trustDevice?: boolean) => Promise<void>;
  verifyBackupCode: (code: string) => Promise<void>;
  /** Verify 2FA using a WebAuthn security key (YubiKey / Touch ID) */
  verifyWebAuthn: (trustDevice?: boolean) => Promise<void>;
  setup2FA: () => Promise<{ qrCodeDataUri: string; manualKey: string }>;
  confirmSetup2FA: (code: string) => Promise<{ backupCodes: string[] }>;
  changePasswordDuringLogin: (newPassword: string) => Promise<void>;
  pending2FA: boolean;
  /** Expose temp token for WebAuthn authenticate-options flow */
  tempToken: string | null;
  cancel2FA: () => void;
  logout: () => void;
  /**
   * User-initiated sign-out from the top-bar / drawer. Strictly blocks while
   * the officer is still on shift — payroll integrity wins over UX here per
   * the workflow spec. Returns the on-shift state so the UI can route the
   * officer to End Shift (which prompts ending mileage). For force-flows
   * (password change, etc.) call `logout()` directly instead.
   */
  signOut: () => Promise<{ ok: true } | { ok: false; reason: 'on_shift'; message: string }>;
  refreshUser: () => Promise<void>;
  error: string | null;
  clearError: () => void;
  // Multi-step login state
  loginStep: LoginStep;
  setLoginStep: (step: LoginStep) => void;
  loginUsername: string;
  setLoginUsername: (u: string) => void;
  pendingBackupCodes: string[] | null;
  requiresPasswordChange: boolean;
  /** Which second factors the pending login may use. Defaults totp-only. */
  twoFactorMethods: { totp: boolean; webauthn: boolean };
}

// Exported (v1047) so opt-in consumers like IntelProvider can read the
// current user safely without requiring an AuthProvider wrapper in unit
// tests. Most callers should still use the throwing `useAuth()` hook.
export const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Exported so other localStorage writers of the same session (e.g. the SSO
// callback page, which persists a token bundle outside of AuthProvider's own
// fetch flows) always target the identical keys — a local copy here would
// silently drift if these ever get renamed.
export const TOKEN_KEY = 'rmpg_token';
export const REFRESH_TOKEN_KEY = 'rmpg_refresh_token';
export const SESSION_ID_KEY = 'rmpg_session_id';
const LAST_USERNAME_KEY = 'rmpg_last_username';

// Access window.electron safely (only present in Electron desktop app)
const electron = typeof window !== 'undefined' ? (window as any).electron : null;

// Refresh access token 120 seconds before it expires.
// Field officers on cellular experience frequent network transitions (WiFi ↔
// cellular, dead zones). A 60-second buffer was too tight — a single failed
// refresh attempt with exponential backoff could leave the token expired before
// the retry succeeded. 120 seconds gives two full retry cycles of margin.
const REFRESH_BUFFER_MS = 120 * 1000;

// Max time (ms) any auth fetch is allowed before aborting — prevents infinite "Initializing..."
// 15s is generous for field conditions (vehicle WiFi, cell data in dead zones)
// Auth requests are tiny (~1KB request, ~2KB response). 6s turned out too
// aggressive — on slow cellular /auth/me legitimately takes 5-10s and was
// being aborted with "signal is aborted without reason", breaking login.
// 12s is long enough for slow cellular but still bounded so a genuinely
// broken network fails before the browser's default ~120s timeout. The
// real splash-resolves-faster fix lives in the SW (cache-first /assets/)
// and nginx (Cache-Control immutable) layers, not in shortening this.
const AUTH_FETCH_TIMEOUT_MS = 12000;

function parseJwtExpiry(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length < 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    return payload.exp ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

// Last server-confirmed user, persisted so a returning field device can render
// optimistically on the next cold boot instead of blocking the "Initializing"
// splash on a slow-cellular /auth/me round-trip.
export const CACHED_USER_KEY = 'rmpg_cached_user';

function readCachedUser(): User | null {
  try {
    const raw = localStorage.getItem(CACHED_USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch { return null; }
}

function writeCachedUser(u: User): void {
  try { localStorage.setItem(CACHED_USER_KEY, JSON.stringify(u)); } catch { /* quota / private mode */ }
}

/**
 * Optimistic-boot user. Returns a cached user ONLY when a stored token exists
 * and is NOT locally expired — so we never render the UI behind an obviously
 * dead token. The token is still validated server-side on the background
 * /auth/me call (and on every data fetch), so this is purely a perceived-speed
 * win, not a security relaxation.
 */
function initialOptimisticUser(): User | null {
  let tok: string | null = null;
  try { tok = localStorage.getItem(TOKEN_KEY); } catch { return null; }
  if (!tok) return null;
  const exp = parseJwtExpiry(tok);
  if (exp !== null && exp <= Date.now()) return null; // expired → must refresh first
  return readCachedUser();
}

/** Fetch with an AbortController timeout so auth requests never hang indefinitely. */
export function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = AUTH_FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

/**
 * Convert raw browser network errors into user-friendly messages.
 * `fetch()` throws TypeError("Failed to fetch") on network failures and
 * DOMException("signal is aborted without reason") on AbortController timeout.
 * Neither is helpful for a field officer staring at a login screen.
 */
const NETWORK_ERROR_PATTERNS = ['failed to fetch', 'networkerror', 'network request failed', 'load failed', 'offline', '503'];
const TIMEOUT_ERROR_PATTERNS = ['abort', 'timed out', 'timeout'];

function friendlyAuthError(err: unknown): string {
  if (!(err instanceof Error)) return 'Login failed. Please try again.';
  const msg = err.message.toLowerCase();
  if (NETWORK_ERROR_PATTERNS.some(p => msg.includes(p))) {
    return 'Unable to connect to the server. Check your network connection and try again.';
  }
  if (TIMEOUT_ERROR_PATTERNS.some(p => msg.includes(p))) {
    return 'Server request timed out. Check your network connection and try again.';
  }
  // Already a meaningful server-side error message — pass through
  return err.message;
}

// Generate a device fingerprint hash for trusted device recognition
// Cached at module level — never changes during a session
let _cachedFingerprint: string | null = null;
let _fingerprintPromise: Promise<string> | null = null;
async function getDeviceFingerprint(): Promise<string> {
  if (_cachedFingerprint) return _cachedFingerprint;
  if (_fingerprintPromise) return _fingerprintPromise;
  _fingerprintPromise = _computeFingerprint();
  return _fingerprintPromise;
}
async function _computeFingerprint(): Promise<string> {
  const raw = [
    navigator.userAgent,
    navigator.language,
    navigator.languages?.join(',') || '',
    screen.width + 'x' + screen.height,
    screen.colorDepth?.toString() || '',
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.hardwareConcurrency?.toString() || '',
    (navigator as any).deviceMemory?.toString() || '',
    navigator.maxTouchPoints?.toString() || '0',
    new Date().getTimezoneOffset().toString(),
  ].join('|');

  try {
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    _cachedFingerprint = Array.from(new Uint8Array(buffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    return _cachedFingerprint;
  } catch {
    // Fallback for environments without SubtleCrypto
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      const char = raw.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    _cachedFingerprint = Math.abs(hash).toString(16);
    return _cachedFingerprint;
  }
}

/** Safe localStorage.setItem — silently handles quota exceeded / private browsing */
function safeSetItem(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* quota exceeded or private browsing */ }
}

// Pushes a freshly issued session (login, 2FA completion, password-change
// completion) into the Electron main process's local_config cache, via the
// `storeAuthSession` bridge preload.js exposes. Browser tab sessions have no
// `electron` (see the module-level `electron` const above) so this is a
// silent no-op there — it only matters for the desktop shell's offline mode
// and PIN sessions, which derive current_user_id/current_user_role from
// this token (see main.js's 'auth:store-session' handler). Fire-and-forget:
// a failure here must never block or fail the login flow itself.
function syncElectronSession(newToken: string, refreshToken?: string | null): void {
  try {
    electron?.storeAuthSession?.(newToken, refreshToken ?? null)?.catch?.(() => { /* offline cache sync is best-effort */ });
  } catch { /* not in Electron, or bridge unavailable */ }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Optimistic boot: render from the cached user when the stored token is still
  // locally valid, so a returning field device is interactive immediately rather
  // than blocking the splash on a slow-cellular /auth/me round-trip. The loadUser
  // effect below revalidates in the background.
  const [user, setUser] = useState<User | null>(initialOptimisticUser);
  const [token, setToken] = useState<string | null>(() => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } });
  const [isLoading, setIsLoading] = useState(() => user === null);
  const [error, setError] = useState<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRefreshingRef = useRef(false);
  const refreshFailCountRef = useRef(0);
  // One-shot flag: true when `user` came from cache at boot and therefore still
  // owes a single background /auth/me validation. Seeded from the first-render
  // `user` value (no extra localStorage read), consumed inside loadUser.
  const needsBootValidationRef = useRef<boolean | null>(null);
  if (needsBootValidationRef.current === null) needsBootValidationRef.current = user !== null;

  // Persist the authenticated user on every change so the NEXT cold boot can
  // render optimistically (see initialOptimisticUser). Centralized here so all
  // login/refresh paths are covered; cleared on logout (setUser(null)).
  useEffect(() => {
    if (user) {
      writeCachedUser(user);
      // Pre-populate the SW API cache so all pages have stale data available
      // if the device goes offline before the officer visits each page.
      // Fire-and-forget — never blocks login, never retries on failure.
      warmOfflineCache();
    } else {
      try { localStorage.removeItem(CACHED_USER_KEY); } catch { /* ignore */ }
    }
  }, [user]);

  // Re-warm the SW API cache when the device reconnects so stale data
  // refreshes automatically after an offline period.
  useEffect(() => {
    if (!user) return;
    const handleOnline = () => {
      void (async () => {
        if (typeof navigator !== 'undefined' && !navigator.onLine) return;
        // Refresh first so the warmer doesn't fire 17 GETs with a dead JWT
        // (the 401 storm after a cellular drop). If the session is genuinely
        // gone, refreshAccessToken clears auth and we skip the warm.
        await refreshAccessToken();
        if (!localStorage.getItem(TOKEN_KEY)) return;
        warmOfflineCache();
      })();
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [user]);

  // Best-effort device GPS attach, once per session — fires only through
  // the browser's OWN navigator.geolocation permission prompt (this code
  // cannot see coordinates the browser doesn't hand it, and never re-prompts
  // if the officer declines). Fire-and-forget: never blocks login, never
  // retries, and any failure (denied, unsupported, no fix, network error)
  // is silently swallowed — this is enrichment for the Security Dashboard,
  // not something login correctness can depend on. Keyed on `user` so it
  // covers every login path (password, 2FA, backup code, SSO) from one
  // place rather than duplicating the call at each success site.
  const deviceLocationSentRef = useRef(false);
  useEffect(() => {
    if (!user) { deviceLocationSentRef.current = false; return; }
    if (deviceLocationSentRef.current) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    deviceLocationSentRef.current = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const currentToken = localStorage.getItem(TOKEN_KEY);
        if (!currentToken) return;
        fetchWithTimeout('/api/auth/session/device-location', {
          method: 'POST',
          headers: { Authorization: `Bearer ${currentToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracyMeters: pos.coords.accuracy,
          }),
        }).catch(() => { /* best-effort */ });
      },
      () => { /* permission denied / unavailable — no-op */ },
      { timeout: 5000, maximumAge: 60_000 },
    );
  }, [user]);

  const clearError = useCallback(() => setError(null), []);

  // Schedule token refresh based on access token expiry
  const scheduleRefresh = useCallback((accessToken: string) => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }
    // Reset the refresh lock — a new schedule means the previous attempt
    // either succeeded or was superseded (e.g. useApi refreshed the token).
    // Without this, a failed backoff leaves isRefreshingRef=true and the
    // new timer's callback would skip the refresh entirely.
    isRefreshingRef.current = false;

    const expiresAt = parseJwtExpiry(accessToken);
    if (!expiresAt) return;

    const refreshIn = Math.max(0, expiresAt - Date.now() - REFRESH_BUFFER_MS);

    refreshTimerRef.current = setTimeout(async () => {
      if (isRefreshingRef.current) return;
      isRefreshingRef.current = true;

      // Delegate to the shared, cross-tab-coordinated refresher. It owns the
      // /refresh request (single in-flight across all tabs via Web Locks),
      // token persistence, and the cross-tab `token`/`logout` broadcast. This
      // eliminates the rotation race that used to log officers out mid-shift:
      // the worker rotates the refresh token on every call, and a background
      // apiFetch refresh used to race this scheduled one — the loser got a 401
      // and force-logged-out. See utils/tokenRefresh.ts.
      const newToken = await refreshAccessToken();

      if (newToken) {
        // Shared module already persisted + broadcast; sync local React state.
        setToken(newToken);
        refreshFailCountRef.current = 0; // reset backoff on success
        isRefreshingRef.current = false;
        scheduleRefresh(newToken);
        return;
      }

      // No token returned. Two cases:
      //  (a) Auth was cleared (genuine 401/403 while online) — the shared
      //      module emitted a `logout` event; our onAuthEvent subscription
      //      below tears down user state. Nothing to do here.
      //  (b) Transient failure (offline / network / timeout / 5xx) — the token
      //      is still in storage. Reschedule on it with exponential backoff so
      //      a flaky-cellular blip doesn't end the shift.
      const current = localStorage.getItem(TOKEN_KEY);
      if (current) {
        refreshFailCountRef.current++;
        // Exponential backoff capped at 60s. Field officers on cellular hit
        // dead zones and WiFi↔cellular transitions that can take 30-45s to
        // resolve. 30s cap was too tight — the token expired during backoff.
        // 60s cap gives the network time to recover while still retrying
        // frequently enough to catch the moment connectivity returns.
        const backoff = Math.min(Math.pow(2, refreshFailCountRef.current) * 1000, 60000);
        refreshTimerRef.current = setTimeout(() => {
          isRefreshingRef.current = false;
          const ct = localStorage.getItem(TOKEN_KEY);
          if (ct) scheduleRefresh(ct);
        }, backoff);
        return;
      }
      isRefreshingRef.current = false;
    }, refreshIn);
  }, []);

  function clearTokens() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(SESSION_ID_KEY);
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }

  // Mirror of the latest access token, so the cross-tab subscription below can
  // cheaply skip events that merely echo this tab's own refresh.
  const lastTokenRef = useRef(token);
  useEffect(() => { lastTokenRef.current = token; }, [token]);

  // ─── Cross-tab auth sync ────────────────────────────────────
  // The shared refresher (utils/tokenRefresh.ts) emits an event whenever the
  // access token is rotated or auth is cleared — in THIS tab or any other.
  // Adopt those so a refresh performed by one tab (or a logout) is reflected
  // everywhere, instead of each tab independently re-refreshing (and racing the
  // worker's single-use rotation into a 401).
  useEffect(() => {
    const unsubscribe = onAuthEvent((e) => {
      if (e.type === 'token') {
        if (e.token && e.token !== lastTokenRef.current) {
          lastTokenRef.current = e.token;
          refreshFailCountRef.current = 0;
          setToken(e.token);
          scheduleRefresh(e.token); // reschedule on the freshly-rotated token's expiry
        }
      } else if (e.type === 'logout') {
        if (lastTokenRef.current !== null) {
          lastTokenRef.current = null;
          clearTokens();
          setToken(null);
          setUser(null);
        }
      }
    });
    return unsubscribe;
  }, [scheduleRefresh]); // eslint-disable-line react-hooks/exhaustive-deps

  // Monotonically-increasing "generation" counter.
  // Every time login/logout/mount kicks off an async load we bump this.
  // When the async work finishes, it only applies its result if the
  // generation is still current — preventing stale responses from winning.
  const generationRef = useRef(0);

  // Load user from saved token on mount, or when a token-refresh changes
  // the token.  login() sets user directly and never touches this path.
  useEffect(() => {
    const gen = ++generationRef.current;

    const loadUser = async () => {
      if (!token) {
        setUser(null);
        setIsLoading(false);
        return;
      }

      // Did this user come from the optimistic cache at boot? If so we still owe
      // ONE background /auth/me validation — fall through (the splash is already
      // down, so this validates silently). A network failure of it must NOT log
      // the user out (see the catch below).
      const optimisticBoot = !!user && needsBootValidationRef.current === true;
      needsBootValidationRef.current = false; // consume the one-shot

      // If we already have a user and it isn't an optimistic boot (login() just
      // set it, or we already validated) there is nothing to fetch.
      if (user && !optimisticBoot) {
        setIsLoading(false);
        return;
      }

      try {
        const res = await fetchWithTimeout('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (gen !== generationRef.current) return; // stale

        if (res.ok) {
          const data = await res.json();
          setUser(data.user || data);
          void mergeProfileImage(token); // hydrate app-wide avatar (not in /me)
          scheduleRefresh(token);
        } else if (res.status === 401) {
          // Access token expired on boot — refresh via the shared, cross-tab
          // coordinated refresher (same single in-flight /refresh the scheduled
          // path uses, so a returning multi-tab device can't race itself out).
          const newToken = await refreshAccessToken();

          if (gen !== generationRef.current) return; // stale

          if (newToken) {
            setToken(newToken);
            // setToken re-triggers this effect — a new generation handles it.
            return;
          }
          // Refresh returned null. If auth was genuinely cleared, the shared
          // module emitted a `logout` event (handled by the subscription
          // below) and TOKEN_KEY is gone → reflect logout. If a token is still
          // present it was a transient failure; keep the optimistic user and
          // let the scheduled refresh recover.
          if (!localStorage.getItem(TOKEN_KEY)) {
            clearTokens();
            setToken(null);
            setUser(null);
          }
        } else if (res.status >= 500) {
          // Server error (502/503 during deploy or cellular blip) — keep the
          // session alive and let scheduled refresh recover. Logging out on a
          // transient 5xx drops officers mid-shift.
          console.warn(`[Auth] /me returned ${res.status} — keeping session, will retry`);
          if (user) scheduleRefresh(token);
        } else {
          // 403 or other definitive rejection — clear auth
          clearTokens();
          setToken(null);
          setUser(null);
        }
      } catch (err) {
        console.warn('[Auth] Initial auth check failed:', err);
        if (gen !== generationRef.current) return; // stale

        // Network/timeout error — NOT a token rejection. Keep the user signed
        // in; the scheduled refresh will recover when connectivity returns.
        // A false logout here would drop officers mid-shift on flaky cellular.
        if (token && localStorage.getItem(TOKEN_KEY)) {
          scheduleRefresh(token);
          setIsLoading(false);
          return;
        }

        // No token in storage — genuinely logged out
        if (!import.meta.env.DEV) {
          setToken(null);
          setUser(null);
        } else {
          setUser({
            id: 'dev-1',
            username: 'dispatcher',
            email: 'dispatcher@rmpg.com',
            first_name: 'John',
            last_name: 'Mitchell',
            role: 'dispatcher',
            badge_number: 'D-101',
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        }
      } finally {
        if (gen === generationRef.current) {
          setIsLoading(false);
        }
      }
    };

    loadUser();
    // NOTE: `user` is intentionally omitted from deps — we only re-run
    // when the token itself changes (mount, refresh, logout).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, scheduleRefresh]);

  // loginBusy drives the LoginPage "Authenticating…" button spinner,
  // but does NOT flip the top-level isLoading (which gates AppRoutes
  // and would show the full-screen "Initializing…" overlay).
  const [loginBusy, setLoginBusy] = useState(false);

  // ── Multi-step login state ────────────────────────────
  const [loginStep, setLoginStep] = useState<LoginStep>('username');
  const [loginUsername, setLoginUsername] = useState('');
  const [pendingBackupCodes, setPendingBackupCodes] = useState<string[] | null>(null);
  const [requiresPasswordChange, setRequiresPasswordChange] = useState(false);
  const deviceFingerprintRef = useRef<string | null>(null);

  // Initialize device fingerprint
  useEffect(() => {
    getDeviceFingerprint().then(fp => { deviceFingerprintRef.current = fp; }).catch(() => { /* fingerprint unavailable */ });
  }, []);

  // ── Two-Factor Authentication state ───────────────────
  const [pending2FA, setPending2FA] = useState(false);
  const [twoFactorMethods, setTwoFactorMethods] = useState<{ totp: boolean; webauthn: boolean }>({ totp: false, webauthn: false });
  const [tempToken, setTempToken] = useState<string | null>(null);
  const tempTokenRef = useRef<string | null>(null);
  // Keep ref in sync so callbacks always see the latest value
  useEffect(() => { tempTokenRef.current = tempToken; }, [tempToken]);

  const cancel2FA = useCallback(() => {
    setPending2FA(false);
    setTempToken(null);
    setTwoFactorMethods({ totp: false, webauthn: false });
    setError(null);
    setLoginStep('password');
  }, []);

  const verify2FA = useCallback(async (code: string, trustDevice?: boolean) => {
    const currentToken = tempTokenRef.current || tempToken;
    if (!currentToken) throw new Error('No pending 2FA session');
    setLoginBusy(true);
    setError(null);

    try {
      const res = await fetchWithTimeout('/api/auth/login/verify-2fa', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          Authorization: `Bearer ${currentToken}`,
        },
        body: JSON.stringify({ tempToken: currentToken, code, deviceFingerprint: deviceFingerprintRef.current, trustDevice: !!trustDevice }),
      });

      if (res.ok) {
        const data = await res.json();

        // Server may require a password change after 2FA verification
        if (data.step === 'password_change') {
          setTempToken(data.tempToken);
          setRequiresPasswordChange(true);
          setLoginStep('password_change');
          return;
        }

        safeSetItem(TOKEN_KEY, data.token);
        if (data.refreshToken) safeSetItem(REFRESH_TOKEN_KEY, data.refreshToken);
        if (data.sessionId) safeSetItem(SESSION_ID_KEY, data.sessionId);
        syncElectronSession(data.token, data.refreshToken);

        setUser(data.user);
        setToken(data.token);
        setPending2FA(false);
        setTempToken(null);
        setIsLoading(false);
        scheduleRefresh(data.token);
        setLoginStep('complete');
        playStartupSound();
      } else {
        const errData = await res.json().catch(() => ({}));
        if (errData.code === 'MFA_EXPIRED' || errData.code === 'VERIFICATION_SESSION_EXPIRED_PLEASE') {
          setLoginStep('password');
          setPending2FA(false);
          throw new Error('Verification session expired. Please sign in again.');
        }
        if (errData.code === 'TOTP_DECRYPT_ERROR') {
          setError('Authentication configuration error. Contact your administrator.');
          throw new Error(errData.error);
        }
        const message = errData.error || 'Invalid verification code. Wait for a new code and try again.';
        setError(message);
        throw new Error(message);
      }
    } catch (err: unknown) {
      const message = friendlyAuthError(err);
      setError(message);
      throw err;
    } finally {
      setLoginBusy(false);
    }
  }, [tempToken, scheduleRefresh]);

  // ── WebAuthn / Security Key 2FA verification ─────────
  const verifyWebAuthn = useCallback(async (trustDeviceFlag?: boolean) => {
    if (!tempToken) throw new Error('No pending 2FA session');
    setLoginBusy(true);
    setError(null);

    try {
      // 1. Get authentication options from server
      const optionsRes = await fetchWithTimeout('/api/auth/webauthn/authenticate-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ tempToken }),
      });

      if (!optionsRes.ok) {
        const errData = await optionsRes.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to get security key options');
      }

      const { options, challengeId } = await optionsRes.json();

      // 2. Prompt the user's security key (browser native WebAuthn dialog)
      const { startAuthentication } = await importWithRetry(() => import('@simplewebauthn/browser'));
      const authResponse = await startAuthentication({ optionsJSON: options });

      // 3. Verify with server
      const verifyRes = await fetchWithTimeout('/api/auth/webauthn/authenticate-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ challengeId, tempToken, response: authResponse, trustDevice: !!trustDeviceFlag, deviceFingerprint: deviceFingerprintRef.current }),
      });

      if (verifyRes.ok) {
        const data = await verifyRes.json();

        if (data.step === 'password_change') {
          setTempToken(data.tempToken);
          setRequiresPasswordChange(true);
          setLoginStep('password_change');
          return;
        }

        safeSetItem(TOKEN_KEY, data.token);
        if (data.refreshToken) safeSetItem(REFRESH_TOKEN_KEY, data.refreshToken);
        if (data.sessionId) safeSetItem(SESSION_ID_KEY, data.sessionId);
        syncElectronSession(data.token, data.refreshToken);

        setUser(data.user);
        setToken(data.token);
        setPending2FA(false);
        setTempToken(null);
        setIsLoading(false);
        scheduleRefresh(data.token);
        setLoginStep('complete');
        playStartupSound();
      } else {
        const errData = await verifyRes.json().catch(() => ({}));
        const message = errData.error || 'Security key verification failed';
        setError(message);
        throw new Error(message);
      }
    } catch (err) {
      const webAuthnErr = err as { name?: string; code?: string; message?: string };
      console.warn('[WEBAUTHN] Auth error:', webAuthnErr.name, webAuthnErr.code, webAuthnErr.message);
      // Handle WebAuthn-specific errors with clear messages
      if (((err as { name?: string }).name === 'NotAllowedError')) {
        setError('Security key verification was cancelled or timed out. Try again.');
      } else if (((err as { name?: string }).name === 'SecurityError')) {
        setError('Security key not available on this domain.');
      } else if (webAuthnErr.message?.includes('not supported')) {
        setError('WebAuthn is not supported in this browser.');
      } else if (webAuthnErr.message?.includes('No security keys registered')) {
        setError('No security keys are registered. Set up a key in Profile → Security.');
      } else {
        const message = friendlyAuthError(err);
        setError(message);
      }
      throw err;
    } finally {
      setLoginBusy(false);
    }
  }, [tempToken, scheduleRefresh]);

  const login = useCallback(async (username: string, password: string): Promise<LoginResult> => {
    setLoginBusy(true);
    setError(null);

    try {
      const deviceFingerprint = deviceFingerprintRef.current;
      const loginInit: RequestInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ username, password, deviceFingerprint }),
      };
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new Error('Unable to connect to the server. Check your network connection and try again.');
      }
      let res = await fetchWithTimeout('/api/auth/login', loginInit);
      // Worker/CF 502–504 (D1 busy during export, deploy blip). Retry a few
      // times before showing the form a failure — POST /login 503 used to
      // coincide with a SW 503 Offline navigation of /login?return=…
      for (let attempt = 0; attempt < 3 && (res.status === 502 || res.status === 503 || res.status === 504); attempt++) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        if (typeof navigator !== 'undefined' && navigator.onLine === false) break;
        res = await fetchWithTimeout('/api/auth/login', loginInit);
      }

      if (res.ok) {
        const data = await res.json();

        // ── Two-Factor Authentication required ──────────
        if (data.requires2FA || data.step === 'verify_2fa') {
          setTempToken(data.tempToken);
          setPending2FA(true);
          setTwoFactorMethods({
            totp: data.methods?.totp !== false,
            webauthn: !!data.methods?.webauthn,
          });
          setRequiresPasswordChange(!!data.requiresPasswordChange);
          setLoginStep('verify_2fa');
          return { requires2FA: true, success: false };
        }

        // ── 2FA Setup required ──────────────────────────
        if (data.step === 'setup_2fa') {
          setTempToken(data.tempToken);
          setRequiresPasswordChange(!!data.requiresPasswordChange);
          setLoginStep('setup_2fa');
          return { requires2FA: false, success: false };
        }

        // ── Password change required ────────────────────
        if (data.step === 'password_change') {
          setTempToken(data.tempToken);
          setRequiresPasswordChange(true);
          setLoginStep('password_change');
          return { requires2FA: false, success: false };
        }

        safeSetItem(TOKEN_KEY, data.token);
        if (data.refreshToken) {
          safeSetItem(REFRESH_TOKEN_KEY, data.refreshToken);
        }
        if (data.sessionId) {
          safeSetItem(SESSION_ID_KEY, data.sessionId);
        }
        syncElectronSession(data.token, data.refreshToken);

        // Store last login info for display on login page
        if (data.lastLoginAt) {
          try {
            sessionStorage.setItem('rmpg_last_login_info', JSON.stringify({
              time: data.lastLoginAt,
              ip: data.lastLoginIp || '',
            }));
          } catch (err) { console.warn('[Auth] Session storage write failed:', err); }
        }

        // Store username for offline auth lookup
        safeSetItem(LAST_USERNAME_KEY, username);

        // Set user BEFORE token so the effect sees user is already
        // populated and skips the redundant /me round-trip.
        setUser(data.user);
        setToken(data.token);
        setIsLoading(false);
        scheduleRefresh(data.token);
        setLoginStep('complete');
        playStartupSound();

        // Trigger offline sync to seed local DB (fire-and-forget)
        if (electron?.triggerSync) {
          electron.triggerSync().catch(() => { /* silent — sync will retry */ });
        }

        return { requires2FA: false, success: true };
      } else {
        const errData = await res.json().catch(() => ({}));

        // Handle specific error codes
        if (errData.code === 'ACCOUNT_LOCKED') {
          throw new Error(errData.error || 'Account locked');
        }

        throw new Error(
          errData.warning
            ? `${errData.error || 'Invalid credentials'}. ${errData.warning}`
            : errData.error || errData.message || 'Invalid credentials'
        );
      }
    } catch (err: unknown) {
      // If the server is unavailable, allow dev login in development only
      if (import.meta.env.DEV && err instanceof TypeError && err.message.includes('fetch')) {
        const mockToken = 'dev-token-' + Date.now();
        safeSetItem(TOKEN_KEY, mockToken);
        setUser({
          id: 'dev-1',
          username,
          email: `${username}@rmpg.com`,
          first_name: 'John',
          last_name: 'Mitchell',
          role: username === 'admin' ? 'admin' : 'dispatcher',
          badge_number: 'D-101',
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        setToken(mockToken);
        setIsLoading(false);
        setLoginStep('complete');
        playStartupSound();
        return { requires2FA: false, success: true };
      } else {
        const message = friendlyAuthError(err);
        setError(message);
        throw err;
      }
    } finally {
      setLoginBusy(false);
    }
  }, [scheduleRefresh]);

  // ─── Verify Backup Code ──────────────────────────
  const verifyBackupCode = useCallback(async (code: string) => {
    const currentToken = tempTokenRef.current || tempToken;
    if (!currentToken) throw new Error('No pending 2FA session');
    setLoginBusy(true);
    setError(null);

    try {
      const res = await fetchWithTimeout('/api/auth/login/verify-backup-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          Authorization: `Bearer ${currentToken}`,
        },
        body: JSON.stringify({ tempToken: currentToken, code, deviceFingerprint: deviceFingerprintRef.current }),
      });

      if (res.ok) {
        const data = await res.json();

        if (data.step === 'password_change') {
          setTempToken(data.tempToken);
          setRequiresPasswordChange(true);
          setLoginStep('password_change');
          return;
        }

        safeSetItem(TOKEN_KEY, data.token);
        if (data.refreshToken) safeSetItem(REFRESH_TOKEN_KEY, data.refreshToken);
        if (data.sessionId) safeSetItem(SESSION_ID_KEY, data.sessionId);
        syncElectronSession(data.token, data.refreshToken);
        setUser(data.user);
        setToken(data.token);
        setPending2FA(false);
        setTempToken(null);
        setIsLoading(false);
        scheduleRefresh(data.token);
        setLoginStep('complete');
        playStartupSound();
      } else {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Invalid backup code');
      }
    } catch (err: unknown) {
      const message = friendlyAuthError(err);
      setError(message);
      throw err;
    } finally {
      setLoginBusy(false);
    }
  }, [tempToken, scheduleRefresh]);

  // ─── Setup 2FA (get QR code) ─────────────────────
  const setup2FA = useCallback(async (): Promise<{ qrCodeDataUri: string; manualKey: string }> => {
    if (loginBusy) throw new Error('Setup already in progress');
    setLoginBusy(true);
    setError(null);

    try {
      const currentToken = tempTokenRef.current || tempToken;
      const res = await fetchWithTimeout('/api/auth/2fa/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}),
        },
        body: JSON.stringify({ tempToken: currentToken }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        if (errData.code === 'TOKEN_EXPIRED' || errData.code === 'MFA_EXPIRED') {
          setLoginStep('password');
          setPending2FA(false);
          setTempToken(null);
          const message = 'Session expired. Please log in again.';
          setError(message);
          throw new Error(message);
        }
        const message = errData.error || 'Failed to start 2FA setup';
        setError(message);
        throw new Error(message);
      }

      const data = await res.json();
      return { qrCodeDataUri: data.qrCodeDataUri, manualKey: data.manualKey };
    } catch (err: unknown) {
      const message = friendlyAuthError(err);
      setError(message);
      throw err;
    } finally {
      setLoginBusy(false);
    }
  }, [loginBusy]);

  // ─── Confirm 2FA Setup (verify first code) ───────
  const confirmSetup2FA = useCallback(async (code: string) => {
    setLoginBusy(true);
    setError(null);

    try {
      const currentToken = tempTokenRef.current || tempToken;
      const res = await fetchWithTimeout('/api/auth/2fa/setup/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}),
        },
        body: JSON.stringify({ code, tempToken: currentToken, deviceFingerprint: deviceFingerprintRef.current }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Invalid code');
      }

      const data = await res.json();
      setPendingBackupCodes(data.backupCodes);

      if (data.requiresPasswordChange && data.tempToken) {
        setTempToken(data.tempToken);
        setRequiresPasswordChange(true);
        setLoginStep('show_backup_codes');
        return { backupCodes: data.backupCodes };
      }

      if (data.token) {
        safeSetItem(TOKEN_KEY, data.token);
        if (data.refreshToken) safeSetItem(REFRESH_TOKEN_KEY, data.refreshToken);
        if (data.sessionId) safeSetItem(SESSION_ID_KEY, data.sessionId);
        syncElectronSession(data.token, data.refreshToken);
        // Update React state so the app recognizes the authenticated session
        setToken(data.token);
        if (data.user) setUser(data.user);
        scheduleRefresh(data.token);
      }

      setLoginStep('show_backup_codes');
      return { backupCodes: data.backupCodes };
    } catch (err: unknown) {
      const message = friendlyAuthError(err);
      setError(message);
      throw err;
    } finally {
      setLoginBusy(false);
    }
  }, [scheduleRefresh]);

  // ─── Change Password During Login ────────────────
  const changePasswordDuringLogin = useCallback(async (newPassword: string) => {
    setLoginBusy(true);
    setError(null);

    try {
      const res = await fetchWithTimeout('/api/auth/login/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          Authorization: `Bearer ${tempToken}`,
        },
        body: JSON.stringify({ newPassword, deviceFingerprint: deviceFingerprintRef.current }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Password change failed');
      }

      const data = await res.json();
      safeSetItem(TOKEN_KEY, data.token);
      if (data.refreshToken) safeSetItem(REFRESH_TOKEN_KEY, data.refreshToken);
      if (data.sessionId) safeSetItem(SESSION_ID_KEY, data.sessionId);
      syncElectronSession(data.token, data.refreshToken);
      setUser(data.user);
      setToken(data.token);
      setIsLoading(false);
      scheduleRefresh(data.token);
      setLoginStep('complete');
        playStartupSound();
      setTempToken(null);
      setRequiresPasswordChange(false);
    } catch (err: unknown) {
      const message = friendlyAuthError(err);
      setError(message);
      throw err;
    } finally {
      setLoginBusy(false);
    }
  }, [tempToken, scheduleRefresh]);

  const logout = useCallback(() => {
    const currentToken = localStorage.getItem(TOKEN_KEY);
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    const sessionId = localStorage.getItem(SESSION_ID_KEY);

    clearTokens();
    setToken(null);
    setUser(null);
    setLoginStep('username');
    setTempToken(null);
    setPendingBackupCodes(null);
    setRequiresPasswordChange(false);

    // Clear voice alerts state (dedup cache, queue, cached voice)
    resetVoiceState();

    // Best-effort notify server — log failure so it's visible in console
    if (currentToken) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${currentToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refreshToken, sessionId }),
      }).catch((err) => {
        console.warn('Logout API call failed — server session may remain active:', err);
      });
    }
  }, []);

  // User-facing sign-out — gated on shift state. If the officer is on duty,
  // refuse to clear the session and return a typed reason so the UI can route
  // them to the ShiftCard's End Shift (which prompts ending mileage). Network
  // failure on the duty/me probe is treated as "unknown → safer to block" so
  // a cellular dropout can't sidestep the gate.
  const signOut = useCallback(async (): Promise<{ ok: true } | { ok: false; reason: 'on_shift'; message: string }> => {
    const currentToken = localStorage.getItem(TOKEN_KEY);
    if (!currentToken) { logout(); return { ok: true }; }
    try {
      const res = await fetchWithTimeout('/api/dispatch/duty/me', {
        headers: { Authorization: `Bearer ${currentToken}` },
      });
      if (res.ok) {
        const state = await res.json().catch(() => null);
        if (state && state.on_shift) {
          return { ok: false, reason: 'on_shift', message: 'End your shift before signing out — open the SHIFT card and tap End Shift.' };
        }
      } else if (res.status !== 401 && res.status !== 404) {
        // Treat any other server error as "unknown shift state" → block.
        return { ok: false, reason: 'on_shift', message: 'Could not confirm shift state — end your shift, then sign out.' };
      }
    } catch (err) {
      console.warn('[Auth] signOut shift check failed — blocking sign-out:', err);
      return { ok: false, reason: 'on_shift', message: 'Offline — end your shift before signing out.' };
    }
    logout();
    return { ok: true };
  }, [logout]);

  // The avatar shown app-wide (topbar, mobile drawer) reads user.profile_image,
  // but /auth/me only returns avatar_url — the base64 avatar lives on a
  // separate endpoint. Fetch it and merge so the avatar updates everywhere
  // after an upload, not just inside the profile modal. Best-effort: a failure
  // (offline / not set) leaves the user object untouched.
  const mergeProfileImage = useCallback(async (currentToken: string) => {
    try {
      const res = await fetchWithTimeout('/api/auth/profile-image', {
        headers: { Authorization: `Bearer ${currentToken}` },
      });
      if (!res.ok) return;
      const { profile_image } = await res.json();
      setUser(prev => (prev ? { ...prev, profile_image: profile_image || undefined } : prev));
    } catch { /* offline / not set — keep existing user */ }
  }, []);

  // Re-fetch user from /auth/me to pick up profile changes (name, email, etc.)
  const refreshUser = useCallback(async () => {
    const currentToken = localStorage.getItem(TOKEN_KEY);
    if (!currentToken) return;
    try {
      const res = await fetchWithTimeout('/api/auth/me', {
        headers: { Authorization: `Bearer ${currentToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user || data);
        void mergeProfileImage(currentToken);
      }
    } catch (err) { console.warn('[Auth] User refresh failed:', err); }
  }, [mergeProfileImage]);

   // Auto-signout mechanisms removed per user request
   // Session idle timeout and absolute session duration timer have been disabled

  // Cleanup on unmount — clear timers and sensitive state from memory
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }

      // Clear sensitive auth state from memory on unmount
      tempTokenRef.current = null;
      isRefreshingRef.current = false;
    };
  }, []);

  // Memoize context value to prevent unnecessary re-renders of consumers
  const contextValue = useMemo(() => ({
    user,
    token,
    isAuthenticated: !!user,
    isLoading,
    loginBusy,
    login,
    verify2FA,
    verifyBackupCode,
    verifyWebAuthn,
    setup2FA,
    confirmSetup2FA,
    changePasswordDuringLogin,
    pending2FA,
    tempToken,
    cancel2FA,
    logout,
    signOut,
    refreshUser,
    error,
    clearError,
    loginStep,
    setLoginStep,
    loginUsername,
    setLoginUsername,
    pendingBackupCodes,
    requiresPasswordChange,
    twoFactorMethods,
  }), [user, token, isLoading, loginBusy, login, verify2FA, verifyBackupCode, verifyWebAuthn, setup2FA, confirmSetup2FA, changePasswordDuringLogin, pending2FA, tempToken, cancel2FA, logout, signOut, refreshUser, error, clearError, loginStep, loginUsername, pendingBackupCodes, requiresPasswordChange, twoFactorMethods]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export function useOptionalAuth(): AuthContextType | null {
  return useContext(AuthContext) ?? null;
}

export default AuthContext;
