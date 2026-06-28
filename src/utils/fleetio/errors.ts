// ============================================================
// RMPG Flex — Fleet.io integration: typed errors
// ============================================================
// Callers `instanceof`-discriminate to map failures to HTTP codes or
// retry policy. Mirrors src/utils/roboflowAlpr.ts error shape so the
// codebase has one consistent integration-error idiom.
// ============================================================

export class FleetioError extends Error {
  readonly status?: number;
  readonly detail?: unknown;
  constructor(message: string, opts?: { status?: number; detail?: unknown }) {
    super(message);
    this.name = 'FleetioError';
    this.status = opts?.status;
    this.detail = opts?.detail;
  }
}

/** Bad/missing config: API key or account token unset, base URL malformed. Not retried. */
export class FleetioConfigError extends FleetioError {
  constructor(message: string, detail?: unknown) {
    super(message, { detail });
    this.name = 'FleetioConfigError';
  }
}

/** Request exceeded the timeout across all retry attempts. */
export class FleetioTimeoutError extends FleetioError {
  constructor(message: string) {
    super(message);
    this.name = 'FleetioTimeoutError';
  }
}

/** Fleet.io returned a non-2xx, non-429 response. `status` carries the HTTP code. */
export class FleetioHttpError extends FleetioError {
  constructor(message: string, status: number, detail?: unknown) {
    super(message, { status, detail });
    this.name = 'FleetioHttpError';
  }
}

/** Fleet.io returned 429. `retryAfterSeconds` reflects the Retry-After header or
 *  the adapter's default backoff if the header was absent/non-numeric. */
export class FleetioRateLimitError extends FleetioError {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number, detail?: unknown) {
    super(`Fleet.io rate limit hit; retry after ${retryAfterSeconds}s`, { status: 429, detail });
    this.name = 'FleetioRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
