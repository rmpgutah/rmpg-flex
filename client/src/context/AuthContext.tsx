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

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  loginBusy: boolean;
  login: (username: string, password: string) => Promise<void>;
  verify2FA: (code: string, trustDevice: boolean) => Promise<void>;
  verifyBackupCode: (code: string) => Promise<void>;
  setup2FA: () => Promise<{ qrCodeDataUri: string; manualKey: string }>;
  confirmSetup2FA: (code: string) => Promise<{ backupCodes: string[] }>;
  changePasswordDuringLogin: (newPassword: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  error: string | null;
  clearError: () => void;
  // Multi-step login state
  loginStep: LoginStep;
  setLoginStep: (step: LoginStep) => void;
  loginUsername: string;
  setLoginUsername: (u: string) => void;
  backupCodes: string[] | null;
  requiresPasswordChange: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = 'rmpg_token';
const REFRESH_TOKEN_KEY = 'rmpg_refresh_token';
const SESSION_ID_KEY = 'rmpg_session_id';

const REFRESH_BUFFER_MS = 60 * 1000;
const AUTH_FETCH_TIMEOUT_MS = 8000;

function parseJwtExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

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
  const [loginBusy, setLoginBusy] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRefreshingRef = useRef(false);

  // Multi-step login state
  const [loginStep, setLoginStep] = useState<LoginStep>('username');
  const [loginUsername, setLoginUsername] = useState('');
  const [tempToken, setTempToken] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [requiresPasswordChange, setRequiresPasswordChange] = useState(false);
  const deviceFingerprintRef = useRef<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  // Initialize device fingerprint
  useEffect(() => {
    getDeviceFingerprint().then(fp => { deviceFingerprintRef.current = fp; });
  }, []);

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
          clearTokens();
          setToken(null);
          setUser(null);
        }
      } catch {
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

  // Helper: complete login with tokens from server
  function completeLogin(data: any) {
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
  }

  const generationRef = useRef(0);

  // Load user from saved token on mount / token change
  useEffect(() => {
    const gen = ++generationRef.current;

    const loadUser = async () => {
      if (!token) {
        setUser(null);
        setIsLoading(false);
        return;
      }

      if (user) {
        setIsLoading(false);
        return;
      }

      try {
        const res = await fetchWithTimeout('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (gen !== generationRef.current) return;

        if (res.ok) {
          const data = await res.json();
          setUser(data.user || data);
          scheduleRefresh(token);
        } else if (res.status === 401) {
          const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
          if (refreshToken) {
            const refreshRes = await fetchWithTimeout('/api/auth/refresh', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ refreshToken }),
            });

            if (gen !== generationRef.current) return;

            if (refreshRes.ok) {
              const data = await refreshRes.json();
              localStorage.setItem(TOKEN_KEY, data.token);
              localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
              setToken(data.token);
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
        if (gen !== generationRef.current) return;
        // Dev fallback
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, scheduleRefresh]);

  // ─── Login Step 1: Username + Password ─────────────
  const login = useCallback(async (username: string, password: string) => {
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

        // Check multi-step responses
        if (data.step === 'verify_2fa') {
          setTempToken(data.tempToken);
          setRequiresPasswordChange(!!data.requiresPasswordChange);
          setLoginStep('verify_2fa');
          return;
        }

        if (data.step === 'setup_2fa') {
          setTempToken(data.tempToken);
          setRequiresPasswordChange(!!data.requiresPasswordChange);
          setLoginStep('setup_2fa');
          return;
        }

        if (data.step === 'password_change') {
          setTempToken(data.tempToken);
          setRequiresPasswordChange(true);
          setLoginStep('password_change');
          return;
        }

        // Direct login (trusted device, no 2FA needed)
        completeLogin(data);
      } else {
        const errData = await res.json().catch(() => ({}));

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
      if (err instanceof TypeError && err.message.includes('fetch')) {
        // Dev fallback
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
      } else {
        const message = err instanceof Error ? err.message : 'Login failed';
        setError(message);
        throw err;
      }
    } finally {
      setLoginBusy(false);
    }
  }, [scheduleRefresh]);

  // ─── Step 2a: Verify 2FA TOTP Code ────────────────
  const verify2FA = useCallback(async (code: string, trustDeviceFlag: boolean) => {
    setLoginBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/login/verify-2fa', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tempToken}`,
        },
        body: JSON.stringify({
          code,
          trustDevice: trustDeviceFlag,
          deviceFingerprint: deviceFingerprintRef.current,
        }),
      });

      if (res.ok) {
        const data = await res.json();

        if (data.step === 'password_change') {
          setTempToken(data.tempToken);
          setRequiresPasswordChange(true);
          setLoginStep('password_change');
          return;
        }

        completeLogin(data);
      } else {
        const errData = await res.json().catch(() => ({}));
        if (errData.code === 'MFA_EXPIRED') {
          setLoginStep('password');
          throw new Error('Verification expired. Please enter your password again.');
        }
        throw new Error(errData.error || 'Invalid verification code');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Verification failed';
      setError(message);
      throw err;
    } finally {
      setLoginBusy(false);
    }
  }, [tempToken, scheduleRefresh]);

  // ─── Step 2b: Verify Backup Code ──────────────────
  const verifyBackupCode = useCallback(async (code: string) => {
    setLoginBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/login/verify-backup-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tempToken}`,
        },
        body: JSON.stringify({ code, deviceFingerprint: deviceFingerprintRef.current }),
      });

      if (res.ok) {
        const data = await res.json();

        if (data.step === 'password_change') {
          setTempToken(data.tempToken);
          setRequiresPasswordChange(true);
          setLoginStep('password_change');
          return;
        }

        completeLogin(data);
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

  // ─── Step 3a: Setup 2FA (get QR code) ─────────────
  const setup2FA = useCallback(async () => {
    setError(null);

    const res = await fetch('/api/auth/2fa/setup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tempToken}`,
      },
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to start 2FA setup');
    }

    const data = await res.json();
    return { qrCodeDataUri: data.qrCodeDataUri, manualKey: data.manualKey };
  }, [tempToken]);

  // ─── Step 3b: Confirm 2FA Setup (verify first code) ──
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
      setBackupCodes(data.backupCodes);

      // Check if there's more steps
      if (data.requiresPasswordChange && data.tempToken) {
        setTempToken(data.tempToken);
        setRequiresPasswordChange(true);
        setLoginStep('show_backup_codes');
        return { backupCodes: data.backupCodes };
      }

      // If tokens are included, we can complete after showing backup codes
      if (data.token) {
        // Store for later completion after user acknowledges backup codes
        setTempToken(null);
        // Temporarily hold the final token data
        localStorage.setItem(TOKEN_KEY, data.token);
        if (data.refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
        if (data.sessionId) localStorage.setItem(SESSION_ID_KEY, data.sessionId);
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
  }, [tempToken]);

  // ─── Step 4: Change Password During Login ─────────
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
      completeLogin(data);
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
    setBackupCodes(null);
    setRequiresPasswordChange(false);

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
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  const contextValue = useMemo(() => ({
    user,
    token,
    isAuthenticated: !!user,
    isLoading,
    loginBusy,
    login,
    verify2FA,
    verifyBackupCode,
    setup2FA,
    confirmSetup2FA,
    changePasswordDuringLogin,
    logout,
    refreshUser,
    error,
    clearError,
    loginStep,
    setLoginStep,
    loginUsername,
    setLoginUsername,
    backupCodes,
    requiresPasswordChange,
  }), [user, token, isLoading, loginBusy, login, verify2FA, verifyBackupCode, setup2FA, confirmSetup2FA, changePasswordDuringLogin, logout, refreshUser, error, clearError, loginStep, loginUsername, backupCodes, requiresPasswordChange]);

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
