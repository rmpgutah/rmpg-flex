// Cloudflare Pages middleware that runs before every response.
// Used to override the Content-Security-Policy that the Pages
// dashboard / project settings is injecting. The dashboard CSP
// was missing https://api.rmpgutah.us in connect-src, blocking
// every cross-origin call to the API subdomain (warrants refresh,
// dispatch state, etc.). _headers and <meta> CSPs were both being
// overridden by whatever wrote the dashboard CSP.
//
// This middleware runs after the static asset is fetched and
// rewrites the header before it ships to the browser. Cloudflare
// runs Pages Functions AFTER static asset handling, so headers
// set here win over both the _headers file and dashboard config.

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
  return out;
};
