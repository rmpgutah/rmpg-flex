// ============================================================
// Skip Tracker 3.5 — Base Data Source
// ============================================================
// Abstract class that all data source adapters extend.
// Provides rate limiting, retry with backoff, result caching,
// encrypted config storage, and enabled/configured checks.

import crypto from 'crypto';
import { DataSource, SearchQuery, SourceCategory, SourceResult } from '../types';
import { getDb } from '../../../models/database';
import { localNow } from '../../../utils/timeUtils';
import { config } from '../../../config';

// ============================================================
// Encryption helpers (AES-256-GCM, same pattern as skiptracer.ts)
// ============================================================

function deriveKey(): Buffer {
  return crypto.createHash('sha256').update(config.jwt.secret).digest();
}

function encrypt(plaintext: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(stored: string): string {
  const key = deriveKey();
  const parts = stored.split(':');
  if (parts.length < 3) throw new Error('Malformed encrypted value');
  const [ivHex, authTagHex, ciphertext] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ============================================================
// Cache entry type
// ============================================================

interface CacheEntry {
  result: SourceResult;
  expiresAt: number;
}

// ============================================================
// Rate limit tracker
// ============================================================

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

// ============================================================
// Base Data Source
// ============================================================

export abstract class BaseDataSource implements DataSource {
  abstract readonly name: string;
  abstract readonly displayName: string;
  abstract readonly category: SourceCategory;
  abstract readonly costPerLookup: number;
  readonly priority?: number;

  /** Max requests per 60-second window. Override in subclass if needed. */
  protected maxRequestsPerMinute = 10;

  // --- In-memory rate limit tracking (per source instance) ---
  private rateLimitBucket: RateLimitBucket = { count: 0, resetAt: 0 };

  // --- In-memory result cache ---
  private static cache = new Map<string, CacheEntry>();
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private static readonly CACHE_MAX_ENTRIES = 500;

  // ============================================================
  // Encrypted config helpers
  // ============================================================

  /** Build a config key following the skipv2_{sourceName}_{suffix} pattern. */
  protected configKey(suffix: string): string {
    return `skipv2_${this.name}_${suffix}`;
  }

  /** Read a plain-text value from system_config. */
  protected getConfigValue(suffix: string): string | null {
    const db = getDb();
    const key = this.configKey(suffix);
    const row = db.prepare("SELECT config_value FROM system_config WHERE config_key = ? AND is_active = 1 LIMIT 1").get(key) as { config_value: string } | undefined;
    return row?.config_value ?? null;
  }

  /** Read and decrypt an AES-256-GCM encrypted value from system_config. */
  protected getDecryptedConfig(suffix: string): string | null {
    const stored = this.getConfigValue(suffix);
    if (!stored) return null;
    try {
      return decrypt(stored);
    } catch {
      return null;
    }
  }

  /** Write a value to system_config, encrypting it with AES-256-GCM. */
  protected setConfigValue(suffix: string, plaintext: string): void {
    const db = getDb();
    const key = this.configKey(suffix);
    const encrypted = encrypt(plaintext);
    // Check if exists first
    const existing = db.prepare("SELECT id FROM system_config WHERE config_key = ? LIMIT 1").get(key) as { id: number } | undefined;
    if (existing) {
      db.prepare("UPDATE system_config SET config_value = ?, updated_at = ? WHERE config_key = ?").run(encrypted, localNow(), key);
    } else {
      db.prepare(
        "INSERT INTO system_config (config_key, config_value, category, is_active, updated_at) VALUES (?, ?, 'integrations', 1, ?)"
      ).run(key, encrypted, localNow());
    }
  }

  // ============================================================
  // isConfigured / isEnabled / healthCheck
  // ============================================================

  /** Returns true by default. Override in sources that require API keys. */
  isConfigured(): boolean {
    return true;
  }

  /** Reads from system_config — enabled unless value is explicitly '0'. */
  isEnabled(): boolean {
    const val = this.getConfigValue('enabled');
    // null / undefined / any non-'0' value means enabled
    return val !== '0';
  }

  /** Basic health check: configured AND enabled. Override for API-level checks. */
  async healthCheck(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
    if (!this.isConfigured()) {
      return { ok: false, error: `${this.displayName} is not configured` };
    }
    if (!this.isEnabled()) {
      return { ok: false, error: `${this.displayName} is disabled` };
    }
    return { ok: true };
  }

  // ============================================================
  // Rate limiting
  // ============================================================

  /** Returns true if the request is allowed; false if rate-limited. */
  private checkRateLimit(): boolean {
    const now = Date.now();
    if (now >= this.rateLimitBucket.resetAt) {
      // Start a new 60-second window
      this.rateLimitBucket = { count: 1, resetAt: now + 60_000 };
      return true;
    }
    if (this.rateLimitBucket.count < this.maxRequestsPerMinute) {
      this.rateLimitBucket.count++;
      return true;
    }
    return false;
  }

  // ============================================================
  // Result caching
  // ============================================================

  private static cacheKey(sourceName: string, query: SearchQuery): string {
    return `${sourceName}:${JSON.stringify(query)}`;
  }

  private getCached(query: SearchQuery): SourceResult | null {
    const key = BaseDataSource.cacheKey(this.name, query);
    const entry = BaseDataSource.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      BaseDataSource.cache.delete(key);
      return null;
    }
    return entry.result;
  }

  private setCache(query: SearchQuery, result: SourceResult): void {
    // Evict oldest entries if over limit
    if (BaseDataSource.cache.size >= BaseDataSource.CACHE_MAX_ENTRIES) {
      // Delete the first (oldest inserted) entry
      const firstKey = BaseDataSource.cache.keys().next().value;
      if (firstKey !== undefined) {
        BaseDataSource.cache.delete(firstKey);
      }
    }
    const key = BaseDataSource.cacheKey(this.name, query);
    BaseDataSource.cache.set(key, {
      result,
      expiresAt: Date.now() + BaseDataSource.CACHE_TTL_MS,
    });
  }

  // ============================================================
  // Retry with exponential backoff
  // ============================================================

  /**
   * Fetch a URL with automatic retry on failure / 429.
   * Max 2 retries (3 total attempts). 15-second timeout per attempt.
   */
  protected async fetchWithRetry(
    url: string,
    options: RequestInit = {},
  ): Promise<Response> {
    const maxRetries = 2;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(url, {
          ...options,
          signal: AbortSignal.timeout(15_000),
        });

        if (res.status === 429 && attempt < maxRetries) {
          // Parse Retry-After header (seconds) or use exponential backoff
          const retryAfter = res.headers.get('Retry-After');
          const waitMs = retryAfter
            ? Math.min(parseInt(retryAfter, 10) * 1000, 30_000)
            : Math.pow(2, attempt + 1) * 1000;
          await this.sleep(waitMs);
          continue;
        }

        return res;
      } catch (err) {
        if (attempt >= maxRetries) throw err;
        // Exponential backoff: 2s, 4s
        await this.sleep(Math.pow(2, attempt + 1) * 1000);
      }
    }

    // Unreachable, but satisfies TypeScript
    throw new Error(`fetchWithRetry: exhausted retries for ${url}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================================================
  // Abstract / optional methods for subclasses
  // ============================================================

  /** Subclasses implement actual search logic here. */
  protected abstract doSearch(query: SearchQuery): Promise<SourceResult[]>;

  /** Optional: subclasses can override to support detail lookups by ID. */
  protected doGetDetails?(id: string): Promise<SourceResult>;

  // ============================================================
  // Public API: search() and getDetails()
  // ============================================================

  /**
   * Public search entry point.
   * Checks enabled/configured, checks cache, enforces rate limit,
   * then delegates to the subclass doSearch().
   */
  async search(query: SearchQuery): Promise<SourceResult> {
    // --- Guard: enabled + configured ---
    if (!this.isEnabled()) {
      return this.errorResult(`${this.displayName} is disabled`);
    }
    if (!this.isConfigured()) {
      return this.errorResult(`${this.displayName} is not configured`);
    }

    // --- Cache check ---
    const cached = this.getCached(query);
    if (cached) return cached;

    // --- Rate limit ---
    if (!this.checkRateLimit()) {
      return this.errorResult(`${this.displayName} rate limit exceeded — try again shortly`);
    }

    // --- Execute search ---
    try {
      const results = await this.doSearch(query);

      // Merge multiple sub-results into a single SourceResult envelope
      const merged = this.mergeResults(results);
      this.setCache(query, merged);
      return merged;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.errorResult(message);
    }
  }

  /**
   * Public detail lookup entry point.
   * Delegates to the optional doGetDetails() if the subclass provides it.
   */
  async getDetails(id: string): Promise<SourceResult> {
    if (!this.doGetDetails) {
      return this.errorResult(`${this.displayName} does not support detail lookups`);
    }
    if (!this.isEnabled()) {
      return this.errorResult(`${this.displayName} is disabled`);
    }
    if (!this.isConfigured()) {
      return this.errorResult(`${this.displayName} is not configured`);
    }

    try {
      return await this.doGetDetails(id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.errorResult(message);
    }
  }

  // ============================================================
  // Helpers
  // ============================================================

  /** Build a minimal error SourceResult. */
  protected errorResult(error: string): SourceResult {
    return {
      source: this.name,
      sourceType: this.category,
      confidence: 0,
      fetchedAt: localNow(),
      error,
    };
  }

  /**
   * Merge an array of SourceResults (from doSearch) into a single envelope.
   * If doSearch returns exactly one result, it is returned as-is.
   */
  private mergeResults(results: SourceResult[]): SourceResult {
    if (results.length === 0) {
      return {
        source: this.name,
        sourceType: this.category,
        confidence: 0,
        fetchedAt: localNow(),
        rawResultCount: 0,
      };
    }
    if (results.length === 1) return results[0];

    // Merge sub-record arrays from all results
    const merged: SourceResult = {
      source: this.name,
      sourceType: this.category,
      confidence: Math.max(...results.map(r => r.confidence)),
      fetchedAt: localNow(),
      rawResultCount: results.reduce((sum, r) => sum + (r.rawResultCount ?? 1), 0),
    };

    const arrayKeys = [
      'names', 'dobs', 'ssns', 'addresses', 'phones', 'emails',
      'socialProfiles', 'associates', 'courtRecords', 'propertyRecords',
      'licenses', 'vehicles', 'businesses', 'watchlistFlags',
      'sexOffenderRecords', 'custodyRecords', 'photos',
    ] as const;

    for (const key of arrayKeys) {
      const combined = results.flatMap(r => (r[key] as any[]) ?? []);
      if (combined.length > 0) {
        (merged as any)[key] = combined;
      }
    }

    // Pass through meta from the first result that has it
    const metaResult = results.find(r => r.meta);
    if (metaResult?.meta) merged.meta = metaResult.meta;

    return merged;
  }
}
