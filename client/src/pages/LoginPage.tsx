// ============================================================
// RMPG Flex — High-Security Login Page
// Single-screen credentials (username + password), system info,
// device info, then 2FA / setup / password change flows.
// ============================================================

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Eye, EyeOff, AlertCircle, ShieldCheck, ArrowLeft, Lock,
  KeyRound, Usb, Fingerprint, Monitor, Server, Wifi, Clock,
  User, ChevronDown, ChevronUp, Shield, Smartphone, CheckCircle2,
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

  // Collapsible system info panels
  const [showSystemInfo, setShowSystemInfo] = useState(false);

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
  const totpSubmittedRef = useRef(false);
  useEffect(() => {
    const trimmed = totpCode.replace(/\s/g, '');
    if (trimmed.length === 6 && loginStep === 'verify_2fa' && !loginBusy && !totpSubmittedRef.current) {
      totpSubmittedRef.current = true;
      handleTotpSubmit(trimmed);
    }
    if (trimmed.length < 6) totpSubmittedRef.current = false;
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

  // Step indicator logic
  const getActiveStep = (): number => {
    if (isCredentialStep) return 0;
    if (pending2FA || loginStep === 'setup_2fa' || loginStep === 'confirm_setup_2fa' || loginStep === 'show_backup_codes') return 1;
    if (loginStep === 'password_change') return 2;
    if (loginStep === 'complete') return 3;
    return 0;
  };
  const activeStep = getActiveStep();
  const stepLabels = ['Credentials', '2FA', 'Password', 'Complete'];
  const totalSteps = requiresPasswordChange ? 4 : 3; // skip password step if not required
  const visibleSteps = requiresPasswordChange ? stepLabels : stepLabels.filter((_, i) => i !== 2);

  // ── Info row item ──────────────────────────────
  const InfoRow = ({ label, value }: { label: string; value: string }) => (
    <div className="flex items-center justify-between py-[3px]" style={{ borderBottom: '1px solid #0d1520' }}>
      <span className="text-[8px] uppercase tracking-wider font-bold" style={{ color: '#5a6e80' }}>{label}</span>
      <span className="text-[9px] font-mono" style={{ color: '#8a9aaa' }}>{value}</span>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative" style={{ background: 'linear-gradient(180deg, #060c14 0%, #141e2b 100%)' }}>
      {/* Background layers */}
      <div className="login-grid-bg" />
      <div className="login-vignette" />
      <div className="login-particles" aria-hidden="true">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="login-particle"
            style={{
              width: `${2 + i}px`,
              height: `${2 + i}px`,
              left: `${10 + i * 15}%`,
              animationDuration: `${12 + i * 4}s`,
              animationDelay: `${i * 2}s`,
            }}
          />
        ))}
      </div>

      {/* ── Security Warning Banner ─────────────────── */}
      <div
        className="w-full max-w-lg mb-3 sm:mb-4 px-3 sm:px-0 relative z-10"
        role="alert"
      >
        <div
          style={{
            background: 'linear-gradient(180deg, rgba(26, 0, 0, 0.6) 0%, rgba(13, 0, 0, 0.4) 100%)',
            borderLeft: '1px solid rgba(153, 27, 27, 0.6)',
            borderRight: '1px solid rgba(153, 27, 27, 0.6)',
            borderBottom: '1px solid rgba(153, 27, 27, 0.6)',
            borderTop: '2px solid #ef4444',
            backdropFilter: 'blur(8px)',
          }}
          className="py-1.5 px-3 text-center"
        >
          <div className="flex items-center justify-center gap-4">
            <div className="w-1 h-1 rounded-full animate-pulse" style={{ background: '#ef4444', boxShadow: '0 0 6px #ef4444' }} />
            <p className="text-[7px] sm:text-[8px] leading-relaxed font-bold uppercase tracking-[0.15em]" style={{ color: '#ef7a7a' }}>
              Restricted System — Authorized Users Only — All Activity Monitored
            </p>
            <div className="w-1 h-1 rounded-full animate-pulse" style={{ background: '#ef4444', boxShadow: '0 0 6px #ef4444' }} />
          </div>
        </div>
      </div>

      {/* ── Main Content ─────────────────────────────── */}
      <div className="relative w-full max-w-lg px-2 sm:px-0 z-10">
        {/* Logo with animated rings */}
        <div className="text-center mb-3">
          <div className="relative inline-flex items-center justify-center" style={{ width: 'clamp(72px, 18vw, 110px)', height: 'clamp(72px, 18vw, 110px)' }}>
            <div className="login-logo-ring-dashed" />
            <div className="login-logo-ring-outer" />
            <div className="login-logo-ring-inner" />
            <img
              src="/rmpg flex.png"
              alt="RMPG Flex"
              className="relative z-10 drop-shadow-[0_0_20px_rgba(26,90,158,0.35)]"
              style={{
                height: 'clamp(56px, 14vw, 88px)',
                width: 'clamp(56px, 14vw, 88px)',
                objectFit: 'contain',
              }}
              draggable={false}
            />
          </div>
          <div className="flex items-center justify-center gap-2 mt-2">
            <div className="h-px w-10 sm:w-16" style={{ background: 'linear-gradient(90deg, transparent, #1a5a9e)' }} />
            <div className="flex items-center gap-1.5">
              <Shield className="w-2.5 h-2.5" style={{ color: '#1a5a9e' }} />
              <p className="text-[8px] sm:text-[9px] tracking-[0.2em] uppercase font-bold" style={{ color: '#1a5a9e' }}>
                Secure Authentication
              </p>
            </div>
            <div className="h-px w-10 sm:w-16" style={{ background: 'linear-gradient(90deg, #1a5a9e, transparent)' }} />
          </div>
        </div>

        {/* ── Login Card ──────────────────────────────── */}
        <div className={`shadow-2xl relative overflow-hidden panel-beveled bg-surface-base login-card login-card-enter login-glow${loginStep === 'complete' ? ' login-success' : ''}`} style={{ boxShadow: '0 4px 40px rgba(26, 90, 158, 0.08), 0 0 0 1px rgba(26, 90, 158, 0.1)' }}>
          <div className="login-card-accent" />
          <div className="login-scan-line" />
          {/* Title bar */}
          <div className="panel-title-bar login-title-bar flex items-center gap-2">
            <ShieldCheck className="w-3 h-3" style={{ color: '#4a9aee' }} />
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
                <div className="login-badge-ok flex items-center gap-1 mr-2 px-1.5 py-0.5">
                  <div className="w-1.5 h-1.5 rounded-full login-secure-dot" style={{ background: '#4ade80' }} />
                  <span className="text-[7px] uppercase tracking-wider font-bold" style={{ color: '#4ade80' }}>Authenticated</span>
                </div>
              )}
              <div className="w-4 h-3 flex items-center justify-center text-[8px] text-rmpg-400 login-window-btn" style={{ background: '#2a3e58', borderLeft: '1px solid #3a5070', borderRight: '1px solid #3a5070', borderTop: '1px solid #3a5070', borderBottom: '1px solid #162236' }}>_</div>
              <div className="w-4 h-3 flex items-center justify-center text-[8px] text-rmpg-400 login-window-btn" style={{ background: '#2a3e58', borderLeft: '1px solid #3a5070', borderRight: '1px solid #3a5070', borderTop: '1px solid #3a5070', borderBottom: '1px solid #162236' }}>□</div>
            </div>
          </div>

          {/* Step progress indicator */}
          {!isCredentialStep && (
            <div className="px-4 sm:px-5 pt-3 pb-0">
              <div className="flex items-center justify-between gap-1">
                {visibleSteps.map((label, i) => {
                  const stepIdx = requiresPasswordChange ? i : (i >= 2 ? i + 1 : i);
                  const isActive = stepIdx === activeStep;
                  const isComplete = stepIdx < activeStep;
                  return (
                    <React.Fragment key={label}>
                      {i > 0 && (
                        <div className="flex-1 h-px mx-1" style={{ background: isComplete ? '#1a5a9e' : '#1e3048', transition: 'background 0.4s ease' }} />
                      )}
                      <div className="flex flex-col items-center gap-1">
                        <div
                          className="w-5 h-5 rounded-full flex items-center justify-center text-[7px] font-bold transition-all duration-300"
                          style={{
                            background: isComplete ? '#1a5a9e' : isActive ? 'rgba(26, 90, 158, 0.2)' : '#0d1520',
                            border: `1.5px solid ${isComplete ? '#1a5a9e' : isActive ? '#1a5a9e' : '#1e3048'}`,
                            color: isComplete || isActive ? '#e5e7eb' : '#3a5070',
                            boxShadow: isActive ? '0 0 8px rgba(26, 90, 158, 0.3)' : 'none',
                          }}
                        >
                          {isComplete ? <CheckCircle2 className="w-3 h-3" /> : i + 1}
                        </div>
                        <span className="text-[7px] uppercase tracking-wider font-bold" style={{ color: isActive ? '#8a9aaa' : isComplete ? '#1a5a9e' : '#3a5070' }}>
                          {label}
                        </span>
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          )}

          <div className="p-4 sm:p-5">
            {/* Idle timeout message */}
            {showIdleMessage && (
              <div className="mb-3 p-2.5 flex items-start gap-2 login-step-enter" style={{ background: 'linear-gradient(135deg, rgba(180, 83, 9, 0.12) 0%, rgba(120, 53, 15, 0.08) 100%)', borderLeft: '2px solid #d97706', borderTop: '1px solid rgba(180, 83, 9, 0.3)', borderRight: '1px solid rgba(180, 83, 9, 0.3)', borderBottom: '1px solid rgba(180, 83, 9, 0.3)' }}>
                <Clock className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-amber-300 font-semibold">Session Timed Out</p>
                  <p className="text-[9px] text-amber-400/80">Automatically signed out after period of inactivity.</p>
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

            {/* Error message */}
            {error && (
              <div className="flex items-center gap-2 p-2.5 mb-4 login-error-shake" style={{ background: 'linear-gradient(135deg, rgba(220, 38, 38, 0.12) 0%, rgba(153, 27, 27, 0.08) 100%)', borderLeft: '2px solid #ef4444', borderTop: '1px solid rgba(153, 27, 27, 0.3)', borderRight: '1px solid rgba(153, 27, 27, 0.3)', borderBottom: '1px solid rgba(153, 27, 27, 0.3)' }}>
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 animate-pulse" style={{ color: '#ef4444' }} />
                <p className="text-xs font-medium" style={{ color: '#ef7a7a' }}>{error}</p>
              </div>
            )}

            {/* ══════ CREDENTIALS STEP (username + password on one screen) ══════ */}
            {isCredentialStep && (
              <form onSubmit={handleCredentialsSubmit} className="space-y-3.5 login-step-enter">
                <div>
                  <label htmlFor="username" className="block text-[10px] font-bold uppercase mb-1.5 tracking-wide" style={{ color: '#8a9aaa' }}>
                    Username
                  </label>
                  <div className="relative login-input-group">
                    <User className="login-input-icon absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none transition-colors" style={{ color: '#3a5070' }} />
                    <input
                      ref={usernameRef}
                      id="username"
                      type="text"
                      className="input-dark login-input-glow h-10 pl-9"
                      placeholder="Enter your username"
                      value={loginUsername}
                      onChange={(e) => setLoginUsername(e.target.value)}
                      autoComplete="username"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="password" className="block text-[10px] font-bold uppercase mb-1.5 tracking-wide" style={{ color: '#8a9aaa' }}>
                    Password
                  </label>
                  <div className="relative login-input-group">
                    <Lock className="login-input-icon absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none transition-colors" style={{ color: '#3a5070' }} />
                    <input
                      ref={passwordRef}
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      className="input-dark login-input-glow h-10 pl-9 pr-9"
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 transition-colors"
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
                <button
                  type="submit"
                  disabled={loginBusy || !loginUsername.trim() || !password}
                  className="login-btn-primary w-full h-10 text-white text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-1"
                  style={{ border: '1px solid rgba(26, 90, 158, 0.5)', borderRadius: '2px' }}
                >
                  {loginBusy ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Authenticating...
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4" />
                      Sign In
                    </>
                  )}
                </button>
                <div className="flex items-center justify-between mt-2">
                  <p className="text-[8px]" style={{ color: '#2a3e58' }}>
                    Press <kbd className="login-kbd">Enter</kbd> to submit
                  </p>
                  <a
                    href="/forgot-password"
                    className="text-[9px] font-medium transition-colors"
                    style={{ color: '#3a6a9e' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#5a9ade'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = '#3a6a9e'; }}
                  >
                    Forgot Password?
                  </a>
                </div>
              </form>
            )}

            {/* ══════ 2FA: Method Chooser ══════ */}
            {pending2FA && effectiveMode === 'choose' && (
              <div className="space-y-4 login-step-enter">
                <div className="text-center mb-1">
                  <p className="text-[10px] uppercase tracking-wide font-bold mb-1" style={{ color: '#8a9aaa' }}>
                    Choose Verification Method
                  </p>
                  <p className="text-[9px]" style={{ color: '#5a6e80' }}>
                    Select how you'd like to verify your identity
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* TOTP Card */}
                  <button
                    type="button"
                    onClick={() => setTwoFactorMode('totp')}
                    className="login-method-card group"
                  >
                    <div className="w-10 h-10 rounded-full flex items-center justify-center mb-2 transition-all duration-300" style={{ background: 'rgba(26, 90, 158, 0.1)', border: '1.5px solid rgba(26, 90, 158, 0.3)' }}>
                      <Smartphone className="w-5 h-5 transition-colors" style={{ color: '#1a5a9e' }} />
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: '#8a9aaa' }}>Authenticator</span>
                    <span className="text-[8px] mt-0.5" style={{ color: '#5a6e80' }}>6-digit code</span>
                  </button>

                  {/* WebAuthn Card */}
                  <button
                    type="button"
                    onClick={() => { setTwoFactorMode('webauthn'); handleSecurityKeyAuth(); }}
                    className="login-method-card group"
                  >
                    <div className="w-10 h-10 rounded-full flex items-center justify-center mb-2 transition-all duration-300" style={{ background: 'rgba(212, 160, 23, 0.1)', border: '1.5px solid rgba(212, 160, 23, 0.3)' }}>
                      <KeyRound className="w-5 h-5 transition-colors" style={{ color: '#d4a017' }} />
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: '#8a9aaa' }}>Security Key</span>
                    <span className="text-[8px] mt-0.5" style={{ color: '#5a6e80' }}>YubiKey / FIDO2</span>
                  </button>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={handleBack}
                    className="flex items-center gap-1 text-[10px] uppercase tracking-wide font-bold transition-colors"
                    style={{ color: '#5a6e80' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#e0e0e0'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = '#5a6e80'; }}
                  >
                    <ArrowLeft className="w-3 h-3" />
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => { setTwoFactorMode('backup'); clearError(); }}
                    className="text-[10px] uppercase tracking-wide font-bold transition-colors"
                    style={{ color: '#5a6e80' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#1a5a9e'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = '#5a6e80'; }}
                  >
                    Use Backup Code
                  </button>
                </div>
              </div>
            )}

            {/* ══════ 2FA: TOTP Verification ══════ */}
            {pending2FA && !useBackupCode && effectiveMode === 'totp' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const trimmed = totpCode.replace(/\s/g, '');
                  if (trimmed.length === 6 && !loginBusy) handleTotpSubmit(trimmed);
                }}
                className="space-y-4 login-step-enter"
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
                  onComplete={handleTotpSubmit}
                  disabled={loginBusy}
                  error={!!error}
                />

                <button
                  type="submit"
                  disabled={loginBusy || totpCode.replace(/\s/g, '').length < 6}
                  className="login-btn-primary w-full h-10 text-white text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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

                {/* Trust this device toggle */}
                <label className="flex items-center gap-2.5 cursor-pointer select-none py-1.5">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={trustThisDevice}
                    onClick={() => setTrustThisDevice(!trustThisDevice)}
                    className="login-toggle"
                    data-checked={trustThisDevice || undefined}
                  >
                    <div className="login-toggle-thumb" />
                  </button>
                  <div>
                    <span className="text-[10px] font-medium block" style={{ color: trustThisDevice ? '#8a9aaa' : '#5a6e80' }}>
                      Trust this device for 30 days
                    </span>
                    {trustThisDevice && (
                      <span className="text-[8px] block mt-0.5" style={{ color: '#1a5a9e' }}>
                        2FA will be skipped on this device
                      </span>
                    )}
                  </div>
                </label>

                {/* Alternative methods */}
                <div className="flex items-center justify-between pt-2">
                  <button
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
                    <button
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
                    <button
                      type="button"
                      onClick={() => { setTwoFactorMode('backup'); clearError(); }}
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
              <div className="space-y-4 login-step-enter">
                <div className="text-center mb-2">
                  <div className="relative inline-flex items-center justify-center mb-3">
                    <div className={`w-16 h-16 rounded-full flex items-center justify-center ${loginBusy ? 'login-key-pulse' : ''}`} style={{ background: webauthnError ? 'rgba(239, 68, 68, 0.1)' : 'rgba(212, 160, 23, 0.08)', border: `2px solid ${webauthnError ? 'rgba(239, 68, 68, 0.4)' : 'rgba(212, 160, 23, 0.3)'}`, transition: 'all 0.3s ease' }}>
                      <KeyRound className="w-7 h-7" style={{ color: webauthnError ? '#ef4444' : '#d4a017', transition: 'color 0.3s ease' }} />
                    </div>
                    {loginBusy && (
                      <div className="absolute inset-0 w-16 h-16 rounded-full login-key-ring" />
                    )}
                  </div>
                  <p className="text-[10px] uppercase tracking-wide font-bold mb-1" style={{ color: '#8a9aaa' }}>Security Key</p>
                  <p className="text-[9px]" style={{ color: webauthnError ? '#ef7a7a' : '#5a6e80' }}>
                    {webauthnError ? 'Authentication failed — try again' : loginBusy ? 'Waiting for key response...' : 'Touch your security key when it flashes'}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleSecurityKeyAuth}
                  disabled={loginBusy}
                  className="login-btn-primary w-full h-10 text-white text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
                  <button
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
                  <p className="text-[10px] uppercase tracking-wide font-bold mb-1" style={{ color: '#a0a0a0' }}>Recovery Code</p>
                  <p className="text-[9px]" style={{ color: '#5a6e80' }}>Enter one of your single-use backup codes</p>
                </div>

                <div className="relative login-input-group">
                  <KeyRound className="login-input-icon absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none transition-colors" style={{ color: '#3a5070' }} />
                  <input
                    type="text"
                    className="input-dark login-input-glow h-9 pl-9 text-center font-mono tracking-widest uppercase"
                    placeholder="XXXX-XXXX"
                    value={backupCode}
                    onChange={(e) => setBackupCode(e.target.value)}
                    autoFocus
                    maxLength={9}
                  />
                </div>

                <button
                  type="submit"
                  disabled={loginBusy || !backupCode.trim()}
                  className="login-btn-primary w-full h-10 text-white text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
                  <button
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
                  <button
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
              <div className="space-y-4 login-step-enter">
                <div className="text-center">
                  <div className="relative inline-flex items-center justify-center mb-3">
                    <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: 'rgba(26, 90, 158, 0.08)', border: '2px solid rgba(26, 90, 158, 0.3)' }}>
                      <ShieldCheck className="w-7 h-7" style={{ color: '#1a5a9e' }} />
                    </div>
                  </div>
                  <p className="text-[10px] uppercase tracking-wide font-bold mb-1" style={{ color: '#8a9aaa' }}>
                    Two-Factor Authentication Required
                  </p>
                  <p className="text-[9px] leading-relaxed" style={{ color: '#5a6e80' }}>
                    Your account requires 2FA for access. You'll need an authenticator app.
                  </p>
                </div>

                {/* App suggestions */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-2 p-2" style={{ background: 'rgba(13, 21, 32, 0.5)', border: '1px solid #1e3048', borderRadius: '2px' }}>
                    <Smartphone className="w-4 h-4 flex-shrink-0" style={{ color: '#1a5a9e' }} />
                    <div>
                      <p className="text-[9px] font-bold" style={{ color: '#8a9aaa' }}>Google Authenticator</p>
                      <p className="text-[7px]" style={{ color: '#5a6e80' }}>iOS / Android</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 p-2" style={{ background: 'rgba(13, 21, 32, 0.5)', border: '1px solid #1e3048', borderRadius: '2px' }}>
                    <Smartphone className="w-4 h-4 flex-shrink-0" style={{ color: '#d4a017' }} />
                    <div>
                      <p className="text-[9px] font-bold" style={{ color: '#8a9aaa' }}>Authy</p>
                      <p className="text-[7px]" style={{ color: '#5a6e80' }}>Multi-device sync</p>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleStartSetup}
                  disabled={loginBusy}
                  className="login-btn-primary w-full h-10 text-white text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loginBusy ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-3.5 h-3.5" />
                      BEGIN SETUP
                    </>
                  )}
                </button>
                <button
                  onClick={handleBack}
                  className="w-full flex items-center justify-center gap-1 py-1.5 text-[9px] uppercase tracking-wider transition-colors"
                  style={{ color: '#5a6e80', background: 'transparent', border: 'none' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#e0e0e0'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = '#5a6e80'; }}
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
                    <div className="login-qr-frame">
                      <div className="p-3" style={{ background: '#ffffff', borderRadius: '2px' }}>
                        <img src={qrCodeUri} alt="2FA QR Code" className="w-40 h-40" draggable={false} />
                      </div>
                      <div className="flex items-center justify-center gap-1.5 mt-2">
                        <Smartphone className="w-3 h-3" style={{ color: '#5a6e80' }} />
                        <span className="text-[8px] uppercase tracking-wider font-bold" style={{ color: '#5a6e80' }}>Scan with authenticator app</span>
                      </div>
                    </div>
                  </div>
                )}

                <div className="text-center">
                  <button
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
                    className="input-dark login-input-glow h-10 text-center text-lg tracking-[0.5em] font-mono"
                    placeholder="000000"
                    value={setupCode}
                    onChange={(e) => setSetupCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    autoComplete="one-time-code"
                    autoFocus
                  />
                </div>

                <button
                  type="submit"
                  disabled={loginBusy || setupCode.length !== 6}
                  className="login-btn-primary w-full h-10 text-white text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
              <form onSubmit={handlePasswordChange} className="space-y-3 login-step-enter">
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
                  <div className="relative login-input-group">
                    <Lock className="login-input-icon absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none transition-colors" style={{ color: '#3a5070' }} />
                    <input
                      type="password"
                      className="input-dark login-input-glow h-9 pl-9"
                      placeholder="Enter new password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      autoComplete="new-password"
                      autoFocus
                      required
                    />
                  </div>
                  <PasswordStrengthMeter password={newPassword} />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase mb-1 tracking-wide" style={{ color: '#8a9aaa' }}>
                    Confirm Password
                  </label>
                  <div className="relative login-input-group">
                    <ShieldCheck className="login-input-icon absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none transition-colors" style={{ color: '#3a5070' }} />
                    <input
                      type="password"
                      className="input-dark login-input-glow h-9 pl-9"
                      placeholder="Confirm new password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      autoComplete="new-password"
                      required
                    />
                  </div>
                  {confirmPassword && newPassword !== confirmPassword && (
                    <p className="text-[9px] mt-1" style={{ color: '#ef4444' }}>Passwords do not match</p>
                  )}
                  {confirmPassword && newPassword === confirmPassword && newPassword.length > 0 && (
                    <p className="text-[9px] mt-1 flex items-center gap-1" style={{ color: '#4ade80' }}>
                      <CheckCircle2 className="w-3 h-3" /> Passwords match
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loginBusy || !newPassword || newPassword !== confirmPassword}
                  className="login-btn-primary w-full h-10 text-white text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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

          </div>

          {/* Status bar */}
          <div className="status-bar">
            <div className="status-bar-section">
              <span className="led-dot login-led-active" style={{ background: status.color, boxShadow: `0 0 4px ${status.color}` }} />
              <span>{status.text}</span>
            </div>
            <div className="status-bar-section">
              <Lock className="w-2.5 h-2.5" style={{ color: '#3a5070' }} />
              <span style={{ color: '#5a6e80' }}>TLS 1.3</span>
            </div>
            <div className="status-bar-section">
              <div className="w-1.5 h-1.5 rounded-full login-secure-dot" style={{ background: '#22c55e' }} />
              <span style={{ color: '#4ade80' }}>SECURE</span>
            </div>
            <div className="status-bar-section border-r-0">
              <span>v{APP_VERSION}</span>
            </div>
          </div>
        </div>

        {/* ── Collapsible System Info + Device Info ─────── */}
        {isCredentialStep && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowSystemInfo(!showSystemInfo)}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 transition-colors"
              style={{ color: '#3a5070' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#5a7a9e'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = '#3a5070'; }}
            >
              <Server className="w-2.5 h-2.5" />
              <span className="text-[8px] uppercase tracking-[0.15em] font-bold">System & Device Info</span>
              {showSystemInfo ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>

            {showSystemInfo && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1 login-step-enter">
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
          </div>
        )}

        {/* ── Classification / FOUO Banner ──────────────── */}
        <div className="mt-2 sm:mt-3">
          <div
            className="text-center py-1.5 px-3"
            style={{
              background: '#060c14',
              borderLeft: '1px solid #1e3048',
              borderRight: '1px solid #1e3048',
              borderBottom: '1px solid #1e3048',
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
        <div className="mt-2">
          <div className="flex items-center justify-center gap-3 py-1.5">
            <div className="flex items-center gap-1.5">
              <div className="w-1 h-1 rounded-full" style={{ background: '#1e3048' }} />
              <p className="text-[7px] sm:text-[8px] tracking-wider uppercase" style={{ color: '#2a3e58' }}>
                RMPG Flex v{APP_VERSION}
              </p>
            </div>
            <div className="w-px h-2.5" style={{ background: '#1e3048' }} />
            <p className="text-[7px] sm:text-[8px] tracking-wide" style={{ color: '#2a3e58' }}>
              Rocky Mountain Protective Group, LLC
            </p>
            <div className="w-px h-2.5" style={{ background: '#1e3048' }} />
            <div className="flex items-center gap-1">
              <Clock className="w-2.5 h-2.5" style={{ color: '#2a3e58' }} />
              <span className="text-[8px] font-mono" style={{ color: '#3a5070' }}>{clock} MT</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
