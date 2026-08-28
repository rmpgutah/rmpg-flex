// ============================================================
// RMPG Flex — High-Security Login Page
// Single-screen credentials (username + password), system info,
// device info, then 2FA / setup / password change flows.
// ============================================================

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  Eye, EyeOff, AlertCircle, ShieldCheck, ArrowLeft, Lock,
  KeyRound, Usb, Fingerprint, Monitor, Server, Wifi, Clock,
  HelpCircle, CheckCircle, ArrowRight,
} from 'lucide-react';
import { useAuth, type LoginStep, fetchWithTimeout } from '../context/AuthContext';
import TotpCodeInput from '../components/TotpCodeInput';
import PasswordStrengthMeter from '../components/security/PasswordStrengthMeter';
import BackupCodesDisplay from '../components/security/BackupCodesDisplay';
import { parseTimestamp } from '../utils/dateUtils';
import { useDeviceInfo } from '../utils/deviceInfo';

const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '5.3.9';
const BUILD_TIME: string =
  typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '';

type TwoFactorMode = 'choose' | 'totp' | 'webauthn' | 'backup';

// ── Performance detection ─────────────────────────
/** True when the device is likely too slow for heavy login visuals (WebGL globe, stacked CSS animations). */
function isLowPerfDevice(): boolean {
  // Honour OS / browser reduced-motion preference
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return true;
  // Very low core-count (≤2) usually means a truly low-power device / Toughbook
  if (typeof navigator.hardwareConcurrency === 'number' && navigator.hardwareConcurrency <= 2) return true;
  return false;
}

// ── Device detection helpers ──────────────────────
function getCurrentTime() {
  return new Date().toLocaleString('en-US', {
    timeZone: 'America/Denver',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}

// Status bar text/led for each step
const stepStatus: Record<LoginStep, { text: string; color: string }> = {
  username:           { text: 'AWAITING CREDENTIALS', color: 'var(--brand-gold)' },
  password:           { text: 'AUTHENTICATING',       color: 'var(--brand-gold)' },
  verify_2fa:         { text: '2FA VERIFICATION',     color: 'var(--sev-critical)' },
  setup_2fa:          { text: '2FA SETUP REQUIRED',   color: 'var(--sev-critical)' },
  confirm_setup_2fa:  { text: '2FA SETUP — VERIFY',   color: 'var(--sev-critical)' },
  show_backup_codes:  { text: 'SAVE BACKUP CODES',    color: 'var(--brand-gold)' },
  password_change:    { text: 'PASSWORD CHANGE REQ.',  color: 'var(--sev-critical)' },
  complete:           { text: 'AUTHENTICATED',         color: 'var(--sev-ok)' },
};

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-[3px]">
      <span className="text-[8px] uppercase tracking-wider font-bold text-rmpg-500">{label}</span>
      <span className="text-[9px] font-mono text-rmpg-200">{value}</span>
    </div>
  );
}

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
    twoFactorMethods,
  } = useAuth();

  const [loginUsername, setLoginUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [ssoChecking, setSsoChecking] = useState(false);
  const [showPasswordField, setShowPasswordField] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [backupCode, setBackupCode] = useState('');
  const [trustThisDevice, setTrustThisDevice] = useState(false);
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [webauthnError, setWebauthnError] = useState(false);
  const [twoFactorMode, setTwoFactorMode] = useState<TwoFactorMode>('choose');

  // Forgot Password flow state
  type ForgotPwStep = 'username' | 'questions' | 'reset' | 'success';
  // Auto-opens when `/login?forgot=1` (the redirect from the legacy
  // /forgot-password route) so the operator lands on the working in-page flow.
  const [forgotPwActive, setForgotPwActive] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('forgot') === '1';
  });
  const [forgotPwStep, setForgotPwStep] = useState<ForgotPwStep>('username');
  const [forgotUsername, setForgotUsername] = useState('');
  const [forgotQuestions, setForgotQuestions] = useState<string[]>([]);
  const [forgotAnswers, setForgotAnswers] = useState(['', '', '']);
  const [forgotTempToken, setForgotTempToken] = useState('');
  const [forgotNewPassword, setForgotNewPassword] = useState('');
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState('');
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotError, setForgotError] = useState('');

  // Last login display
  const [lastLoginInfo, setLastLoginInfo] = useState<{ time: string; ip: string } | null>(null);

  // ── URL deep-link contract (one-shot, stripped after consumption) ──
  // Honors `?return=<path>` to redirect to the original destination after
  // login (a supervisor can paste a deep link without authing first and
  // still land where they intended). `?reset=1` flashes a success banner
  // after the reset-password flow returns the user to /login. `?error=...`
  // surfaces a single banner (e.g. `?error=session_expired`).
  // `?username=<val>` pre-fills the username field (stripped on mount so a
  // refresh doesn't re-populate; deepLinkConsumedRef prevents double-apply).
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkConsumedRef = useRef(false);
  const returnUrl = useMemo(() => {
    const raw = searchParams.get('return');
    if (!raw) return null;
    // Only same-origin paths — never let an attacker bounce to an external host
    if (!raw.startsWith('/') || raw.startsWith('//')) return null;
    // Full-screen kiosk/drive surfaces aren't meaningful post-login destinations
    const BLOCKED_RETURNS = ['/desktop', '/navigation'];
    if (BLOCKED_RETURNS.some((p) => raw === p || raw.startsWith(p + '/'))) return null;
    return raw;
  }, [searchParams]);
  const [resetSuccess, setResetSuccess] = useState<boolean>(() => searchParams.get('reset') === '1');
  const [urlError, setUrlError] = useState<string | null>(() => {
    // src/routes/oidc.ts's backToLogin() sends failed dialer SSO attempts
    // here as ?sso=dialer&status=error&message=... — surface that message
    // directly since it's already operator-facing (e.g. "no linked account").
    if (searchParams.get('sso') === 'dialer' && searchParams.get('status') === 'error') {
      return searchParams.get('message') || 'Dialer sign-in failed. Please try again.';
    }
    const code = searchParams.get('error');
    if (!code) return null;
    switch (code) {
      case 'session_expired':  return 'Your session expired. Sign in again to continue.';
      case 'unauthorized':     return 'You must sign in to view that page.';
      case 'logged_out':       return 'You have been signed out.';
      default:                 return null;
    }
  });
  // Strip consumed params on mount so a refresh doesn't re-pin the banners.
  // Also apply ?username= pre-fill (one-shot via deepLinkConsumedRef).
  useEffect(() => {
    if (deepLinkConsumedRef.current) return;
    deepLinkConsumedRef.current = true;
    const hasTransient = searchParams.has('reset') || searchParams.has('error') ||
      searchParams.has('forgot') || searchParams.has('username') || searchParams.has('sso');
    if (!hasTransient) return;
    const next = new URLSearchParams(searchParams);
    // Pre-fill username if provided and field is empty
    const usernameParam = next.get('username');
    if (usernameParam && !loginUsername) {
      setLoginUsername(usernameParam);
    }
    next.delete('reset');
    next.delete('error');
    next.delete('forgot');
    next.delete('username');
    next.delete('sso');
    next.delete('status');
    next.delete('message');
    // Preserve `return` — it's still load-bearing for the post-login navigate.
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Auto-dismiss the reset-success flash after 6s so the form regains focus.
  useEffect(() => {
    if (!resetSuccess) return;
    const t = setTimeout(() => setResetSuccess(false), 6000);
    return () => clearTimeout(t);
  }, [resetSuccess]);

  // Post-login redirect honoring `?return=<path>`. The App.tsx /login route
  // already auto-redirects authed users to `/` (or `/crm`), but it ignores
  // the return URL. We intercept on `complete` and route there explicitly.
  useEffect(() => {
    if (loginStep !== 'complete' || !returnUrl) return;
    navigate(returnUrl, { replace: true });
  }, [loginStep, returnUrl, navigate]);

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

  // Performance tier (computed once)
  const lowPerf = useMemo(() => isLowPerfDevice(), []);

  // Clock — update every 60s on low-perf, every 1s otherwise
  const [clock, setClock] = useState(getCurrentTime());
  useEffect(() => {
    const iv = setInterval(() => setClock(getCurrentTime()), lowPerf ? 60_000 : 1000);
    return () => clearInterval(iv);
  }, [lowPerf]);

  // Live device info — viewport and online status re-sample on change rather
  // than freezing at mount. See utils/deviceInfo.ts.
  const device = useDeviceInfo();

  // Derived: true when the credentials form is the active step.
  // Declared here (before the keyboard useEffect) so the closure captures it.
  const isCredentialStep = !pending2FA && loginStep !== 'setup_2fa' && loginStep !== 'confirm_setup_2fa' && loginStep !== 'show_backup_codes' && loginStep !== 'password_change';

  // Esc smart-cascade: clear the most-foreground transient state first.
  //   1. context error (clearError)  2. URL-error banner  3. reset-success flash
  //   4. unmasked password  5. open forgot-password panel  → no-op otherwise.
  // N shortcut: focuses the username field when on the credentials step and the
  //   event target is not already an input/textarea (guards typed "n" in forms).
  // Critically, Esc does NOT cancel 2FA / setup_2fa — those have their own
  // explicit "Back" controls and an accidental Esc mid-verification would
  // discard the partially-entered code.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (error) { clearError(); return; }
        if (urlError) { setUrlError(null); return; }
        if (resetSuccess) { setResetSuccess(false); return; }
        if (showPassword) { setShowPassword(false); return; }
        if (forgotPwActive) { handleForgotClose(); return; }
        return;
      }
      if (e.key === 'n' || e.key === 'N') {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return;
        if (isCredentialStep && !forgotPwActive) {
          e.preventDefault();
          usernameRef.current?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error, urlError, resetSuccess, showPassword, forgotPwActive, isCredentialStep]);

  // Auto-logout (idle / max-session) messaging removed — sessions no longer
  // expire automatically, so these notices can never fire.

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

  // Focus the password field the moment it mounts (after the identifier-first
  // SSO check falls through). loginStep stays 'username' for this whole
  // screen, so the auto-focus effect above never fires again here -- without
  // this, focus would stay stranded on the now-satisfied username field.
  useEffect(() => {
    if (showPasswordField) passwordRef.current?.focus();
  }, [showPasswordField]);

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

  // Identifier-first step: before showing the password field, probe whether
  // the typed value (matched against the user's `email` column, not their
  // `username` -- those are separate fields in this app) is SSO-enabled.
  // If so, skip the password field entirely and redirect into Dial Connect.
  // A failed/timed-out check is non-fatal -- fall through to the normal
  // password field rather than blocking login entirely.
  const handleUsernameContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginUsername.trim()) return;
    setSsoChecking(true);
    clearError();
    try {
      const res = await fetchWithTimeout(`/api/oidc/dialer/check?email=${encodeURIComponent(loginUsername.trim())}`);
      // Guard on res.ok before parsing — a non-JSON error body (WAF challenge
      // page, SPA HTML fallback) would otherwise throw inside the try and read
      // as "SSO check failed" with a misleading JSON-parse error.
      const data = res.ok ? await res.json() : { ssoEnabled: false };
      if (data.ssoEnabled) {
        window.location.href = '/api/oidc/dialer/login';
        return;
      }
    } catch {
      // SSO check failing is non-fatal -- fall through to the normal
      // password field rather than blocking login entirely.
    } finally {
      setSsoChecking(false);
    }
    setShowPasswordField(true);
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

  // ── Forgot Password Handlers ──────────────────────────
  const handleForgotStart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotUsername.trim()) return;
    setForgotBusy(true);
    setForgotError('');
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: forgotUsername.trim() }),
      });
      const data = await res.json();
      if (data.hasQuestions && data.questions) {
        setForgotQuestions(data.questions);
        setForgotPwStep('questions');
      } else {
        setForgotError('No security questions found for this account. Contact your administrator.');
      }
    } catch {
      setForgotError('Unable to connect. Please try again.');
    } finally {
      setForgotBusy(false);
    }
  };

  const handleForgotAnswerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (forgotAnswers.some(a => !a.trim())) return;
    setForgotBusy(true);
    setForgotError('');
    try {
      const res = await fetch('/api/auth/forgot-password/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: forgotUsername.trim(), answers: forgotAnswers.map(a => a.trim().toLowerCase()) }),
      });
      const data = await res.json();
      if (res.ok && data.success && data.tempToken) {
        setForgotTempToken(data.tempToken);
        setForgotPwStep('reset');
      } else {
        setForgotError(data.error || 'One or more answers are incorrect.');
      }
    } catch {
      setForgotError('Unable to connect. Please try again.');
    } finally {
      setForgotBusy(false);
    }
  };

  const handleForgotReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotNewPassword || forgotNewPassword !== forgotConfirmPassword) return;
    setForgotBusy(true);
    setForgotError('');
    try {
      const res = await fetch('/api/auth/forgot-password/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tempToken: forgotTempToken, newPassword: forgotNewPassword }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setForgotPwStep('success');
      } else {
        setForgotError(data.error || 'Failed to reset password.');
      }
    } catch {
      setForgotError('Unable to connect. Please try again.');
    } finally {
      setForgotBusy(false);
    }
  };

  const handleForgotClose = () => {
    setForgotPwActive(false);
    setForgotPwStep('username');
    setForgotUsername('');
    setForgotQuestions([]);
    setForgotAnswers(['', '', '']);
    setForgotTempToken('');
    setForgotNewPassword('');
    setForgotConfirmPassword('');
    setForgotError('');
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

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative" style={{ background: 'linear-gradient(180deg, var(--surface-base) 0%, var(--surface-sunken) 100%)', paddingTop: 'env(safe-area-inset-top, 16px)', paddingBottom: 'env(safe-area-inset-bottom, 16px)' }}>
      {/* Animated grid background */}
      <div className="login-grid-bg" />

      {/* ── Security Warning Banner ─────────────────── */}
      <div
        className="w-full max-w-lg mb-1 sm:mb-3 px-3 sm:px-0 relative z-10"
        role="alert"
        aria-label="Security warning"
        style={{ marginTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div
          className="p-2 sm:p-2.5 text-center bg-gradient-to-b from-red-950/90 to-red-950/50 border border-red-800 border-t-2 border-t-red-500"
        >
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <div className="w-1 h-1 rounded-full animate-pulse bg-red-500" style={{ boxShadow: '0 0 4px var(--sev-critical)' }} />
            <span className="text-[8px] sm:text-[9px] font-black uppercase tracking-[0.2em] text-red-500">Warning</span>
            <div className="w-1 h-1 rounded-full animate-pulse bg-red-500" style={{ boxShadow: '0 0 4px var(--sev-critical)' }} />
          </div>
          <p className="text-[8px] sm:text-[9px] leading-relaxed font-medium text-red-400">
            RESTRICTED INTERNAL SYSTEM &mdash; AUTHORIZED USERS ONLY.
            ALL ACTIVITY IS MONITORED AND RECORDED. UNAUTHORIZED ACCESS IS PROHIBITED.
          </p>
        </div>
      </div>

      {/* ── Main Content ─────────────────────────────── */}
      <div className="relative w-full max-w-lg px-2 sm:px-0 z-10">
        {/* Logo */}
        <div className="text-center mb-1 sm:mb-2">
          <div className="inline-flex items-center justify-center">
            <img
              src="/rmpg flex.png"
              alt="RMPG Flex"
              style={{
                height: 'clamp(48px, 12vw, 88px)',
                width: 'clamp(48px, 12vw, 88px)',
                objectFit: 'contain',
                filter: 'drop-shadow(0 0 15px color-mix(in srgb, var(--brand-gold) 25%, transparent))',
              }}
              draggable={false}
              loading="eager"
            />
          </div>
          <div className="flex items-center justify-center gap-2 mt-0.5 sm:mt-1">
            <div className="h-px w-8 sm:w-12" style={{ background: 'linear-gradient(90deg, transparent, var(--border-default))' }} />
            <p className="text-[7px] sm:text-[8px] tracking-[0.15em] uppercase font-bold text-rmpg-400/65">
              Secure Authentication
            </p>
            <div className="h-px w-8 sm:w-12" style={{ background: 'linear-gradient(90deg, var(--border-default), transparent)' }} />
          </div>
        </div>

        {/* ── Login Card ──────────────────────────────── */}
        <div className="shadow-md relative overflow-hidden panel-beveled bg-surface-base" role="form" aria-label="Authentication form">
          {/* Title bar */}
          <div className="panel-title-bar flex items-center gap-2">
            <ShieldCheck className="w-3 h-3 text-rmpg-400" />
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
                <div className="flex items-center gap-1 mr-2" role="status">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-400" aria-hidden="true" />
                  <span className="text-[8px] uppercase tracking-wide text-green-400">Password OK</span>
                </div>
              )}
              <div className="w-4 h-3 flex items-center justify-center text-[8px] text-rmpg-400" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-strong)', borderBottom: '1px solid var(--border-subtle)' }} aria-hidden="true">_</div>
              <div className="w-4 h-3 flex items-center justify-center text-[8px] text-rmpg-400" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-strong)', borderBottom: '1px solid var(--border-subtle)' }} aria-hidden="true">&#9633;</div>
            </div>
          </div>

          <div className="p-4 sm:p-5">
            {/* URL `?error=...` banner — dismisses on Esc or close */}
            {urlError && !forgotPwActive && (
              <div className="flex items-center gap-2 p-2.5 mb-4 animate-fade-in border border-red-900" role="alert" aria-live="polite" style={{
                background: 'rgba(220, 38, 38, 0.10)',
              }}>
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 text-red-500" aria-hidden="true" />
                <p className="text-xs flex-1 text-red-400">{urlError}</p>
                <button
                  type="button"
                  onClick={() => setUrlError(null)}
                  className="text-[10px] uppercase tracking-wide font-bold text-rmpg-500 hover:text-rmpg-200 transition-colors"
                  aria-label="Dismiss notice"
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* `?reset=1` success flash — comes from ResetPasswordPage */}
            {resetSuccess && !forgotPwActive && (
              <div className="flex items-center gap-2 p-2.5 mb-4 animate-fade-in border border-green-800" role="status" aria-live="polite" style={{
                background: 'rgba(34, 197, 94, 0.08)',
              }}>
                <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 text-green-500" aria-hidden="true" />
                <p className="text-xs flex-1 text-green-300">
                  Password reset complete. Sign in with your new password.
                </p>
                <button
                  type="button"
                  onClick={() => setResetSuccess(false)}
                  className="text-[10px] uppercase tracking-wide font-bold text-rmpg-500 hover:text-rmpg-200 transition-colors"
                  aria-label="Dismiss notice"
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* Last login info banner */}
            {lastLoginInfo && (
              <div className="flex items-center gap-2 p-2 mb-4 animate-fade-in border border-green-800" style={{ background: 'rgba(34, 197, 94, 0.08)' }}>
                <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0 text-green-500" />
                <p className="text-xs text-green-300">
                  Last login: {(() => {
                    const d = parseTimestamp(lastLoginInfo.time);
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
              <div
                className={`flex items-center gap-2 p-2.5 mb-4 animate-fade-in ${error.includes('locked') ? 'border border-red-500' : 'border border-red-800'}`}
                role="alert"
                aria-live="assertive"
                style={{ background: error.includes('locked') ? 'rgba(239, 68, 68, 0.2)' : 'rgba(220, 38, 38, 0.15)' }}
              >
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 text-red-500" aria-hidden="true" />
                <div>
                  <p className="text-xs text-red-400">{error}</p>
                  {error.includes('attempt') && (
                    <p className="text-[10px] mt-0.5 text-red-400">Too many failed attempts will lock your account.</p>
                  )}
                  {(error.includes('Invalid verification') || error.includes('invalid verification')) && pending2FA && (
                    <p className="text-[10px] mt-0.5 text-red-400">
                      Tip: Wait for a fresh code in your authenticator app and ensure your device clock is accurate.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* ══════ CREDENTIALS STEP (username + password on one screen) ══════ */}
            {/* Hidden while the forgot-password panel is open so the operator
                isn't looking at two parallel forms. */}
            {isCredentialStep && !forgotPwActive && (
              <form onSubmit={showPasswordField ? handleCredentialsSubmit : handleUsernameContinue} className="space-y-3">
                {/* Chrome skips disabled username fields (identifier-first SSO
                    used to set disabled={ssoChecking}), so a password field in
                    this form logged "Password forms should have username fields".
                    Keep an always-enabled type=hidden username for the heuristic,
                    and use readOnly — not disabled — on the visible input. */}
                <input
                  type="hidden"
                  autoComplete="username"
                  value={loginUsername}
                />
                <div>
                  <label htmlFor="username" className="block text-[10px] font-bold uppercase mb-1.5 tracking-wide text-rmpg-400">
                    Username
                  </label>
                  <input
                    ref={usernameRef}
                    id="username"
                    name="username"
                    type="text"
                    className="input-dark login-input-glow h-9 sm:h-9 min-h-[44px] sm:min-h-0"
                    placeholder="Enter your username"
                    aria-required="true"
                    value={loginUsername}
                    onChange={(e) => { setLoginUsername(e.target.value); setShowPasswordField(false); }}
                    autoComplete="username"
                    required
                    readOnly={ssoChecking}
                  />
                </div>
                {showPasswordField && (
                  <div>
                    <label htmlFor="password" className="block text-[10px] font-bold uppercase mb-1.5 tracking-wide text-rmpg-400">
                      Password
                    </label>
                    <div className="relative">
                      <input
                        ref={passwordRef}
                        id="password"
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        className="input-dark login-input-glow h-9 sm:h-9 min-h-[44px] sm:min-h-0 pr-8"
                        placeholder="Enter your password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="current-password"
                        aria-required="true"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                                              className="absolute right-0 top-1/2 -translate-y-1/2 transition-colors flex items-center justify-center w-11 h-11 text-rmpg-500 hover:text-rmpg-200"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        tabIndex={0}
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                )}
                <button
                  type="submit"
                  disabled={loginBusy || ssoChecking || !loginUsername.trim() || (showPasswordField && !password)}
                  className="toolbar-btn toolbar-btn-primary w-full h-9 sm:h-9 min-h-[48px] sm:min-h-0 text-rmpg-100 text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all duration-150 active:scale-[0.98]"
                  aria-busy={loginBusy || ssoChecking}
                >
                  {loginBusy || ssoChecking ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true" />
                      <span>{ssoChecking ? 'Checking...' : 'Authenticating...'}</span>
                    </>
                  ) : (
                    showPasswordField ? 'Sign In' : 'Continue'
                  )}
                </button>
                {showPasswordField && (
                  <button
                    type="button"
                    onClick={() => { setForgotPwActive(true); setForgotPwStep('username'); setForgotUsername(loginUsername); setForgotError(''); }}
                    className="w-full text-center text-[10px] uppercase tracking-wider font-bold mt-2 transition-colors text-rmpg-500"
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--brand-gold)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
                    aria-label="Forgot password"
                  >
                    Forgot Password?
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { window.location.href = '/api/oidc/dialer/login'; }}
                  className="toolbar-btn w-full h-9 sm:h-9 min-h-[44px] sm:min-h-0 text-rmpg-300 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 mt-2"
                  aria-label="Sign in with Dialer"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Sign in with Dialer
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
                  <p className="text-[10px] uppercase tracking-wide font-bold mb-1 text-rmpg-400">
                    Enter Authenticator Code
                  </p>
                  <p className="text-[9px] text-rmpg-500">
                    Open your authenticator app and enter the 6-digit code
                  </p>
                </div>

                <TotpCodeInput
                  value={totpCode}
                  onChange={setTotpCode}
                  disabled={loginBusy}
                  error={!!error}
                />

                <button
                  type="submit"
                  disabled={loginBusy || totpCode.replace(/\s/g, '').length < 6}
                  className="toolbar-btn toolbar-btn-primary w-full h-9 sm:h-9 min-h-[48px] sm:min-h-0 text-rmpg-100 text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all duration-150 active:scale-[0.98]"
                  aria-busy={loginBusy}
                >
                  {loginBusy ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true" />
                      <span>Verifying...</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                      VERIFY CODE
                    </>
                  )}
                </button>

                {/* Trust this device checkbox */}
                <label className="flex items-center gap-2 cursor-pointer select-none py-1 group min-h-[44px]">
                  <input id="ff-loginpage-0"
                    type="checkbox"
                    name="trust-device"
                    checked={trustThisDevice}
                    onChange={(e) => setTrustThisDevice(e.target.checked)}
                    className="w-4 h-4 rounded-sm cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500/50"
                    style={{ accentColor: 'var(--rmpg-400)' }}
                    aria-label="Trust this device for 30 days"
                  />
                  <span className="text-[10px] group-hover:text-rmpg-200 transition-colors text-rmpg-400">
                    Trust this device for 30 days
                  </span>
                </label>

                {/* Alternative methods */}
                <div className="flex items-center justify-between pt-2" style={{ borderTop: '1px solid var(--border-default)' }}>
                  <button
                    type="button"
                    onClick={handleBackWebAuthn}
                                        className="flex items-center gap-1 text-[10px] uppercase tracking-wide font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500/50 rounded-sm px-1 py-0.5 text-rmpg-500"
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
                    aria-label="Go back to credentials"
                  >
                    <ArrowLeft className="w-3 h-3" aria-hidden="true" />
                    Back
                  </button>
                  <div className="flex items-center gap-3">
                    {twoFactorMethods.webauthn && (
                    <button
                      type="button"
                      onClick={() => { clearError(); handleSecurityKeyAuth(); }}
                      disabled={loginBusy}
                                            className="flex items-center gap-1 text-[10px] uppercase tracking-wide font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500/50 rounded-sm px-1 py-0.5 text-rmpg-500"
                      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--sev-warn)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
                      aria-label="Verify with YubiKey security key"
                    >
                      <Usb className="w-3 h-3" aria-hidden="true" />
                      YubiKey
                    </button>
                    )}
                    <button
                      type="button"
                      onClick={() => { setTwoFactorMode('backup'); setUseBackupCode(true); clearError(); }}
                                            className="text-[10px] uppercase tracking-wide font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500/50 rounded-sm px-1 py-0.5 text-rmpg-500"
                      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
                      aria-label="Use a backup recovery code"
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
                  <p className="text-[10px] uppercase tracking-wide font-bold mb-1 text-rmpg-400">Security Key</p>
                  <p className="text-[9px] text-rmpg-500">
                    {webauthnError ? 'Authentication failed — try again' : 'Touch your security key when it flashes'}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleSecurityKeyAuth}
                  disabled={loginBusy}
                  className="toolbar-btn toolbar-btn-primary w-full h-9 sm:h-9 min-h-[48px] sm:min-h-0 text-rmpg-100 text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all duration-150 active:scale-[0.98]"
                  aria-busy={loginBusy}
                  aria-label={webauthnError ? 'Retry security key authentication' : 'Activate security key'}
                >
                  {loginBusy ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true" />
                      <span>Waiting...</span>
                    </>
                  ) : (
                    <>
                      <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
                      {webauthnError ? 'RETRY SECURITY KEY' : 'ACTIVATE SECURITY KEY'}
                    </>
                  )}
                </button>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleBackWebAuthn}
                                        className="flex items-center gap-1 text-[10px] uppercase tracking-wide font-bold transition-colors text-rmpg-500"
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
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
                  <p className="text-[10px] uppercase tracking-wide font-bold mb-1 text-rmpg-400">Recovery Code</p>
                  <p className="text-[9px] text-rmpg-500">Enter one of your single-use backup codes</p>
                </div>

                <input id="ff-loginpage-1"
                  type="text"
                  name="backup-code"
                  className="input-dark login-input-glow h-9 sm:h-9 min-h-[44px] sm:min-h-0 text-center font-mono tracking-widest uppercase"
                  placeholder="XXXX-XXXX"
                  value={backupCode}
                  onChange={(e) => setBackupCode(e.target.value)}
                  autoFocus
                  maxLength={9}
                  aria-label="Backup recovery code"
                  autoComplete="off"
                  spellCheck={false}
                />

                <button
                  type="submit"
                  disabled={loginBusy || !backupCode.trim()}
                  className="toolbar-btn toolbar-btn-primary w-full h-9 sm:h-9 min-h-[48px] sm:min-h-0 text-rmpg-100 text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
                                        className="flex items-center gap-1 text-[10px] uppercase tracking-wide font-bold transition-colors text-rmpg-500"
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
                  >
                    <ArrowLeft className="w-3 h-3" />
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => { setTwoFactorMode('totp'); clearError(); }}
                                        className="text-[10px] uppercase tracking-wide font-bold transition-colors text-rmpg-500"
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
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
                  <ShieldCheck className="w-10 h-10 mx-auto mb-2 text-rmpg-400" />
                  <p className="text-[10px] uppercase tracking-wide font-bold mb-1 text-rmpg-400">
                    Two-Factor Authentication Required
                  </p>
                  <p className="text-[9px] leading-relaxed text-rmpg-500">
                    Your account requires two-factor authentication. You'll need an authenticator app like
                    <strong> Google Authenticator</strong> or <strong>Authy</strong>.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleStartSetup}
                  disabled={loginBusy}
                  className="toolbar-btn toolbar-btn-primary w-full h-9 sm:h-9 min-h-[48px] sm:min-h-0 text-rmpg-100 text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all duration-150 active:scale-[0.98]"
                  aria-busy={loginBusy}
                >
                  {loginBusy ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true" />
                      <span>Generating...</span>
                    </>
                  ) : (
                    'BEGIN SETUP'
                  )}
                </button>
                <button type="button"
                  onClick={handleBack}
                  className="w-full flex items-center justify-center gap-1 py-1.5 text-[9px] uppercase tracking-wider"
                  style={{ color: 'var(--text-muted)', background: 'transparent', border: 'none' }}
                >
                  <ArrowLeft className="w-3 h-3" /> Set Up Later
                </button>
              </div>
            )}

            {/* ══════ Confirm 2FA Setup (QR code + verify) ══════ */}
            {loginStep === 'confirm_setup_2fa' && (
              <form onSubmit={handleConfirmSetup} className="space-y-4">
                <div className="text-center">
                  <p className="text-[10px] uppercase tracking-wide font-bold mb-1 text-rmpg-400">Scan QR Code</p>
                  <p className="text-[9px] text-rmpg-500">
                    Scan with your authenticator app, then enter the 6-digit code
                  </p>
                </div>

                {qrCodeUri && (
                  <div className="flex justify-center">
                    <div className="p-2.5 shadow-lg bg-white" style={{ borderRadius: '2px' }}>
                      <img src={qrCodeUri} alt="Scan this QR code with your authenticator app to set up two-factor authentication" className="w-44 h-44" draggable={false} />
                    </div>
                  </div>
                )}

                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => setShowManualKey(!showManualKey)}
                    className="text-[9px] uppercase tracking-wide text-rmpg-400"
                  >
                    {showManualKey ? 'Hide' : 'Show'} manual entry key
                  </button>
                  {showManualKey && manualKey && (
                    <div
                      className="mt-2 p-2 font-mono text-xs tracking-wider break-all select-all cursor-text"
                      style={{ background: 'var(--surface-overlay)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
                    >
                      {manualKey}
                    </div>
                  )}
                </div>

                <div>
                  <label htmlFor="setup-code" className="block text-[10px] font-bold uppercase mb-1.5 tracking-wide text-rmpg-400">
                    Enter code from app to verify
                  </label>
                  <input
                    id="setup-code"
                    name="setup-code"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    className="input-dark h-10 sm:h-10 min-h-[44px] text-center text-lg tracking-[0.5em] font-mono login-input-glow"
                    placeholder="000000"
                    value={setupCode}
                    onChange={(e) => setSetupCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    autoComplete="one-time-code"
                    autoFocus
                    aria-label="6-digit verification code"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loginBusy || setupCode.length !== 6}
                  className="toolbar-btn toolbar-btn-primary w-full h-9 sm:h-9 min-h-[48px] sm:min-h-0 text-rmpg-100 text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all duration-150 active:scale-[0.98]"
                  aria-busy={loginBusy}
                >
                  {loginBusy ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true" />
                      <span>Verifying...</span>
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
                  <KeyRound className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--brand-gold)' }} />
                  <p className="text-[10px] uppercase tracking-wide font-bold mb-1 text-rmpg-400">
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
                {/* A password form with no username field makes password
                    managers guess which account the new password belongs to,
                    and Chrome logs "Password forms should have (optionally
                    hidden) username fields for accessibility". The identifier
                    is already known at this step — expose it read-only and
                    off-screen so managers can attribute the update. */}
                <input
                  type="text"
                  name="username"
                  autoComplete="username"
                  value={loginUsername}
                  readOnly
                  aria-hidden="true"
                  tabIndex={-1}
                  className="sr-only"
                />
                <div className="text-center mb-2">
                  <Lock className="w-8 h-8 mx-auto mb-2 text-rmpg-400" />
                  <p className="text-[10px] uppercase tracking-wide font-bold mb-1 text-rmpg-400">
                    Password Change Required
                  </p>
                  <p className="text-[9px] text-rmpg-500">
                    Your password has expired or must be changed before continuing.
                  </p>
                </div>

                <div>
                  <label htmlFor="new-pw" className="block text-[10px] font-bold uppercase mb-1.5 tracking-wide text-rmpg-400">
                    New Password
                  </label>
                  <input
                    id="new-pw"
                    name="new-password"
                    type="password"
                    className="input-dark login-input-glow h-9 sm:h-9 min-h-[44px] sm:min-h-0"
                    placeholder="Enter new password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                    autoFocus
                    required
                    aria-required="true"
                  />
                  <PasswordStrengthMeter password={newPassword} />
                </div>

                <div>
                  <label htmlFor="confirm-pw" className="block text-[10px] font-bold uppercase mb-1.5 tracking-wide text-rmpg-400">
                    Confirm Password
                  </label>
                  <input
                    id="confirm-pw"
                    name="confirm-password"
                    type="password"
                    className="input-dark login-input-glow h-9 sm:h-9 min-h-[44px] sm:min-h-0"
                    placeholder="Confirm new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                    aria-required="true"
                  />
                  {confirmPassword && newPassword !== confirmPassword && (
                    <p className="text-[9px] mt-1 text-red-400">Passwords do not match</p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loginBusy || !newPassword || newPassword !== confirmPassword}
                  className="toolbar-btn toolbar-btn-primary w-full h-9 sm:h-9 min-h-[48px] sm:min-h-0 text-rmpg-100 text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all duration-150 active:scale-[0.98]"
                  aria-busy={loginBusy}
                >
                  {loginBusy ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true" />
                      <span>Updating...</span>
                    </>
                  ) : (
                    'CHANGE PASSWORD & CONTINUE'
                  )}
                </button>
              </form>
            )}

            {/* ══════ Forgot Password Flow ══════ */}
            {forgotPwActive && (
              <div className="space-y-3">
                {/* Error */}
                {forgotError && (
                  <div className="flex items-center gap-2 p-2.5 mb-2 animate-fade-in border border-red-800" role="alert" style={{ background: 'rgba(220, 38, 38, 0.15)' }}>
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 text-red-500" aria-hidden="true" />
                    <p className="text-xs text-red-400">{forgotError}</p>
                  </div>
                )}

                {/* Step: Username */}
                {forgotPwStep === 'username' && (
                  <form onSubmit={handleForgotStart} className="space-y-3">
                    <div className="text-center mb-1">
                      <HelpCircle className="w-8 h-8 mx-auto mb-1" style={{ color: 'var(--brand-gold)' }} />
                      <p className="text-[10px] uppercase tracking-wide font-bold mb-1 text-rmpg-400">
                        Forgot Password
                      </p>
                      <p className="text-[9px] text-rmpg-500">
                        Enter your username to retrieve your security questions.
                      </p>
                    </div>
                    <div>
                      <label htmlFor="forgot-username" className="block text-[10px] font-bold uppercase mb-1.5 tracking-wide text-rmpg-400">
                        Username
                      </label>
                      <input
                        id="forgot-username"
                        type="text"
                        className="input-dark login-input-glow h-9 sm:h-9 min-h-[44px] sm:min-h-0"
                        placeholder="Enter your username"
                        value={forgotUsername}
                        onChange={(e) => setForgotUsername(e.target.value)}
                        autoComplete="username"
                        autoFocus
                        required
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={forgotBusy || !forgotUsername.trim()}
                      className="toolbar-btn toolbar-btn-primary w-full h-9 sm:h-9 min-h-[48px] sm:min-h-0 text-rmpg-100 text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {forgotBusy ? (
                        <>
                          <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true" />
                          Checking...
                        </>
                      ) : (
                        'Continue'
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={handleForgotClose}
                                            className="w-full text-center text-[9px] uppercase tracking-wider mt-1 text-rmpg-500"
                    >
                      Back to Login
                    </button>
                  </form>
                )}

                {/* Step: Answer Security Questions */}
                {forgotPwStep === 'questions' && (
                  <form onSubmit={handleForgotAnswerSubmit} className="space-y-3">
                    <div className="text-center mb-1">
                      <ShieldCheck className="w-8 h-8 mx-auto mb-1" style={{ color: 'var(--brand-gold)' }} />
                      <p className="text-[10px] uppercase tracking-wide font-bold mb-1 text-rmpg-400">
                        Answer Security Questions
                      </p>
                      <p className="text-[9px] text-rmpg-500">
                        Answers are case-insensitive.
                      </p>
                    </div>
                    {[0, 1, 2].map((i) => (
                      <div key={i}>
                        <label htmlFor="ff-loginpage-2" className="block text-[10px] font-bold uppercase mb-1.5 tracking-wide text-rmpg-400">
                          Question {i + 1}
                        </label>
                        <p className="text-[10px] mb-1" style={{ color: 'var(--text-secondary)' }}>{forgotQuestions[i]}</p>
                        <input id="ff-loginpage-2"
                          type="text"
                          className="input-dark login-input-glow h-9 sm:h-9 min-h-[44px] sm:min-h-0"
                          placeholder="Your answer"
                          value={forgotAnswers[i]}
                          onChange={(e) => {
                            const newAnswers = [...forgotAnswers];
                            newAnswers[i] = e.target.value;
                            setForgotAnswers(newAnswers);
                          }}
                          autoComplete="off"
                          autoFocus={i === 0}
                          required
                        />
                      </div>
                    ))}
                    <button
                      type="submit"
                      disabled={forgotBusy || forgotAnswers.some(a => !a.trim())}
                      className="toolbar-btn toolbar-btn-primary w-full h-9 sm:h-9 min-h-[48px] sm:min-h-0 text-rmpg-100 text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {forgotBusy ? (
                        <>
                          <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true" />
                          Verifying...
                        </>
                      ) : (
                        'Verify Answers'
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setForgotPwStep('username'); setForgotError(''); }}
                                            className="w-full flex items-center justify-center gap-1 text-[9px] uppercase tracking-wider mt-1 text-rmpg-500"
                    >
                      <ArrowLeft className="w-3 h-3" /> Back
                    </button>
                  </form>
                )}

                {/* Step: Reset Password */}
                {forgotPwStep === 'reset' && (
                  <form onSubmit={handleForgotReset} className="space-y-3">
                    {/* Same rationale as the password_change form above — give
                        password managers the account this reset belongs to. */}
                    <input
                      type="text"
                      name="username"
                      autoComplete="username"
                      value={forgotUsername}
                      readOnly
                      aria-hidden="true"
                      tabIndex={-1}
                      className="sr-only"
                    />
                    <div className="text-center mb-1">
                      <Lock className="w-8 h-8 mx-auto mb-1" style={{ color: 'var(--brand-gold)' }} />
                      <p className="text-[10px] uppercase tracking-wide font-bold mb-1 text-rmpg-400">
                        Reset Password
                      </p>
                      <p className="text-[9px] text-rmpg-500">
                        Choose a new password for your account.
                      </p>
                    </div>
                    <div>
                      <label htmlFor="forgot-new-pw" className="block text-[10px] font-bold uppercase mb-1.5 tracking-wide text-rmpg-400">
                        New Password
                      </label>
                      <input
                        id="forgot-new-pw"
                        type="password"
                        className="input-dark login-input-glow h-9 sm:h-9 min-h-[44px] sm:min-h-0"
                        placeholder="At least 12 characters"
                        value={forgotNewPassword}
                        onChange={(e) => setForgotNewPassword(e.target.value)}
                        autoComplete="new-password"
                        autoFocus
                        required
                      />
                    </div>
                    <div>
                      <label htmlFor="forgot-confirm-pw" className="block text-[10px] font-bold uppercase mb-1.5 tracking-wide text-rmpg-400">
                        Confirm Password
                      </label>
                      <input
                        id="forgot-confirm-pw"
                        type="password"
                        className="input-dark login-input-glow h-9 sm:h-9 min-h-[44px] sm:min-h-0"
                        placeholder="Confirm new password"
                        value={forgotConfirmPassword}
                        onChange={(e) => setForgotConfirmPassword(e.target.value)}
                        autoComplete="new-password"
                        required
                      />
                      {forgotConfirmPassword && forgotNewPassword !== forgotConfirmPassword && (
                        <p className="text-[9px] mt-1 text-red-400">Passwords do not match</p>
                      )}
                    </div>
                    <button
                      type="submit"
                      disabled={forgotBusy || !forgotNewPassword || forgotNewPassword !== forgotConfirmPassword}
                      className="toolbar-btn toolbar-btn-primary w-full h-9 sm:h-9 min-h-[48px] sm:min-h-0 text-rmpg-100 text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {forgotBusy ? (
                        <>
                          <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true" />
                          Resetting...
                        </>
                      ) : (
                        'Reset Password'
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setForgotPwStep('questions'); setForgotError(''); }}
                                            className="w-full flex items-center justify-center gap-1 text-[9px] uppercase tracking-wider mt-1 text-rmpg-500"
                    >
                      <ArrowLeft className="w-3 h-3" /> Back
                    </button>
                  </form>
                )}

                {/* Step: Success */}
                {forgotPwStep === 'success' && (
                  <div className="text-center space-y-3 py-2">
                    <CheckCircle className="w-10 h-10 mx-auto text-green-500" />
                    <p className="text-[10px] uppercase tracking-wide font-bold text-rmpg-400">
                      Password Reset Complete
                    </p>
                    <p className="text-[9px] text-rmpg-500">
                      Your password has been reset successfully. You can now log in with your new password.
                    </p>
                    <button
                      type="button"
                      onClick={handleForgotClose}
                      className="toolbar-btn toolbar-btn-primary w-full h-9 sm:h-9 min-h-[48px] sm:min-h-0 text-rmpg-100 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2"
                    >
                      <ArrowRight className="w-3.5 h-3.5" />
                      Return to Login
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="mt-3 pt-2" style={{ borderTop: '1px solid var(--border-default)' }} aria-hidden="true" />
          </div>

          {/* Status bar */}
          <div className="status-bar" role="status" aria-label={`Login status: ${stepStatus[loginStep].text}`}>
            <div className="status-bar-section">
              <span className="led-dot" style={{ background: stepStatus[loginStep].color, boxShadow: `0 0 4px ${stepStatus[loginStep].color}` }} aria-hidden="true" />
              <span>{stepStatus[loginStep].text}</span>
            </div>
            <div className="status-bar-section" aria-label="Connection encrypted">
              <span className="text-rmpg-500">ENCRYPTED</span>
            </div>
            <div className="status-bar-section border-r-0">
              <span>v{APP_VERSION}</span>
            </div>
          </div>
        </div>

        {/* ── System Info + Device Info Panels ─────────── */}
        {/* Hidden on phones to keep login form above fold. Uses CSS class.
            Also hidden while forgot-password is open — the panel itself is
            tall enough that the extra two panels push the action button off
            the fold. */}
        {isCredentialStep && !forgotPwActive && (
          <div className="login-system-info grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
            {/* System Info */}
            <div className="panel-beveled bg-surface-base overflow-hidden">
              <div className="panel-title-bar flex items-center gap-1.5">
                <Server className="w-2.5 h-2.5 text-rmpg-400" />
                <span>SYSTEM</span>
              </div>
              <div className="px-3 py-2">
                <InfoRow label="Application" value="RMPG Flex CAD/RMS" />
                <InfoRow label="Version" value={`v${APP_VERSION}`} />
                {BUILD_TIME && <InfoRow label="Build" value={new Date(BUILD_TIME).toLocaleDateString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', year: 'numeric' })} />}{/* new-date-ok */}
                <InfoRow label="Operator" value="Rocky Mountain Protective Group" />
                <InfoRow label="Jurisdiction" value="Salt Lake City, UT" />
                <div className="flex items-center justify-between py-[3px]">
                  <span className="text-[8px] uppercase tracking-wider font-bold text-rmpg-500">Server</span>
                  <div className="flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500" style={{ boxShadow: '0 0 3px var(--sev-ok)' }} />
                    <span className="text-[9px] font-mono text-green-400">Online</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Device Info */}
            <div className="panel-beveled bg-surface-base overflow-hidden">
              <div className="panel-title-bar flex items-center gap-1.5">
                <Monitor className="w-2.5 h-2.5 text-rmpg-400" />
                <span>DEVICE</span>
              </div>
              <div className="px-3 py-2">
                <InfoRow label="Browser" value={device.browser} />
                <InfoRow label="OS" value={device.os} />
                <InfoRow label="Type" value={device.deviceType} />
                <InfoRow label="Display" value={device.screen} />
                <InfoRow label="Viewport" value={device.viewport} />
                <div className="flex items-center justify-between py-[3px]">
                  <span className="text-[8px] uppercase tracking-wider font-bold text-rmpg-500">Connection</span>
                  <div className="flex items-center gap-1">
                    <Wifi className={`w-2.5 h-2.5 ${device.online ? 'text-green-400' : 'text-red-500'}`} />
                    <span className={`text-[9px] font-mono ${device.online ? 'text-green-400' : 'text-red-500'}`}>
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
              background: 'var(--surface-base)',
              border: '1px solid var(--border-default)',
              borderTop: '2px solid var(--border-default)',
            }}
          >
            <p className="text-[8px] sm:text-[9px] font-black uppercase tracking-[0.25em]" style={{ color: 'var(--text-muted)' }}>
              Internal Use Only
            </p>
            <p className="text-[7px] mt-0.5 uppercase tracking-wider text-rmpg-500">
              Company Confidential — Do Not Distribute
            </p>
          </div>
        </div>

        {/* Footer with clock */}
        <div className="text-center mt-2 flex items-center justify-center gap-3" aria-label="Application footer">
          <p className="text-[7px] sm:text-[8px] tracking-wide" style={{ color: 'var(--text-muted)' }}>
            RMPG Flex v{APP_VERSION} | Rocky Mountain Protective Group, LLC
          </p>
          <div className="flex items-center gap-1" role="timer" aria-label="Current Mountain Time">
            <Clock className="w-2.5 h-2.5" style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
            <time className="text-[8px] font-mono tabular-nums" style={{ color: 'var(--text-muted)' }}>{clock} MT</time>
          </div>
        </div>
      </div>
    </div>
  );
}
