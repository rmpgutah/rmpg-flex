// Request context utilities
// - Attach request ID to error responses
// - API version header support
// - Response time tracking

import { Request, Response, NextFunction } from 'express';

/** API version constant */
export const API_VERSION = '1.0';

/** Middleware: adds X-API-Version, X-Response-Time, and ensures X-Request-Id on error responses */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const startTime = process.hrtime.bigint();

  // Set API version header
  res.setHeader('X-API-Version', API_VERSION);

  // Track response time
  const originalJson = res.json.bind(res);
  res.json = function (body: any) {
    const elapsed = Number(process.hrtime.bigint() - startTime) / 1e6;
    res.setHeader('X-Response-Time', `${elapsed.toFixed(2)}ms`);

    // Attach request ID to error responses for traceability
    if (res.statusCode >= 400 && body && typeof body === 'object' && body.error) {
      const reqId = res.getHeader('X-Request-Id') as string;
      if (reqId) {
        body.requestId = reqId;
      }
    }

    return originalJson(body);
  } as any;

  next();
}

/** Extract request ID from response headers (set by pino-http) */
export function getRequestId(res: Response): string | undefined {
  return res.getHeader('X-Request-Id') as string | undefined;
}
