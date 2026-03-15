import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { User } from '../types';

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
  verifyBackupCode: (code: string, trustDevice?: boolean) => Promise<void>;
  /** Verify 2FA using a WebAuthn security key (YubiKey / Touch ID) */
  verifyWebAuthn: (trustDevice?: boolean) => Promise<void>;
  setup2FA: () => Promise<{ qrCodeDataUri: string; manualKey: string }>;
  confirmSetup2FA: (code: string) => Promise<{ backupCodes: string[] }>;
  changePasswordDuringLogin: (newPassword: string) => Promise<void>;
  pending2FA: boolean;
  twoFactorMethods: { totp: boolean; webauthn: boolean };
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
  backupCodes: string[] | null;
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
const AUTH_FETCH_TIMEOUT_MS = 8000;

function parseJwtExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
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

// Generate a device fingerprint hash for trusted device recognition
async function getDeviceFingerprint(): Promise<string> {
  const raw = [
    navigator.userAgent,
    navigator.language,
    screen.width + 'x' + screen.height,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ].join('|');

  try {
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    return Array.from(new Uint8Array(buffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    // Fallback for environments without SubtleCrypto
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      const char = raw.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(16);
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem(TOKEN_KEY));
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRefreshingRef = useRef(false);

  const clearError = useCallback(() => setError(null), []);

  // Schedule token refresh based on access token expiry
  const scheduleRefresh = useCallback((accessToken: string) => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }

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
          clearTokens();
          setToken(null);
          setUser(null);
          return;
        }

        const res = await fetchWithTimeout('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });

        if (res.ok) {
          const data = await res.json();
          localStorage.setItem(TOKEN_KEY, data.token);
          localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
          setToken(data.token);
          scheduleRefresh(data.token);
        } else {
          // Refresh failed — only force logout if we're online
          // (when offline in Electron, keep the cached user session alive)
          if (electron?.getOfflineState) {
            try {
              const state = await electron.getOfflineState();
              if (!state.isOnline) {
                // Offline — don't force logout, retry later
                refreshTimerRef.current = setTimeout(() => {
                  isRefreshingRef.current = false;
                  const ct = localStorage.getItem(TOKEN_KEY);
                  if (ct) scheduleRefresh(ct);
                }, 30000);
                return;
              }
            } catch { /* fall through to logout */ }
          }
          clearTokens();
          setToken(null);
          setUser(null);
        }
      } catch {
        // Network/timeout error — try again in 30 seconds
        refreshTimerRef.current = setTimeout(() => {
          isRefreshingRef.current = false;
          const currentToken = localStorage.getItem(TOKEN_KEY);
          if (currentToken) scheduleRefresh(currentToken);
        }, 30000);
      } finally {
        isRefreshingRef.current = false;
      }
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
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ refreshToken }),
            });

            if (gen !== generationRef.current) return; // stale

            if (refreshRes.ok) {
              const data = await refreshRes.json();
              localStorage.setItem(TOKEN_KEY, data.token);
              localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
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
      } catch {
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
          } catch { /* fall through to mock */ }
        }

        // Fallback mock user for pure-browser development
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
    getDeviceFingerprint().then(fp => { deviceFingerprintRef.current = fp; });
  }, []);

  // ── Two-Factor Authentication state ───────────────────
  const [pending2FA, setPending2FA] = useState(false);
  const [twoFactorMethods, setTwoFactorMethods] = useState<{ totp: boolean; webauthn: boolean }>({ totp: false, webauthn: false });
  const [tempToken, setTempToken] = useState<string | null>(null);

  const cancel2FA = useCallback(() => {
    setPending2FA(false);
    setTempToken(null);
    setError(null);
    setLoginStep('password');
  }, []);

  const verify2FA = useCallback(async (code: string, shouldTrustDevice?: boolean) => {
    if (!tempToken) throw new Error('No pending 2FA session');
    setLoginBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/login/verify-2fa', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tempToken}`,
        },
        body: JSON.stringify({
          code,
          deviceFingerprint: deviceFingerprintRef.current,
          trustDevice: shouldTrustDevice,
        }),
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

        localStorage.setItem(TOKEN_KEY, data.token);
        if (data.refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
        if (data.sessionId) localStorage.setItem(SESSION_ID_KEY, data.sessionId);

        setUser(data.user);
        setToken(data.token);
        setPending2FA(false);
        setTempToken(null);
        setIsLoading(false);
        scheduleRefresh(data.token);
        setLoginStep('complete');
      } else {
        const errData = await res.json().catch(() => ({}));
        if (errData.code === 'MFA_EXPIRED') {
          setLoginStep('password');
          setPending2FA(false);
          throw new Error('Verification expired. Please enter your password again.');
        }
        const message = errData.error || 'Invalid verification code';
        setError(message);
        throw new Error(message);
      }
    } finally {
      setLoginBusy(false);
    }
  }, [tempToken, scheduleRefresh]);

  // ── WebAuthn / Security Key 2FA verification ─────────
  const verifyWebAuthn = useCallback(async (shouldTrustDevice?: boolean) => {
    if (!tempToken) throw new Error('No pending 2FA session');
    setLoginBusy(true);
    setError(null);

    try {
      // 1. Get authentication options from server
      const optionsRes = await fetch('/api/auth/webauthn/authenticate-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      const verifyRes = await fetch('/api/auth/webauthn/authenticate-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId,
          tempToken,
          response: authResponse,
          trustDevice: shouldTrustDevice,
          deviceFingerprint: deviceFingerprintRef.current,
        }),
      });

      if (verifyRes.ok) {
        const data = await verifyRes.json();

        if (data.step === 'password_change') {
          setTempToken(data.tempToken);
          setRequiresPasswordChange(true);
          setLoginStep('password_change');
          return;
        }

        localStorage.setItem(TOKEN_KEY, data.token);
        if (data.refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
        if (data.sessionId) localStorage.setItem(SESSION_ID_KEY, data.sessionId);

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
        setError(err?.message || 'Security key verification failed');
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
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, deviceFingerprint }),
      });

      if (res.ok) {
        const data = await res.json();

        // ── Two-Factor Authentication required ──────────
        if (data.requires2FA || data.step === 'verify_2fa') {
          setTempToken(data.tempToken);
          setPending2FA(true);
          if (data.methods) {
            setTwoFactorMethods({ totp: !!data.methods.totp, webauthn: !!data.methods.webauthn });
          }
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

        localStorage.setItem(TOKEN_KEY, data.token);
        if (data.refreshToken) {
          localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
        }
        if (data.sessionId) {
          localStorage.setItem(SESSION_ID_KEY, data.sessionId);
        }

        // Store username for offline auth lookup
        localStorage.setItem(LAST_USERNAME_KEY, username);

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
      // If the server is unavailable, allow dev login
      if (err instanceof TypeError && err.message.includes('fetch')) {
        const mockToken = 'dev-token-' + Date.now();
        localStorage.setItem(TOKEN_KEY, mockToken);
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
        const message = err instanceof Error ? err.message : 'Login failed';
        setError(message);
        throw err;
      }
    } finally {
      setLoginBusy(false);
    }
  }, [scheduleRefresh]);

  // ─── Verify Backup Code ──────────────────────────
  const verifyBackupCode = useCallback(async (code: string, shouldTrustDevice?: boolean) => {
    if (!tempToken) throw new Error('No pending 2FA session');
    setLoginBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/login/verify-backup-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tempToken}`,
        },
        body: JSON.stringify({ code, deviceFingerprint: deviceFingerprintRef.current, trustDevice: shouldTrustDevice }),
      });

      if (res.ok) {
        const data = await res.json();

        if (data.step === 'password_change') {
          setTempToken(data.tempToken);
          setRequiresPasswordChange(true);
          setLoginStep('password_change');
          return;
        }

        localStorage.setItem(TOKEN_KEY, data.token);
        if (data.refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
        if (data.sessionId) localStorage.setItem(SESSION_ID_KEY, data.sessionId);
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
      const message = err instanceof Error ? err.message : 'Verification failed';
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
      const res = await fetch('/api/auth/2fa/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tempToken}`,
        },
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
    } finally {
      setLoginBusy(false);
    }
  }, [tempToken, loginBusy]);

  // ─── Confirm 2FA Setup (verify first code) ───────
  const confirmSetup2FA = useCallback(async (code: string) => {
    setLoginBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/2fa/setup/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tempToken}`,
        },
        body: JSON.stringify({ code, deviceFingerprint: deviceFingerprintRef.current }),
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
        localStorage.setItem(TOKEN_KEY, data.token);
        if (data.refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
        if (data.sessionId) localStorage.setItem(SESSION_ID_KEY, data.sessionId);
        // Update React state so the app recognizes the authenticated session
        setToken(data.token);
        if (data.user) setUser(data.user);
        scheduleRefresh(data.token);
      }

      setLoginStep('show_backup_codes');
      return { backupCodes: data.backupCodes };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Setup verification failed';
      setError(message);
      throw err;
    } finally {
      setLoginBusy(false);
    }
  }, [tempToken, scheduleRefresh]);

  // ─── Change Password During Login ────────────────
  const changePasswordDuringLogin = useCallback(async (newPassword: string) => {
    setLoginBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/login/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tempToken}`,
        },
        body: JSON.stringify({ newPassword, deviceFingerprint: deviceFingerprintRef.current }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Password change failed');
      }

      const data = await res.json();
      localStorage.setItem(TOKEN_KEY, data.token);
      if (data.refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
      if (data.sessionId) localStorage.setItem(SESSION_ID_KEY, data.sessionId);
      setUser(data.user);
      setToken(data.token);
      setIsLoading(false);
      scheduleRefresh(data.token);
      setLoginStep('complete');
      setTempToken(null);
      setRequiresPasswordChange(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Password change failed';
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

    // Best-effort notify server
    if (currentToken) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${currentToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refreshToken, sessionId }),
      }).catch(() => {});
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
    } catch { /* silent — stale data is acceptable */ }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
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
    twoFactorMethods,
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
    backupCodes: pendingBackupCodes,
    requiresPasswordChange,
  }), [user, token, isLoading, loginBusy, login, verify2FA, verifyBackupCode, verifyWebAuthn, setup2FA, confirmSetup2FA, changePasswordDuringLogin, pending2FA, twoFactorMethods, tempToken, cancel2FA, logout, refreshUser, error, clearError, loginStep, loginUsername, pendingBackupCodes, requiresPasswordChange]);

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
