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

// SM API returns paginated results via `links.next` cursor. The original code
// fetched exactly one page of 50 and silently dropped jobs beyond that on every
// poll cycle. This iterates through all pages, deduplicating by job id.
export async function fetchRecentJobs(db: D1Database, jwtSecret: string, since?: string): Promise<SmJob[]> {
  const key = await getStoredKey(db, jwtSecret);
  if (!key) return [];
  try {
    const allJobs: SmJob[] = [];
    const seen = new Set<number>();
    // SM supports per_page up to 100; use the max to minimise round-trips.
    const baseParams: Record<string, string> = { per_page: '100' };
    if (since) baseParams.updated_since = since;

    // The /jobs endpoint uses cursor-based pagination: the response envelope
    // includes `links.next` (a full URL) and `links.last`. We follow `next`
    // until it is null or we have fetched 2000 jobs (safety cap to prevent an
    // infinite loop against a misbehaving API).
    let nextUrl: string | null = null;
    let page = 0;
    const MAX_PAGES = 20;

    do {
      let result: any;
      if (nextUrl) {
        // nextUrl is a full absolute URL; extract path+query and call smGet.
        const parsed = new URL(nextUrl);
        const path = parsed.pathname.replace(/^\/api/, '');
        const params: Record<string, string> = {};
        parsed.searchParams.forEach((v, k) => { params[k] = v; });
        result = await smGet(path, key, params);
      } else {
        result = await smGet('/jobs', key, baseParams);
      }

      // JSON:API-style `{ links: {...}, data: [...] }` envelope confirmed live.
      const jobs: SmJob[] = Array.isArray(result?.data)
        ? result.data
        : Array.isArray(result) ? result : [];

      for (const job of jobs) {
        if (!seen.has(job.id)) { seen.add(job.id); allJobs.push(job); }
      }

      nextUrl = result?.links?.next ?? null;
      page++;
    } while (nextUrl && page < MAX_PAGES);

    return allJobs;
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

// ── Outbound: push a serve attempt back to ServeManager ──────

// Called when an RMPG officer logs a serve attempt so that ServeManager's
// own job timeline stays in sync without manual data entry on the SM side.
// Returns the created SM attempt id, or null on failure (non-fatal — the
// RMPG attempt already exists; SM is authoritative only for their timeline).
export async function pushAttemptToJob(
  db: D1Database,
  jwtSecret: string,
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
  const key = await getStoredKey(db, jwtSecret);
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
  jwtSecret: string,
  smJobId: number | string,
  documentName: string,
  documentBuffer: ArrayBuffer,
  contentType = 'application/pdf',
): Promise<{ ok: true; id: number | string } | { ok: false; error: string }> {
  const key = await getStoredKey(db, jwtSecret);
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

// ServeManager signs webhook payloads with HMAC-SHA-256. The signature is
// in the `X-ServeManager-Signature` header as `sha256=<hex>`. The secret
// is stored in system_config as `servemanager_webhook_secret` (plaintext —
// it's a shared secret supplied by SM, not a user credential, so it doesn't
// need AES-GCM wrapping, matching the pattern used by the Fleet.io webhook).
export async function verifyWebhookSignature(
  payload: string,
  signatureHeader: string | null,
  secret: string,
): Promise<boolean> {
  if (!signatureHeader || !secret) return false;
  try {
    const expected = signatureHeader.replace(/^sha256=/, '');
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
    const computed = bytesToHex(new Uint8Array(sig));
    // Constant-time comparison
    if (computed.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < computed.length; i++) {
      diff |= computed.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    return diff === 0;
  } catch { return false; }
}

export { getStoredKey };
