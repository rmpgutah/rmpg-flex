// ============================================================
// RMPG Flex — API Response Helpers
// ============================================================
// Standardized response shapes for consistency across all routes.
// Reduces boilerplate in route handlers and ensures clients
// always receive predictable response structures.
// ============================================================

import { Response } from 'express';

/**
 * Send a success response with data.
 *
 * @example
 * sendSuccess(res, { id: 1, name: 'John' });
 * // → 200 { id: 1, name: 'John' }
 *
 * sendSuccess(res, { id: 1 }, 201);
 * // → 201 { id: 1 }
 */
export function sendSuccess<T>(res: Response, data: T, status = 200): void {
  res.status(status).json(data);
}

/**
 * Send a paginated response.
 *
 * @example
 * sendPaginated(res, warrants, { page: 1, limit: 25, total: 150 });
 * // → 200 { data: [...], pagination: { page: 1, limit: 25, total: 150, totalPages: 6 } }
 */
export function sendPaginated<T>(
  res: Response,
  data: T[],
  pagination: { page: number; limit: number; total: number },
): void {
  res.json({
    data,
    pagination: {
      ...pagination,
      totalPages: Math.ceil(pagination.total / pagination.limit),
    },
  });
}

/**
 * Send an error response with a standardized shape.
 *
 * @example
 * sendError(res, 'Warrant not found', 404);
 * // → 404 { error: 'Warrant not found' }
 *
 * sendError(res, 'Validation failed', 400, { fields: { name: 'Required' } });
 * // → 400 { error: 'Validation failed', details: { fields: { name: 'Required' } } }
 */
export function sendError(
  res: Response,
  message: string,
  status = 500,
  details?: Record<string, any>,
): void {
  const body: Record<string, any> = { error: message };
  if (details) body.details = details;
  res.status(status).json(body);
}

/**
 * Send a 400 Bad Request for validation errors.
 *
 * @example
 * sendValidationError(res, {
 *   warrant_number: 'Required',
 *   subject_name: 'Must be at least 2 characters',
 * });
 */
export function sendValidationError(
  res: Response,
  fields: Record<string, string>,
): void {
  res.status(400).json({
    error: 'Validation failed',
    fields,
  });
}

/**
 * Send a 404 Not Found response.
 */
export function sendNotFound(res: Response, entity = 'Resource'): void {
  res.status(404).json({ error: `${entity} not found` });
}

/**
 * Send a 201 Created response with the new entity.
 */
export function sendCreated<T>(res: Response, data: T): void {
  res.status(201).json(data);
}

/**
 * Wrap an async route handler to catch errors automatically.
 * Prevents unhandled promise rejections and sends consistent error responses.
 *
 * @example
 * router.get('/warrants', asyncHandler(async (req, res) => {
 *   const warrants = await fetchWarrants();
 *   sendSuccess(res, warrants);
 * }));
 */
export function asyncHandler(
  fn: (req: any, res: Response, next: any) => Promise<any>,
) {
  return (req: any, res: Response, next: any) => {
    Promise.resolve(fn(req, res, next)).catch((err) => {
      console.error(`[API Error] ${req.method} ${req.path}:`, err);
      if (!res.headersSent) {
        sendError(res, err.message || 'Internal server error', 500);
      }
    });
  };
}
