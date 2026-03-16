import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import config from '../config';

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  // Attach a unique request ID for audit correlation
  const requestId = crypto.randomUUID();
  req.headers['x-request-id'] = requestId;
  res.set('X-Request-ID', requestId);

  // Prevent MIME-type sniffing
  res.set('X-Content-Type-Options', 'nosniff');

  // Prevent clickjacking (SAMEORIGIN allows internal blob: PDF viewer iframes)
  res.set('X-Frame-Options', 'SAMEORIGIN');

  // XSS protection (legacy browsers)
  res.set('X-XSS-Protection', '1; mode=block');

  // Referrer policy — 'no-referrer' prevents tokens in URLs from leaking via Referer header
  res.set('Referrer-Policy', 'no-referrer');

  // Permissions policy — restrict browser features to minimum required
  // camera/microphone: needed for body cam and radio; geolocation: needed for patrol GPS
  // All others explicitly denied to reduce attack surface
  res.set('Permissions-Policy', [
    'camera=(self)', 'microphone=(self)', 'geolocation=(self)',
    'payment=()', 'usb=()', 'bluetooth=()', 'serial=()',
    'hid=()', 'magnetometer=()', 'gyroscope=()',
    'accelerometer=()', 'ambient-light-sensor=()',
  ].join(', '));

  // Cross-Origin isolation headers — prevent cross-origin attacks
  res.set('Cross-Origin-Opener-Policy', 'same-origin');
  res.set('Cross-Origin-Resource-Policy', 'same-origin');
  res.set('X-Permitted-Cross-Domain-Policies', 'none');

  // Prevent caching of API responses containing sensitive law enforcement data
  // Static assets are cached separately with their own Cache-Control in index.ts
  if (req.path.startsWith('/api')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
  }

  // Strict Transport Security — ONLY when SSL is actually enabled
  // Sending HSTS without HTTPS causes browsers to refuse plain HTTP connections
  if (config.ssl.enabled) {
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
    // unsafe-inline is required by Google Maps JS API which injects inline scripts
    // unsafe-eval only in dev for Vite HMR; blocked in production
    `script-src 'self' 'unsafe-inline' ${config.isProduction ? '' : "'unsafe-eval'"} blob: https://*.googleapis.com https://*.gstatic.com https://js.arcgis.com https://*.arcgis.com`.replace(/\s+/g, ' '),
    "style-src 'self' 'unsafe-inline' https://unpkg.com https://*.googleapis.com https://*.gstatic.com https://js.arcgis.com https://*.arcgis.com",
    "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://unpkg.com https://*.googleapis.com https://*.gstatic.com https://*.ggpht.com https://*.google.com https://*.googleusercontent.com https://*.arcgis.com https://js.arcgis.com",
    "font-src 'self' data: https://*.gstatic.com https://js.arcgis.com https://*.arcgis.com",
    `connect-src 'self' wss://rmpgutah.us ${config.isProduction ? '' : 'ws://localhost:* wss://localhost:*'} https://*.googleapis.com https://*.google.com https://*.gstatic.com https://*.arcgis.com https://js.arcgis.com https://*.arcgisonline.com`.replace(/\s+/g, ' '),
    "frame-src 'self' blob: https://*.arcgis.com",
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "manifest-src 'self'",
    "frame-ancestors 'self'",
  ].join('; '));

  // Remove powered-by header
  res.removeHeader('X-Powered-By');

  next();
}
