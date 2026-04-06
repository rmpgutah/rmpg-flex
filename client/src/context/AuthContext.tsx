import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { User } from '../types';

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
  verify2FA: (code: string) => Promise<void>;
  pending2FA: boolean;
  cancel2FA: () => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
  /** Dismiss the Force-2FA modal for this session only. */
  dismiss2FASetup: () => void;
  error: string | null;
  clearError: () => void;
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

  // ── Two-Factor Authentication state ───────────────────
  const [pending2FA, setPending2FA] = useState(false);
  const [tempToken, setTempToken] = useState<string | null>(null);

  const cancel2FA = useCallback(() => {
    setPending2FA(false);
    setTempToken(null);
    setError(null);
  }, []);

  const verify2FA = useCallback(async (code: string) => {
    if (!tempToken) throw new Error('No pending 2FA session');
    setLoginBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/verify-2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tempToken, code }),
      });

      if (res.ok) {
        const data = await res.json();
        localStorage.setItem(TOKEN_KEY, data.token);
        if (data.refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
        if (data.sessionId) localStorage.setItem(SESSION_ID_KEY, data.sessionId);

        setUser(data.user);
        setToken(data.token);
        setPending2FA(false);
        setTempToken(null);
        setIsLoading(false);
        scheduleRefresh(data.token);
      } else {
        const errData = await res.json().catch(() => ({}));
        const message = errData.error || 'Invalid verification code';
        setError(message);
        throw new Error(message);
      }
    } finally {
      setLoginBusy(false);
    }
  }, [tempToken, scheduleRefresh]);

  const login = useCallback(async (username: string, password: string): Promise<LoginResult> => {
    setLoginBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (res.ok) {
        const data = await res.json();

        // ── Two-Factor Authentication required ──────────
        if (data.requires2FA) {
          setTempToken(data.tempToken);
          setPending2FA(true);
          return { requires2FA: true, success: false };
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

  const logout = useCallback(() => {
    const currentToken = localStorage.getItem(TOKEN_KEY);
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    const sessionId = localStorage.getItem(SESSION_ID_KEY);

    clearTokens();
    setToken(null);
    setUser(null);

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

  // Dismiss Force-2FA modal for this session (client-only, next login re-prompts)
  const dismiss2FASetup = useCallback(() => {
    setUser(prev => prev ? { ...prev, requires_2fa_setup: false } : prev);
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
    pending2FA,
    cancel2FA,
    logout,
    refreshUser,
    dismiss2FASetup,
    error,
    clearError,
  }), [user, token, isLoading, loginBusy, login, verify2FA, pending2FA, cancel2FA, logout, refreshUser, dismiss2FASetup, error, clearError]);

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
