// Landing page for the Dial Connect SSO redirect. The backend callback
// (src/routes/ssoAuth.ts) can't hand tokens to the SPA directly -- it's a
// full-page browser redirect, and AuthContext reads tokens from
// localStorage, not cookies -- so it hands off a single-use KV exchange
// code instead. This page trades that code for the real token bundle via
// POST /exchange, writes it to the SAME localStorage keys AuthContext uses,
// and does a hard reload so AuthContext re-initializes from a clean state
// (simpler and safer than reaching into the context from outside its
// provider tree).
import { useEffect, useState } from 'react';
import { TOKEN_KEY, REFRESH_TOKEN_KEY, SESSION_ID_KEY, CACHED_USER_KEY, fetchWithTimeout } from '../context/AuthContext';

export default function SsoCallbackPage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const code = searchParams.get('code');
    if (!code) {
      setError('Missing SSO exchange code.');
      return;
    }
    (async () => {
      try {
        const res = await fetchWithTimeout('/api/oidc/dialer/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        if (!res.ok) {
          setError('This sign-in link has expired or was already used. Return to the login page and try again.');
          return;
        }
        const data = await res.json().catch(() => null);
        // Guard against a malformed/incomplete body before persisting anything --
        // an unguarded write here could stash the literal string "undefined"
        // under these keys, which then throws when AuthContext's own code
        // later JSON.parses the cached-user entry back out.
        if (!data || typeof data.token !== 'string' || !data.token) {
          setError('Unable to complete sign-in. Return to the login page and try again.');
          return;
        }
        localStorage.setItem(TOKEN_KEY, data.token);
        if (data.refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
        if (data.sessionId) localStorage.setItem(SESSION_ID_KEY, data.sessionId);
        if (data.user) localStorage.setItem(CACHED_USER_KEY, JSON.stringify(data.user));
        window.location.href = '/';
      } catch {
        setError('Unable to complete sign-in. Return to the login page and try again.');
      }
    })();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--surface-sunken)' }}>
      <div className="text-center">
        {error ? (
          <>
            <p className="text-sm mb-2" style={{ color: 'var(--sev-critical-soft)' }}>{error}</p>
            <a href="/login" className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Back to login</a>
          </>
        ) : (
          <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Completing sign-in&hellip;</p>
        )}
      </div>
    </div>
  );
}
