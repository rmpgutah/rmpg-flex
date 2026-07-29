// ============================================================
// RMPG Flex — ServeManager integration: typed errors
// ============================================================
// Mirrors src/utils/fleetio/errors.ts so the codebase has one
// consistent integration-error idiom across adapters.
// ============================================================

export class ServeManagerError extends Error {
  readonly status?: number;
  readonly detail?: unknown;
  constructor(message: string, opts?: { status?: number; detail?: unknown }) {
    super(message);
    this.name = 'ServeManagerError';
    this.status = opts?.status;
    this.detail = opts?.detail;
  }
}

/** Bad/missing config: API key unset, base URL malformed. Not retried. */
export class ServeManagerConfigError extends ServeManagerError {
  constructor(message: string, detail?: unknown) {
    super(message, { detail });
    this.name = 'ServeManagerConfigError';
  }
}

/** Request exceeded the timeout across all retry attempts. */
export class ServeManagerTimeoutError extends ServeManagerError {
  constructor(message: string) {
    super(message);
    this.name = 'ServeManagerTimeoutError';
  }
}

/** ServeManager returned a non-2xx, non-429 response. `status` carries the HTTP code. */
export class ServeManagerHttpError extends ServeManagerError {
  constructor(message: string, status: number, detail?: unknown) {
    super(message, { status, detail });
    this.name = 'ServeManagerHttpError';
  }
}

/** ServeManager returned 429. `retryAfterSeconds` reflects the Retry-After header or
 *  the adapter's default backoff if the header was absent/non-numeric. */
export class ServeManagerRateLimitError extends ServeManagerError {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number, detail?: unknown) {
    super(`ServeManager rate limit hit; retry after ${retryAfterSeconds}s`, { status: 429, detail });
    this.name = 'ServeManagerRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
