/**
 * Signed URL utility — replaces insecure ?token=JWT patterns.
 *
 * Instead of embedding the full JWT session token in URL query parameters
 * (leaks to browser history, Referer headers, proxy logs), we request
 * short-lived HMAC-signed URLs from the server that are:
 *   - Resource-specific (can only access the signed resource)
 *   - Time-limited (24h TTL by default)
 *   - Read-only (no session context)
 */

interface SignedParams {
  sig: string;
  exp: number;
  nonce: string;
}

// In-memory cache: key → { params, fetchedAt }
const cache = new Map<string, { params: SignedParams; fetchedAt: number }>();
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours (server signs for 24h, refresh at 12h)

function getCacheKey(type: string, id: string | number): string {
  return `${type}:${id}`;
}

/**
 * Get signed URL query string for a resource.
 * Returns `?sig=...&exp=...&nonce=...` or falls back to `?token=...` if signing fails.
 */
export async function getSignedParams(
  type: string,
  id: string | number,
): Promise<SignedParams | null> {
  const key = getCacheKey(type, id);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.params;
  }

  try {
    const token = localStorage.getItem('rmpg_token');
    if (!token) return null;

    const res = await fetch('/api/auth/sign-urls', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({ resources: [{ type, id: String(id) }] }),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const params = data.signed?.[key];
    if (params) {
      cache.set(key, { params, fetchedAt: Date.now() });
      return params;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Batch-sign multiple resources at once (more efficient than individual calls).
 */
export async function batchSignResources(
  resources: Array<{ type: string; id: string | number }>,
): Promise<Map<string, SignedParams>> {
  const result = new Map<string, SignedParams>();

  // Return cached entries and collect uncached
  const uncached: Array<{ type: string; id: string | number }> = [];
  for (const r of resources) {
    const key = getCacheKey(r.type, r.id);
    const cached = cache.get(key);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      result.set(key, cached.params);
    } else {
      uncached.push(r);
    }
  }

  if (uncached.length === 0) return result;

  try {
    const token = localStorage.getItem('rmpg_token');
    if (!token) return result;

    const res = await fetch('/api/auth/sign-urls', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({
        resources: uncached.map(r => ({ type: r.type, id: String(r.id) })),
      }),
    });

    if (!res.ok) return result;

    const data = await res.json();
    if (data.signed) {
      for (const [key, params] of Object.entries(data.signed)) {
        const signedParams = params as SignedParams;
        cache.set(key, { params: signedParams, fetchedAt: Date.now() });
        result.set(key, signedParams);
      }
    }
  } catch {
    // Signing failed — caller should fall back gracefully
  }

  return result;
}

/**
 * Build a signed URL for a resource endpoint.
 * Falls back to legacy ?token= if signing fails.
 */
export async function buildSignedUrl(
  basePath: string,
  resourceType: string,
  resourceId: string | number,
): Promise<string> {
  const params = await getSignedParams(resourceType, resourceId);
  if (params) {
    return `${basePath}?sig=${params.sig}&exp=${params.exp}&nonce=${params.nonce}`;
  }
  // No fallback — signed URLs are mandatory for secure resource access
  console.warn('[signedUrls] Failed to generate signed URL for', basePath);
  return basePath;
}

/**
 * Build a signed query string suffix (without the leading '?').
 * Returns `sig=...&exp=...&nonce=...` or legacy `token=...`.
 */
export function buildSignedQuerySync(params: SignedParams | null): string {
  if (params) {
    return `sig=${params.sig}&exp=${params.exp}&nonce=${params.nonce}`;
  }
  // No fallback — signed params are mandatory
  return '';
}

/** Clear the signed URL cache (call on logout). */
export function clearSignedUrlCache(): void {
  cache.clear();
}
