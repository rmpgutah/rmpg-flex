// ============================================================
// RMPG Flex — High-Security Login Page
// Security warning banner, multi-step auth (credentials
// → TOTP 2FA / WebAuthn / setup / password change),
// classification banner.
// ============================================================

import React, { useState, useEffect, useRef } from 'react';
import {
  Eye, EyeOff, AlertCircle, Shield, ShieldCheck, ArrowLeft,
  Smartphone, KeyRound, Lock, Fingerprint
} from 'lucide-react';
import { useAuth, type LoginStep } from '../context/AuthContext';
import TotpCodeInput from '../components/TotpCodeInput';
import PasswordStrengthMeter from '../components/security/PasswordStrengthMeter';
import BackupCodesDisplay from '../components/security/BackupCodesDisplay';

type TwoFactorMode = 'choose' | 'totp' | 'webauthn' | 'backup';

const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '5.3.9';

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
    login, verify2FA, verifyWebAuthn, verifyBackupCode, setup2FA, confirmSetup2FA, changePasswordDuringLogin,
    pending2FA, twoFactorMethods, cancel2FA,
    error, clearError, loginBusy, loginStep, setLoginStep, loginUsername, setLoginUsername,
    backupCodes, requiresPasswordChange,
  } = useAuth();

  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [backupCode, setBackupCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [trustDevice, setTrustDevice] = useState(false);
  const [twoFactorMode, setTwoFactorMode] = useState<TwoFactorMode>('choose');
  const [webauthnError, setWebauthnError] = useState(false);

  // 2FA setup state
  const [qrCodeUri, setQrCodeUri] = useState('');
  const [manualKey, setManualKey] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [showManualKey, setShowManualKey] = useState(false);

  // Password change state
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

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
  useEffect(() => {
    if (totpCode.length === 6 && loginStep === 'verify_2fa' && !loginBusy) {
      handleVerify2FA();
    }
  }, [totpCode]);

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
      await verify2FA(code, trustDevice);
    } catch {
      // Error handled by context — clear TOTP input for retry
      setTotpCode('');
    }
  };

  const handleVerify2FA = async () => {
    clearError();
    try {
      await verify2FA(totpCode, trustDevice);
    } catch {
      setTotpCode('');
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
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-surface-base">
      {/* ── Security Warning Banner ─────────────────── */}
      <div
        className="w-full max-w-lg mb-4 sm:mb-5 px-3 sm:px-0"
        role="alert"
      >
        <div
          style={{
            background: 'linear-gradient(180deg, #1a0000 0%, #0d0000 100%)',
            border: '1px solid #8a0c0c',
            borderTop: '3px solid #d93030',
          }}
          className="p-3 sm:p-4 text-center"
        >
          <div className="flex items-center justify-center gap-2 mb-2">
            <div
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ background: '#d93030', boxShadow: '0 0 6px #d93030' }}
            />
            <span
              className="text-[10px] sm:text-xs font-black uppercase tracking-[0.2em]"
              style={{ color: '#d93030' }}
            >
              Warning
            </span>
            <div
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ background: '#d93030', boxShadow: '0 0 6px #d93030' }}
            />
          </div>
          <p
            className="text-[9px] sm:text-[10px] leading-relaxed font-medium"
            style={{ color: '#ef7a7a' }}
          >
            THIS IS A RESTRICTED INTERNAL COMPANY INFORMATION SYSTEM.
            AUTHORIZED USERS ONLY. ALL ACTIVITY IS MONITORED AND RECORDED.
            UNAUTHORIZED ACCESS OR USE IS STRICTLY PROHIBITED
            AND MAY RESULT IN DISCIPLINARY ACTION OR TERMINATION.
          </p>
        </div>
      </div>

      {/* ── Login Card ───────────────────────────────────── */}
      <div className="relative w-full max-w-md px-2 sm:px-0">
        {/* Logo / Brand */}
        <div className="text-center mb-4 sm:mb-6">
          <div className="inline-flex items-center justify-center mb-2">
            <img
              src="/rmpg flex.png"
              alt="RMPG Flex"
              className="drop-shadow-[0_0_20px_rgba(188,16,16,0.3)]"
              style={{ height: 'clamp(100px, 25vw, 160px)', width: 'clamp(100px, 25vw, 160px)', objectFit: 'contain' }}
              draggable={false}
            />
          </div>
          <div className="flex items-center justify-center gap-2 mt-1">
            <div className="h-px w-12 sm:w-20" style={{ background: 'linear-gradient(90deg, transparent, #8a0c0c)' }} />
            <p className="text-[9px] sm:text-[10px] tracking-[0.15em] sm:tracking-[0.2em] uppercase font-semibold" style={{ color: 'rgba(188, 16, 16, 0.65)' }}>
              Secure Authentication
            </p>
            <div className="h-px w-12 sm:w-20" style={{ background: 'linear-gradient(90deg, #8a0c0c, transparent)' }} />
          </div>
        </div>

        {/* Login Card */}
        <div className="shadow-2xl relative overflow-hidden panel-beveled bg-surface-base">
          {/* Title bar */}
          <div className="panel-title-bar flex items-center gap-2">
            <div className="w-2 h-2 bg-brand-600 flex-shrink-0" />
            <span>RMPG FLEX — {pending2FA ? 'IDENTITY VERIFICATION' : loginStep === 'setup_2fa' || loginStep === 'confirm_setup_2fa' ? '2FA SETUP' : loginStep === 'show_backup_codes' ? 'BACKUP CODES' : loginStep === 'password_change' ? 'PASSWORD CHANGE' : 'SYSTEM LOGIN'}</span>
            <div className="ml-auto flex items-center gap-1">
              <Shield className="w-3 h-3" style={{ color: '#d4a017' }} />
            </div>
          </div>

          <div className="p-6">
            {/* Security indicators bar */}
            <div className="flex items-center gap-3 mb-4 pb-3" style={{ borderBottom: '1px solid #2a2a2a' }}>
              <div className="flex items-center gap-1.5">
                <Lock className="w-3 h-3" style={{ color: '#22c55e' }} />
                <span className="text-[8px] uppercase tracking-wider" style={{ color: '#6b7280' }}>TLS</span>
              </div>
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="w-3 h-3" style={{ color: '#22c55e' }} />
                <span className="text-[8px] uppercase tracking-wider" style={{ color: '#6b7280' }}>2FA</span>
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

            {/* Error message */}
            {error && (
              <div className="flex items-center gap-2 p-2 mb-4 animate-fade-in" style={{ background: 'rgba(188, 16, 16, 0.15)', border: '1px solid #8a0c0c' }}>
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#d93030' }} />
                <p className="text-xs" style={{ color: '#ef7a7a' }}>{error}</p>
              </div>
            )}

            {/* ═══ STEP: USERNAME ═══ */}
            {loginStep === 'username' && !pending2FA && (
              <form onSubmit={handleUsernameSubmit} className="space-y-3">
                <div>
                  <label htmlFor="username" className="block text-[10px] font-bold uppercase mb-1 tracking-wide" style={{ color: '#a0a0a0' }}>
                    Username
                  </label>
                  <input
                    ref={usernameRef}
                    id="username"
                    type="text"
                    className="input-dark h-9"
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
                  <div className="flex items-center justify-between mb-1">
                    <label htmlFor="password" className="block text-[10px] font-bold uppercase tracking-wide" style={{ color: '#a0a0a0' }}>
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={goBack}
                      className="flex items-center gap-1 text-[9px] uppercase tracking-wide transition-colors"
                      style={{ color: '#707070' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = '#e0e0e0'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = '#707070'; }}
                    >
                      <ArrowLeft className="w-2.5 h-2.5" />
                      Back
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      ref={passwordRef}
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      className="input-dark h-9 pr-8"
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
                      style={{ color: '#707070' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = '#e0e0e0'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = '#707070'; }}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
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

            {/* ═══ WebAuthn: Method Selection (when pending2FA with multiple methods) ═══ */}
            {pending2FA && effectiveMode === 'choose' && (
              <div className="space-y-3">
                <div className="text-center mb-2">
                  <p className="text-[10px] uppercase tracking-wide font-bold mb-1" style={{ color: '#a0a0a0' }}>
                    Choose Verification Method
                  </p>
                  <p className="text-[9px]" style={{ color: '#666' }}>
                    Select how you'd like to verify your identity
                  </p>
                </div>

                {twoFactorMethods.totp && (
                  <button
                    type="button"
                    onClick={() => { setTwoFactorMode('totp'); clearError(); }}
                    className="w-full flex items-center gap-3 p-3 transition-colors"
                    style={{ background: '#1a1a1a', border: '1px solid #333' }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#bc1010'; e.currentTarget.style.background = '#1e1a1a'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#333'; e.currentTarget.style.background = '#1a1a1a'; }}
                  >
                    <Smartphone className="w-5 h-5 flex-shrink-0" style={{ color: '#bc1010' }} />
                    <div className="text-left">
                      <p className="text-xs font-bold" style={{ color: '#e0e0e0' }}>Authenticator App</p>
                      <p className="text-[9px]" style={{ color: '#666' }}>Enter a 6-digit code from your app</p>
                    </div>
                  </button>
                )}

                {twoFactorMethods.webauthn && (
                  <button
                    type="button"
                    onClick={() => { setTwoFactorMode('webauthn'); clearError(); handleWebAuthn(); }}
                    className="w-full flex items-center gap-3 p-3 transition-colors"
                    style={{ background: '#1a1a1a', border: '1px solid #333' }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#bc1010'; e.currentTarget.style.background = '#1e1a1a'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#333'; e.currentTarget.style.background = '#1a1a1a'; }}
                  >
                    <KeyRound className="w-5 h-5 flex-shrink-0" style={{ color: '#bc1010' }} />
                    <div className="text-left">
                      <p className="text-xs font-bold" style={{ color: '#e0e0e0' }}>Security Key</p>
                      <p className="text-[9px]" style={{ color: '#666' }}>Use your YubiKey or hardware security key</p>
                    </div>
                  </button>
                )}

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleBackToLogin}
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

            {/* ═══ WebAuthn: TOTP Verification (from pending2FA flow) ═══ */}
            {pending2FA && effectiveMode === 'totp' && (
              <div className="space-y-4">
                <div className="text-center mb-2">
                  <p className="text-[10px] uppercase tracking-wide font-bold mb-1" style={{ color: '#a0a0a0' }}>
                    Enter Authenticator Code
                  </p>
                  <p className="text-[9px]" style={{ color: '#666' }}>
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

                {loginBusy && (
                  <div className="flex items-center justify-center gap-2 mt-2">
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span className="text-[10px] uppercase tracking-wide" style={{ color: '#a0a0a0' }}>
                      Verifying...
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between pt-2">
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
                  <button
                    type="button"
                    onClick={() => { setTwoFactorMode('backup'); clearError(); }}
                    className="text-[10px] uppercase tracking-wide font-bold transition-colors"
                    style={{ color: '#666' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#bc1010'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = '#666'; }}
                  >
                    Use Backup Code
                  </button>
                </div>
              </div>
            )}

            {/* ═══ WebAuthn: Security Key Verification ═══ */}
            {pending2FA && effectiveMode === 'webauthn' && (
              <div className="space-y-4">
                <div className="text-center mb-2">
                  <KeyRound className="w-8 h-8 mx-auto mb-2" style={{ color: '#bc1010' }} />
                  <p className="text-[10px] uppercase tracking-wide font-bold mb-1" style={{ color: '#a0a0a0' }}>
                    Security Key Verification
                  </p>
                  <p className="text-[9px]" style={{ color: '#666' }}>
                    {webauthnError
                      ? 'Verification failed — tap your key to try again'
                      : 'Insert your security key and tap it when prompted'}
                  </p>
                </div>

                {loginBusy && (
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span className="text-[10px] uppercase tracking-wide" style={{ color: '#a0a0a0' }}>
                      Waiting for security key...
                    </span>
                  </div>
                )}

                {!loginBusy && (
                  <button
                    type="button"
                    onClick={handleWebAuthn}
                    className="toolbar-btn toolbar-btn-primary w-full h-9 text-white text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    {webauthnError ? 'RETRY SECURITY KEY' : 'ACTIVATE SECURITY KEY'}
                  </button>
                )}

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
                  <p className="text-[9px]" style={{ color: '#666' }}>
                    Enter one of your single-use backup codes
                  </p>
                </div>

                <input
                  type="text"
                  className="input-dark h-9 text-center font-mono tracking-widest uppercase"
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
                    style={{ color: '#666' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#e0e0e0'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = '#666'; }}
                  >
                    <ArrowLeft className="w-3 h-3" />
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => { setTwoFactorMode('totp'); clearError(); }}
                    className="text-[10px] uppercase tracking-wide font-bold transition-colors"
                    style={{ color: '#666' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#bc1010'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = '#666'; }}
                  >
                    Use Authenticator
                  </button>
                </div>
              </form>
            )}

            {/* ═══ STEP: VERIFY 2FA (multi-step flow) ═══ */}
            {loginStep === 'verify_2fa' && !pending2FA && !useBackup && (
              <div className="space-y-3">
                <div className="text-center mb-2">
                  <Smartphone className="w-8 h-8 mx-auto mb-2" style={{ color: '#a855f7' }} />
                  <p className="text-body-sm" style={{ color: '#e5e7eb' }}>Two-Factor Authentication</p>
                  <p className="text-[10px] mt-1" style={{ color: '#707070' }}>
                    Enter the 6-digit code from your authenticator app
                  </p>
                </div>

                <div>
                  <input
                    ref={totpRef}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    className="input-dark h-12 text-center text-xl tracking-[0.5em] font-mono"
                    placeholder="000000"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    autoComplete="one-time-code"
                    autoFocus
                  />
                </div>

                {/* Trust device checkbox */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={trustDevice}
                    onChange={(e) => setTrustDevice(e.target.checked)}
                    className="accent-brand-500"
                  />
                  <span className="text-[10px]" style={{ color: '#a0a0a0' }}>
                    Trust this device for 30 days
                  </span>
                </label>

                <button
                  onClick={handleVerify2FA}
                  disabled={loginBusy || totpCode.length !== 6}
                  className="toolbar-btn toolbar-btn-primary w-full h-9 text-white text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loginBusy ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    'Verify'
                  )}
                </button>

                <div className="flex items-center justify-between pt-2" style={{ borderTop: '1px solid #2a2a2a' }}>
                  <button
                    type="button"
                    onClick={goBack}
                    className="text-[9px] uppercase tracking-wide transition-colors flex items-center gap-1"
                    style={{ color: '#707070' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#e0e0e0'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = '#707070'; }}
                  >
                    <ArrowLeft className="w-2.5 h-2.5" />
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => { setUseBackup(true); clearError(); }}
                    className="text-[9px] uppercase tracking-wide transition-colors flex items-center gap-1"
                    style={{ color: '#4a90c4' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#7bb8e8'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = '#4a90c4'; }}
                  >
                    <KeyRound className="w-2.5 h-2.5" />
                    Use Backup Code
                  </button>
                </div>
              </div>
            )}

            {/* ═══ STEP: BACKUP CODE (multi-step flow) ═══ */}
            {loginStep === 'verify_2fa' && !pending2FA && useBackup && (
              <form onSubmit={handleVerifyBackupCode} className="space-y-3">
                <div className="text-center mb-2">
                  <KeyRound className="w-8 h-8 mx-auto mb-2" style={{ color: '#d4a017' }} />
                  <p className="text-body-sm" style={{ color: '#e5e7eb' }}>Backup Code</p>
                  <p className="text-[10px] mt-1" style={{ color: '#707070' }}>
                    Enter one of your backup recovery codes
                  </p>
                </div>

                <input
                  type="text"
                  className="input-dark h-10 text-center font-mono tracking-widest uppercase"
                  placeholder="XXXX-XXXX"
                  value={backupCode}
                  onChange={(e) => setBackupCode(e.target.value.toUpperCase())}
                  autoFocus
                  required
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
                    'Verify Backup Code'
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => { setUseBackup(false); setBackupCode(''); clearError(); }}
                  className="w-full text-center text-[9px] uppercase tracking-wide transition-colors flex items-center justify-center gap-1"
                  style={{ color: '#707070' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#e0e0e0'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = '#707070'; }}
                >
                  <ArrowLeft className="w-2.5 h-2.5" />
                  Use Authenticator App Instead
                </button>
              </form>
            )}

            {/* ═══ STEP: SETUP 2FA ═══ */}
            {loginStep === 'setup_2fa' && !pending2FA && (
              <div className="space-y-4">
                <div className="text-center">
                  <ShieldCheck className="w-10 h-10 mx-auto mb-2" style={{ color: '#bc1010' }} />
                  <p className="text-body-sm font-semibold" style={{ color: '#e5e7eb' }}>
                    Two-Factor Authentication Required
                  </p>
                  <p className="text-[10px] mt-2 leading-relaxed" style={{ color: '#a0a0a0' }}>
                    Your account requires two-factor authentication. You'll need an authenticator app like
                    <strong> Google Authenticator</strong> or <strong>Authy</strong>.
                  </p>
                </div>

                <button
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
                    'Begin Setup'
                  )}
                </button>
              </div>
            )}

            {/* ═══ STEP: CONFIRM 2FA SETUP ═══ */}
            {loginStep === 'confirm_setup_2fa' && (
              <form onSubmit={handleConfirmSetup} className="space-y-4">
                <div className="text-center">
                  <p className="text-body-sm font-semibold" style={{ color: '#e5e7eb' }}>
                    Scan QR Code
                  </p>
                  <p className="text-[10px] mt-1" style={{ color: '#707070' }}>
                    Scan this QR code with your authenticator app
                  </p>
                </div>

                {/* QR Code */}
                {qrCodeUri && (
                  <div className="flex justify-center">
                    <div className="p-2" style={{ background: '#ffffff', borderRadius: '2px' }}>
                      <img src={qrCodeUri} alt="2FA QR Code" className="w-44 h-44" />
                    </div>
                  </div>
                )}

                {/* Manual key toggle */}
                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => setShowManualKey(!showManualKey)}
                    className="text-[9px] uppercase tracking-wide"
                    style={{ color: '#4a90c4' }}
                  >
                    {showManualKey ? 'Hide' : 'Show'} manual entry key
                  </button>
                  {showManualKey && manualKey && (
                    <div
                      className="mt-2 p-2 font-mono text-xs tracking-wider break-all select-all cursor-text"
                      style={{ background: '#141414', border: '1px solid #2a2a2a', color: '#e5e7eb' }}
                    >
                      {manualKey}
                    </div>
                  )}
                </div>

                {/* Verify code */}
                <div>
                  <label className="block text-[10px] font-bold uppercase mb-1 tracking-wide" style={{ color: '#a0a0a0' }}>
                    Enter code from app to verify
                  </label>
                  <input
                    ref={setupCodeRef}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    className="input-dark h-12 text-center text-xl tracking-[0.5em] font-mono"
                    placeholder="000000"
                    value={setupCode}
                    onChange={(e) => setSetupCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    autoComplete="one-time-code"
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
                    'Verify & Activate 2FA'
                  )}
                </button>
              </form>
            )}

            {/* ═══ STEP: SHOW BACKUP CODES ═══ */}
            {loginStep === 'show_backup_codes' && backupCodes && (
              <div>
                <div className="text-center mb-4">
                  <KeyRound className="w-8 h-8 mx-auto mb-2" style={{ color: '#d4a017' }} />
                  <p className="text-body-sm font-semibold" style={{ color: '#e5e7eb' }}>
                    Backup Recovery Codes
                  </p>
                </div>
                <BackupCodesDisplay
                  codes={backupCodes}
                  onAcknowledge={handleBackupCodesAck}
                />
              </div>
            )}

            {/* ═══ STEP: PASSWORD CHANGE ═══ */}
            {loginStep === 'password_change' && (
              <form onSubmit={handlePasswordChange} className="space-y-3">
                <div className="text-center mb-2">
                  <Lock className="w-8 h-8 mx-auto mb-2" style={{ color: '#bc1010' }} />
                  <p className="text-body-sm font-semibold" style={{ color: '#e5e7eb' }}>
                    Password Change Required
                  </p>
                  <p className="text-[10px] mt-1" style={{ color: '#707070' }}>
                    Your password has expired or must be changed before continuing.
                  </p>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase mb-1 tracking-wide" style={{ color: '#a0a0a0' }}>
                    New Password
                  </label>
                  <input
                    type="password"
                    className="input-dark h-9"
                    placeholder="Enter new password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                  />
                  <PasswordStrengthMeter password={newPassword} />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase mb-1 tracking-wide" style={{ color: '#a0a0a0' }}>
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
                    <p className="text-[9px] mt-1" style={{ color: '#d93030' }}>Passwords do not match</p>
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
                    'Change Password & Continue'
                  )}
                </button>
              </form>
            )}
          </div>

          {/* Status bar */}
          <div className="status-bar">
            <div className="status-bar-section">
              <span
                className="led-dot"
                style={{
                  background: pending2FA ? '#a855f7' : status.color,
                  boxShadow: `0 0 4px ${pending2FA ? '#a855f7' : status.color}`,
                }}
              />
              <span>{pending2FA ? '2FA VERIFICATION' : status.text}</span>
            </div>
            <div className="status-bar-section border-r-0">
              <span>v{APP_VERSION}</span>
            </div>
          </div>
        </div>

        {/* ── Classification / FOUO Banner ──────────────── */}
        <div className="mt-4 sm:mt-5">
          <div
            className="text-center py-2 px-3"
            style={{
              background: '#0a0a0a',
              border: '1px solid #333',
              borderTop: '2px solid #8a0c0c',
            }}
          >
            <p
              className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.25em]"
              style={{ color: '#8a0c0c' }}
            >
              Internal Use Only
            </p>
            <p
              className="text-[7px] sm:text-[8px] mt-0.5 uppercase tracking-wider"
              style={{ color: '#444' }}
            >
              Company Confidential — Do Not Distribute
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-3 sm:mt-4">
          <p
            className="text-[8px] sm:text-[9px] tracking-wide"
            style={{ color: '#383838' }}
          >
            RMPG Flex v{APP_VERSION} | Rocky Mountain Protective Group, LLC
          </p>
          <p
            className="text-[7px] sm:text-[8px] mt-0.5 italic"
            style={{ color: '#303030' }}
          >
            &ldquo;Resolving today&rsquo;s concerns, to ensure
            tomorrow&rsquo;s solutions.&rdquo;
          </p>
        </div>
      </div>
    </div>
  );
}
