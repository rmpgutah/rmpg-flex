// ============================================================
// RMPG Flex — Legal Data Hunter integration: typed errors
// ============================================================
// Mirrors src/utils/fleetio/errors.ts so the codebase keeps one
// consistent integration-error idiom across external HTTP adapters.
// ============================================================

export class LdhError extends Error {
  readonly status?: number;
  readonly detail?: unknown;
  constructor(message: string, opts?: { status?: number; detail?: unknown }) {
    super(message);
    this.name = 'LdhError';
    this.status = opts?.status;
    this.detail = opts?.detail;
  }
}

/** Missing/blank LEGAL_DATA_HUNTER_API_KEY. Not retried. */
export class LdhConfigError extends LdhError {
  constructor(message: string, detail?: unknown) {
    super(message, { detail });
    this.name = 'LdhConfigError';
  }
}

/** Request exceeded the timeout. */
export class LdhTimeoutError extends LdhError {
  constructor(message: string) {
    super(message);
    this.name = 'LdhTimeoutError';
  }
}

/** Non-2xx, non-429 response. `status` carries the HTTP code. */
export class LdhHttpError extends LdhError {
  constructor(message: string, status: number, detail?: unknown) {
    super(message, { status, detail });
    this.name = 'LdhHttpError';
  }
}

/** LDH returned 429. `retryAfterSeconds` reflects the Retry-After header. */
export class LdhRateLimitError extends LdhError {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number, detail?: unknown) {
    super(`Legal Data Hunter rate limit hit; retry after ${retryAfterSeconds}s`, { status: 429, detail });
    this.name = 'LdhRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
