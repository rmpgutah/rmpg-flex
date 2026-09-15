// ============================================================
// RMPG Flex — ServeManager API Client (Cloudflare Worker)
// ============================================================
// Handles API key storage/encryption and HTTP calls to
// ServeManager's REST API. All SM calls go through this module.
// Key is stored in D1 config, encrypted with Web Crypto AES-256-GCM.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { queryFirst, execute } from './db';
import { timingSafeEqual } from './signedAccess';
import { log } from './logger';

const SM_BASE_URL = 'https://www.servemanager.com/api';

// ── Crypto helpers (no Buffer in Workers — use Uint8Array) ───

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  return bytes;
}

export type ServeManagerSecretSource = string | {
  JWT_SECRET?: string;
  JWT_SECRET_PREVIOUS?: string;
  FILE_ENCRYPTION_KEK?: string;
  FILE_ENCRYPTION_KEK_PREVIOUS?: string;
};

function primaryJwtSecret(source: ServeManagerSecretSource): string {
  return typeof source === 'string' ? source : (source.JWT_SECRET ?? '');
}

function dedicatedKekRaw(b64: string | undefined): Uint8Array | null {
  if (!b64?.trim()) return null;
  try {
    const bin = atob(b64.trim());
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.length === 32 ? out : null;
  } catch {
    return null;
  }
}

async function importAesKey(raw: BufferSource): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function deriveKey(jwtSecret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(jwtSecret));
  return importAesKey(raw);
}

async function cryptoKeysForSource(source: ServeManagerSecretSource): Promise<CryptoKey[]> {
  const keys: CryptoKey[] = [];
  const seen = new Set<string>();
  const addJwt = async (secret?: string) => {
    const s = secret?.trim();
    if (!s || seen.has(`jwt:${s}`)) return;
    seen.add(`jwt:${s}`);
    keys.push(await deriveKey(s));
  };
  const addDedicated = async (b64?: string) => {
    const raw = dedicatedKekRaw(b64);
    if (!raw || seen.has(`ded:${b64!.trim()}`)) return;
    seen.add(`ded:${b64!.trim()}`);
    keys.push(await importAesKey(raw));
  };
  if (typeof source === 'string') {
    await addJwt(source);
  } else {
    await addJwt(source.JWT_SECRET);
    await addJwt(source.JWT_SECRET_PREVIOUS);
    await addDedicated(source.FILE_ENCRYPTION_KEK);
    await addDedicated(source.FILE_ENCRYPTION_KEK_PREVIOUS);
  }
  return keys;
}

function looksEncryptedApiKey(stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 3) return false;
  return parts.every((p) => p.length > 0 && /^[0-9a-f]+$/i.test(p));
}

async function encryptApiKey(plaintext: string, jwtSecret: string): Promise<string> {
  const key = await deriveKey(jwtSecret);
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, enc.encode(plaintext),
  );
  const buf = new Uint8Array(ciphertext);
  const authTag = buf.slice(buf.length - 16);
  const ct = buf.slice(0, buf.length - 16);
  return `${bytesToHex(iv)}:${bytesToHex(authTag)}:${bytesToHex(ct)}`;
}

async function decryptApiKeyWithKey(stored: string, key: CryptoKey): Promise<string> {
  const parts = stored.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted API key format');
  const iv = hexToBytes(parts[0]);
  const authTag = hexToBytes(parts[1]);
  const ct = hexToBytes(parts[2]);
  const combined = new Uint8Array(ct.length + 16);
  combined.set(ct, 0);
  combined.set(authTag, ct.length);
  const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, combined);
  return new TextDecoder().decode(dec);
}

async function decryptApiKey(stored: string, source: ServeManagerSecretSource): Promise<string> {
  if (!looksEncryptedApiKey(stored)) return stored;
  const keys = await cryptoKeysForSource(source);
  if (keys.length === 0) throw new Error('Decryption failed — key may have changed or data is corrupted');
  for (const key of keys) {
    try {
      return await decryptApiKeyWithKey(stored, key);
    } catch {
      // Try the next historical wrapping key.
    }
  }
  throw new Error('Decryption failed — key may have changed or data is corrupted');
}

// ── Key storage ───────────────────────────────────────────────

async function persistRewrappedApiKey(db: D1Database, jwtSecret: string, plaintext: string): Promise<void> {
  if (!jwtSecret) return;
  const encrypted = await encryptApiKey(plaintext, jwtSecret);
  await execute(
    db,
    "UPDATE system_config SET config_value = ?, updated_at = datetime('now') WHERE config_key = 'servemanager_api_key' AND category = 'integrations'",
    encrypted,
  );
}

async function getStoredKey(db: D1Database, source: ServeManagerSecretSource): Promise<string | null> {
  try {
    const row = await queryFirst<{ config_value: string }>(
      db,
      "SELECT config_value FROM system_config WHERE config_key = 'servemanager_api_key' AND category = 'integrations' AND is_active = 1 LIMIT 1",
    );
    if (!row?.config_value) return null;
    const plaintext = await decryptApiKey(row.config_value, source);
    const primary = primaryJwtSecret(source);
    if (primary && looksEncryptedApiKey(row.config_value)) {
      try {
        await decryptApiKeyWithKey(row.config_value, await deriveKey(primary));
      } catch {
        await persistRewrappedApiKey(db, primary, plaintext).catch(() => undefined);
      }
    }
    return plaintext;
  } catch (err) {
    console.error('[sm-client] Failed to decrypt API key:', (err as Error).message);
    throw new Error((err as Error).message || 'Decryption failed — key may have changed or data is corrupted');
  }
}

export async function setApiKey(db: D1Database, jwtSecret: string, plaintext: string): Promise<void> {
  const encrypted = await encryptApiKey(plaintext, jwtSecret);
  await execute(db,
    "DELETE FROM system_config WHERE config_key = 'servemanager_api_key' AND category = 'integrations'");
  await execute(db,
    `INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at)
     VALUES ('servemanager_api_key', ?, 'integrations', 0, 1, datetime('now'), datetime('now'))`,
    encrypted,
  );
}

export async function clearApiKey(db: D1Database): Promise<void> {
  await execute(db,
    "DELETE FROM system_config WHERE config_key = 'servemanager_api_key' AND category = 'integrations'");
}

// ── HTTP client ───────────────────────────────────────────────

// ── Typed errors ──────────────────────────────────────────────
// Mirrors the shape every other integration client in this repo uses
// (Fleet.io, Roboflow, CarsXE) so callers can branch on the failure kind
// instead of regex-matching a message string.

export class ServeManagerConfigError extends Error {
  constructor(message: string) { super(message); this.name = 'ServeManagerConfigError'; }
}

export class ServeManagerTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`ServeManager request timed out after ${timeoutMs}ms`);
    this.name = 'ServeManagerTimeoutError';
  }
}

export class ServeManagerHttpError extends Error {
  constructor(public readonly status: number, public readonly bodyText: string) {
    super(`ServeManager API returned ${status}: ${bodyText}`);
    this.name = 'ServeManagerHttpError';
  }
}

export class ServeManagerRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number | null) {
    super(`ServeManager rate limit hit${retryAfterSeconds != null ? ` (retry after ${retryAfterSeconds}s)` : ''}`);
    this.name = 'ServeManagerRateLimitError';
  }
}

// ── Transport ─────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 500;

/**
 * Only transient server-side faults are worth replaying. A 401/403 means the
 * stored key is wrong — retrying it just delays the operator seeing that, and
 * a 404 will never become a 200. 429 is deliberately excluded: it gets its own
 * typed error so the caller can back off on ServeManager's own schedule rather
 * than hammering through the retry budget.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || (status >= 500 && status <= 599);
}

/**
 * POST is never replayed. ServeManager exposes no idempotency-key header, so
 * replaying a POST that actually succeeded but whose response was lost
 * double-creates the attempt or document. Same invariant the Fleet.io adapter
 * documents for the same reason.
 */
function isRetryableMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD';
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

export interface SmRequestInput {
  path: string;
  apiKey: string;
  params?: Record<string, string>;
  method?: 'GET' | 'POST';
  body?: unknown;
  /** Absolute URL to call instead of `SM_BASE_URL + path` (pagination `links.next`). */
  absoluteUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  /** Injected for tests; defaults to the platform fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * The single seam every ServeManager JSON call goes through: Basic auth,
 * an AbortController timeout, bounded retries with backoff, and typed errors.
 *
 * ServeManager auth is HTTP Basic — the API key is the username, password is
 * EMPTY. `X-Auth-Token` is not a header ServeManager recognizes at all; every
 * request using it 401s with "HTTP Basic: Access denied" regardless of how
 * valid the key is.
 */
export async function smRequest<T = any>(input: SmRequestInput): Promise<T> {
  const {
    path, apiKey, params, method = 'GET', body, absoluteUrl,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    fetchImpl = fetch,
  } = input;

  const url = new URL(absoluteUrl ?? `${SM_BASE_URL}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const maxRetries = isRetryableMethod(method)
    ? (input.maxRetries ?? DEFAULT_MAX_RETRIES)
    : 0;

  const headers: Record<string, string> = {
    Authorization: `Basic ${btoa(`${apiKey}:`)}`,
    Accept: 'application/json',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url.toString(), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      if (res.status === 429) {
        const raw = res.headers.get('retry-after');
        const parsed = raw == null ? NaN : Number(raw);
        throw new ServeManagerRateLimitError(Number.isFinite(parsed) ? parsed : null);
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new ServeManagerHttpError(res.status, text);
        if (attempt < maxRetries && isRetryableStatus(res.status)) {
          lastErr = err;
          await sleep(retryDelayMs * 2 ** attempt);
          continue;
        }
        throw err;
      }

      return await res.json() as T;
    } catch (err) {
      // A rate-limit or a terminal HTTP error is the caller's to handle — never
      // swallow it into the retry loop.
      if (err instanceof ServeManagerRateLimitError || err instanceof ServeManagerHttpError) throw err;

      const isAbort = (err as Error)?.name === 'AbortError';
      const wrapped = isAbort ? new ServeManagerTimeoutError(timeoutMs) : err;
      if (attempt < maxRetries) {
        lastErr = wrapped;
        await sleep(retryDelayMs * 2 ** attempt);
        continue;
      }
      throw wrapped;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('ServeManager request failed');
}

async function smGet(path: string, apiKey: string, params?: Record<string, string>): Promise<any> {
  return smRequest({ path, apiKey, params });
}

// documents_json's `pdf_download_url` (e.g.
// https://www.servemanager.com/api/documents/50457080/download) is
// ServeManager's OWN authenticated API endpoint, not a public link — the
// browser has no ServeManager credentials, so linking to it directly from
// the client 401s. This proxies the binary through the Worker with the
// same Basic-Auth pattern smGet() uses for JSON.
export async function fetchDocumentBinary(
  db: D1Database, source: ServeManagerSecretSource, documentId: number | string,
): Promise<{ ok: true; contentType: string; body: ArrayBuffer } | { ok: false; status: number; error: string }> {
  let key: string | null;
  try {
    key = await getStoredKey(db, source);
  } catch (err) {
    return { ok: false, status: 503, error: (err as Error).message };
  }
  if (!key) return { ok: false, status: 503, error: 'API key not configured' };
  try {
    const res = await fetch(`${SM_BASE_URL}/documents/${documentId}/download`, {
      headers: { Authorization: `Basic ${btoa(`${key}:`)}` },
    });
    if (!res.ok) return { ok: false, status: res.status, error: await res.text().catch(() => 'download failed') };
    return { ok: true, contentType: res.headers.get('content-type') || 'application/pdf', body: await res.arrayBuffer() };
  } catch (err) {
    return { ok: false, status: 502, error: (err as Error).message };
  }
}

// ── Status check ──────────────────────────────────────────────

export async function testConnection(db: D1Database, source: ServeManagerSecretSource): Promise<{ success: boolean; account?: any; error?: string }> {
  let key: string | null;
  try {
    key = await getStoredKey(db, source);
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
  if (!key) return { success: false, error: 'API key not configured' };
  try {
    const account = await smGet('/account', key);
    return { success: true, account };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ── Job fetching ──────────────────────────────────────────────

export interface SmJob {
  id: number;
  // The real /jobs list payload (confirmed live 2026-08-09) has no
  // top-level `job_number` at all — the field is `servemanager_job_number`.
  servemanager_job_number?: string;
  job_status?: string;
  service_status?: string;
  client_company?: { name?: string; id?: number };
  // recipient.name is confirmed live; full_name kept as fallback.
  recipient: {
    name?: string;
    full_name?: string;
    description?: string;
    age?: number;
    gender?: string;
    ethnicity?: string;
    hair?: string;
    eyes?: string;
    height1?: string;
    height2?: string;
    weight?: string;
    relationship?: string;
  };
  service_instructions?: string;
  court_case?: { number?: string; id?: number; plaintiff?: string; defendant?: string };
  due_date?: string;
  // ServeManager returns rush as a boolean or 0/1 integer depending on API version.
  rush?: boolean | number;
  addresses?: Array<{
    primary?: boolean; address1?: string; address2?: string;
    city?: string; state?: string; postal_code?: string;
    lat?: number; lng?: number; latitude?: number; longitude?: number;
    label?: string; county?: string;
  }>;
  // documents confirmed live 2026-08-08: includes id, title, pdf_download_url,
  // signed, document_type. The /jobs list returns these fields inline on the job.
  documents?: Array<{
    id?: number;
    title?: string;
    pdf_download_url?: string;
    signed?: boolean;
    document_type?: string;
    affidavit?: boolean;
    created_at?: string;
    updated_at?: string;
  }>;
  attempt_count?: number;
  // Attempts embedded on the job resource (no separate /jobs/:id/attempts endpoint).
  attempts?: Array<{
    id?: string | number;
    description?: string;
    success?: boolean;
    service_status?: string;
    serve_type?: string;
    served_at?: string;
    lat?: number;
    lng?: number;
    latitude?: number;
    longitude?: number;
    gps_timestamp?: string;
    server_name?: string;
    // employee_process_server uses first_name/last_name (confirmed live 2026-08-09
    // for in-house serves); external servers use process_server_contact.name.
    employee_process_server?: { first_name?: string; last_name?: string; name?: string };
    recipient_name?: string;
    attachments?: unknown[];
    created_at?: string;
    updated_at?: string;
  }>;
  process_server_company?: { name?: string };
  process_server_contact?: { name?: string };
  employee_process_server?: { first_name?: string; last_name?: string };
  client_job_number?: string;
  attorney_name?: string;
  attorney_email?: string;
  created_at?: string;
  updated_at?: string;
  archived_at?: string;
  last_attempt_served_at?: string;
}

/**
 * Safety cap on the cursor walk, guarding against an infinite `links.next`
 * chain from a misbehaving API. At per_page=100 this is 10,000 jobs in one
 * cycle — far beyond any realistic `updated_since` window, so in practice it
 * never binds. It was 20 (2,000 jobs), and hitting it was INDISTINGUISHABLE
 * from a complete walk, which is what made truncation silently lossy.
 */
export const SM_MAX_PAGES = 100;

export interface FetchRecentJobsResult {
  jobs: SmJob[];
  /**
   * True only when the cursor chain was walked to its natural end. The caller
   * MUST NOT advance its `updated_since` watermark when this is false, or
   * every job it did not reach is skipped permanently.
   */
  complete: boolean;
  /**
   * The latest `updated_at` actually observed, or null when the batch carried
   * none. This — not wall-clock now() — is the only safe next cursor.
   */
  watermark: string | null;
  error?: string;
}

export interface FetchRecentJobsOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  maxPages?: number;
}

/**
 * Latest `updated_at` in a batch, compared by INSTANT rather than
 * lexicographically — ServeManager timestamps carry a zone offset, so string
 * ordering picks the wrong winner across zones. Returns the original string so
 * it round-trips back to the API unchanged.
 */
export function maxUpdatedAt(jobs: readonly SmJob[]): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const job of jobs) {
    const raw = job?.updated_at;
    if (!raw) continue;
    const ms = Date.parse(raw);
    if (!Number.isFinite(ms) || ms <= bestMs) continue;
    bestMs = ms;
    best = raw;
  }
  return best;
}

/**
 * Walks the `/jobs` cursor with an explicit API key. Split out from
 * fetchRecentJobs so the pagination and error-propagation contract is testable
 * without a D1 binding.
 *
 * Failure is PARTIAL, not total: jobs already read are returned alongside the
 * error. Every downstream write is an idempotent upsert, so processing them is
 * strictly better than discarding the work — as long as the caller honours
 * `complete` and leaves the watermark alone.
 */
export async function fetchRecentJobsWithKey(
  apiKey: string,
  since?: string,
  opts: FetchRecentJobsOptions = {},
): Promise<FetchRecentJobsResult> {
  const { fetchImpl, timeoutMs, maxRetries, retryDelayMs, maxPages = SM_MAX_PAGES } = opts;
  const allJobs: SmJob[] = [];
  const seen = new Set<number>();

  // SM supports per_page up to 100; use the max to minimise round-trips.
  const baseParams: Record<string, string> = { per_page: '100' };
  if (since) baseParams.updated_since = since;

  // The /jobs endpoint uses cursor-based pagination: the response envelope
  // includes `links.next` (a full URL) and `links.last`.
  let nextUrl: string | null = null;
  let page = 0;

  try {
    do {
      const result: any = await smRequest({
        path: '/jobs',
        absoluteUrl: nextUrl ?? undefined,
        params: nextUrl ? undefined : baseParams,
        apiKey, fetchImpl, timeoutMs, maxRetries, retryDelayMs,
      });

      // JSON:API-style `{ links: {...}, data: [...] }` envelope confirmed live.
      const jobs: SmJob[] = Array.isArray(result?.data)
        ? result.data
        : Array.isArray(result) ? result : [];

      for (const job of jobs) {
        if (job && !seen.has(job.id)) { seen.add(job.id); allJobs.push(job); }
      }

      nextUrl = result?.links?.next ?? null;
      page++;
    } while (nextUrl && page < maxPages);
  } catch (err) {
    const message = (err as Error).message || String(err);
    log.error('[sm-client] Job fetch failed', { page, partialJobs: allJobs.length }, err as Error);
    return { jobs: allJobs, complete: false, watermark: maxUpdatedAt(allJobs), error: message };
  }

  if (nextUrl) {
    // Cap reached with pages still outstanding. Report it loudly rather than
    // returning a truncated list that looks complete.
    const error = `ServeManager pagination stopped at the ${maxPages}-page cap with more pages available; watermark not advanced`;
    log.error('[sm-client] ' + error, { pages: page, jobs: allJobs.length });
    return { jobs: allJobs, complete: false, watermark: maxUpdatedAt(allJobs), error };
  }

  return { jobs: allJobs, complete: true, watermark: maxUpdatedAt(allJobs) };
}

/**
 * Key-resolving wrapper over fetchRecentJobsWithKey. A missing or undecryptable
 * key is a real, reportable condition — it used to collapse into an empty array
 * indistinguishable from "no new jobs".
 */
export async function fetchRecentJobs(
  db: D1Database,
  source: ServeManagerSecretSource,
  since?: string,
  opts: FetchRecentJobsOptions = {},
): Promise<FetchRecentJobsResult> {
  let key: string | null;
  try {
    key = await getStoredKey(db, source);
  } catch (err) {
    const message = (err as Error).message || 'Failed to read ServeManager API key';
    log.error('[sm-client] Job fetch failed: key unavailable', {}, err as Error);
    return { jobs: [], complete: false, watermark: null, error: message };
  }
  if (!key) {
    return { jobs: [], complete: false, watermark: null, error: 'ServeManager API key not configured' };
  }
  return fetchRecentJobsWithKey(key, since, opts);
}

// Single-job fetch for the manual "Create Dispatch" action — needs the
// freshest job data (not whatever's cached in sm_jobs) so the manually-
// created call captures current addresses/documents/case info. Singular
// resources use the same `{ data: {...} }` envelope confirmed on /account
// and every job's own `links.self` (a `/jobs/{id}` URL), just not wrapped
// in an array.
export async function fetchJobById(db: D1Database, source: ServeManagerSecretSource, jobId: number | string): Promise<SmJob | null> {
  let key: string | null;
  try {
    key = await getStoredKey(db, source);
  } catch (err) {
    console.error('[sm-client] Job-by-id fetch failed for', jobId, (err as Error).message);
    return null;
  }
  if (!key) return null;
  try {
    const result = await smGet(`/jobs/${jobId}`, key);
    return result?.data ?? null;
  } catch (err) {
    console.error('[sm-client] Job-by-id fetch failed for', jobId, (err as Error).message);
    return null;
  }
}

// There is no GET /jobs/:id/attempts endpoint (confirmed live 2026-08-09 —
// it 404s regardless of numeric job.id or servemanager_job_number). Attempts
// come embedded on the job resource returned by fetchRecentJobs, so this is
// a pure extractor, not an HTTP call. Kept as its own function so the
// (still-unverified, see SmJob.attempts) mapping is named and in one place.
export function extractJobAttempts(job: SmJob): NonNullable<SmJob['attempts']> {
  return job.attempts ?? [];
}

// ── Outbound: push a serve attempt back to ServeManager ──────

// Called when an RMPG officer logs a serve attempt so that ServeManager's
// own job timeline stays in sync without manual data entry on the SM side.
// Returns the created SM attempt id, or null on failure (non-fatal — the
// RMPG attempt already exists; SM is authoritative only for their timeline).
export async function pushAttemptToJob(
  db: D1Database,
  source: ServeManagerSecretSource,
  smJobId: number | string,
  attempt: {
    description?: string;
    success: boolean;
    serve_type?: string;
    served_at?: string;
    lat?: number | null;
    lng?: number | null;
    server_name?: string;
  },
): Promise<{ ok: true; id: number | string } | { ok: false; error: string }> {
  let key: string | null;
  try {
    key = await getStoredKey(db, source);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  if (!key) return { ok: false, error: 'API key not configured' };
  try {
    const url = new URL(`${SM_BASE_URL}/jobs/${smJobId}/attempts`);
    const body: Record<string, unknown> = {
      success: attempt.success,
      description: attempt.description ?? null,
    };
    if (attempt.serve_type) body.serve_type = attempt.serve_type;
    if (attempt.served_at) body.served_at = attempt.served_at;
    if (attempt.lat != null && attempt.lng != null) {
      body.lat = attempt.lat;
      body.lng = attempt.lng;
    }
    if (attempt.server_name) body.server_name = attempt.server_name;

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${key}:`)}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `SM returned ${res.status}: ${text}` };
    }
    const data: any = await res.json().catch(() => ({}));
    const id = data?.data?.id ?? data?.id;
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ── Outbound: upload a document (affidavit/receipt/etc.) to a SM job ─

// RMPG can generate signed affidavits/receipts; this pushes the binary to
// the corresponding ServeManager job so SM's own document list stays current.
// documentName should include the extension (e.g. "affidavit_signed.pdf").
export async function uploadDocumentToJob(
  db: D1Database,
  source: ServeManagerSecretSource,
  smJobId: number | string,
  documentName: string,
  documentBuffer: ArrayBuffer,
  contentType = 'application/pdf',
): Promise<{ ok: true; id: number | string } | { ok: false; error: string }> {
  let key: string | null;
  try {
    key = await getStoredKey(db, source);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  if (!key) return { ok: false, error: 'API key not configured' };
  try {
    const url = new URL(`${SM_BASE_URL}/jobs/${smJobId}/documents`);
    const form = new FormData();
    form.append('document[title]', documentName.replace(/\.[^.]+$/, ''));
    form.append(
      'document[file]',
      new Blob([documentBuffer], { type: contentType }),
      documentName,
    );
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: { Authorization: `Basic ${btoa(`${key}:`)}` },
      body: form,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `SM returned ${res.status}: ${text}` };
    }
    const data: any = await res.json().catch(() => ({}));
    const id = data?.data?.id ?? data?.id;
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ── Webhook signature verification ────────────────────────────

// ServeManager signs webhook POSTs per
// https://www.servemanager.com/api  (Authenticating Requests):
//
//   1. Base64-encode the raw JSON body bytes  →  hashed_payload
//   2. HMAC-SHA-256(secret_key, hashed_payload)
//   3. Base64-encode the HMAC digest
//
// The digest arrives in `X-SM-HMAC-SHA256` (value is the Base64 HMAC, sometimes
// shown as `x-sm-hmac-sha256=<b64>`). This is NOT GitHub-style
// `X-Hub-Signature-256: sha256=<hex>` of the raw body — that was the previous
// verifier, which 401'd every live SM delivery with `{"error":"Invalid signature"}`.
//
// Secret lives in system_config as `servemanager_webhook_secret` (plaintext —
// it's a shared secret from SM's webhook overview, not a user credential).
export function normalizeServeManagerSignature(signatureHeader: string | null | undefined): string | null {
  if (!signatureHeader) return null;
  const trimmed = signatureHeader.trim();
  if (!trimmed) return null;
  return trimmed
    .replace(/^x-sm-hmac-sha256=/i, '')
    .replace(/^sha256=/i, '')
    .trim() || null;
}

export function readServeManagerSignatureHeader(getHeader: (name: string) => string | undefined): string | null {
  return getHeader('X-SM-HMAC-SHA256')
    || getHeader('x-sm-hmac-sha256')
    || getHeader('X-ServeManager-Signature')
    || null;
}

export async function computeServeManagerSignature(
  payload: string,
  secret: string,
): Promise<string> {
  const enc = new TextEncoder();
  // Ruby's Base64.strict_encode64(request.raw_post) — UTF-8 bytes, no newlines.
  const hashedPayload = bytesToBase64(enc.encode(payload));
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(hashedPayload));
  return bytesToBase64(new Uint8Array(sig));
}

export async function verifyWebhookSignature(
  payload: string,
  signatureHeader: string | null,
  secret: string,
): Promise<boolean> {
  const expected = normalizeServeManagerSignature(signatureHeader);
  if (!expected || !secret) return false;
  try {
    const computed = await computeServeManagerSignature(payload, secret);
    return timingSafeEqual(computed, expected);
  } catch { return false; }
}

/** Pull ServeManager job ids out of the live webhook envelope (batched `data[]`). */
export function extractServeManagerJobIds(payload: unknown): number[] {
  const ids = new Set<number>();
  const add = (value: unknown) => {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) ids.add(value);
    else if (typeof value === 'string' && /^\d+$/.test(value)) ids.add(Number(value));
  };

  if (!payload || typeof payload !== 'object') return [];
  const body = payload as Record<string, unknown>;

  // Legacy single-object shape (never observed from SM, kept for tests/admin echo).
  const nested = body.data;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const row = nested as Record<string, unknown>;
    add(row.id);
    const job = row.job;
    if (job && typeof job === 'object') add((job as Record<string, unknown>).id);
    add(row.job_id);
  }

  const rows = Array.isArray(nested) ? nested
    : Array.isArray(body.jobs) ? body.jobs
    : [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as Record<string, unknown>;
    if (rec.type === 'job') add(rec.id);
    add(rec.job_id);
  }

  return [...ids];
}

export { getStoredKey };
