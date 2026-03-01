// ============================================================
// RMPG Flex — High-Security Login Page
// Security warning banner, multi-step auth (credentials
// → TOTP 2FA), classification banner.
// ============================================================

import React, { useState } from 'react';
import { Eye, EyeOff, AlertCircle, ShieldCheck, ArrowLeft } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import TotpCodeInput from '../components/TotpCodeInput';

const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '5.3.9';

export default function LoginPage() {
  const {
    login,
    verify2FA,
    pending2FA,
    cancel2FA,
    error,
    clearError,
    loginBusy,
  } = useAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [backupCode, setBackupCode] = useState('');

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    try {
      await login(username, password);
    } catch {
      // Error handled by context
    }
  };

  const handleTotpSubmit = async (code: string) => {
    clearError();
    try {
      await verify2FA(code);
    } catch {
      // Error handled by context — clear TOTP input for retry
      setTotpCode('');
    }
  };

  const handleBackupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!backupCode.trim()) return;
    await handleTotpSubmit(backupCode.trim());
  };

  const handleBack = () => {
    cancel2FA();
    setTotpCode('');
    setBackupCode('');
    setUseBackupCode(false);
    setPassword('');
  };

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
        {/* Logo */}
        <div className="text-center mb-3 sm:mb-4">
          <div className="inline-flex items-center justify-center mb-1">
            <img
              src="/rmpg flex.png"
              alt="RMPG Flex"
              className="drop-shadow-[0_0_20px_rgba(188,16,16,0.3)]"
              style={{
                height: 'clamp(90px, 22vw, 150px)',
                width: 'clamp(90px, 22vw, 150px)',
                objectFit: 'contain',
              }}
              draggable={false}
            />
          </div>
          <div className="flex items-center justify-center gap-2 mt-1">
            <div
              className="h-px w-10 sm:w-16"
              style={{
                background: 'linear-gradient(90deg, transparent, #8a0c0c)',
              }}
            />
            <p
              className="text-[8px] sm:text-[9px] tracking-[0.15em] uppercase font-bold"
              style={{ color: 'rgba(188, 16, 16, 0.65)' }}
            >
              Secure Authentication
            </p>
            <div
              className="h-px w-10 sm:w-16"
              style={{
                background: 'linear-gradient(90deg, #8a0c0c, transparent)',
              }}
            />
          </div>
        </div>

        {/* Card with Spillman Flex chrome */}
        <div className="shadow-2xl relative overflow-hidden panel-beveled bg-surface-base">
          {/* Title bar */}
          <div className="panel-title-bar flex items-center gap-2">
            <ShieldCheck className="w-3 h-3" style={{ color: '#bc1010' }} />
            <span>
              {pending2FA
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
                  background: '#383838',
                  border: '1px solid #484848',
                  borderBottom: '1px solid #282828',
                }}
              >
                _
              </div>
              <div
                className="w-4 h-3 flex items-center justify-center text-[8px] text-rmpg-400"
                style={{
                  background: '#383838',
                  border: '1px solid #484848',
                  borderBottom: '1px solid #282828',
                }}
              >
                □
              </div>
            </div>
          </div>

          <div className="p-5 sm:p-6">
            {/* Step indicator */}
            <div className="flex items-center justify-center gap-3 mb-5">
              <div className="flex items-center gap-1.5">
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
                  style={{
                    background: pending2FA ? '#1a3a1a' : '#8a0c0c',
                    border: `2px solid ${pending2FA ? '#4ade80' : '#bc1010'}`,
                    color: pending2FA ? '#4ade80' : '#fff',
                  }}
                >
                  {pending2FA ? '✓' : '1'}
                </div>
                <span
                  className="text-[9px] font-bold uppercase tracking-wide"
                  style={{ color: pending2FA ? '#4ade80' : '#bc1010' }}
                >
                  Credentials
                </span>
              </div>
              <div
                className="w-8 h-px"
                style={{
                  background: pending2FA ? '#4ade80' : '#333',
                }}
              />
              <div className="flex items-center gap-1.5">
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
                  style={{
                    background: pending2FA ? '#8a0c0c' : '#1a1a1a',
                    border: `2px solid ${pending2FA ? '#bc1010' : '#333'}`,
                    color: pending2FA ? '#fff' : '#555',
                  }}
                >
                  2
                </div>
                <span
                  className="text-[9px] font-bold uppercase tracking-wide"
                  style={{ color: pending2FA ? '#bc1010' : '#555' }}
                >
                  Verify
                </span>
              </div>
            </div>

            {/* Error display */}
            {error && (
              <div
                className="flex items-center gap-2 p-2 mb-4 animate-fade-in"
                style={{
                  background: 'rgba(188, 16, 16, 0.15)',
                  border: '1px solid #8a0c0c',
                }}
              >
                <AlertCircle
                  className="w-3.5 h-3.5 flex-shrink-0"
                  style={{ color: '#d93030' }}
                />
                <p className="text-xs" style={{ color: '#ef7a7a' }}>
                  {error}
                </p>
              </div>
            )}

            {/* ── Step 1: Username + Password ──────────────── */}
            {!pending2FA && (
              <form onSubmit={handleCredentialsSubmit} className="space-y-3">
                <div>
                  <label
                    htmlFor="username"
                    className="block text-[10px] font-bold uppercase mb-1 tracking-wide"
                    style={{ color: '#a0a0a0' }}
                  >
                    Username
                  </label>
                  <input
                    id="username"
                    type="text"
                    className="input-dark h-9"
                    placeholder="Enter your username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    autoFocus
                    required
                  />
                </div>

                <div>
                  <label
                    htmlFor="password"
                    className="block text-[10px] font-bold uppercase mb-1 tracking-wide"
                    style={{ color: '#a0a0a0' }}
                  >
                    Password
                  </label>
                  <div className="relative">
                    <input
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
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = '#e0e0e0';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = '#707070';
                      }}
                      aria-label={
                        showPassword ? 'Hide password' : 'Show password'
                      }
                      tabIndex={0}
                    >
                      {showPassword ? (
                        <EyeOff className="w-3.5 h-3.5" />
                      ) : (
                        <Eye className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loginBusy || !username || !password}
                  className="toolbar-btn toolbar-btn-primary w-full h-9 text-white text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loginBusy ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Authenticating...
                    </>
                  ) : (
                    'SIGN IN'
                  )}
                </button>
              </form>
            )}

            {/* ── Step 2: TOTP Verification ────────────────── */}
            {pending2FA && !useBackupCode && (
              <div className="space-y-4">
                <div className="text-center mb-2">
                  <p
                    className="text-[10px] uppercase tracking-wide font-bold mb-1"
                    style={{ color: '#a0a0a0' }}
                  >
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
                    <span
                      className="text-[10px] uppercase tracking-wide"
                      style={{ color: '#a0a0a0' }}
                    >
                      Verifying...
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={handleBack}
                    className="flex items-center gap-1 text-[10px] uppercase tracking-wide font-bold transition-colors"
                    style={{ color: '#666' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = '#e0e0e0';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = '#666';
                    }}
                  >
                    <ArrowLeft className="w-3 h-3" />
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUseBackupCode(true);
                      clearError();
                    }}
                    className="text-[10px] uppercase tracking-wide font-bold transition-colors"
                    style={{ color: '#666' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = '#bc1010';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = '#666';
                    }}
                  >
                    Use Backup Code
                  </button>
                </div>
              </div>
            )}

            {/* ── Step 2 (alt): Backup Code ────────────────── */}
            {pending2FA && useBackupCode && (
              <form onSubmit={handleBackupSubmit} className="space-y-3">
                <div className="text-center mb-2">
                  <p
                    className="text-[10px] uppercase tracking-wide font-bold mb-1"
                    style={{ color: '#a0a0a0' }}
                  >
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
                    onClick={handleBack}
                    className="flex items-center gap-1 text-[10px] uppercase tracking-wide font-bold transition-colors"
                    style={{ color: '#666' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = '#e0e0e0';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = '#666';
                    }}
                  >
                    <ArrowLeft className="w-3 h-3" />
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUseBackupCode(false);
                      clearError();
                    }}
                    className="text-[10px] uppercase tracking-wide font-bold transition-colors"
                    style={{ color: '#666' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = '#bc1010';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = '#666';
                    }}
                  >
                    Use Authenticator
                  </button>
                </div>
              </form>
            )}

            <div
              className="mt-4 pt-3"
              style={{ borderTop: '1px solid #303030' }}
            />
          </div>

          {/* Status bar */}
          <div className="status-bar">
            <div className="status-bar-section">
              <span className="led-dot led-green" />
              <span>
                {pending2FA ? '2FA REQUIRED' : 'SYSTEM READY'}
              </span>
            </div>
            <div className="status-bar-section">
              <span style={{ color: '#555' }}>ENCRYPTED</span>
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
