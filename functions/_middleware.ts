// Cloudflare Pages middleware that runs before every response.
//
// NOTE: Cloudflare's response header ordering is:
//   Application (this middleware) → _headers file → Cloudflare Dashboard
// Each step OVERWRITES headers with the same name from the previous step.
// This means Dashboard-set Content-Security-Policy wins over this
// middleware AND _headers. This middleware can only handle the static
// asset + _headers response; it CANNOT override Dashboard headers.
//
// If CSP-connected requests to api.rmpgutah.us are blocked, the fix is
// to remove the Content-Security-Policy header from the Cloudflare
// Dashboard (Pages project → Settings → Custom Headers). After removal,
// this middleware and the <meta> tag CSP will be the only sources.
//
// What this middleware CAN do:
// 1. Remove the Dashboard's Content-Security-Policy-Report-Only header
//    (reduces console noise from report-only violations).
// 2. Set a comprehensive Content-Security-Policy that applies when the
//    Dashboard does NOT have a conflicting header (e.g., preview branches).

interface Env {}

const ALLOWED_CONNECT = [
  "'self'",
  'ws:', 'wss:',
  'https://api.rmpgutah.us',
  'https://*.rmpgutah.us',
  'https://api.mapbox.com',
  'https://events.mapbox.com',
  'https://*.arcgis.com',
  'https://js.arcgis.com',
  'https://*.arcgisonline.com',
  'https://api.open-meteo.com',
  'https://basemaps.cartocdn.com',
  'https://*.basemaps.cartocdn.com',
  'https://*.cartocdn.com',
  'https://nominatim.openstreetmap.org',
  'https://api.fbi.gov',
  'https://photon.komoot.io',
  'https://static.cloudflareinsights.com',
].join(' ');

const FULL_CSP = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://api.mapbox.com https://js.arcgis.com https://*.arcgis.com https://static.cloudflareinsights.com`,
  `style-src 'self' 'unsafe-inline' https://unpkg.com https://api.mapbox.com https://js.arcgis.com https://*.arcgis.com`,
  `img-src 'self' data: blob: https: http:`,
  `font-src 'self' data: https://*.gstatic.com https://js.arcgis.com https://*.arcgis.com`,
  `connect-src ${ALLOWED_CONNECT}`,
  `frame-src 'self' blob: https://*.arcgis.com`,
  `media-src 'self' blob: data:`,
  `worker-src 'self' blob:`,
  `child-src 'self' blob:`,
  `manifest-src 'self'`,
  `frame-ancestors 'self'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  `object-src 'none'`,
].join('; ');

export const onRequest: PagesFunction<Env> = async (context) => {
  // Pass through to the static asset / SPA fallback.
  const response = await context.next();
  // Clone so we can mutate headers (Response.headers is read-only
  // when the response came from upstream).
  const out = new Response(response.body, response);
  out.headers.set('Content-Security-Policy', FULL_CSP);
  // The Cloudflare Dashboard also injects a restrictive
  // Content-Security-Policy-Report-Only that is NOT overridden by
  // _headers or <meta> tags. If it has connect-src 'none', every
  // API call generates a violation in the browser console even
  // though the request succeeds. Deleting it here silences the
  // noise so the console only shows real errors.
  out.headers.delete('Content-Security-Policy-Report-Only');
  return out;
};
