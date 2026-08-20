// Dialer OIDC config comes from Wrangler vars/secrets (env.DIALER_OIDC_*
// -- see the "Dialer OIDC" block in wrangler.toml), NOT the system_config
// DB table. DIALER_OIDC_ISSUER is the FULL discovery-document URL (it ends
// in /.well-known/openid-configuration), so this relying party follows the
// standard OIDC discovery flow: fetch that document and read the real
// authorization_endpoint/token_endpoint/jwks_uri from it, rather than
// guessing endpoint paths off a bare issuer. No caching -- YAGNI, /login
// and /callback aren't high-frequency -- a fresh fetch per request is fine.

export interface DialerOidcEndpoints {
  // The discovery document's own "issuer" field -- the IdP's actual issuer
  // identifier, which is what appears in the `iss` claim of issued ID
  // tokens. NOT the same string as DIALER_OIDC_ISSUER (that's the
  // discovery *document URL*, i.e. `${issuer}/.well-known/openid-configuration`).
  // Required for jwtVerify() to correctly authenticate the token issuer.
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
}

interface OidcDiscoveryDocument {
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  jwks_uri?: string;
}

// Fetches + parses the Dialer OIDC discovery document. Returns null on any
// failure (missing config, network error, non-2xx, malformed/incomplete
// JSON) so callers can fail closed -- /login surfaces its existing 503
// "not configured" response, /callback surfaces its existing generic
// sso_failed redirect. Never throws.
export async function readDialerOidcEndpoints(
  env: { DIALER_OIDC_ISSUER?: string },
): Promise<DialerOidcEndpoints | null> {
  const discoveryUrl = env.DIALER_OIDC_ISSUER;
  if (!discoveryUrl) return null;

  try {
    const res = await fetch(discoveryUrl);
    if (!res.ok) return null;

    const doc = await res.json<OidcDiscoveryDocument>();
    if (!doc.issuer || !doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) return null;

    return {
      issuer: doc.issuer,
      authorizationEndpoint: doc.authorization_endpoint,
      tokenEndpoint: doc.token_endpoint,
      jwksUri: doc.jwks_uri,
    };
  } catch {
    return null;
  }
}

// PKCE code_verifier per RFC 7636: 43-128 char unreserved-charset string.
export function generateCodeVerifier(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
}

export async function codeChallengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
