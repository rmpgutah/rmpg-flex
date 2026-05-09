// API deprecation warning system
import { Request, Response, NextFunction } from 'express';
import { logger } from './logger';

interface DeprecatedEndpoint {
  path: string;
  method: string;
  message: string;
  sunsetDate: string; // ISO date
  replacement?: string;
}

const deprecatedEndpoints: DeprecatedEndpoint[] = [];

/** Register an endpoint as deprecated */
export function deprecateEndpoint(endpoint: DeprecatedEndpoint): void {
  deprecatedEndpoints.push(endpoint);
}

/** Middleware factory for marking a route as deprecated */
export function deprecated(
  message: string,
  sunsetDate: string,
  replacement?: string
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('Deprecation', `date="${sunsetDate}"`);
    res.setHeader('Sunset', sunsetDate);
    if (replacement) {
      res.setHeader('Link', `<${replacement}>; rel="successor-version"`);
    }

    // Add deprecation notice to response
    const originalJson = res.json.bind(res);
    res.json = function (body: any) {
      if (body && typeof body === 'object') {
        body._deprecation = {
          message,
          sunsetDate,
          replacement: replacement || null,
        };
      }
      return originalJson(body);
    } as any;

    next();
  };
}

/** Get all registered deprecated endpoints */
export function getDeprecatedEndpoints(): DeprecatedEndpoint[] {
  return [...deprecatedEndpoints];
}
