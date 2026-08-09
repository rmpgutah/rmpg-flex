// Cloudflare Pages middleware that runs before every response.
//
// HEADER ORDERING (highest priority wins last):
//   1. This middleware (runs first)
//   2. _headers file
//   3. Pages project → Settings → Custom Headers (Cloudflare Dashboard)
//   4. Zone → Rules → Transform Rules (runs last, cannot be overridden by code)
//
// IMPORTANT: If CSP-Report-Only violations flood the browser console
// (connect-src 'none' / script-src missing 'self'), a zone-level rule or
// Pages Custom Header is injecting a bad Content-Security-Policy-Report-Only
// header AFTER this middleware runs. Fix by removing it in one of:
//   A. dash.cloudflare.com → Workers & Pages → rmpg-flex → Settings → Custom Headers
//   B. dash.cloudflare.com → Zone rmpgutah.us → Rules → Transform Rules → Modify Response Header
//   C. dash.cloudflare.com → Zone rmpgutah.us → Speed → Observatory (disable if on)
// Code cannot suppress a zone-level header injection — it must be removed from the Dashboard.
//
// If the enforcing Content-Security-Policy blocks requests to api.rmpgutah.us,
// the same fix applies (remove the Dashboard CSP entry so this middleware's
// correct policy takes effect, and the <meta> tag CSP in index.html is the fallback).

interface Env {}

const ALLOWED_CONNECT = [
  "'self'",
  'ws:', 'wss:',
  // fetch() of an in-page blob: URL (e.g. PrintRecordButton re-reading its own
  // generated PDF blob to attach it to an email) is subject to connect-src,
  // not img-src/media-src — Chrome blocks it without this explicit token even
  // though the blob was created same-origin.
  'blob:',
  'https://api.rmpgutah.us',
  'https://*.rmpgutah.us',
  'https://api.mapbox.com',
  'https://events.mapbox.com',
  'https://*.arcgis.com',
  'https://js.arcgis.com',
  'https://*.arcgisonline.com',
  'https://api.open-meteo.com',
  // RainViewer live weather radar overlay (Map tab): frame index JSON.
  'https://api.rainviewer.com',
  // RainViewer radar TILES — a DIFFERENT host from the index above. Mapbox
  // GL v3 pulls raster tiles via fetch() (for cancellation/CORS control),
  // which connect-src governs, not img-src — despite img-src's permissive
  // `https:` making tiles load fine as a bare <img>. Confirmed live 2026-08-09:
  // this host was missing here (though present in index.html's meta-tag CSP,
  // which loses to this enforced header), so the radar control panel showed
  // live frame data while the map painted nothing, with no console error from
  // our own code. See client/src/utils/__tests__/mapExternalTileHosts.test.ts.
  'https://tilecache.rainviewer.com',
  'https://basemaps.cartocdn.com',
  'https://*.basemaps.cartocdn.com',
  'https://*.cartocdn.com',
  'https://nominatim.openstreetmap.org',
  'https://overpass-api.de',
  'https://api.fbi.gov',
  'https://photon.komoot.io',
  // Mapillary street-level imagery lookup (client/src/utils/locationImagery.ts)
  // — same silent-block pattern as the RainViewer tile host above.
  'https://graph.mapillary.com',
  'https://static.cloudflareinsights.com',
  // TensorFlow.js COCO-SSD (forensic dashcam AI vehicle tracking): the ESM
  // module CDN + the model-weights origin.
  'https://esm.sh',
  'https://cdn.esm.sh',
  'https://storage.googleapis.com',
  // ffmpeg.wasm core (in-browser dashcam redaction MP4 encode) — fetched via
  // toBlobURL(), which is a connect-src request.
  'https://unpkg.com',
  // R2 presigned direct-upload (attachments >20MB fallback path + admin Map
  // Data Files tab): the browser PUTs straight to this host using a
  // presigned URL, bypassing the Worker entirely — without this entry the
  // fetch/XHR is blocked by CSP before it ever reaches the network.
  'https://5caa95c5789f4fc4ed3934b2a2c29ed4.r2.cloudflarestorage.com',
].join(' ');

const FULL_CSP = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://api.mapbox.com https://js.arcgis.com https://*.arcgis.com https://static.cloudflareinsights.com https://esm.sh https://cdn.esm.sh https://unpkg.com`,
  `style-src 'self' 'unsafe-inline' https://unpkg.com https://api.mapbox.com https://js.arcgis.com https://*.arcgis.com`,
  `img-src 'self' data: blob: https: http:`,
  `font-src 'self' data: https://*.gstatic.com https://js.arcgis.com https://*.arcgis.com`,
  `connect-src ${ALLOWED_CONNECT}`,
  // dialer.rmpgutah.us: DialerPanel's embedded Dial Connect iframe (see
  // client/src/components/DialerPanel.tsx) -- without this the browser
  // blocks the embed outright, even though the meta-tag CSP in index.html
  // allows it, because this HTTP header enforces alongside it.
  `frame-src 'self' blob: https://*.arcgis.com https://www.mapillary.com https://dialer.rmpgutah.us`,
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
  // Mirror the enforcing policy as report-only so the browser logs zero
  // violations. This silences a bad CSPO injected by the Pages Custom Headers
  // layer. It does NOT fix a zone-level Transform Rule — if violations persist
  // after deploy, remove the source in the Cloudflare Dashboard (see comment
  // at the top of this file for exact locations).
  out.headers.set('Content-Security-Policy-Report-Only', FULL_CSP);
  return out;
};
