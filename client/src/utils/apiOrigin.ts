// Where the SPA should send authenticated HTTP and WebSocket traffic.
//
// Production lives on two hostnames: the Pages SPA (rmpgutah.us) and the
// Worker (api.rmpgutah.us). A zone Worker (rmpg-api-proxy) intercepts
// rmpgutah.us/api/* and service-binds to the rewrite, so same-origin
// /api/* carries the WAF challenge cookie. Cross-origin calls to
// api.rmpgutah.us do not: the managed-challenge skip is /api/health only,
// and CORP/CORS then surface as generic "Upload failed" / empty pages.

export const WORKER_HTTP_ORIGIN = 'https://api.rmpgutah.us';
export const WORKER_WS_ORIGIN = 'wss://api.rmpgutah.us';

export function isLocalDevHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1';
}

/** Pages / preview hosts that should use same-origin /api/* via the zone proxy. */
export function isAppHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === 'rmpgutah.us' ||
    host === 'www.rmpgutah.us' ||
    (host.endsWith('.rmpgutah.us') && host !== 'api.rmpgutah.us') ||
    host.endsWith('.pages.dev')
  );
}

/**
 * HTTP origin prefix for Worker API calls.
 * Empty string = relative same-origin URLs (`/api/...`).
 */
export function resolveApiHttpBase(opts: { isDev: boolean; hostname?: string }): string {
  if (opts.isDev) return '';
  const host = (opts.hostname || '').toLowerCase();
  if (isAppHostname(host)) return '';
  if (isLocalDevHost(host)) return 'http://localhost:8787';
  return WORKER_HTTP_ORIGIN;
}

/**
 * WebSocket origin for CAD / alerts / voice / company-browser hubs.
 * Local Vite talks to wrangler on :8787; the live SPA uses the same host
 * as the page so the upgrade rides the zone proxy (and VoiceHubDO).
 */
export function resolveApiWsBase(opts: {
  hostname?: string;
  hostWithPort?: string;
  protocol?: string;
}): string {
  const host = (opts.hostname || '').toLowerCase();
  if (isLocalDevHost(host)) return `ws://${host}:8787`;
  if (isAppHostname(host)) {
    const proto = opts.protocol === 'http:' ? 'ws:' : 'wss:';
    const authority = opts.hostWithPort || host;
    return `${proto}//${authority}`;
  }
  return WORKER_WS_ORIGIN;
}

export function apiHttpBase(): string {
  return resolveApiHttpBase({
    isDev: typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV),
    hostname: typeof window !== 'undefined' ? window.location.hostname : '',
  });
}

export function apiWsBase(): string {
  if (typeof window === 'undefined') return WORKER_WS_ORIGIN;
  return resolveApiWsBase({
    hostname: window.location.hostname,
    hostWithPort: window.location.host,
    protocol: window.location.protocol,
  });
}
