// ============================================================
// RMPG Flex — High-Security Login Page
// Security warning banner, multi-step auth (credentials
// → TOTP 2FA / WebAuthn / setup / password change),
// classification banner.
// ============================================================

import React, { useState, useEffect, useRef } from 'react';
import { Eye, EyeOff, AlertCircle, ShieldCheck, ArrowLeft, Lock, KeyRound, Smartphone, Usb, Fingerprint } from 'lucide-react';
import { useAuth, type LoginStep } from '../context/AuthContext';
import TotpCodeInput from '../components/TotpCodeInput';
import PasswordStrengthMeter from '../components/security/PasswordStrengthMeter';
import BackupCodesDisplay from '../components/security/BackupCodesDisplay';

const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '5.3.9';

type TwoFactorMode = 'choose' | 'totp' | 'webauthn' | 'backup';

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

  // Idle logout message
  const [showIdleMessage, setShowIdleMessage] = useState(false);
  useEffect(() => {
    if (sessionStorage.getItem('rmpg_idle_logout') === '1') {
      setShowIdleMessage(true);
      sessionStorage.removeItem('rmpg_idle_logout');
      const t = setTimeout(() => setShowIdleMessage(false), 15000);
      return () => clearTimeout(t);
    }
  }, []);

  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const totpRef = useRef<HTMLInputElement>(null);
  const setupCodeRef = useRef<HTMLInputElement>(null);

  // Auto-focus based on step
  useEffect(() => {
    const timer = setTimeout(() => {
      if (loginStep === 'username') usernameRef.current?.focus();
      else if (loginStep === 'password') passwordRef.current?.focus();
      else if (loginStep === 'verify_2fa') totpRef.current?.focus();
      else if (loginStep === 'confirm_setup_2fa') setupCodeRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, [loginStep]);

  // Auto-submit TOTP when 6 digits entered
  const handleVerify2FA = () => {
    const trimmed = totpCode.replace(/\s/g, '');
    if (trimmed.length === 6) handleTotpSubmit(trimmed);
  };

  useEffect(() => {
    if (totpCode.length === 6 && loginStep === 'verify_2fa' && !loginBusy) {
      handleVerify2FA();
    }
  }, [totpCode]);

  const handleCredentialsSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginUsername.trim()) return;
    if (loginStep === 'username') {
      setLoginStep('password');
    } else if (loginStep === 'password') {
      handlePasswordSubmit(e);
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

  const handleUsernameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginUsername.trim()) return;
    setLoginStep('password');
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    try {
      await login(loginUsername, password);
    } catch {
      // Error handled by context
    }
  };

  const handleTotpSubmit = async (code: string) => {
    clearError();
    try {
      await verify2FA(code, trustThisDevice);
    } catch {
      // Error handled by context — clear TOTP input for retry
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

  const handleVerifyBackupCode = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    try {
      await verifyBackupCode(backupCode);
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

  // Determine initial 2FA mode when entering WebAuthn 2FA step
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
    if (newPassword !== confirmPassword) {
      return;
    }
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
      // Complete — tokens already stored by confirmSetup2FA
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

  // ── WebAuthn / Security Key handler ──────────────
  const handleSecurityKeyAuth = async () => {
    clearError();
    try {
      await verifyWebAuthn(trustThisDevice);
    } catch {
      // Error handled by context
    }
  };

  const handleBackToLogin = () => {
    cancel2FA();
    setTotpCode('');
    setBackupCode('');
    setTwoFactorMode('choose');
    setWebauthnError(false);
    setPassword('');
  };

  const goBack = () => {
    clearError();
    if (loginStep === 'password') {
      setLoginStep('username');
      setPassword('');
    } else if (loginStep === 'verify_2fa') {
      setLoginStep('password');
      setTotpCode('');
      setPassword('');
    }
  };

  const status = stepStatus[loginStep] || stepStatus.username;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative" style={{ background: 'linear-gradient(180deg, #060c14 0%, #141e2b 100%)' }}>
      {/* Animated grid background */}
      <div className="login-grid-bg" />

      {/* ── Security Warning Banner ─────────────────── */}
      <div
        className="w-full max-w-sm mb-2 sm:mb-3 px-3 sm:px-0 relative z-10"
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
            <div
              className="w-1 h-1 rounded-full animate-pulse"
              style={{ background: '#ef4444', boxShadow: '0 0 4px #ef4444' }}
            />
            <span
              className="text-[8px] sm:text-[9px] font-black uppercase tracking-[0.2em]"
              style={{ color: '#ef4444' }}
            >
              Warning
            </span>
            <div
              className="w-1 h-1 rounded-full animate-pulse"
              style={{ background: '#ef4444', boxShadow: '0 0 4px #ef4444' }}
            />
          </div>
          <p
            className="text-[8px] sm:text-[9px] leading-relaxed font-medium"
            style={{ color: '#ef7a7a' }}
          >
            RESTRICTED INTERNAL SYSTEM. AUTHORIZED USERS ONLY.
            ALL ACTIVITY IS MONITORED. UNAUTHORIZED ACCESS IS PROHIBITED.
          </p>
        </div>
      </div>

      {/* ── Login Card ───────────────────────────────────── */}
      <div className="relative w-full max-w-sm px-2 sm:px-0 z-10">
        {/* Logo */}
        <div className="text-center mb-2">
          <div className="inline-flex items-center justify-center">
            <img
              src="/rmpg flex.png"
              alt="RMPG Flex"
              className="drop-shadow-[0_0_15px_rgba(26,90,158,0.25)]"
              style={{
                height: 'clamp(64px, 16vw, 100px)',
                width: 'clamp(64px, 16vw, 100px)',
                objectFit: 'contain',
              }}
              draggable={false}
            />
          </div>
          <div className="flex items-center justify-center gap-2 mt-0.5">
            <div
              className="h-px w-8 sm:w-12"
              style={{
                background: 'linear-gradient(90deg, transparent, #124070)',
              }}
            />
            <p
              className="text-[7px] sm:text-[8px] tracking-[0.15em] uppercase font-bold"
              style={{ color: 'rgba(26, 90, 158, 0.65)' }}
            >
              Secure Authentication
            </p>
            <div
              className="h-px w-8 sm:w-12"
              style={{
                background: 'linear-gradient(90deg, #124070, transparent)',
              }}
            />
          </div>
        </div>

        {/* Login Card */}
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
                      ? 'STEP 2 — IDENTITY VERIFICATION'
                      : 'STEP 1 — CREDENTIALS'}
            </span>
            <div className="ml-auto flex items-center gap-1">
              {pending2FA && (
                <div className="flex items-center gap-1 mr-2">
                  <div
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: '#4ade80' }}
                  />
                  <span
                    className="text-[8px] uppercase tracking-wide"
                    style={{ color: '#4ade80' }}
                  >
                    Password OK
                  </span>
                </div>
              )}
              <div
                className="w-4 h-3 flex items-center justify-center text-[8px] text-rmpg-400"
                style={{
                  background: '#2a3e58',
                  border: '1px solid #3a5070',
                  borderBottom: '1px solid #162236',
                }}
              >
                _
              </div>
              <div
                className="w-4 h-3 flex items-center justify-center text-[8px] text-rmpg-400"
                style={{
                  background: '#2a3e58',
                  border: '1px solid #3a5070',
                  borderBottom: '1px solid #162236',
                }}
              >
                □
              </div>
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

            {/* Step indicator — only for basic credentials + verify flow */}
            {loginStep !== 'setup_2fa' && loginStep !== 'confirm_setup_2fa' && loginStep !== 'show_backup_codes' && loginStep !== 'password_change' && (
            <div className="flex items-center justify-center gap-2 mb-3">
              <div className="flex items-center gap-1">
                <div
                  className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold"
                  style={{
                    background: pending2FA ? '#1a3a1a' : '#124070',
                    border: `2px solid ${pending2FA ? '#4ade80' : '#1a5a9e'}`,
                    color: pending2FA ? '#4ade80' : '#fff',
                  }}
                >
                  {pending2FA ? '✓' : '1'}
                </div>
                <span
                  className="text-[8px] font-bold uppercase tracking-wide"
                  style={{ color: pending2FA ? '#4ade80' : '#1a5a9e' }}
                >
                  Credentials
                </span>
              </div>
              <div
                className="w-6 h-px"
                style={{
                  background: pending2FA ? '#4ade80' : '#1e3048',
                }}
              />
              <div className="flex items-center gap-1">
                <div
                  className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold"
                  style={{
                    background: pending2FA ? '#124070' : '#141e2b',
                    border: `2px solid ${pending2FA ? '#1a5a9e' : '#1e3048'}`,
                    color: pending2FA ? '#fff' : '#5a6e80',
                  }}
                >
                  2
                </div>
                <span
                  className="text-[8px] font-bold uppercase tracking-wide"
                  style={{ color: pending2FA ? '#1a5a9e' : '#5a6e80' }}
                >
                  Verify
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Fingerprint className="w-3 h-3" style={{ color: '#4a90c4' }} />
                <span className="text-[8px] uppercase tracking-wider" style={{ color: '#6b7280' }}>Device ID</span>
              </div>
              {loginUsername && (
                <div className="ml-auto text-[9px] font-mono" style={{ color: '#707070' }}>
                  {loginUsername}
                </div>
              )}
            </div>
            )}

            {/* Error message */}
            {error && (
              <div
                className="flex items-center gap-2 p-2 mb-4 animate-fade-in"
                style={{
                  background: 'rgba(220, 38, 38, 0.15)',
                  border: '1px solid #991b1b',
                }}
              >
                <AlertCircle
                  className="w-3.5 h-3.5 flex-shrink-0"
                  style={{ color: '#ef4444' }}
                />
                <p className="text-xs" style={{ color: '#ef7a7a' }}>
                  {error}
                </p>
              </div>
            )}

            {/* ── Step 1: Username + Password ──────────────── */}
            {!pending2FA && loginStep !== 'setup_2fa' && loginStep !== 'confirm_setup_2fa' && loginStep !== 'show_backup_codes' && loginStep !== 'password_change' && (
              <form onSubmit={handleCredentialsSubmit} className="space-y-3">
                <div>
                  <label
                    htmlFor="username"
                    className="block text-[10px] font-bold uppercase mb-1 tracking-wide"
                    style={{ color: '#8a9aaa' }}
                  >
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
                <button
                  type="submit"
                  disabled={!loginUsername.trim()}
                  className="toolbar-btn toolbar-btn-primary w-full h-9 text-white text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </form>
            )}

            {/* ═══ STEP: PASSWORD ═══ */}
            {loginStep === 'password' && !pending2FA && (
              <form onSubmit={handlePasswordSubmit} className="space-y-3">
                <div>
                  <label
                    htmlFor="password"
                    className="block text-[10px] font-bold uppercase mb-1 tracking-wide"
                    style={{ color: '#8a9aaa' }}
                  >
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
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 transition-colors"
                      style={{ color: '#5a6e80' }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = '#e0e0e0';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = '#5a6e80';
                      }}
                      aria-label={
                        showPassword ? 'Hide password' : 'Show password'
                      }
                      tabIndex={0}
                    >
                      {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={loginBusy || !password}
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

            {/* ── Step 2: TOTP Verification ────────────────── */}
            {pending2FA && !useBackupCode && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const trimmed = totpCode.replace(/\s/g, '');
                  if (trimmed.length === 6 && !loginBusy) handleTotpSubmit(trimmed);
                }}
                className="space-y-4"
              >
                <div className="text-center mb-2">
                  <p
                    className="text-[10px] uppercase tracking-wide font-bold mb-1"
                    style={{ color: '#8a9aaa' }}
                  >
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
                  <button
                    type="button"
                    onClick={handleBackWebAuthn}
                    className="flex items-center gap-1 text-[10px] uppercase tracking-wide font-bold transition-colors"
                    style={{ color: '#5a6e80' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = '#e0e0e0';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = '#5a6e80';
                    }}
                  >
                    <ArrowLeft className="w-3 h-3" />
                    Back
                  </button>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        clearError();
                        handleSecurityKeyAuth();
                      }}
                      disabled={loginBusy}
                      className="flex items-center gap-1 text-[10px] uppercase tracking-wide font-bold transition-colors"
                      style={{ color: '#5a6e80' }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = '#d97706';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = '#5a6e80';
                      }}
                    >
                      <Usb className="w-3 h-3" />
                      YubiKey
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setUseBackupCode(true);
                        clearError();
                      }}
                      className="text-[10px] uppercase tracking-wide font-bold transition-colors"
                      style={{ color: '#5a6e80' }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = '#1a5a9e';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = '#5a6e80';
                      }}
                    >
                      Backup Code
                    </button>
                  </div>
                </div>
              </form>
            )}

            {/* ═══ WebAuthn: Security Key Verification ═══ */}
            {pending2FA && effectiveMode === 'webauthn' && (
              <div className="space-y-4">
                <div className="text-center mb-2">
                  <p
                    className="text-[10px] uppercase tracking-wide font-bold mb-1"
                    style={{ color: '#8a9aaa' }}
                  >
                    Security Key
                  </p>
                  <p className="text-[9px]" style={{ color: '#5a6e80' }}>
                    {webauthnError ? 'Authentication failed — try again' : 'Touch your security key when it flashes'}
                  </p>
                </div>

                <button
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
                  <button
                    type="button"
                    onClick={handleBackWebAuthn}
                    className="flex items-center gap-1 text-[10px] uppercase tracking-wide font-bold transition-colors"
                    style={{ color: '#666' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#e0e0e0'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = '#666'; }}
                  >
                    <ArrowLeft className="w-3 h-3" />
                    Back
                  </button>
                </div>
              </div>
            )}

            {/* ═══ WebAuthn: Backup Code (from pending2FA flow) ═══ */}
            {pending2FA && effectiveMode === 'backup' && (
              <form onSubmit={(e) => { e.preventDefault(); if (backupCode.trim()) handleTotpSubmit(backupCode.trim()); }} className="space-y-3">
                <div className="text-center mb-2">
                  <p className="text-[10px] uppercase tracking-wide font-bold mb-1" style={{ color: '#a0a0a0' }}>
                    Recovery Code
                  </p>
                  <p className="text-[9px]" style={{ color: '#5a6e80' }}>
                    Enter one of your single-use backup codes
                  </p>
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

                <button
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
                  <button
                    type="button"
                    onClick={handleBackWebAuthn}
                    className="flex items-center gap-1 text-[10px] uppercase tracking-wide font-bold transition-colors"
                    style={{ color: '#5a6e80' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = '#e0e0e0';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = '#5a6e80';
                    }}
                  >
                    <ArrowLeft className="w-3 h-3" />
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => { setTwoFactorMode('totp'); clearError(); }}
                    className="text-[10px] uppercase tracking-wide font-bold transition-colors"
                    style={{ color: '#5a6e80' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = '#1a5a9e';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = '#5a6e80';
                    }}
                  >
                    Use Authenticator
                  </button>
                </div>
              </form>
            )}

            {/* ── Step: 2FA Setup Required ────────────────── */}
            {loginStep === 'setup_2fa' && (
              <div className="space-y-4">
                <div className="text-center">
                  <ShieldCheck className="w-10 h-10 mx-auto mb-2" style={{ color: '#1a5a9e' }} />
                  <p
                    className="text-[10px] uppercase tracking-wide font-bold mb-1"
                    style={{ color: '#8a9aaa' }}
                  >
                    Two-Factor Authentication Required
                  </p>
                  <p className="text-[9px] leading-relaxed" style={{ color: '#5a6e80' }}>
                    Your account requires two-factor authentication. You'll need an authenticator app like
                    <strong> Google Authenticator</strong> or <strong>Authy</strong>.
                  </p>
                </div>
                <button
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
                <button
                  onClick={handleBack}
                  className="w-full flex items-center justify-center gap-1 py-1.5 text-[9px] uppercase tracking-wider"
                  style={{ color: '#5a6e80', background: 'transparent', border: 'none' }}
                >
                  <ArrowLeft className="w-3 h-3" /> Set Up Later
                </button>
              </div>
            )}

            {/* ── Step: Confirm 2FA Setup (QR code + verify) ── */}
            {loginStep === 'confirm_setup_2fa' && (
              <form onSubmit={handleConfirmSetup} className="space-y-4">
                <div className="text-center">
                  <p
                    className="text-[10px] uppercase tracking-wide font-bold mb-1"
                    style={{ color: '#8a9aaa' }}
                  >
                    Scan QR Code
                  </p>
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
                  <label
                    className="block text-[10px] font-bold uppercase mb-1 tracking-wide"
                    style={{ color: '#8a9aaa' }}
                  >
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

                <button
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

            {/* ── Step: Show Backup Codes ────────────────────── */}
            {loginStep === 'show_backup_codes' && pendingBackupCodes && (
              <div>
                <div className="text-center mb-4">
                  <KeyRound className="w-8 h-8 mx-auto mb-2" style={{ color: '#d4a017' }} />
                  <p
                    className="text-[10px] uppercase tracking-wide font-bold mb-1"
                    style={{ color: '#8a9aaa' }}
                  >
                    Backup Recovery Codes
                  </p>
                </div>
                <BackupCodesDisplay
                  codes={pendingBackupCodes}
                  onAcknowledge={handleBackupCodesAck}
                />
              </div>
            )}

            {/* ── Step: Password Change Required ─────────────── */}
            {loginStep === 'password_change' && (
              <form onSubmit={handlePasswordChange} className="space-y-3">
                <div className="text-center mb-2">
                  <Lock className="w-8 h-8 mx-auto mb-2" style={{ color: '#1a5a9e' }} />
                  <p
                    className="text-[10px] uppercase tracking-wide font-bold mb-1"
                    style={{ color: '#8a9aaa' }}
                  >
                    Password Change Required
                  </p>
                  <p className="text-[9px]" style={{ color: '#5a6e80' }}>
                    Your password has expired or must be changed before continuing.
                  </p>
                </div>

                <div>
                  <label
                    className="block text-[10px] font-bold uppercase mb-1 tracking-wide"
                    style={{ color: '#8a9aaa' }}
                  >
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
                  <label
                    className="block text-[10px] font-bold uppercase mb-1 tracking-wide"
                    style={{ color: '#8a9aaa' }}
                  >
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

                <button
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

            <div
              className="mt-3 pt-2"
              style={{ borderTop: '1px solid #1e3048' }}
            />
          </div>

          {/* Status bar */}
          <div className="status-bar">
            <div className="status-bar-section">
              <span className="led-dot led-green" />
              <span>
                {loginStep === 'setup_2fa' || loginStep === 'confirm_setup_2fa'
                  ? '2FA SETUP REQUIRED'
                  : loginStep === 'show_backup_codes'
                    ? 'SAVE BACKUP CODES'
                    : loginStep === 'password_change'
                      ? 'PASSWORD CHANGE REQ.'
                      : pending2FA
                        ? '2FA REQUIRED'
                        : 'SYSTEM READY'}
              </span>
            </div>
            <div className="status-bar-section">
              <span style={{ color: '#5a6e80' }}>ENCRYPTED</span>
            </div>
            <div className="status-bar-section border-r-0">
              <span>v{APP_VERSION}</span>
            </div>
          </div>
        </div>

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
            <p
              className="text-[8px] sm:text-[9px] font-black uppercase tracking-[0.25em]"
              style={{ color: '#124070' }}
            >
              Internal Use Only
            </p>
            <p
              className="text-[7px] mt-0.5 uppercase tracking-wider"
              style={{ color: '#5a6e80' }}
            >
              Company Confidential — Do Not Distribute
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-2">
          <p
            className="text-[7px] sm:text-[8px] tracking-wide"
            style={{ color: '#2a3e58' }}

          >
            RMPG Flex v{APP_VERSION} | Rocky Mountain Protective Group, LLC
          </p>
        </div>
      </div>
    </div>
  );
}
