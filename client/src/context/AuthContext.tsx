import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { User } from '../types';
import { resetVoiceState } from '../utils/voiceAlerts';

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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = 'rmpg_token';
const REFRESH_TOKEN_KEY = 'rmpg_refresh_token';
const SESSION_ID_KEY = 'rmpg_session_id';
const LAST_USERNAME_KEY = 'rmpg_last_username';

// Access window.electron safely (only present in Electron desktop app)
const electron = typeof window !== 'undefined' ? (window as any).electron : null;

// Refresh access token 60 seconds before it expires
const REFRESH_BUFFER_MS = 60 * 1000;

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

/** Fetch with an AbortController timeout so auth requests never hang indefinitely. */
function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = AUTH_FETCH_TIMEOUT_MS): Promise<Response> {
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
const NETWORK_ERROR_PATTERNS = ['failed to fetch', 'networkerror', 'network request failed', 'load failed'];
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem(TOKEN_KEY));
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRefreshingRef = useRef(false);
  const refreshFailCountRef = useRef(0);

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

      try {
        const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
        if (!refreshToken) {
          // No refresh token — force logout
          isRefreshingRef.current = false;
          clearTokens();
          setToken(null);
          setUser(null);
          return;
        }

        const res = await fetchWithTimeout('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          body: JSON.stringify({ refreshToken }),
        });

        if (res.ok) {
          const data = await res.json();
          safeSetItem(TOKEN_KEY, data.token);
          safeSetItem(REFRESH_TOKEN_KEY, data.refreshToken);
          setToken(data.token);
          refreshFailCountRef.current = 0; // reset backoff on success
          scheduleRefresh(data.token);
        } else {
          // Refresh failed — only force logout if we're online
          // (when offline in Electron, keep the cached user session alive)
          if (electron?.getOfflineState) {
            try {
              const state = await electron.getOfflineState();
              if (!state.isOnline) {
                // Offline — don't force logout, retry with backoff
                refreshFailCountRef.current++;
                const backoff = Math.min(Math.pow(2, refreshFailCountRef.current) * 1000, 30000);
                refreshTimerRef.current = setTimeout(() => {
                  isRefreshingRef.current = false;
                  const ct = localStorage.getItem(TOKEN_KEY);
                  if (ct) scheduleRefresh(ct);
                }, backoff);
                return;
              }
            } catch (err) { console.warn('[Auth] Token refresh retry failed:', err); /* fall through to logout */ }
          }
          clearTokens();
          setToken(null);
          setUser(null);
        }
      } catch (err) {
        console.warn('[Auth] Token refresh failed, retrying with backoff:', err);
        // Network/timeout error — retry with exponential backoff (1s, 2s, 4s, ... max 30s)
        refreshFailCountRef.current++;
        const backoff = Math.min(Math.pow(2, refreshFailCountRef.current) * 1000, 30000);
        refreshTimerRef.current = setTimeout(() => {
          isRefreshingRef.current = false;
          const currentToken = localStorage.getItem(TOKEN_KEY);
          if (currentToken) scheduleRefresh(currentToken);
        }, backoff);
        // Note: isRefreshingRef stays true until the backoff timer fires,
        // preventing duplicate concurrent refresh attempts during retry.
        return;
      }
      // Only clear the flag when we're NOT scheduling a retry
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

      // If we already have a user for this token (login() just set both)
      // there is nothing to fetch — just make sure loading is off.
      if (user) {
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
          scheduleRefresh(token);
        } else if (res.status === 401) {
          // Token expired — try refresh
          const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
          if (refreshToken) {
            const refreshRes = await fetchWithTimeout('/api/auth/refresh', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
              body: JSON.stringify({ refreshToken }),
            });

            if (gen !== generationRef.current) return; // stale

            if (refreshRes.ok) {
              const data = await refreshRes.json();
              safeSetItem(TOKEN_KEY, data.token);
              safeSetItem(REFRESH_TOKEN_KEY, data.refreshToken);
              setToken(data.token);
              // setToken will re-trigger this effect — new generation will handle it
              return;
            } else {
              clearTokens();
              setToken(null);
              setUser(null);
            }
          } else {
            clearTokens();
            setToken(null);
            setUser(null);
          }
        } else {
          clearTokens();
          setToken(null);
          setUser(null);
        }
      } catch (err) {
        console.warn('[Auth] Initial auth check failed:', err);
        if (gen !== generationRef.current) return; // stale

        // API not available — attempt offline auth via Electron local cache
        const lastUsername = localStorage.getItem(LAST_USERNAME_KEY);
        if (electron?.getCachedUser && lastUsername) {
          try {
            const cachedUser = await electron.getCachedUser(lastUsername);
            if (cachedUser) {
              setUser(cachedUser);
              return; // loaded from local DB — skip mock
            }
          } catch (err) { console.warn('[Auth] Cached user fetch failed:', err); /* fall through to mock */ }
        }

        // Fallback mock user for pure-browser development ONLY
        if (import.meta.env.DEV) {
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
        } else {
          // In production, clear auth state if server is unreachable
          clearTokens();
          setToken(null);
          setUser(null);
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

        setUser(data.user);
        setToken(data.token);
        setPending2FA(false);
        setTempToken(null);
        setIsLoading(false);
        scheduleRefresh(data.token);
        setLoginStep('complete');
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
      const { startAuthentication } = await import('@simplewebauthn/browser');
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

        setUser(data.user);
        setToken(data.token);
        setPending2FA(false);
        setTempToken(null);
        setIsLoading(false);
        scheduleRefresh(data.token);
        setLoginStep('complete');
      } else {
        const errData = await verifyRes.json().catch(() => ({}));
        const message = errData.error || 'Security key verification failed';
        setError(message);
        throw new Error(message);
      }
    } catch (err: any) {
      console.warn('[WEBAUTHN] Auth error:', err?.name, err?.code, err?.message);
      // Handle WebAuthn-specific errors with clear messages
      if (err?.name === 'NotAllowedError') {
        setError('Security key verification was cancelled or timed out. Try again.');
      } else if (err?.name === 'SecurityError') {
        setError('Security key not available on this domain.');
      } else if (err?.message?.includes('not supported')) {
        setError('WebAuthn is not supported in this browser.');
      } else if (err?.message?.includes('No security keys registered')) {
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
      const res = await fetchWithTimeout('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ username, password, deviceFingerprint }),
      });

      if (res.ok) {
        const data = await res.json();

        // ── Two-Factor Authentication required ──────────
        if (data.requires2FA || data.step === 'verify_2fa') {
          setTempToken(data.tempToken);
          setPending2FA(true);
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
        setUser(data.user);
        setToken(data.token);
        setPending2FA(false);
        setTempToken(null);
        setIsLoading(false);
        scheduleRefresh(data.token);
        setLoginStep('complete');
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
      setUser(data.user);
      setToken(data.token);
      setIsLoading(false);
      scheduleRefresh(data.token);
      setLoginStep('complete');
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
      }
    } catch (err) { console.warn('[Auth] User refresh failed:', err); }
  }, []);

  // ─── Session idle timeout (CJIS compliance) ────────
  // Tracks user activity (mouse, keyboard, touch) and auto-logs out
  // after the configured inactivity period.
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleTimeoutMsRef = useRef(60 * 60 * 1000); // 1 hour of inactivity before auto-logout
  const sessionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxSessionMsRef = useRef(12 * 60 * 60 * 1000); // 12 hours of continuous use before auto-logout

  // Fetch session timeout config from server once authenticated
  useEffect(() => {
    if (!user || !token) return;
    fetch('/api/auth/session-timeout', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.timeoutMinutes) {
          idleTimeoutMsRef.current = data.timeoutMinutes * 60 * 1000;
          resetIdleTimer(); // restart with updated timeout
        }
        if (data?.maxSessionHours) {
          maxSessionMsRef.current = data.maxSessionHours * 60 * 60 * 1000;
        }
      })
      .catch(() => { /* use default */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!user]);

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    // Only set idle timer if user is authenticated
    if (!user) return;
    idleTimerRef.current = setTimeout(() => {
      console.warn('[Auth] Session idle timeout — auto-logout');
      // Set a flag so login page can show timeout message
      sessionStorage.setItem('rmpg_idle_logout', '1');
      logout();
    }, idleTimeoutMsRef.current);
  }, [user, logout]);

  // Listen for user activity to reset idle timer
  useEffect(() => {
    if (!user) {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      return;
    }

    const onActivity = () => resetIdleTimer();
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll', 'mousemove'];

    // Throttle — only reset timer at most once per 30 seconds to avoid overhead
    let lastReset = Date.now();
    const throttledActivity = () => {
      const now = Date.now();
      if (now - lastReset > 30_000) {
        lastReset = now;
        onActivity();
      }
    };

    events.forEach(e => document.addEventListener(e, throttledActivity, { passive: true }));
    resetIdleTimer(); // start the timer

    return () => {
      events.forEach(e => document.removeEventListener(e, throttledActivity));
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [user, resetIdleTimer]);

  // ─── Absolute session duration timer ─────────────────
  // Forces logout after maxSessionHours regardless of activity.
  // Server also enforces this on refresh, but this gives a clean client UX.
  useEffect(() => {
    if (!user) {
      if (sessionTimerRef.current) clearTimeout(sessionTimerRef.current);
      return;
    }

    sessionTimerRef.current = setTimeout(() => {
      console.warn('[Auth] Max session duration reached — auto-logout');
      sessionStorage.setItem('rmpg_session_expired', '1');
      logout();
    }, maxSessionMsRef.current);

    return () => {
      if (sessionTimerRef.current) clearTimeout(sessionTimerRef.current);
    };
  }, [user, logout]);

  // Cleanup on unmount — clear timers and sensitive state from memory
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      if (sessionTimerRef.current) {
        clearTimeout(sessionTimerRef.current);
        sessionTimerRef.current = null;
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
    refreshUser,
    error,
    clearError,
    loginStep,
    setLoginStep,
    loginUsername,
    setLoginUsername,
    pendingBackupCodes,
    requiresPasswordChange,
  }), [user, token, isLoading, loginBusy, login, verify2FA, verifyBackupCode, verifyWebAuthn, setup2FA, confirmSetup2FA, changePasswordDuringLogin, pending2FA, tempToken, cancel2FA, logout, refreshUser, error, clearError, loginStep, loginUsername, pendingBackupCodes, requiresPasswordChange]);

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

export default AuthContext;
