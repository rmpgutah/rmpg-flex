import {
  US_STATE_CODES,
  type PlateToVinParams,
  type PlateToVinResponse,
  type AutoDevApiErrorBody,
  type PlateToVinClientConfig,
  type AutoDevErrorCode,
} from './types.js';

// ─── Custom Errors ────────────────────────────────────────────────────────────

export class PlateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlateValidationError';
  }
}

export class AutoDevApiError extends Error {
  readonly statusCode: number;
  readonly code: AutoDevErrorCode;
  readonly requestId: string;

  constructor(body: AutoDevApiErrorBody) {
    super(body.error);
    this.name = 'AutoDevApiError';
    this.statusCode = body.status;
    this.code = body.code;
    this.requestId = body.requestId;
  }
}

export class RateLimitExceededError extends Error {
  constructor() {
    super('Local rate limit exceeded — back off before retrying');
    this.name = 'RateLimitExceededError';
  }
}

// ─── Token Bucket (internal) ──────────────────────────────────────────────────

class TokenBucket {
  private tokens: number;
  private lastRefillMs: number;

  constructor(private readonly maxPerSecond: number) {
    this.tokens = maxPerSecond;
    this.lastRefillMs = Date.now();
  }

  tryConsume(): boolean {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefillMs) / 1000;
    this.tokens = Math.min(this.maxPerSecond, this.tokens + elapsedSec * this.maxPerSecond);
    this.lastRefillMs = now;

    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

// ─── TTL Cache (internal) ─────────────────────────────────────────────────────

class TtlCache<T> {
  private readonly store = new Map<string, { value: T; expiresAt: number }>();

  constructor(private readonly ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.ttlMs === 0) return;
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_STATE_SET = new Set<string>(US_STATE_CODES);
const PLATE_RE = /^[A-Z0-9]{2,8}$/;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizePlate(raw: string): string {
  return raw.replace(/-/g, '').toUpperCase();
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class PlateToVinClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;
  private readonly cache: TtlCache<PlateToVinResponse>;
  private readonly bucket: TokenBucket;

  constructor(config: PlateToVinClientConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? 'https://api.auto.dev';
    this.maxRetries = config.maxRetries ?? 3;
    this.initialBackoffMs = config.initialBackoffMs ?? 500;
    this.cache = new TtlCache<PlateToVinResponse>(config.cacheTtlMs ?? 86_400_000);
    this.bucket = new TokenBucket(config.maxRequestsPerSecond ?? 10);
  }

  async lookup(params: PlateToVinParams): Promise<PlateToVinResponse> {
    // 1. Validate
    const plate = normalizePlate(params.plate);
    const state = params.state.toUpperCase();

    if (!PLATE_RE.test(plate)) {
      throw new PlateValidationError(
        `Invalid plate "${params.plate}": must be 2–8 alphanumeric characters (hyphens are stripped).`,
      );
    }
    if (!VALID_STATE_SET.has(state)) {
      throw new PlateValidationError(
        `Invalid state code "${params.state}": must be a valid 2-letter US state code.`,
      );
    }

    // 2. Cache hit
    const cacheKey = `${state}:${plate}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    // 3. Rate limit
    if (!this.bucket.tryConsume()) {
      throw new RateLimitExceededError();
    }

    // 4. Fetch with retry
    const url = `${this.baseUrl}/plate/${state}/${plate}`;
    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };

    let lastError: Error = new Error('Unknown error');

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await fetch(url, { headers });

        // 5. Success
        if (response.status === 200) {
          const body = (await response.json()) as PlateToVinResponse;
          this.cache.set(cacheKey, body);
          return body;
        }

        // 6. Structured 4xx (not 429) — never retry
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          let errorBody: AutoDevApiErrorBody;
          try {
            errorBody = (await response.json()) as AutoDevApiErrorBody;
          } catch {
            throw new Error(`API error ${response.status}: ${await response.text()}`);
          }
          throw new AutoDevApiError(errorBody);
        }

        // 7. Retryable: 429, 5xx
        const retryAfterRaw = response.headers.get('Retry-After');
        const backoffMs =
          retryAfterRaw != null
            ? parseInt(retryAfterRaw, 10) * 1000
            : this.calcBackoff(attempt);

        lastError = new Error(`HTTP ${response.status} — retrying (attempt ${attempt + 1})`);

        if (attempt < this.maxRetries) {
          await sleep(backoffMs);
        }
      } catch (err) {
        // Re-throw non-retryable errors immediately
        if (err instanceof AutoDevApiError || err instanceof PlateValidationError) {
          throw err;
        }
        // Network errors — retryable
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.maxRetries) {
          await sleep(this.calcBackoff(attempt));
        }
      }
    }

    throw lastError;
  }

  private calcBackoff(attempt: number): number {
    const base = this.initialBackoffMs * Math.pow(2, attempt);
    const jitter = base * 0.2 * Math.random();
    return base + jitter;
  }
}
