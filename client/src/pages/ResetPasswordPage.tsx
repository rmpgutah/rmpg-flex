import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { ShieldCheck, Lock, Eye, EyeOff, CheckCircle, XCircle, ArrowLeft, Loader2 } from 'lucide-react';

export default function ResetPasswordPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [token, setToken] = useState('');
  const [username, setUsername] = useState('');
  const [validating, setValidating] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
  const [tokenError, setTokenError] = useState('');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const passwordRef = useRef<HTMLInputElement>(null);
  const deepLinkConsumed = useRef(false);

  const validateResetToken = (t: string) => {
    setValidating(true);
    setTokenError('');
    fetch(`/api/auth/reset-password/validate?token=${encodeURIComponent(t)}`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to validate reset link');
        return res.json();
      })
      .then(data => {
        if (data.valid) {
          setTokenValid(true);
          setUsername(data.username || '');
        } else {
          setTokenValid(false);
          setTokenError(data.error || 'Invalid or expired reset link');
        }
      })
      .catch(() => {
        setTokenValid(false);
        setTokenError('Unable to validate reset link. Please try again.');
      })
      .finally(() => setValidating(false));
  };

  // Extract token from URL via useSearchParams, strip after use
  useEffect(() => {
    const t = searchParams.get('token');
    if (!t) {
      setValidating(false);
      setTokenError('No reset token provided. Please request a new password reset link.');
      return;
    }
    setToken(t);

    // Strip ?token= from URL once consumed
    if (!deepLinkConsumed.current) {
      deepLinkConsumed.current = true;
      const next = new URLSearchParams(searchParams);
      next.delete('token');
      setSearchParams(next, { replace: true });
    }

    validateResetToken(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // N — focus password input; Esc — clear error state
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        passwordRef.current?.focus();
      }
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (error) setError('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [error]);

  const passwordChecks = [
    { label: 'At least 12 characters', met: password.length >= 12 },
    { label: 'Uppercase letter', met: /[A-Z]/.test(password) },
    { label: 'Lowercase letter', met: /[a-z]/.test(password) },
    { label: 'Number', met: /\d/.test(password) },
    { label: 'Special character', met: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password) },
    { label: 'Passwords match', met: password.length > 0 && password === confirmPassword },
  ];

  const allMet = passwordChecks.every(c => c.met);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allMet) return;

    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || 'Failed to reset password');
      }

      setSuccess(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to reset password');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--surface-overlay)' }}>
      <div className="w-full max-w-sm">
        <div
          className="panel-beveled bg-surface-base relative overflow-hidden"
          style={{ boxShadow: '0 4px 40px rgba(136, 136, 136, 0.08), 0 0 0 1px rgba(136, 136, 136, 0.1)' }}
          role="form"
          aria-label="Password reset form"
        >
          {/* Accent line */}
          <div style={{ height: '2px', background: 'linear-gradient(90deg, transparent, var(--border-strong), transparent)' }} />

          {/* Title bar */}
          <div className="panel-title-bar flex items-center gap-2">
            <ShieldCheck className="w-3 h-3 text-rmpg-400" />
            <span>SET NEW PASSWORD</span>
            <div className="ml-auto flex items-center gap-1" aria-hidden="true">
              <div className="w-4 h-3 flex items-center justify-center text-[8px] text-rmpg-400" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-strong)' }}>_</div>
              <div className="w-4 h-3 flex items-center justify-center text-[8px] text-rmpg-400" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-strong)' }}>&#9633;</div>
            </div>
          </div>

          <div className="px-5 py-6">
            {/* Loading state */}
            {validating && (
              <div className="text-center py-8" role="status" aria-live="polite">
                <Loader2 className="w-6 h-6 mx-auto mb-3 animate-spin text-rmpg-400" aria-hidden="true" />
                <p className="text-[10px] text-rmpg-400">Validating reset link...</p>
              </div>
            )}

            {/* Token invalid */}
            {!validating && !tokenValid && !success && (
              <div className="text-center py-4" role="alert">
                <div className="w-12 h-12 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                  <XCircle className="w-6 h-6 text-red-400" />
                </div>
                <h2 className="text-sm font-bold text-rmpg-100 mb-2">Invalid Reset Link</h2>
                <p className="text-[10px] leading-relaxed text-rmpg-400">
                  {tokenError}
                </p>
                {token ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-rmpg-100"
                    onClick={() => validateResetToken(token)}
                  >
                    Retry validation
                  </button>
                ) : null}
                <a
                  href="/forgot-password"
                  className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-rmpg-100 transition-all duration-150 hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500/50"
                  style={{
                    background: 'linear-gradient(180deg, var(--rmpg-400) 0%, var(--surface-raised) 100%)',
                    border: '1px solid rgba(136, 136, 136, 0.5)',
                    borderRadius: '2px',
                  }}
                >
                  Request New Link
                </a>
              </div>
            )}

            {/* Password form */}
            {!validating && tokenValid && !success && (
              <>
                <div className="text-center mb-5">
                  <div className="w-10 h-10 mx-auto mb-3 rounded-full flex items-center justify-center" style={{ background: 'rgba(136, 136, 136, 0.15)', border: '1px solid rgba(136, 136, 136, 0.3)' }}>
                    <Lock className="w-5 h-5 text-rmpg-400" />
                  </div>
                  <h2 className="text-sm font-bold text-rmpg-100 mb-1">Set New Password</h2>
                  {username && (
                    <p className="text-[10px] font-mono text-rmpg-500">
                      @{username}
                    </p>
                  )}
                </div>

                {error && (
                  <div className="mb-3 px-3 py-2.5 text-[10px] font-medium text-red-400 bg-red-900/20 border border-red-700/30 animate-fade-in" role="alert" aria-live="assertive">
                    {error}
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-3">
                  <div>
                    <label htmlFor="new-password" className="block text-[10px] font-bold uppercase mb-1.5 tracking-wide text-rmpg-400">
                      New Password
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none text-rmpg-500" />
                      <input
                        id="new-password"
                        ref={passwordRef}
                        type={showPassword ? 'text' : 'password'}
                        className="input-dark search-glow h-10 pl-9 pr-9 w-full"
                        placeholder="Enter new password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoFocus
                        autoComplete="new-password"
                        aria-required="true"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500/50 rounded-sm text-rmpg-500 hover:text-rmpg-300"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="confirm-password" className="block text-[10px] font-bold uppercase mb-1.5 tracking-wide text-rmpg-400">
                      Confirm Password
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none text-rmpg-500" />
                      <input
                        id="confirm-password"
                        name="confirm-password"
                        type={showPassword ? 'text' : 'password'}
                        className="input-dark search-glow h-10 pl-9 w-full"
                        placeholder="Confirm new password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        autoComplete="new-password"
                        aria-required="true"
                      />
                    </div>
                  </div>

                  {/* Password requirements */}
                  {password.length > 0 && (
                    <div className="space-y-1 py-2" role="list" aria-label="Password requirements">
                      {passwordChecks.map((check) => (
                        <div key={check.label} className="flex items-center gap-2 text-[9px] transition-colors duration-200" role="listitem">
                          {check.met ? (
                            <CheckCircle className="w-3 h-3 text-green-400 flex-shrink-0" aria-hidden="true" />
                          ) : (
                            <XCircle className="w-3 h-3 flex-shrink-0 text-rmpg-500" aria-hidden="true" />
                          )}
                          <span className={check.met ? 'text-green-400' : 'text-rmpg-500'}>{check.label}</span>
                          <span className="sr-only">{check.met ? '(met)' : '(not met)'}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={submitting || !allMet}
                    className="w-full h-10 text-rmpg-100 text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all duration-150 active:scale-[0.98]"
                    style={{
                      background: 'linear-gradient(180deg, var(--rmpg-400) 0%, var(--surface-raised) 100%)',
                      border: '1px solid rgba(136, 136, 136, 0.5)',
                      borderRadius: '2px',
                    }}
                    aria-busy={submitting}
                  >
                    {submitting ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true" />
                        <span>Resetting...</span>
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-4 h-4" aria-hidden="true" />
                        Set New Password
                      </>
                    )}
                  </button>
                </form>
              </>
            )}

            {/* Success */}
            {success && (
              <div className="text-center py-4 animate-fade-in" role="status" aria-live="polite">
                <div className="w-12 h-12 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ background: 'rgba(34, 197, 94, 0.15)', border: '1px solid rgba(34, 197, 94, 0.3)' }}>
                  <CheckCircle className="w-6 h-6 text-green-400" aria-hidden="true" />
                </div>
                <h2 className="text-sm font-bold text-rmpg-100 mb-2">Password Reset Complete</h2>
                <p className="text-[10px] leading-relaxed mb-1 text-rmpg-400">
                  Your password has been updated. All existing sessions have been signed out for security.
                </p>
                <a
                  href="/login?reset=1"
                  className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-rmpg-100 transition-all duration-150 hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500/50"
                  style={{
                    background: 'linear-gradient(180deg, var(--rmpg-400) 0%, var(--surface-raised) 100%)',
                    border: '1px solid rgba(136, 136, 136, 0.5)',
                    borderRadius: '2px',
                  }}
                >
                  <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                  Sign In
                </a>
              </div>
            )}

            <div className="mt-4 pt-3" style={{ borderTop: '1px solid var(--border-default)' }}>
              <a
                href="/login"
                className="flex items-center justify-center gap-1.5 text-[10px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500/50 rounded-sm text-rmpg-500 hover:text-rmpg-400"
              >
                <ArrowLeft className="w-3 h-3" aria-hidden="true" />
                Back to Login
              </a>
            </div>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-[8px] mt-4 text-rmpg-500">
          RMPG Flex &mdash; Rocky Mountain Protective Group
        </p>
      </div>
    </div>
  );
}
