// ============================================================
// RMPG Flex — Live Broadcast Middleware
// Automatically broadcasts WebSocket events to all connected
// clients when data is mutated via API (POST, PUT, PATCH, DELETE).
// This enables real-time sync across all devices and users.
// ============================================================

import { Request, Response, NextFunction } from 'express';
import { broadcast } from '../utils/websocket';
import { localNow } from '../utils/timeUtils';

// Map API path prefixes → WebSocket channel names
// Every module gets its own channel so clients subscribe selectively
const PATH_TO_CHANNEL: Record<string, string> = {
  '/api/records': 'records',
  '/api/personnel': 'personnel',
  '/api/fleet': 'fleet',
  '/api/incidents': 'incidents',
  '/api/citations': 'citations',
  '/api/patrol': 'patrol',
  '/api/admin': 'admin',
  '/api/dispatch': 'dispatch',
  '/api/warrants': 'alerts',
  '/api/comms': 'dispatch',
  '/api/invoices': 'admin',
  '/api/servemanager': 'admin',
  '/api/notifications': 'dispatch',
  '/api/statutes': 'admin',
  '/api/cases': 'records',
  '/api/code-enforcement': 'records',
  '/api/court': 'records',
  '/api/dar': 'admin',
  '/api/offender-registry': 'records',
  '/api/company-documents': 'admin',
  '/api/process-server': 'admin',
  '/api/forensic-lab': 'records',
  '/api/evidence': 'records',
  '/api/field-interviews': 'records',
  '/api/trespass-orders': 'records',
  '/api/hr': 'admin',
  '/api/email': 'admin',
  '/api/skiptracer': 'admin',
};

// Methods that mutate data
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Paths to exclude from broadcasting (auth, uploads, health, etc.)
const EXCLUDE_PATHS = ['/api/auth', '/api/health', '/api/uploads', '/api/downloads', '/api/updates'];

/**
 * Express middleware that intercepts successful mutation responses
 * and broadcasts a WebSocket event so other clients can refresh.
 *
 * The broadcast payload includes:
 *  - action: the HTTP method (POST/PUT/PATCH/DELETE)
 *  - path: the API path (e.g. /api/records/persons/123)
 *  - module: the module name (e.g. 'records', 'personnel')
 *  - user: who made the change
 *  - timestamp: when it happened
 */
export function liveBroadcast(req: Request, res: Response, next: NextFunction): void {
  // Only intercept mutation methods
  if (!MUTATION_METHODS.has(req.method)) {
    next();
    return;
  }

  // Skip excluded paths
  if (EXCLUDE_PATHS.some(p => req.path.startsWith(p))) {
    next();
    return;
  }

  // Override res.json to intercept the response
  const originalJson = res.json.bind(res);

  res.json = function (body: any) {
    // Only broadcast on success (2xx status codes)
    const statusCode = res.statusCode;
    if (statusCode >= 200 && statusCode < 300) {
      // Find matching channel for this API path
      for (const [prefix, channel] of Object.entries(PATH_TO_CHANNEL)) {
        if (req.path.startsWith(prefix)) {
          const module = prefix.replace('/api/', '');
          const pathParts = req.path.replace(prefix, '').split('/').filter(Boolean);
          const entity = pathParts[0] || module;

          try {
            broadcast(channel, 'data_changed', {
              action: req.method.toLowerCase(),
              module,
              entity,
              path: req.path,
              id: pathParts[1] || (body?.id) || null,
              user: req.user ? { id: req.user.userId, username: req.user.username } : null,
              timestamp: localNow(),
            });
          } catch (err) {
            // Never let broadcast errors break the API response
            console.error('[BROADCAST] Error:', err);
          }
          break;
        }
      }
    }

    return originalJson(body);
  };

  next();
}
