// ============================================================
// RMPG Flex — Dialer OIDC SSO landing page
// ============================================================
// src/routes/oidc.ts's /api/oidc/dialer/callback finishes the SSO exchange
// server-side and redirects the browser here with the minted Flex session
// in the URL FRAGMENT (#token=...&refreshToken=...&sessionId=...&expiresIn=...)
// rather than the query string, so the tokens never hit server access logs
// or Cloudflare/analytics. This page's only job is to move them into the
// same localStorage keys AuthContext.login() writes, then hard-navigate to
// "/" so AuthProvider's mount-time read of those keys picks up the session
// exactly like a normal password login would.
// ============================================================

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Loader2, ShieldCheck, AlertCircle } from 'lucide-react';

const TOKEN_KEY = 'rmpg_token';
const REFRESH_TOKEN_KEY = 'rmpg_refresh_token';
const SESSION_ID_KEY = 'rmpg_session_id';

export default function OidcCallbackPage() {
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // A failed SSO attempt lands on /login?sso=dialer&status=error&message=...
    // (see backToLogin() in src/routes/oidc.ts), not here — this page only
    // ever sees a successful exchange. Still guard defensively.
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const token = fragment.get('token');
    const refreshToken = fragment.get('refreshToken');
    const sessionId = fragment.get('sessionId');

    if (!token) {
      setError(searchParams.get('message') || 'Sign-in did not complete. Please try again.');
      return;
    }

    try {
      localStorage.setItem(TOKEN_KEY, token);
      if (refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
      if (sessionId) localStorage.setItem(SESSION_ID_KEY, sessionId);
    } catch {
      setError('Could not save your session (browser storage unavailable). Please try again.');
      return;
    }

    // Hard navigation (not react-router) so AuthProvider re-mounts and reads
    // the freshly-written localStorage keys from scratch.
    window.location.replace('/');
  }, [searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-base">
      <div className="text-center space-y-3">
        {error ? (
          <>
            <AlertCircle className="w-8 h-8 mx-auto text-[var(--sev-critical)]" />
            <p className="text-sm text-rmpg-300">{error}</p>
            <a href="/login" className="text-xs uppercase tracking-wider font-bold text-brand-gold-500">
              Back to sign in
            </a>
          </>
        ) : (
          <>
            <ShieldCheck className="w-8 h-8 mx-auto text-brand-gold-500" />
            <p className="text-sm text-rmpg-300 flex items-center gap-2 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Completing sign-in…
            </p>
          </>
        )}
      </div>
    </div>
  );
}
