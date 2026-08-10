// ============================================================
// RMPG Flex — ServeManager API Client (Cloudflare Worker)
// ============================================================
// Handles API key storage/encryption and HTTP calls to
// ServeManager's REST API. All SM calls go through this module.
// Key is stored in D1 config, encrypted with Web Crypto AES-256-GCM.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { queryFirst, execute } from './db';

const SM_BASE_URL = 'https://www.servemanager.com/api';

// ── Crypto helpers (no Buffer in Workers — use Uint8Array) ───

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  return bytes;
}

async function deriveKey(jwtSecret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(jwtSecret));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
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

async function decryptApiKey(stored: string, jwtSecret: string): Promise<string> {
  const key = await deriveKey(jwtSecret);
  const parts = stored.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted API key format');
  const iv = hexToBytes(parts[0]);
  const authTag = hexToBytes(parts[1]);
  const ct = hexToBytes(parts[2]);
  const combined = new Uint8Array(ct.length + 16);
  combined.set(ct, 0);
  combined.set(authTag, ct.length);
  try {
    const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, combined);
    return new TextDecoder().decode(dec);
  } catch { throw new Error('Decryption failed — key may have changed or data is corrupted'); }
}

// ── Key storage ───────────────────────────────────────────────

async function getStoredKey(db: D1Database, jwtSecret: string): Promise<string | null> {
  try {
    const row = await queryFirst<{ config_value: string }>(
      db,
      "SELECT config_value FROM system_config WHERE config_key = 'servemanager_api_key' AND category = 'integrations' AND is_active = 1 LIMIT 1",
    );
    if (row?.config_value) return decryptApiKey(row.config_value, jwtSecret);
  } catch (err) {
    console.error('[sm-client] Failed to decrypt API key:', (err as Error).message);
  }
  return null;
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

async function smGet(path: string, apiKey: string, params?: Record<string, string>): Promise<any> {
  const url = new URL(`${SM_BASE_URL}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  // ServeManager auth is HTTP Basic — the API key is the username, password is
  // EMPTY (https://servemanager.com/api#authentication). `X-Auth-Token` is not
  // a header ServeManager recognizes at all; every request using it 401s with
  // "HTTP Basic: Access denied" regardless of how valid the key is.
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Basic ${btoa(`${apiKey}:`)}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`ServeManager API returned ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}

// documents_json's `pdf_download_url` (e.g.
// https://www.servemanager.com/api/documents/50457080/download) is
// ServeManager's OWN authenticated API endpoint, not a public link — the
// browser has no ServeManager credentials, so linking to it directly from
// the client 401s. This proxies the binary through the Worker with the
// same Basic-Auth pattern smGet() uses for JSON.
export async function fetchDocumentBinary(
  db: D1Database, jwtSecret: string, documentId: number | string,
): Promise<{ ok: true; contentType: string; body: ArrayBuffer } | { ok: false; status: number; error: string }> {
  const key = await getStoredKey(db, jwtSecret);
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

export async function testConnection(db: D1Database, jwtSecret: string): Promise<{ success: boolean; account?: any; error?: string }> {
  const key = await getStoredKey(db, jwtSecret);
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
  // Every `job.job_number` read was reading a field that never existed
  // ("ServeManager Job #undefined" landed in a created call's
  // description, and Job # showed blank in the Cached Jobs table), which
  // #3350's `?? null` fallback correctly null-coalesced but didn't fix —
  // it just stopped the D1_TYPE_ERROR on binding a raw `undefined`.
  servemanager_job_number?: string;
  job_status?: string;
  service_status?: string;
  // The real /jobs list payload (confirmed live 2026-08-08) has no
  // top-level `client` object at all — the client company lives under
  // `client_company.name` (a JSON:API-style nested resource; there is
  // also a separate, usually-null `client_contact`). `client` never
  // existed, so every read of `job.client?.company_name` silently
  // evaluated to undefined.
  client_company?: { name?: string };
  // The real /jobs list payload (confirmed live 2026-08-08) uses
  // `recipient.name`, not `recipient.full_name` — `full_name` is kept as a
  // fallback in case a different endpoint/version uses it.
  recipient: { name?: string; full_name?: string; description?: string };
  service_instructions?: string;
  // Confirmed live 2026-08-08: there is no top-level `court_case_number` —
  // the case number lives under the nested `court_case.number` resource.
  court_case?: { number?: string };
  due_date?: string;
  rush?: number;
  addresses?: Array<{
    primary?: boolean; address1?: string; address2?: string;
    city?: string; state?: string; postal_code?: string;
    lat?: number; lng?: number; latitude?: number; longitude?: number;
  }>;
  documents?: Array<{ title?: string }>;
  attempts_count?: number;
  // There is no separate GET /jobs/:id/attempts collection endpoint —
  // confirmed live 2026-08-09, it 404s (plain HTML error page, not even
  // JSON) regardless of whether the numeric job.id or
  // servemanager_job_number is used. Attempts are embedded directly on
  // the job resource instead. Field names below are ServeManager's own
  // per its object-naming conventions elsewhere (id/description/
  // success/service_status/serve_type mirror the job's own fields), but
  // unverified against a real non-empty sample — the one live job
  // checked has zero attempts (attempt_count: 0, attempts: []) because
  // it hasn't been served yet. Re-verify once any job accrues one.
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
    employee_process_server?: { name?: string; full_name?: string };
    recipient_name?: string;
    attachments?: unknown[];
    created_at?: string;
    updated_at?: string;
  }>;
  // Confirmed live 2026-08-09: there is no top-level `process_server` field.
  // The real job-level fields are process_server_company (external company)
  // and process_server_contact (external individual) — both null on the one
  // live job checked, an in-house serve, so their sub-shape is unconfirmed
  // and mirrors client_company/client_contact's confirmed `.name` pattern —
  // plus employee_process_server, which IS populated for in-house serves
  // and uses first_name/last_name (an object shape distinct from the other
  // "name" resources; confirmed live with a real employee record).
  process_server_company?: { name?: string };
  process_server_contact?: { name?: string };
  employee_process_server?: { first_name?: string; last_name?: string };
  // Confirmed live 2026-08-09: exists as a top-level field, observed "" on
  // the one job checked (genuinely blank, not a mapping gap).
  client_job_number?: string;
  // Confirmed present as top-level keys in the full key list captured
  // 2026-08-08 (attorney_name, attorney_email), but their values were never
  // sampled — the one live job checked has no attorney on file. Used for
  // the manual "Create Dispatch" action's pso_requestor_name/email so the
  // requesting attorney (not just the client company) is captured when
  // present; re-verify the shape once a job with a real attorney syncs.
  attorney_name?: string;
  attorney_email?: string;
  updated_at?: string;
}

export async function fetchRecentJobs(db: D1Database, jwtSecret: string, since?: string): Promise<SmJob[]> {
  const key = await getStoredKey(db, jwtSecret);
  if (!key) return [];
  try {
    const params: Record<string, string> = { per_page: '50' };
    if (since) params.updated_since = since;
    const result = await smGet('/jobs', key, params);
    // ServeManager wraps every response — list endpoints included — in a
    // JSON:API-style `{ links: {...}, data: [...] }` envelope (confirmed
    // live 2026-08-08 against the production account's real job data).
    // There is no top-level `jobs` key, so `result?.jobs` was always
    // undefined and every sync silently returned 0 jobs even with a valid
    // key and real jobs in the account.
    return Array.isArray(result?.data) ? result.data : Array.isArray(result) ? result : [];
  } catch (err) {
    console.error('[sm-client] Job fetch failed:', (err as Error).message);
    return [];
  }
}

// Single-job fetch for the manual "Create Dispatch" action — needs the
// freshest job data (not whatever's cached in sm_jobs) so the manually-
// created call captures current addresses/documents/case info. Singular
// resources use the same `{ data: {...} }` envelope confirmed on /account
// and every job's own `links.self` (a `/jobs/{id}` URL), just not wrapped
// in an array.
export async function fetchJobById(db: D1Database, jwtSecret: string, jobId: number | string): Promise<SmJob | null> {
  const key = await getStoredKey(db, jwtSecret);
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

export { getStoredKey };
