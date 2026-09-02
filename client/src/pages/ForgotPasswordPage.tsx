import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { ShieldCheck, Mail, ArrowLeft, CheckCircle } from 'lucide-react';

export default function ForgotPasswordPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [email, setEmail] = useState(() => searchParams.get('email') ?? '');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const emailRef = useRef<HTMLInputElement>(null);
  const deepLinkConsumed = useRef(false);

  // Strip ?email= from URL after pre-fill (once)
  useEffect(() => {
    if (!deepLinkConsumed.current && searchParams.get('email')) {
      deepLinkConsumed.current = true;
      const next = new URLSearchParams(searchParams);
      next.delete('email');
      setSearchParams(next, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // N — focus email input
  // Esc — reset form if not submitted
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        emailRef.current?.focus();
      }
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (!submitted) {
          setEmail('');
          setError('');
          emailRef.current?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [submitted]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Request failed');
      }

      setSubmitted(true);
    } catch (_err: unknown) {
      // Always show success to prevent email enumeration
      setSubmitted(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--surface-overlay)' }}>
      <div className="w-full max-w-sm">
        <div
          className="panel-beveled bg-surface-base relative overflow-hidden"
          style={{ boxShadow: '0 4px 40px rgba(136, 136, 136, 0.08), 0 0 0 1px rgba(136, 136, 136, 0.1)' }}
        >
          {/* Accent line */}
          <div style={{ height: '2px', background: 'linear-gradient(90deg, transparent, var(--border-strong), transparent)' }} />

          {/* Title bar */}
          <div className="panel-title-bar flex items-center gap-2">
            <ShieldCheck className="w-3 h-3 text-rmpg-400" />
            <span>PASSWORD RESET</span>
            <div className="ml-auto flex items-center gap-1">
              <div className="w-4 h-3 flex items-center justify-center text-[8px] text-rmpg-400" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-strong)' }}>_</div>
              <div className="w-4 h-3 flex items-center justify-center text-[8px] text-rmpg-400" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-strong)' }}>&#9633;</div>
            </div>
          </div>

          <div className="px-5 py-6">
            {!submitted ? (
              <>
                <div className="text-center mb-5">
                  <div className="w-10 h-10 mx-auto mb-3 rounded-full flex items-center justify-center" style={{ background: 'rgba(136, 136, 136, 0.15)', border: '1px solid rgba(136, 136, 136, 0.3)' }}>
                    <Mail className="w-5 h-5 text-rmpg-400" />
                  </div>
                  <h2 className="text-sm font-bold text-rmpg-100 mb-1">Forgot Your Password?</h2>
                  <p className="text-[10px] leading-relaxed text-rmpg-500">
                    Enter the email address associated with your account and we'll send you a link to reset your password.
                  </p>
                </div>

                {error && (
                  <div className="mb-3 px-3 py-2 text-[10px] font-medium text-red-400 bg-red-900/20 border border-red-700/30" role="alert" id="reset-email-error">
                    {error}
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label htmlFor="reset-email" className="block text-[10px] font-bold uppercase mb-1.5 tracking-wide text-rmpg-400">
                      Email Address
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none text-rmpg-500" />
                      <input
                        id="reset-email"
                        ref={emailRef}
                        type="email"
                        className="input-dark search-glow h-10 pl-9 w-full"
                        placeholder="officer@rmpgutah.us"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        autoComplete="email"
                        autoFocus
                        required
                        aria-invalid={Boolean(error)}
                        aria-describedby={error ? 'reset-email-error' : undefined}
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || !email.trim()}
                    className="w-full h-10 text-rmpg-100 text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    style={{
                      background: 'linear-gradient(180deg, var(--rmpg-400) 0%, var(--surface-raised) 100%)',
                      border: '1px solid rgba(136, 136, 136, 0.5)',
                      borderRadius: '2px',
                    }}
                  >
                    {loading ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Mail className="w-4 h-4" />
                        Send Reset Link
                      </>
                    )}
                  </button>
                </form>
              </>
            ) : (
              <div className="text-center py-4">
                <div className="w-12 h-12 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ background: 'rgba(34, 197, 94, 0.15)', border: '1px solid rgba(34, 197, 94, 0.3)' }}>
                  <CheckCircle className="w-6 h-6 text-green-400" />
                </div>
                <h2 className="text-sm font-bold text-rmpg-100 mb-2">Check Your Email</h2>
                <p className="text-[10px] leading-relaxed mb-1 text-rmpg-400">
                  If an account with that email exists, we've sent a password reset link.
                </p>
                <p className="text-[9px] text-rmpg-500">
                  The link expires in 1 hour. Check your spam folder if you don't see it.
                </p>
              </div>
            )}

            <div className="mt-4 pt-3" style={{ borderTop: '1px solid var(--border-default)' }}>
              <a
                href="/login"
                className="flex items-center justify-center gap-1.5 text-[10px] font-medium transition-colors text-rmpg-500 hover:text-rmpg-400"
              >
                <ArrowLeft className="w-3 h-3" />
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
