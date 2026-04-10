import React, { useState } from 'react';
import { ShieldCheck, Mail, ArrowLeft, CheckCircle } from 'lucide-react';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
    } catch (err: any) {
      // Always show success to prevent email enumeration
      setSubmitted(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#0a0e14' }}>
      <div className="w-full max-w-sm">
        <div
          className="panel-beveled bg-surface-base relative overflow-hidden"
          style={{ boxShadow: '0 4px 40px rgba(136, 136, 136, 0.08), 0 0 0 1px rgba(136, 136, 136, 0.1)' }}
        >
          {/* Accent line */}
          <div style={{ height: '2px', background: 'linear-gradient(90deg, transparent, #888888, transparent)' }} />

          {/* Title bar */}
          <div className="panel-title-bar flex items-center gap-2">
            <ShieldCheck className="w-3 h-3" style={{ color: '#999999' }} />
            <span>PASSWORD RESET</span>
            <div className="ml-auto flex items-center gap-1">
              <div className="w-4 h-3 flex items-center justify-center text-[8px] text-rmpg-400" style={{ background: '#2e2e2e', border: '1px solid #3a5070' }}>_</div>
              <div className="w-4 h-3 flex items-center justify-center text-[8px] text-rmpg-400" style={{ background: '#2e2e2e', border: '1px solid #3a5070' }}>&#9633;</div>
            </div>
          </div>

          <div className="px-5 py-6">
            {!submitted ? (
              <>
                <div className="text-center mb-5">
                  <div className="w-10 h-10 mx-auto mb-3 rounded-full flex items-center justify-center" style={{ background: 'rgba(136, 136, 136, 0.15)', border: '1px solid rgba(136, 136, 136, 0.3)' }}>
                    <Mail className="w-5 h-5" style={{ color: '#999999' }} />
                  </div>
                  <h2 className="text-sm font-bold text-white mb-1">Forgot Your Password?</h2>
                  <p className="text-[10px] leading-relaxed" style={{ color: '#666666' }}>
                    Enter the email address associated with your account and we'll send you a link to reset your password.
                  </p>
                </div>

                {error && (
                  <div className="mb-3 px-3 py-2 text-[10px] font-medium text-red-400 bg-red-900/20 border border-red-700/30">
                    {error}
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label htmlFor="reset-email" className="block text-[10px] font-bold uppercase mb-1.5 tracking-wide" style={{ color: '#888888' }}>
                      Email Address
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: '#383838' }} />
                      <input
                        id="reset-email"
                        type="email"
                        className="input-dark search-glow h-10 pl-9 w-full"
                        placeholder="officer@rmpgutah.us"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        autoFocus
                        required
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || !email.trim()}
                    className="w-full h-10 text-white text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    style={{
                      background: 'linear-gradient(180deg, #888888 0%, #3a3a3a 100%)',
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
                <h2 className="text-sm font-bold text-white mb-2">Check Your Email</h2>
                <p className="text-[10px] leading-relaxed mb-1" style={{ color: '#888888' }}>
                  If an account with that email exists, we've sent a password reset link.
                </p>
                <p className="text-[9px]" style={{ color: '#666666' }}>
                  The link expires in 1 hour. Check your spam folder if you don't see it.
                </p>
              </div>
            )}

            <div className="mt-4 pt-3" style={{ borderTop: '1px solid #2b2b2b' }}>
              <a
                href="/login"
                className="flex items-center justify-center gap-1.5 text-[10px] font-medium transition-colors"
                style={{ color: '#666666' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#888888'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = '#666666'; }}
              >
                <ArrowLeft className="w-3 h-3" />
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
