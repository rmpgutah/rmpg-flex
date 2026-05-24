// BaseWarrantSource: shared rate-limit + retry + fetch wrapper.
// Mirrors the BaseDataSource pattern already used in server/src/routes/skiptracer-v2/.

import type { WarrantRecord } from '../types';

export type SourceMode = 'list-poll' | 'query-lookup';

export interface SourceConfig {
  userAgent?: string;          // override for sites that 403 a default UA
  minIntervalMs?: number;      // between requests to this source
  maxRetries?: number;
  timeoutMs?: number;
}

export abstract class BaseWarrantSource {
  abstract readonly id: string;        // 'warrants-utah-gov', 'slco-sheriff', etc.
  abstract readonly displayName: string;
  abstract readonly mode: SourceMode;

  protected lastFetchAt = 0;
  protected config: Required<SourceConfig>;

  constructor(cfg: SourceConfig = {}) {
    this.config = {
      userAgent: cfg.userAgent ?? 'RMPG-Flex-Warrants-Poller/1.0 (chzamo@rmpgutah.us)',
      minIntervalMs: cfg.minIntervalMs ?? 2000,
      maxRetries: cfg.maxRetries ?? 3,
      timeoutMs: cfg.timeoutMs ?? 30_000,
    };
  }

  // list-poll sources implement this; query-lookup sources throw.
  async pollAll(): Promise<WarrantRecord[]> {
    throw new Error(`${this.id} is a query-lookup source; call lookup() instead`);
  }

  // query-lookup sources implement this; list-poll sources may also support it.
  // `age` is in years; pass it when the local system stores age directly,
  // OR alongside dob (in which case adapters that disambiguate prefer age,
  // since the upstream usually exposes age, not dob).
  async lookup(_query: { name: string; dob?: string; age?: number }): Promise<WarrantRecord[]> {
    throw new Error(`${this.id} does not support per-name lookup`);
  }

  protected async fetchWithRetry(url: string, init: RequestInit = {}): Promise<Response> {
    await this.throttle();
    const headers = new Headers(init.headers);
    if (!headers.has('user-agent')) headers.set('user-agent', this.config.userAgent);

    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.config.timeoutMs);
      try {
        const res = await fetch(url, { ...init, headers, signal: ctrl.signal });
        clearTimeout(timer);
        if (res.status >= 500 && attempt < this.config.maxRetries) {
          await sleep(backoffMs(attempt));
          continue;
        }
        return res;
      } catch (err) {
        clearTimeout(timer);
        lastErr = err;
        if (attempt < this.config.maxRetries) await sleep(backoffMs(attempt));
      }
    }
    throw lastErr ?? new Error(`fetch failed after ${this.config.maxRetries} retries: ${url}`);
  }

  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastFetchAt;
    if (elapsed < this.config.minIntervalMs) {
      await sleep(this.config.minIntervalMs - elapsed);
    }
    this.lastFetchAt = Date.now();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function backoffMs(attempt: number): number {
  return Math.min(8000, 250 * 2 ** attempt) + Math.floor(Math.random() * 200);
}
