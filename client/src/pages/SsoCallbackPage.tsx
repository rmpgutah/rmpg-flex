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
import { useSearchParams } from 'react-router-dom';

const TOKEN_KEY = 'rmpg_token';
const REFRESH_TOKEN_KEY = 'rmpg_refresh_token';
const SESSION_ID_KEY = 'rmpg_session_id';
const CACHED_USER_KEY = 'rmpg_cached_user';

export default function SsoCallbackPage() {
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get('code');
    if (!code) {
      setError('Missing SSO exchange code.');
      return;
    }
    (async () => {
      try {
        const res = await fetch('/api/auth/sso/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        if (!res.ok) {
          setError('This sign-in link has expired or was already used. Return to the login page and try again.');
          return;
        }
        const data = await res.json();
        localStorage.setItem(TOKEN_KEY, data.token);
        localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
        localStorage.setItem(SESSION_ID_KEY, data.sessionId);
        localStorage.setItem(CACHED_USER_KEY, JSON.stringify(data.user));
        window.location.href = '/';
      } catch {
        setError('Unable to complete sign-in. Return to the login page and try again.');
      }
    })();
  }, [searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--surface-sunken)' }}>
      <div className="text-center">
        {error ? (
          <>
            <p className="text-sm mb-2" style={{ color: '#ef7a7a' }}>{error}</p>
            <a href="/login" className="text-xs uppercase tracking-wider" style={{ color: 'var(--rmpg-400)' }}>Back to login</a>
          </>
        ) : (
          <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--rmpg-500)' }}>Completing sign-in&hellip;</p>
        )}
      </div>
    </div>
  );
}
