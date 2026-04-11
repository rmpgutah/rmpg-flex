import React, { useState, useEffect } from 'react';
import { ShieldCheck, Lock, Eye, EyeOff, CheckCircle, XCircle, ArrowLeft, Loader2 } from 'lucide-react';

export default function ResetPasswordPage() {
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

  // Extract token from URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('token');
    if (!t) {
      setValidating(false);
      setTokenError('No reset token provided. Please request a new password reset link.');
      return;
    }
    setToken(t);

    // Validate token
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
          setTokenError(data.error || 'Invalid or expired reset link');
        }
      })
      .catch(() => {
        setTokenError('Unable to validate reset link. Please try again.');
      })
      .finally(() => setValidating(false));
  }, []);

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
    } catch (err: any) {
      setError(err.message || 'Failed to reset password');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'linear-gradient(180deg, #0a0a0a 0%, #0a0a0a 100%)' }}>
      <div className="w-full max-w-sm">
        <div
          className="panel-beveled bg-surface-base relative overflow-hidden"
          style={{ boxShadow: '0 4px 40px rgba(136, 136, 136, 0.08), 0 0 0 1px rgba(136, 136, 136, 0.1)' }}
          role="form"
          aria-label="Password reset form"
        >
          {/* Accent line */}
          <div style={{ height: '2px', background: 'linear-gradient(90deg, transparent, #888888, transparent)' }} />

          {/* Title bar */}
          <div className="panel-title-bar flex items-center gap-2">
            <ShieldCheck className="w-3 h-3" style={{ color: '#999999' }} />
            <span>SET NEW PASSWORD</span>
            <div className="ml-auto flex items-center gap-1" aria-hidden="true">
              <div className="w-4 h-3 flex items-center justify-center text-[8px] text-rmpg-400" style={{ background: '#2e2e2e', border: '1px solid #383838' }}>_</div>
              <div className="w-4 h-3 flex items-center justify-center text-[8px] text-rmpg-400" style={{ background: '#2e2e2e', border: '1px solid #383838' }}>&#9633;</div>
            </div>
          </div>

          <div className="px-5 py-6">
            {/* Loading state */}
            {validating && (
              <div className="text-center py-8" role="status" aria-live="polite">
                <Loader2 className="w-6 h-6 mx-auto mb-3 animate-spin" style={{ color: '#999999' }} aria-hidden="true" />
                <p className="text-[10px]" style={{ color: '#888888' }}>Validating reset link...</p>
              </div>
            )}

            {/* Token invalid */}
            {!validating && !tokenValid && !success && (
              <div className="text-center py-4">
                <div className="w-12 h-12 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                  <XCircle className="w-6 h-6 text-red-400" />
                </div>
                <h2 className="text-sm font-bold text-white mb-2">Invalid Reset Link</h2>
                <p className="text-[10px] leading-relaxed" style={{ color: '#888888' }}>
                  {tokenError}
                </p>
                <a
                  href="/forgot-password"
                  className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-white transition-all duration-150 hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500/50"
                  style={{
                    background: 'linear-gradient(180deg, #888888 0%, #144a84 100%)',
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
                    <Lock className="w-5 h-5" style={{ color: '#999999' }} />
                  </div>
                  <h2 className="text-sm font-bold text-white mb-1">Set New Password</h2>
                  {username && (
                    <p className="text-[10px] font-mono" style={{ color: '#666666' }}>
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
                    <label htmlFor="new-password" className="block text-[10px] font-bold uppercase mb-1.5 tracking-wide" style={{ color: '#888888' }}>
                      New Password
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: '#383838' }} />
                      <input
                        id="new-password"
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
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500/50 rounded-sm"
                        style={{ color: '#666666' }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = '#e0e0e0'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = '#666666'; }}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="confirm-password" className="block text-[10px] font-bold uppercase mb-1.5 tracking-wide" style={{ color: '#888888' }}>
                      Confirm Password
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: '#383838' }} />
                      <input
                        id="confirm-password"
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
                            <XCircle className="w-3 h-3 flex-shrink-0" style={{ color: '#555555' }} aria-hidden="true" />
                          )}
                          <span style={{ color: check.met ? '#4ade80' : '#666666' }}>{check.label}</span>
                          <span className="sr-only">{check.met ? '(met)' : '(not met)'}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={submitting || !allMet}
                    className="w-full h-10 text-white text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all duration-150 active:scale-[0.98]"
                    style={{
                      background: 'linear-gradient(180deg, #888888 0%, #144a84 100%)',
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
                <h2 className="text-sm font-bold text-white mb-2">Password Reset Complete</h2>
                <p className="text-[10px] leading-relaxed mb-1" style={{ color: '#888888' }}>
                  Your password has been updated. All existing sessions have been signed out for security.
                </p>
                <a
                  href="/login"
                  className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-white transition-all duration-150 hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500/50"
                  style={{
                    background: 'linear-gradient(180deg, #888888 0%, #144a84 100%)',
                    border: '1px solid rgba(136, 136, 136, 0.5)',
                    borderRadius: '2px',
                  }}
                >
                  <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                  Sign In
                </a>
              </div>
            )}

            <div className="mt-4 pt-3" style={{ borderTop: '1px solid #222222' }}>
              <a
                href="/login"
                className="flex items-center justify-center gap-1.5 text-[10px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500/50 rounded-sm py-1"
                style={{ color: '#666666' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#888888'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = '#666666'; }}
              >
                <ArrowLeft className="w-3 h-3" aria-hidden="true" />
                Back to Login
              </a>
            </div>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-[8px] mt-4" style={{ color: '#2e2e2e' }}>
          RMPG Flex &mdash; Rocky Mountain Protective Group
        </p>
      </div>
    </div>
  );
}
