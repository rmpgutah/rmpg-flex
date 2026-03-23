// ============================================================
// RMPG Flex — High-Security Login Page
// Single-screen credentials (username + password), system info,
// device info, then 2FA / setup / password change flows.
// ============================================================

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Eye, EyeOff, AlertCircle, ShieldCheck, ArrowLeft, Lock,
  KeyRound, Usb, Fingerprint, Monitor, Server, Wifi, Clock,
} from 'lucide-react';
import { useAuth, type LoginStep } from '../context/AuthContext';
import TotpCodeInput from '../components/TotpCodeInput';
import PasswordStrengthMeter from '../components/security/PasswordStrengthMeter';
import BackupCodesDisplay from '../components/security/BackupCodesDisplay';

const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '5.3.9';
const BUILD_TIME: string =
  typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '';

type TwoFactorMode = 'choose' | 'totp' | 'webauthn' | 'backup';

// ── Device detection helpers ──────────────────────
function getDeviceInfo() {
  const ua = navigator.userAgent;
  let browser = 'Unknown';
  if (ua.includes('Electron')) browser = 'RMPG Desktop';
  else if (ua.includes('Edg/')) browser = 'Edge';
  else if (ua.includes('Chrome/') && !ua.includes('Edg/')) browser = 'Chrome';
  else if (ua.includes('Firefox/')) browser = 'Firefox';
  else if (ua.includes('Safari/') && !ua.includes('Chrome')) browser = 'Safari';

  let os = 'Unknown';
  if (ua.includes('Windows NT 10')) os = 'Windows 10/11';
  else if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac OS X')) os = 'macOS';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
  else if (ua.includes('Linux')) os = 'Linux';

  let deviceType = 'Desktop';
  if (/Mobi|Android/i.test(ua)) deviceType = 'Mobile';
  else if (/Tablet|iPad/i.test(ua)) deviceType = 'Tablet';

  const screen = `${window.screen.width}×${window.screen.height}`;
  const viewport = `${window.innerWidth}×${window.innerHeight}`;
  const touchEnabled = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const online = navigator.onLine;

  return { browser, os, deviceType, screen, viewport, touchEnabled, online };
}

function getCurrentTime() {
  return new Date().toLocaleString('en-US', {
    timeZone: 'America/Denver',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}

// Status bar text/led for each step
const stepStatus: Record<LoginStep, { text: string; color: string }> = {
  username:           { text: 'AWAITING CREDENTIALS', color: '#d4a017' },
  password:           { text: 'AUTHENTICATING',       color: '#d4a017' },
  verify_2fa:         { text: '2FA VERIFICATION',     color: '#a855f7' },
  setup_2fa:          { text: '2FA SETUP REQUIRED',   color: '#bc1010' },
  confirm_setup_2fa:  { text: '2FA SETUP — VERIFY',   color: '#bc1010' },
  show_backup_codes:  { text: 'SAVE BACKUP CODES',    color: '#d4a017' },
  password_change:    { text: 'PASSWORD CHANGE REQ.',  color: '#bc1010' },
  complete:           { text: 'AUTHENTICATED',         color: '#22c55e' },
};

export default function LoginPage() {
  const {
    login,
    verify2FA,
    verifyBackupCode,
    verifyWebAuthn,
    setup2FA,
    confirmSetup2FA,
    changePasswordDuringLogin,
    pending2FA,
    cancel2FA,
    error,
    clearError,
    loginBusy,
    loginStep,
    setLoginStep,
    pendingBackupCodes,
    requiresPasswordChange,
  } = useAuth();

  const [loginUsername, setLoginUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [backupCode, setBackupCode] = useState('');
  const [trustThisDevice, setTrustThisDevice] = useState(false);
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [webauthnError, setWebauthnError] = useState(false);
  const [twoFactorMode, setTwoFactorMode] = useState<TwoFactorMode>('choose');
  const [twoFactorMethods, setTwoFactorMethods] = useState<{ totp?: boolean; webauthn?: boolean }>({});

  // Last login display
  const [lastLoginInfo, setLastLoginInfo] = useState<{ time: string; ip: string } | null>(null);

  // Check for last login info stored during login flow
  useEffect(() => {
    if (loginStep === 'complete') {
      const info = sessionStorage.getItem('rmpg_last_login_info');
      if (info) {
        try {
          const parsed = JSON.parse(info);
          setLastLoginInfo(parsed);
          sessionStorage.removeItem('rmpg_last_login_info');
          // Auto-dismiss after 8 seconds
          const t = setTimeout(() => setLastLoginInfo(null), 8000);
          return () => clearTimeout(t);
        } catch { /* ignore */ }
      }
    }
  }, [loginStep]);

  // 2FA setup state
  const [qrCodeUri, setQrCodeUri] = useState('');
  const [manualKey, setManualKey] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [showManualKey, setShowManualKey] = useState(false);

  // Password change state
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Clock
  const [clock, setClock] = useState(getCurrentTime());
  useEffect(() => {
    const iv = setInterval(() => setClock(getCurrentTime()), 1000);
    return () => clearInterval(iv);
  }, []);

  // Device info (computed once)
  const device = useMemo(() => getDeviceInfo(), []);

  // Idle logout message
  const [showIdleMessage, setShowIdleMessage] = useState(false);
  const [showSessionExpired, setShowSessionExpired] = useState(false);
  useEffect(() => {
    if (sessionStorage.getItem('rmpg_idle_logout') === '1') {
      setShowIdleMessage(true);
      sessionStorage.removeItem('rmpg_idle_logout');
      const t = setTimeout(() => setShowIdleMessage(false), 15000);
      return () => clearTimeout(t);
    }
    if (sessionStorage.getItem('rmpg_session_expired') === '1') {
      setShowSessionExpired(true);
      sessionStorage.removeItem('rmpg_session_expired');
      const t = setTimeout(() => setShowSessionExpired(false), 15000);
      return () => clearTimeout(t);
    }
  }, []);

  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const totpRef = useRef<HTMLInputElement>(null);
  const setupCodeRef = useRef<HTMLInputElement>(null);

  // Auto-focus
  useEffect(() => {
    const timer = setTimeout(() => {
      if (loginStep === 'username' || loginStep === 'password') usernameRef.current?.focus();
      else if (loginStep === 'verify_2fa') totpRef.current?.focus();
      else if (loginStep === 'confirm_setup_2fa') setupCodeRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, [loginStep]);

  // Auto-submit TOTP when 6 digits entered (with ref guard to prevent double-submit)
  const totpSubmittingRef = useRef(false);
  useEffect(() => {
    const trimmed = totpCode.replace(/\s/g, '');
    if (trimmed.length === 6 && loginStep === 'verify_2fa' && !loginBusy && !totpSubmittingRef.current) {
      totpSubmittingRef.current = true;
      handleTotpSubmit(trimmed).finally(() => { totpSubmittingRef.current = false; });
    }
    if (trimmed.length < 6) totpSubmittingRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totpCode, loginStep, loginBusy]);

  // ── Handlers ──────────────────────────────────────
  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginUsername.trim() || !password) return;
    clearError();
    try {
      await login(loginUsername, password);
    } catch {
      // Error handled by context
    }
  };

  const handleBack = () => {
    cancel2FA();
    setTotpCode('');
    setBackupCode('');
    setTwoFactorMode('choose');
    setWebauthnError(false);
    setPassword('');
    setLoginStep('username');
  };

  const handleTotpSubmit = async (code: string) => {
    clearError();
    try {
      await verify2FA(code, trustThisDevice);
    } catch {
      setTotpCode('');
    }
  };

  const handleBackupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!backupCode.trim()) return;
    clearError();
    try {
      await verifyBackupCode(backupCode.trim());
    } catch {
      setBackupCode('');
    }
  };

  const handleWebAuthn = async () => {
    clearError();
    setWebauthnError(false);
    try {
      await verifyWebAuthn();
    } catch {
      setWebauthnError(true);
    }
  };

  const getEffectiveMode = (): TwoFactorMode => {
    if (twoFactorMode !== 'choose') return twoFactorMode;
    const hasBoth = twoFactorMethods.totp && twoFactorMethods.webauthn;
    if (!hasBoth) {
      if (twoFactorMethods.webauthn) return 'webauthn';
      return 'totp';
    }
    return 'choose';
  };

  const effectiveMode = pending2FA ? getEffectiveMode() : 'choose';

  const handleStartSetup = async () => {
    clearError();
    try {
      const result = await setup2FA();
      setQrCodeUri(result.qrCodeDataUri);
      setManualKey(result.manualKey);
      setLoginStep('confirm_setup_2fa');
    } catch {
      // Error handled by context
    }
  };

  const handleConfirmSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    try {
      await confirmSetup2FA(setupCode);
    } catch {
      setSetupCode('');
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    if (newPassword !== confirmPassword) return;
    try {
      await changePasswordDuringLogin(newPassword);
    } catch {
      // Error handled
    }
  };

  const handleBackupCodesAck = () => {
    if (requiresPasswordChange) {
      setLoginStep('password_change');
    } else {
      window.location.reload();
    }
  };

  const handleBackWebAuthn = () => {
    if (twoFactorMode !== 'choose' && twoFactorMethods.totp && twoFactorMethods.webauthn) {
      setTwoFactorMode('choose');
      setTotpCode('');
      setBackupCode('');
      setWebauthnError(false);
      clearError();
      return;
    }
    cancel2FA();
    setTotpCode('');
    setBackupCode('');
    setTwoFactorMode('choose');
    setWebauthnError(false);
    setPassword('');
    setLoginStep('username');
  };

  const handleSecurityKeyAuth = async () => {
    clearError();
    try {
      await verifyWebAuthn(trustThisDevice);
    } catch {
      // Error handled by context
    }
  };

  const status = stepStatus[loginStep] || stepStatus.username;
  const isCredentialStep = !pending2FA && loginStep !== 'setup_2fa' && loginStep !== 'confirm_setup_2fa' && loginStep !== 'show_backup_codes' && loginStep !== 'password_change';

  // ── Info row item ──────────────────────────────
  const InfoRow = ({ label, value }: { label: string; value: string }) => (
    <div className="flex items-center justify-between py-[3px]" style={{ borderBottom: '1px solid #0d1520' }}>
      <span className="text-[8px] uppercase tracking-wider font-bold" style={{ color: '#5a6e80' }}>{label}</span>
      <span className="text-[9px] font-mono" style={{ color: '#8a9aaa' }}>{value}</span>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative" style={{ background: 'linear-gradient(180deg, #060c14 0%, #141e2b 100%)' }}>
      {/* Animated grid background */}
      <div className="login-grid-bg" />

      {/* ── Security Warning Banner ─────────────────── */}
      <div
        className="w-full max-w-lg mb-2 sm:mb-3 px-3 sm:px-0 relative z-10"
        role="alert"
      >
        <div
          style={{
            background: 'linear-gradient(180deg, #1a0000 0%, #0d0000 100%)',
            border: '1px solid #991b1b',
            borderTop: '2px solid #ef4444',
          }}
          className="p-2 sm:p-2.5 text-center"
        >
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <div className="w-1 h-1 rounded-full animate-pulse" style={{ background: '#ef4444', boxShadow: '0 0 4px #ef4444' }} />
            <span className="text-[8px] sm:text-[9px] font-black uppercase tracking-[0.2em]" style={{ color: '#ef4444' }}>Warning</span>
            <div className="w-1 h-1 rounded-full animate-pulse" style={{ background: '#ef4444', boxShadow: '0 0 4px #ef4444' }} />
          </div>
          <p className="text-[8px] sm:text-[9px] leading-relaxed font-medium" style={{ color: '#ef7a7a' }}>
            RESTRICTED INTERNAL SYSTEM. AUTHORIZED USERS ONLY.
            ALL ACTIVITY IS MONITORED. UNAUTHORIZED ACCESS IS PROHIBITED.
          </p>
        </div>
      </div>

      {/* ── Main Content ─────────────────────────────── */}
      <div className="relative w-full max-w-lg px-2 sm:px-0 z-10">
        {/* Logo */}
        <div className="text-center mb-2">
          <div className="inline-flex items-center justify-center">
            <img
              src="/rmpg flex.png"
              alt="RMPG Flex"
              className="drop-shadow-[0_0_15px_rgba(26,90,158,0.25)]"
              style={{
                height: 'clamp(56px, 14vw, 88px)',
                width: 'clamp(56px, 14vw, 88px)',
                objectFit: 'contain',
              }}
              draggable={false}
            />
          </div>
          <div className="flex items-center justify-center gap-2 mt-0.5">
            <div className="h-px w-8 sm:w-12" style={{ background: 'linear-gradient(90deg, transparent, #124070)' }} />
            <p className="text-[7px] sm:text-[8px] tracking-[0.15em] uppercase font-bold" style={{ color: 'rgba(26, 90, 158, 0.65)' }}>
              Secure Authentication
            </p>
            <div className="h-px w-8 sm:w-12" style={{ background: 'linear-gradient(90deg, #124070, transparent)' }} />
          </div>
        </div>

        {/* ── Login Card ──────────────────────────────── */}
        <div className="shadow-2xl relative overflow-hidden panel-beveled bg-surface-base">
          {/* Title bar */}
          <div className="panel-title-bar flex items-center gap-2">
            <ShieldCheck className="w-3 h-3" style={{ color: '#1a5a9e' }} />
            <span>
              {loginStep === 'setup_2fa' || loginStep === 'confirm_setup_2fa'
                ? '2FA SETUP'
                : loginStep === 'show_backup_codes'
                  ? 'BACKUP CODES'
                  : loginStep === 'password_change'
                    ? 'PASSWORD CHANGE'
                    : pending2FA
                      ? 'IDENTITY VERIFICATION'
                      : 'SYSTEM LOGIN'}
            </span>
            <div className="ml-auto flex items-center gap-1">
              {pending2FA && (
                <div className="flex items-center gap-1 mr-2">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#4ade80' }} />
                  <span className="text-[8px] uppercase tracking-wide" style={{ color: '#4ade80' }}>Password OK</span>
                </div>
              )}
              <div className="w-4 h-3 flex items-center justify-center text-[8px] text-rmpg-400" style={{ background: '#2a3e58', border: '1px solid #3a5070', borderBottom: '1px solid #162236' }}>_</div>
              <div className="w-4 h-3 flex items-center justify-center text-[8px] text-rmpg-400" style={{ background: '#2a3e58', border: '1px solid #3a5070', borderBottom: '1px solid #162236' }}>□</div>
            </div>
          </div>

          <div className="p-4 sm:p-5">
            {/* Idle timeout message */}
            {showIdleMessage && (
              <div className="mb-3 p-2.5 bg-amber-900/25 border border-amber-700/50 flex items-start gap-2">
                <Lock className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-amber-300 font-semibold">Session Expired</p>
                  <p className="text-[9px] text-amber-400/80">You were automatically logged out due to inactivity.</p>
                </div>
              </div>
            )}
            {/* Max session duration message */}
            {showSessionExpired && (
              <div className="mb-3 p-2.5 bg-blue-900/25 border border-blue-700/50 flex items-start gap-2">
                <Lock className="w-3.5 h-3.5 text-blue-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-blue-300 font-semibold">Session Duration Limit</p>
                  <p className="text-[9px] text-blue-400/80">Your session reached the maximum duration. Please sign in again.</p>
                </div>
              </div>
            )}

            {/* Last login info banner */}
            {lastLoginInfo && (
              <div className="flex items-center gap-2 p-2 mb-4 animate-fade-in" style={{ background: 'rgba(34, 197, 94, 0.08)', border: '1px solid #166534' }}>
                <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#22c55e' }} />
                <p className="text-xs" style={{ color: '#86efac' }}>
                  Last login: {(() => {
                    const d = new Date(lastLoginInfo.time);
                    const now = new Date();
                    const diff = now.getTime() - d.getTime();
                    const hours = Math.floor(diff / 3600000);
                    const mins = Math.floor(diff / 60000);
                    const timeAgo = hours > 24 ? `${Math.floor(hours / 24)}d ago` : hours > 0 ? `${hours}h ago` : `${mins}m ago`;
                    return timeAgo;
                  })()}
                  {lastLoginInfo.ip && ` from ${lastLoginInfo.ip}`}
                </p>
              </div>
            )}

            {/* Error message */}
            {error && (
              <div className="flex items-center gap-2 p-2 mb-4 animate-fade-in" style={{
                background: error.includes('locked') ? 'rgba(239, 68, 68, 0.2)' : 'rgba(220, 38, 38, 0.15)',
                border: error.includes('locked') ? '1px solid #ef4444' : '1px solid #991b1b',
              }}>
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#ef4444' }} />
                <div>
                  <p className="text-xs" style={{ color: '#ef7a7a' }}>{error}</p>
                  {error.includes('attempt') && (
                    <p className="text-[10px] mt-0.5" style={{ color: '#f87171' }}>Too many failed attempts will lock your account.</p>
                  )}
                </div>
              </div>
            )}

            {/* ══════ CREDENTIALS STEP (username + password on one screen) ══════ */}
            {isCredentialStep && (
              <form onSubmit={handleCredentialsSubmit} className="space-y-3">
                <div>
                  <label htmlFor="username" className="block text-[10px] font-bold uppercase mb-1 tracking-wide" style={{ color: '#8a9aaa' }}>
                    Username
                  </label>
                  <input
                    ref={usernameRef}
                    id="username"
                    type="text"
                    className="input-dark login-input-glow h-9"
                    placeholder="Enter your username"
                    value={loginUsername}
                    onChange={(e) => setLoginUsername(e.target.value)}
                    autoComplete="username"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="password" className="block text-[10px] font-bold uppercase mb-1 tracking-wide" style={{ color: '#8a9aaa' }}>
                    Password
                  </label>
                  <div className="relative">
                    <input
                      ref={passwordRef}
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      className="input-dark login-input-glow h-9 pr-8"
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      required
                    />
                    <button type="button"
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 transition-colors"
                      style={{ color: '#5a6e80' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = '#e0e0e0'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = '#5a6e80'; }}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      tabIndex={0}
                    >
                      {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                <button type="button"
                  type="submit"
                  disabled={loginBusy || !loginUsername.trim() || !password}
                  className="toolbar-btn toolbar-btn-primary w-full h-9 text-white text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loginBusy ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Authenticating...
                    </>
                  ) : (
                    'Sign In'
                  )}
                </button>
              </form>
            )}

            {/* ══════ 2FA: TOTP Verification ══════ */}
            {pending2FA && !useBackupCode && effectiveMode !== 'webauthn' && effectiveMode !== 'backup' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const trimmed = totpCode.replace(/\s/g, '');
                  if (trimmed.length === 6 && !loginBusy && !totpSubmittingRef.current) {
                    totpSubmittingRef.current = true;
                    handleTotpSubmit(trimmed).finally(() => { totpSubmittingRef.current = false; });
                  }
                }}
                className="space-y-4"
              >
                <div className="text-center mb-2">
                  <p className="text-[10px] uppercase tracking-wide font-bold mb-1" style={{ color: '#8a9aaa' }}>
                    Enter Authenticator Code
                  </p>
                  <p className="text-[9px]" style={{ color: '#5a6e80' }}>
                    Open your authenticator app and enter the 6-digit code
                  </p>
                </div>

                <TotpCodeInput
                  value={totpCode}
                  onChange={setTotpCode}
                  disabled={loginBusy}
                  error={!!error}
                />

                <button type="button"
                  type="submit"
                  disabled={loginBusy || totpCode.replace(/\s/g, '').length < 6}
                  className="toolbar-btn toolbar-btn-primary w-full h-9 text-white text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loginBusy ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-3.5 h-3.5" />
                      VERIFY CODE
                    </>
                  )}
                </button>

                {/* Trust this device checkbox */}
                <label className="flex items-center gap-2 cursor-pointer select-none py-1">
                  <input
                    type="checkbox"
                    checked={trustThisDevice}
                    onChange={(e) => setTrustThisDevice(e.target.checked)}
                    className="w-3.5 h-3.5 rounded-sm accent-[#1a5a9e] cursor-pointer"
                    style={{ accentColor: '#1a5a9e' }}
                  />
                  <span className="text-[10px]" style={{ color: '#8a9aaa' }}>
                    Trust this device for 30 days
                  </span>
                </label>

                {/* Alternative methods */}
                <div className="flex items-center justify-between pt-2">
                  <button type="button"
                    type="button"
                    onClick={handleBackWebAuthn}
                    className="flex items-center gap-1 text-[10px] uppercase tracking-wide font-bold transition-colors"
                    style={{ color: '#5a6e80' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#e0e0e0'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = '#5a6e80'; }}
                  >
                    <ArrowLeft className="w-3 h-3" />
                    Back
                  </button>
                  <div className="flex items-center gap-3">
                    <button type="button"
                      type="button"
                      onClick={() => { clearError(); handleSecurityKeyAuth(); }}
                      disabled={loginBusy}
                      className="flex items-center gap-1 text-[10px] uppercase tracking-wide font-bold transition-colors"
                      style={{ color: '#5a6e80' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = '#d97706'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = '#5a6e80'; }}
                    >
                      <Usb className="w-3 h-3" />
                      YubiKey
                    </button>
                    <button type="button"
                      type="button"
                      onClick={() => { setTwoFactorMode('backup'); setUseBackupCode(true); clearError(); }}
                      className="text-[10px] uppercase tracking-wide font-bold transition-colors"
                      style={{ color: '#5a6e80' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = '#1a5a9e'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = '#5a6e80'; }}
                    >
                      Backup Code
                    </button>
                  </div>
                </div>
              </form>
            )}

            {/* ══════ WebAuthn: Security Key Verification ══════ */}
            {pending2FA && effectiveMode === 'webauthn' && (
              <div className="space-y-4">
                <div className="text-center mb-2">
                  <p className="text-[10px] uppercase tracking-wide font-bold mb-1" style={{ color: '#8a9aaa' }}>Security Key</p>
                  <p className="text-[9px]" style={{ color: '#5a6e80' }}>
                    {webauthnError ? 'Authentication failed — try again' : 'Touch your security key when it flashes'}
                  </p>
                </div>

                <button type="button"
                  type="button"
                  onClick={handleSecurityKeyAuth}
                  disabled={loginBusy}
                  className="toolbar-btn toolbar-btn-primary w-full h-9 text-white text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loginBusy ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Waiting...
                    </>
                  ) : (
                    <>
                      <KeyRound className="w-3.5 h-3.5" />
                      {webauthnError ? 'RETRY SECURITY KEY' : 'ACTIVATE SECURITY KEY'}
                    </>
                  )}
                </button>

                <div className="pt-2">
                  <button type="button"
                    type="button"
                    onClick={handleBackWebAuthn}
                    className="flex items-center gap-1 text-[10px] uppercase tracking-wide font-bold transition-colors"
                    style={{ color: '#5a6e80' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#e0e0e0'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = '#5a6e80'; }}
                  >
                    <ArrowLeft className="w-3 h-3" />
                    Back
                  </button>
                </div>
              </div>
            )}

            {/* ══════ Backup Code (from pending2FA flow) ══════ */}
            {pending2FA && effectiveMode === 'backup' && (
              <form onSubmit={handleBackupSubmit} className="space-y-3">
                <div className="text-center mb-2">
                  <p className="text-[10px] uppercase tracking-wide font-bold mb-1" style={{ color: '#8a9aaa' }}>Recovery Code</p>
                  <p className="text-[9px]" style={{ color: '#5a6e80' }}>Enter one of your single-use backup codes</p>
                </div>

                <input
                  type="text"
                  className="input-dark login-input-glow h-9 text-center font-mono tracking-widest uppercase"
                  placeholder="XXXX-XXXX"
                  value={backupCode}
                  onChange={(e) => setBackupCode(e.target.value)}
                  autoFocus
                  maxLength={9}
                />

                <button type="button"
                  type="submit"
                  disabled={loginBusy || !backupCode.trim()}
                  className="toolbar-btn toolbar-btn-primary w-full h-9 text-white text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loginBusy ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    'VERIFY RECOVERY CODE'
                  )}
                </button>

                <div className="flex items-center justify-between pt-1">
                  <button type="button"
                    type="button"
                    onClick={handleBackWebAuthn}
                    className="flex items-center gap-1 text-[10px] uppercase tracking-wide font-bold transition-colors"
                    style={{ color: '#5a6e80' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#e0e0e0'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = '#5a6e80'; }}
                  >
                    <ArrowLeft className="w-3 h-3" />
                    Back
                  </button>
                  <button type="button"
                    type="button"
                    onClick={() => { setTwoFactorMode('totp'); clearError(); }}
                    className="text-[10px] uppercase tracking-wide font-bold transition-colors"
                    style={{ color: '#5a6e80' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#1a5a9e'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = '#5a6e80'; }}
                  >
                    Use Authenticator
                  </button>
                </div>
              </form>
            )}

            {/* ══════ 2FA Setup Required ══════ */}
            {loginStep === 'setup_2fa' && (
              <div className="space-y-4">
                <div className="text-center">
                  <ShieldCheck className="w-10 h-10 mx-auto mb-2" style={{ color: '#1a5a9e' }} />
                  <p className="text-[10px] uppercase tracking-wide font-bold mb-1" style={{ color: '#8a9aaa' }}>
                    Two-Factor Authentication Required
                  </p>
                  <p className="text-[9px] leading-relaxed" style={{ color: '#5a6e80' }}>
                    Your account requires two-factor authentication. You'll need an authenticator app like
                    <strong> Google Authenticator</strong> or <strong>Authy</strong>.
                  </p>
                </div>
                <button type="button"
                  type="button"
                  onClick={handleStartSetup}
                  disabled={loginBusy}
                  className="toolbar-btn toolbar-btn-primary w-full h-9 text-white text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loginBusy ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Generating...
                    </>
                  ) : (
                    'BEGIN SETUP'
                  )}
                </button>
                <button type="button"
                  onClick={handleBack}
                  className="w-full flex items-center justify-center gap-1 py-1.5 text-[9px] uppercase tracking-wider"
                  style={{ color: '#5a6e80', background: 'transparent', border: 'none' }}
                >
                  <ArrowLeft className="w-3 h-3" /> Set Up Later
                </button>
              </div>
            )}

            {/* ══════ Confirm 2FA Setup (QR code + verify) ══════ */}
            {loginStep === 'confirm_setup_2fa' && (
              <form onSubmit={handleConfirmSetup} className="space-y-4">
                <div className="text-center">
                  <p className="text-[10px] uppercase tracking-wide font-bold mb-1" style={{ color: '#8a9aaa' }}>Scan QR Code</p>
                  <p className="text-[9px]" style={{ color: '#5a6e80' }}>
                    Scan with your authenticator app, then enter the 6-digit code
                  </p>
                </div>

                {qrCodeUri && (
                  <div className="flex justify-center">
                    <div className="p-2" style={{ background: '#ffffff', borderRadius: '2px' }}>
                      <img src={qrCodeUri} alt="2FA QR Code" className="w-44 h-44" draggable={false} />
                    </div>
                  </div>
                )}

                <div className="text-center">
                  <button type="button"
                    type="button"
                    onClick={() => setShowManualKey(!showManualKey)}
                    className="text-[9px] uppercase tracking-wide"
                    style={{ color: '#1a5a9e' }}
                  >
                    {showManualKey ? 'Hide' : 'Show'} manual entry key
                  </button>
                  {showManualKey && manualKey && (
                    <div
                      className="mt-2 p-2 font-mono text-xs tracking-wider break-all select-all cursor-text"
                      style={{ background: '#0d1520', border: '1px solid #1e3048', color: '#e0e0e0' }}
                    >
                      {manualKey}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase mb-1 tracking-wide" style={{ color: '#8a9aaa' }}>
                    Enter code from app to verify
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    className="input-dark h-10 text-center text-lg tracking-[0.5em] font-mono"
                    placeholder="000000"
                    value={setupCode}
                    onChange={(e) => setSetupCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    autoComplete="one-time-code"
                    autoFocus
                  />
                </div>

                <button type="button"
                  type="submit"
                  disabled={loginBusy || setupCode.length !== 6}
                  className="toolbar-btn toolbar-btn-primary w-full h-9 text-white text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loginBusy ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    'VERIFY & ACTIVATE 2FA'
                  )}
                </button>
              </form>
            )}

            {/* ══════ Show Backup Codes ══════ */}
            {loginStep === 'show_backup_codes' && pendingBackupCodes && (
              <div>
                <div className="text-center mb-4">
                  <KeyRound className="w-8 h-8 mx-auto mb-2" style={{ color: '#d4a017' }} />
                  <p className="text-[10px] uppercase tracking-wide font-bold mb-1" style={{ color: '#8a9aaa' }}>
                    Backup Recovery Codes
                  </p>
                </div>
                <BackupCodesDisplay
                  codes={pendingBackupCodes}
                  onAcknowledge={handleBackupCodesAck}
                />
              </div>
            )}

            {/* ══════ Password Change Required ══════ */}
            {loginStep === 'password_change' && (
              <form onSubmit={handlePasswordChange} className="space-y-3">
                <div className="text-center mb-2">
                  <Lock className="w-8 h-8 mx-auto mb-2" style={{ color: '#1a5a9e' }} />
                  <p className="text-[10px] uppercase tracking-wide font-bold mb-1" style={{ color: '#8a9aaa' }}>
                    Password Change Required
                  </p>
                  <p className="text-[9px]" style={{ color: '#5a6e80' }}>
                    Your password has expired or must be changed before continuing.
                  </p>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase mb-1 tracking-wide" style={{ color: '#8a9aaa' }}>
                    New Password
                  </label>
                  <input
                    type="password"
                    className="input-dark h-9"
                    placeholder="Enter new password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                    autoFocus
                    required
                  />
                  <PasswordStrengthMeter password={newPassword} />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase mb-1 tracking-wide" style={{ color: '#8a9aaa' }}>
                    Confirm Password
                  </label>
                  <input
                    type="password"
                    className="input-dark h-9"
                    placeholder="Confirm new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                  />
                  {confirmPassword && newPassword !== confirmPassword && (
                    <p className="text-[9px] mt-1" style={{ color: '#ef4444' }}>Passwords do not match</p>
                  )}
                </div>

                <button type="button"
                  type="submit"
                  disabled={loginBusy || !newPassword || newPassword !== confirmPassword}
                  className="toolbar-btn toolbar-btn-primary w-full h-9 text-white text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loginBusy ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Updating...
                    </>
                  ) : (
                    'CHANGE PASSWORD & CONTINUE'
                  )}
                </button>
              </form>
            )}

            <div className="mt-3 pt-2" style={{ borderTop: '1px solid #1e3048' }} />
          </div>

          {/* Status bar */}
          <div className="status-bar">
            <div className="status-bar-section">
              <span className="led-dot" style={{ background: status.color, boxShadow: `0 0 4px ${status.color}` }} />
              <span>{status.text}</span>
            </div>
            <div className="status-bar-section">
              <span style={{ color: '#5a6e80' }}>ENCRYPTED</span>
            </div>
            <div className="status-bar-section border-r-0">
              <span>v{APP_VERSION}</span>
            </div>
          </div>
        </div>

        {/* ── System Info + Device Info Panels ─────────── */}
        {isCredentialStep && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
            {/* System Info */}
            <div className="panel-beveled bg-surface-base overflow-hidden">
              <div className="panel-title-bar flex items-center gap-1.5">
                <Server className="w-2.5 h-2.5" style={{ color: '#1a5a9e' }} />
                <span>SYSTEM</span>
              </div>
              <div className="px-3 py-2">
                <InfoRow label="Application" value="RMPG Flex CAD/RMS" />
                <InfoRow label="Version" value={`v${APP_VERSION}`} />
                {BUILD_TIME && <InfoRow label="Build" value={new Date(BUILD_TIME).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} />}
                <InfoRow label="Operator" value="Rocky Mountain Protective Group" />
                <InfoRow label="Jurisdiction" value="Salt Lake City, UT" />
                <div className="flex items-center justify-between py-[3px]">
                  <span className="text-[8px] uppercase tracking-wider font-bold" style={{ color: '#5a6e80' }}>Server</span>
                  <div className="flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#22c55e', boxShadow: '0 0 3px #22c55e' }} />
                    <span className="text-[9px] font-mono" style={{ color: '#4ade80' }}>Online</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Device Info */}
            <div className="panel-beveled bg-surface-base overflow-hidden">
              <div className="panel-title-bar flex items-center gap-1.5">
                <Monitor className="w-2.5 h-2.5" style={{ color: '#1a5a9e' }} />
                <span>DEVICE</span>
              </div>
              <div className="px-3 py-2">
                <InfoRow label="Browser" value={device.browser} />
                <InfoRow label="OS" value={device.os} />
                <InfoRow label="Type" value={device.deviceType} />
                <InfoRow label="Display" value={device.screen} />
                <InfoRow label="Viewport" value={device.viewport} />
                <div className="flex items-center justify-between py-[3px]">
                  <span className="text-[8px] uppercase tracking-wider font-bold" style={{ color: '#5a6e80' }}>Connection</span>
                  <div className="flex items-center gap-1">
                    <Wifi className="w-2.5 h-2.5" style={{ color: device.online ? '#4ade80' : '#ef4444' }} />
                    <span className="text-[9px] font-mono" style={{ color: device.online ? '#4ade80' : '#ef4444' }}>
                      {device.online ? 'Online' : 'Offline'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Classification / FOUO Banner ──────────────── */}
        <div className="mt-2 sm:mt-3">
          <div
            className="text-center py-1.5 px-3"
            style={{
              background: '#060c14',
              border: '1px solid #1e3048',
              borderTop: '2px solid #124070',
            }}
          >
            <p className="text-[8px] sm:text-[9px] font-black uppercase tracking-[0.25em]" style={{ color: '#124070' }}>
              Internal Use Only
            </p>
            <p className="text-[7px] mt-0.5 uppercase tracking-wider" style={{ color: '#5a6e80' }}>
              Company Confidential — Do Not Distribute
            </p>
          </div>
        </div>

        {/* Footer with clock */}
        <div className="text-center mt-2 flex items-center justify-center gap-3">
          <p className="text-[7px] sm:text-[8px] tracking-wide" style={{ color: '#2a3e58' }}>
            RMPG Flex v{APP_VERSION} | Rocky Mountain Protective Group, LLC
          </p>
          <div className="flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" style={{ color: '#2a3e58' }} />
            <span className="text-[8px] font-mono" style={{ color: '#3a5070' }}>{clock} MT</span>
          </div>
        </div>
      </div>
    </div>
  );
}
