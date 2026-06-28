// ============================================================
// Mapbox telemetry sink (POST /api/mapbox/events/v2)
// ============================================================
// Mapbox GL JS POSTs usage telemetry — turnstile, map.load, map.auth,
// gljs.performance, style.load — to events.mapbox.com. Some operator
// networks (DNS sinkholes, ad blockers, corporate proxies) block that
// host, which spams the dispatch console with `net::ERR_CONNECTION_REFUSED`
// stack traces multiple times per map mount. The SDK exposes
// `mapboxgl.config.EVENTS_URL` so we can redirect the POST to a same-origin
// endpoint that returns 204 instead, killing the console noise without
// affecting map functionality.
//
// Public: the Mapbox SDK doesn't send our auth cookie, and there's no
// sensitive surface here — the route accepts any body and discards it.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';

const mapboxTelemetry = new Hono<Env>();

mapboxTelemetry.post('/v2', (c) => c.body(null, 204));

export default mapboxTelemetry;
