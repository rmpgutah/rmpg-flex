import { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import config from '../config';

// ── Helmet configuration ──────────────────────────────────
// Helmet sets 13+ HTTP security headers in one middleware call.
// We configure it to allow Google Maps, ArcGIS, and other
// required external resources while maintaining CJIS compliance.

const helmetMiddleware = helmet({
  // Content Security Policy — allow Google Maps, ArcGIS, CartoDB, etc.
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "blob:", "https://*.googleapis.com", "https://*.gstatic.com", "https://js.arcgis.com", "https://*.arcgis.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://*.googleapis.com", "https://*.gstatic.com", "https://js.arcgis.com", "https://*.arcgis.com"],
      imgSrc: ["'self'", "data:", "blob:", "https:", "http:", "https://*.basemaps.cartocdn.com"],
      fontSrc: ["'self'", "data:", "https://*.gstatic.com", "https://js.arcgis.com", "https://*.arcgis.com"],
      connectSrc: ["'self'", "ws:", "wss:", "https://*.googleapis.com", "https://*.google.com", "https://*.gstatic.com", "https://*.arcgis.com", "https://js.arcgis.com", "https://*.arcgisonline.com", "https://api.open-meteo.com", "https://basemaps.cartocdn.com", "https://*.basemaps.cartocdn.com", "https://*.cartocdn.com", "https://nominatim.openstreetmap.org", "https://api.fbi.gov", "https://photon.komoot.io"],
      frameSrc: ["'self'", "blob:", "https://*.arcgis.com"],
      mediaSrc: ["'self'", "blob:", "data:"],
      workerSrc: ["'self'", "blob:"],
      childSrc: ["'self'", "blob:"],
      manifestSrc: ["'self'"],
      frameAncestors: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      objectSrc: ["'none'"],
    },
  },
  // Strict Transport Security — HSTS
  strictTransportSecurity: (config.isProduction || config.ssl.enabled) ? {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  } : false,
  // X-Frame-Options — SAMEORIGIN for internal blob: PDF viewer iframes
  frameguard: { action: 'sameorigin' },
  // X-Content-Type-Options: nosniff
  noSniff: undefined, // helmet sets this by default
  // X-XSS-Protection: deprecated in modern browsers but kept for legacy
  xXssProtection: undefined, // helmet handles this
  // Referrer-Policy
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  // Permissions-Policy
  permittedCrossDomainPolicies: { permittedPolicies: 'none' },
  // Cross-Origin policies
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  // Remove X-Powered-By (helmet does this automatically)
  hidePoweredBy: undefined, // helmet removes it by default
});

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  // Apply helmet's comprehensive security headers
  helmetMiddleware(req, res, () => {
    // Permissions-Policy (helmet doesn't set this directly — we add it manually)
    res.set('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(self), payment=()');

    // [FIX 21] Cache-Control for API responses to prevent sensitive data caching
    if (req.path.startsWith('/api/')) {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.set('Pragma', 'no-cache');
    }

  // XSS protection (legacy browsers)
  res.set('X-XSS-Protection', '1; mode=block');

  // Referrer policy
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions policy (restrict browser features)
  res.set('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(self), payment=()');

  // Strict Transport Security (when SSL is enabled or in production)
  if (config.isProduction || config.ssl.enabled) {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  // Content Security Policy
  // Mapbox GL JS requires script-src, connect-src access to api.mapbox.com,
  // events.mapbox.com, and tiles.mapbox.com.
  // ArcGIS Embeddable Components require access to js.arcgis.com and *.arcgis.com domains.
  res.set('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://api.mapbox.com https://js.arcgis.com https://*.arcgis.com",
    "style-src 'self' 'unsafe-inline' https://unpkg.com https://api.mapbox.com https://js.arcgis.com https://*.arcgis.com",
    "img-src 'self' data: blob: https: http: https://api.mapbox.com https://tiles.mapbox.com https://*.basemaps.cartocdn.com",
    "font-src 'self' data: https://*.gstatic.com https://js.arcgis.com https://*.arcgis.com",
    "connect-src 'self' ws: wss: https://api.mapbox.com https://events.mapbox.com https://*.arcgis.com https://js.arcgis.com https://*.arcgisonline.com https://api.open-meteo.com https://basemaps.cartocdn.com https://*.basemaps.cartocdn.com https://*.cartocdn.com https://nominatim.openstreetmap.org https://api.fbi.gov https://photon.komoot.io",
    "frame-src 'self' blob: https://*.arcgis.com",
    "media-src 'self' blob: data:",
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "manifest-src 'self'",
    "frame-ancestors 'self'",
    // [FIX 17] Add base-uri to prevent <base> tag injection attacks
    "base-uri 'self'",
    // [FIX 18] Add form-action to restrict form submission targets
    "form-action 'self'",
    // [FIX 19] Add object-src to block Flash/plugin-based attacks
    "object-src 'none'",
  ].join('; '));

  // Remove powered-by header
  res.removeHeader('X-Powered-By');

  // [FIX 20] Add Cross-Origin headers to prevent speculative execution side-channel attacks
  res.set('Cross-Origin-Opener-Policy', 'same-origin');
  res.set('Cross-Origin-Resource-Policy', 'same-origin');

  // [FIX 21] Cache-Control for API responses to prevent sensitive data caching
  if (req.path.startsWith('/api/')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
  }

  next();
}
