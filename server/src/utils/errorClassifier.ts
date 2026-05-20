// Structured error classification
import { Response } from 'express';
import { logger } from './logger';

export enum ErrorCode {
  // Authentication & Authorization
  AUTH_REQUIRED = 'AUTH_REQUIRED',
  AUTH_INVALID_TOKEN = 'AUTH_INVALID_TOKEN',
  AUTH_EXPIRED = 'AUTH_EXPIRED',
  AUTH_INSUFFICIENT_ROLE = 'AUTH_INSUFFICIENT_ROLE',
  AUTH_ACCOUNT_LOCKED = 'AUTH_ACCOUNT_LOCKED',
  AUTH_2FA_REQUIRED = 'AUTH_2FA_REQUIRED',

  // Validation
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  INVALID_PARAMETER = 'INVALID_PARAMETER',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',

  // Resource
  NOT_FOUND = 'NOT_FOUND',
  ALREADY_EXISTS = 'ALREADY_EXISTS',
  CONFLICT = 'CONFLICT',

  // Rate Limiting
  RATE_LIMITED = 'RATE_LIMITED',

  // Server
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  TIMEOUT = 'TIMEOUT',
}

const STATUS_MAP: Record<ErrorCode, number> = {
  [ErrorCode.AUTH_REQUIRED]: 401,
  [ErrorCode.AUTH_INVALID_TOKEN]: 401,
  [ErrorCode.AUTH_EXPIRED]: 401,
  [ErrorCode.AUTH_INSUFFICIENT_ROLE]: 403,
  [ErrorCode.AUTH_ACCOUNT_LOCKED]: 423,
  [ErrorCode.AUTH_2FA_REQUIRED]: 403,
  [ErrorCode.VALIDATION_FAILED]: 400,
  [ErrorCode.INVALID_PARAMETER]: 400,
  [ErrorCode.MISSING_REQUIRED_FIELD]: 400,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.ALREADY_EXISTS]: 409,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.RATE_LIMITED]: 429,
  [ErrorCode.INTERNAL_ERROR]: 500,
  [ErrorCode.DATABASE_ERROR]: 500,
  [ErrorCode.EXTERNAL_SERVICE_ERROR]: 502,
  [ErrorCode.SERVICE_UNAVAILABLE]: 503,
  [ErrorCode.TIMEOUT]: 504,
};

export interface ClassifiedError {
  code: ErrorCode;
  message: string;
  status: number;
  details?: Record<string, any>;
}

/** Classify an error and send appropriate response */
export function sendClassifiedError(
  res: Response,
  code: ErrorCode,
  message: string,
  details?: Record<string, any>
): void {
  const status = STATUS_MAP[code] || 500;
  const body: Record<string, any> = { error: message, code };
  if (details) body.details = details;

  if (status >= 500) {
    logger.error({ code, message, details }, 'Server error');
  }

  res.status(status).json(body);
}

/** Classify a caught error into a structured error */
export function classifyError(err: unknown): ClassifiedError {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();

    if (msg.includes('not found')) {
      return { code: ErrorCode.NOT_FOUND, message: err.message, status: 404 };
    }
    if (msg.includes('unauthorized') || msg.includes('authentication')) {
      return { code: ErrorCode.AUTH_REQUIRED, message: err.message, status: 401 };
    }
    if (msg.includes('forbidden') || msg.includes('permission')) {
      return {
        code: ErrorCode.AUTH_INSUFFICIENT_ROLE,
        message: err.message,
        status: 403,
      };
    }
    if (
      msg.includes('duplicate') ||
      msg.includes('unique constraint') ||
      msg.includes('already exists')
    ) {
      return { code: ErrorCode.ALREADY_EXISTS, message: err.message, status: 409 };
    }
    if (msg.includes('timeout') || msg.includes('timed out')) {
      return { code: ErrorCode.TIMEOUT, message: err.message, status: 504 };
    }
    if (msg.includes('sqlite') || msg.includes('database')) {
      return {
        code: ErrorCode.DATABASE_ERROR,
        message: 'Database operation failed',
        status: 500,
      };
    }

    return { code: ErrorCode.INTERNAL_ERROR, message: err.message, status: 500 };
  }

  return {
    code: ErrorCode.INTERNAL_ERROR,
    message: 'An unexpected error occurred',
    status: 500,
  };
}
