import { Request, Response, NextFunction } from 'express';
import config from '../config';

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  // Prevent MIME-type sniffing
  res.set('X-Content-Type-Options', 'nosniff');

  // Prevent clickjacking (SAMEORIGIN allows internal blob: PDF viewer iframes)
  res.set('X-Frame-Options', 'SAMEORIGIN');

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
  // NOTE: Google Maps requires script/img/connect/font access to *.googleapis.com,
  // *.gstatic.com, and *.google.com domains.
  // ArcGIS Embeddable Components require access to js.arcgis.com and *.arcgis.com domains.
  // Google Maps loads sub-resources from *.gstatic.com (maps., www., fonts.),
  // *.googleapis.com, *.google.com, and *.ggpht.com.
  // ArcGIS loads from js.arcgis.com, *.arcgis.com, and *.arcgisonline.com.
  // Using wildcards for the gstatic/google/arcgis families to avoid breakage
  // when Google or Esri add new sub-domains.
  res.set('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://*.googleapis.com https://*.gstatic.com https://js.arcgis.com https://*.arcgis.com",
    "style-src 'self' 'unsafe-inline' https://unpkg.com https://*.googleapis.com https://*.gstatic.com https://js.arcgis.com https://*.arcgis.com",
    "img-src 'self' data: blob: https: http: https://*.basemaps.cartocdn.com",
    "font-src 'self' data: https://*.gstatic.com https://js.arcgis.com https://*.arcgis.com",
    "connect-src 'self' ws: wss: https://*.googleapis.com https://*.google.com https://*.gstatic.com https://*.arcgis.com https://js.arcgis.com https://*.arcgisonline.com https://api.open-meteo.com https://basemaps.cartocdn.com https://*.cartocdn.com https://nominatim.openstreetmap.org https://api.fbi.gov https://photon.komoot.io",
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
