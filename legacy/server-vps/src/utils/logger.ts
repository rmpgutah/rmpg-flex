// Centralized structured logger for RMPG Flex server.
//
// Wraps pino for fast JSON logging in production (plays well with
// journalctl -u rmpg-flex) and pino-pretty formatting in development.
// Replaces scattered console.log/error/warn calls with leveled, query-
// able, request-correlated logs.
//
// Usage:
//   import { logger } from './utils/logger';
//   logger.info('server started');
//   logger.error({ err }, 'database init failed');
//   logger.warn({ userId, ip: req.ip }, 'auth ip mismatch');
//
// For request-scoped logging (includes request ID automatically):
//   req.log.info('processing dispatch call');
//   req.log.error({ err }, 'handler threw');
//
// The logSafe() helper from ./logSafe should still be used on any string
// derived from untrusted input (request bodies, scraper output) before
// including it in a log message — pino does not sanitize log-injection
// payloads.

import pino from 'pino';
import pinoHttp from 'pino-http';
import { randomUUID } from 'crypto';

const isProd = process.env.NODE_ENV === 'production';
// Vitest sets NODE_ENV='test' by default. Several tests deliberately
// exercise rejection / fallback paths that emit warn-level logs (e.g.
// the dashcam ingest signature-mismatch tests) — useful in production
// for ops, just stderr noise during `npx vitest run`. Default level
// 'error' under test keeps real errors visible while silencing the
// expected warn spam. Override with LOG_LEVEL=info if a test author
// needs to see info/warn while debugging.
const isTest = process.env.NODE_ENV === 'test' || !!process.env.VITEST;

/**
 * Pure helper exported for tests: decides the logger level from env
 * without constructing a pino instance. LOG_LEVEL always wins; then
 * test → 'error', prod → 'info', else → 'debug'.
 */
export function decideLogLevel(env: NodeJS.ProcessEnv = process.env): string {
  if (env.LOG_LEVEL) return env.LOG_LEVEL;
  if (env.NODE_ENV === 'test' || env.VITEST) return 'error';
  if (env.NODE_ENV === 'production') return 'info';
  return 'debug';
}

// Pretty-printed dev logs; JSON lines in production for structured search.
// Tests use the default destination (stderr) without pino-pretty so the
// vitest reporter stays clean.
const transport = isProd || isTest
  ? undefined
  : {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname',
      },
    };

export const logger = pino({
  level: decideLogLevel(),
  base: { service: 'rmpg-flex' },
  timestamp: pino.stdTimeFunctions.isoTime,
  transport,
  // Redact common token/credential fields at any nesting depth.
  // Keeps JWTs and passwords out of log aggregation.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.passwordHash',
      '*.password_hash',
      '*.token',
      '*.refreshToken',
      '*.refresh_token',
      '*.totpSecret',
      '*.totp_secret',
      'headers.authorization',
      'headers.cookie',
    ],
    censor: '[REDACTED]',
  },
});

// HTTP request logger middleware. Attaches `req.log` with a per-request
// child logger carrying the request ID, so every log line emitted during
// request processing can be correlated back to the originating request.
export const httpLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    // Honor upstream X-Request-Id if present (for nginx/cloudflare tracing);
    // otherwise mint one. Echo back so clients/logs can cross-reference.
    const incoming = req.headers['x-request-id'];
    const id = (typeof incoming === 'string' && incoming) || randomUUID();
    res.setHeader('X-Request-Id', id);
    return id;
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  // Drop noisy routes from the per-request log stream — health checks
  // and static assets would otherwise dominate journalctl.
  autoLogging: {
    ignore: (req) => {
      const url = req.url || '';
      return (
        url === '/api/health' ||
        url.startsWith('/assets/') ||
        url.startsWith('/tiles/') ||
        url === '/sw.js' ||
        url === '/favicon.ico'
      );
    },
  },
  serializers: {
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: req.url,
      // Don't log body — may contain PII, large payloads, or credentials
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
    err: pino.stdSerializers.err,
  },
});

// Re-export for consumers that need a shaped type when attaching `req.log`.
export type Logger = typeof logger;
