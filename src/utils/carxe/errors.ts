// ============================================================
// RMPG Flex — CarsXE integration: typed errors
// ============================================================
// Mirrors src/utils/fleetio/errors.ts so the codebase has one consistent
// integration-error idiom. Callers `instanceof`-discriminate to map
// failures to HTTP codes or retry policy.
// ============================================================

export class CarxeError extends Error {
  readonly status?: number;
  readonly detail?: unknown;
  constructor(message: string, opts?: { status?: number; detail?: unknown }) {
    super(message);
    this.name = 'CarxeError';
    this.status = opts?.status;
    this.detail = opts?.detail;
  }
}

/** Bad/missing config: API key unset. Not retried. */
export class CarxeConfigError extends CarxeError {
  constructor(message: string, detail?: unknown) {
    super(message, { detail });
    this.name = 'CarxeConfigError';
  }
}

/** Request exceeded the timeout across all retry attempts. */
export class CarxeTimeoutError extends CarxeError {
  constructor(message: string) {
    super(message);
    this.name = 'CarxeTimeoutError';
  }
}

/** CarsXE returned a non-2xx, non-429 response. `status` carries the HTTP code. */
export class CarxeHttpError extends CarxeError {
  constructor(message: string, status: number, detail?: unknown) {
    super(message, { status, detail });
    this.name = 'CarxeHttpError';
  }
}

/** CarsXE returned 429. `retryAfterSeconds` reflects the Retry-After header or
 *  the adapter's default backoff if the header was absent/non-numeric. */
export class CarxeRateLimitError extends CarxeError {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number, detail?: unknown) {
    super(`CarsXE rate limit hit; retry after ${retryAfterSeconds}s`, { status: 429, detail });
    this.name = 'CarxeRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
