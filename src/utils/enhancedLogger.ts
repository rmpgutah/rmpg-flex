// ============================================================
// RMPG Flex — Enhanced logging with error context propagation
// ============================================================
// Ensures every log statement captures full error context,
// stack traces, and user/entity information for production debugging.
// ============================================================

export interface LogContext {
  userId?: number | null;
  userName?: string | null;
  callId?: string | number | null;
  callNumber?: string | null;
  unitId?: string | number | null;
  callSign?: string | null;
  entityType?: string;
  entityId?: string | number | null;
  action?: string;
  path?: string;
  method?: string;
  requestId?: string;
}

export interface ErrorDetails {
  message: string;
  stack?: string;
  code?: string;
  statusCode?: number;
  context?: LogContext;
  cause?: unknown;
}

// Extract error details with full stack trace
function extractErrorDetails(err: unknown): ErrorDetails {
  if (err instanceof Error) {
    return {
      message: err.message,
      stack: err.stack,
      code: (err as any).code,
      statusCode: (err as any).statusCode,
    };
  }
  if (typeof err === 'string') {
    return { message: err };
  }
  if (typeof err === 'object' && err !== null) {
    return {
      message: (err as any).message || JSON.stringify(err),
      code: (err as any).code,
      statusCode: (err as any).statusCode,
    };
  }
  return { message: 'Unknown error' };
}

// Attach context information to error
function withContext(err: ErrorDetails, ctx: LogContext): ErrorDetails {
  return { ...err, context: ctx };
}

// Main logger with context propagation
export const log = {
  info: (msg: string, ctx?: LogContext) => {
    console.log(`[INFO] ${msg}`, ctx ? JSON.stringify(ctx) : '');
  },

  warn: (msg: string, ctx?: LogContext, err?: unknown) => {
    const details = err ? extractErrorDetails(err) : {};
    console.warn(`[WARN] ${msg}`, JSON.stringify({ ...ctx, ...details }));
  },

  error: (msg: string, ctx: LogContext = {}, err?: unknown) => {
    const details = err ? extractErrorDetails(err) : {};
    const full = withContext(details, ctx);
    console.error(`[ERROR] ${msg}`, JSON.stringify(full, (key, value) => {
      // Avoid circular refs in context
      if (key === 'context' && typeof value === 'object') return '[circular]';
      return value;
    }));
  },

  debug: (msg: string, ctx?: LogContext, data?: any) => {
    if (process.env.DEBUG) {
      console.log(`[DEBUG] ${msg}`, JSON.stringify({ ctx, data }));
    }
  },
};

// Error wrapper for route handlers (standardize error responses)
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code: string = 'UNKNOWN',
    public context?: LogContext,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Safe async wrapper: catches + logs + returns error response
export function safeRoute<T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  defaultErrorCtx: LogContext = {},
) {
  return async (...args: T): Promise<R | null> => {
    try {
      return await fn(...args);
    } catch (err) {
      log.error('Route handler error', defaultErrorCtx, err);
      return null;
    }
  };
}
