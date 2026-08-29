// ============================================================
// RMPG Flex — Recipient Receipt of Service + Court Document Release
//
// Two routers, deliberately split by audience:
//
//   serveReceipt      → /api/serve-receipt  (auth: 'public')
//       The RECIPIENT's surface. Reached by scanning the QR printed on
//       the Call for Service report / run sheet before shift initiation.
//       The token in the URL IS the credential — there is no session and
//       never will be one (the signer is a member of the public, often a
//       defendant). Same posture as mobileCfs.ts, but stricter: that
//       token is officer-facing and multi-scan; this one is BURNED on the
//       first successful signature so a receipt cannot be re-signed.
//
//   serveReceiptAdmin → /api/serve-receipts (auth: 'required')
//       The OFFICER/agency surface: mint tokens, read signed receipts,
//       void a receipt.
//
// SECURITY NOTES (read before editing):
//   * The public router returns the MINIMUM needed to sign — party names,
//     address of service, document titles. It must never grow to return
//     case narrative, officer notes, prior attempts, or other jobs. A
//     defendant holds this credential.
//   * Rate limited per-IP on both GET and POST; the token is guessable
//     only at 2^192, but scans_used/max_scans caps abuse of a real one.
//   * Signatures are base64 PNG data URLs (same convention as
//     serve_attempts.signature_data), size-capped below.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { recordAudit } from '../utils/auditLog';
import { requireRole } from '../middleware/auth';
import { rateLimitAllow } from '../utils/rateLimit';
import { log } from '../utils/logger';
import { clientIp } from '../utils/requestIp';
import { upsertPersonFromAos, storeIdPhotos, linkReceiptToPerson } from '../utils/serveReceiptPersons';
import { formatServiceAddress } from '../utils/formatServiceAddress';
import { broadcastAll } from './ws';

const PUBLIC_APP_URL = 'https://rmpgutah.us';

/** Default life of a printed QR. Printed sheets outlive their usefulness. */
const DEFAULT_TOKEN_TTL_DAYS = 30;

/** Max size of a single base64 signature payload (~500 KB, matches
 *  users.digital_signature's cap in src/routes/auth.ts). */
const MAX_SIGNATURE_BYTES = 500_000;
const MAX_PAGE_IMAGE_BYTES = 2_000_000;
const MAX_ID_PHOTO_BYTES = 2_000_000;

// ── Helpers ─────────────────────────────────────────────────

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Salted SHA-256 of the caller IP. We keep a correlator for abuse
 *  investigation without storing a member of the public's raw IP. */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Salted, VERSIONED hash of the caller IP.
 *
 * The salt is JWT_SECRET, which can be rotated. Two hashes computed under
 * different salts are not comparable, and without a marker that difference
 * is invisible: an investigator would simply see records that never
 * correlate and conclude the addresses differed. The 4-hex salt
 * fingerprint prefix makes a rotation obvious at a glance instead.
 */
async function hashIp(ip: string, salt: string): Promise<string> {
  const saltId = (await sha256Hex(salt)).slice(0, 4);
  const body = (await sha256Hex(`${salt}:${ip}`)).slice(0, 28);
  return `${saltId}:${body}`;
}


/** Reject anything that isn't a plausibly-sized PNG data URL. */
/**
 * Does the base64 body actually decode, and does it start with a real
 * PNG or JPEG header?
 *
 * The pattern test alone accepts a truncated write — a payload cut short
 * by a dropped connection still matches `data:image/png;base64,[A-Za-z0-9+/=]+`
 * and only fails when someone tries to PRINT the instrument, potentially
 * years later in front of a judge. Checking the magic bytes catches it at
 * write time, where the signer is still standing there and can sign again.
 *
 * Header only — decoding a 500KB payload in full on every submission to
 * validate pixels nobody will look at is not a good trade.
 */
function decodesToImage(dataUri: string): boolean {
  const comma = dataUri.indexOf(',');
  if (comma < 0) return false;
  const head = dataUri.slice(comma + 1, comma + 33);
  try {
    const bytes = Uint8Array.from(atob(head), (ch) => ch.charCodeAt(0));
    if (bytes.length < 4) return false;
    // PNG: 89 50 4E 47 ("\x89PNG").  JPEG: FF D8 FF.
    const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    return png || jpeg;
  } catch {
    return false;   // not valid base64 at all
  }
}

/**
 * Does this base64 payload actually begin a PDF?
 *
 * The email endpoint takes `pdf_base64` from the token holder and mails it
 * as an attachment FROM THE ASSIGNED OFFICER'S MAILBOX. Nothing checked
 * that the bytes were a PDF, so any 6 MB payload — HTML, a script, an
 * executable — could leave an RMPG mailbox under an RMPG subject line,
 * carrying whatever filename the caller chose.
 *
 * Header-only, like decodesToImage: the cost is constant, and the goal is
 * to reject payloads that are not the type claimed, not to validate PDF
 * structure. A well-formed PDF can still hold anything, which is why the
 * per-IP rate limit stays.
 */
export function decodesToPdf(base64: string): boolean {
  try {
    const bytes = Uint8Array.from(atob(base64.slice(0, 12)), (ch) => ch.charCodeAt(0));
    // "%PDF-" — the header every PDF opens with (ISO 32000-1 §7.5.2).
    return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44
      && bytes[3] === 0x46 && bytes[4] === 0x2d;
  } catch {
    return false;   // not valid base64 at all
  }
}

function validSignature(v: unknown): v is string {
  // PNG and JPEG only, not `data:image/*`. SVG is an image by that test
  // and can carry script; this value is rendered back into an officer's
  // DOM and embedded in a PDF, so the permissive form was a stored-XSS
  // vector wearing a signature's clothes.
  return typeof v === 'string'
    && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(v)
    && v.length > 100
    && v.length <= MAX_SIGNATURE_BYTES
    && decodesToImage(v);
}

/** Validates a scanned page image (e.g. summons page photo). Same rules as
 *  signature but with a 2 MB cap — page photos are larger than signatures. */
export function validPageImage(v: unknown): v is string {
  return typeof v === 'string'
    && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(v)
    && v.length > 100
    && v.length <= MAX_PAGE_IMAGE_BYTES
    && decodesToImage(v);
}

/** Validates a captured ID photo (front or back of a driver licence / govt ID).
 *  PNG or JPEG only, 2 MB cap. */
export function validIdPhoto(v: unknown): v is string {
  return typeof v === 'string'
    && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(v)
    && v.length > 100
    && v.length <= MAX_ID_PHOTO_BYTES
    && decodesToImage(v);
}

/**
 * Is this the unique-index violation from 0209 — a second signed
 * acknowledgement for a job that already has one?
 *
 * Three independent write paths exist (subject's phone, transcribed
 * paper, officer-attested refusal). The token burn stops one of them
 * running twice; it does nothing about two DIFFERENT paths firing for
 * the same doorstep. The database now refuses, and this turns the raw
 * constraint error into something an officer can act on instead of a
 * 500 they will simply retry.
 */
export function isDuplicateSignedReceipt(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err ?? '');
  return /UNIQUE constraint failed/i.test(m) && /idx_serve_receipts_one_signed|serve_receipts/i.test(m);
}

const DUPLICATE_MESSAGE =
  'This job already has a signed acknowledgement. Void the existing one first '
  + 'if it was recorded in error.';

function bool(v: unknown): number {
  return v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0;
}

/**
 * Serialise a bounded list to JSON, with an aggregate ceiling.
 *
 * Per-item caps alone leave the total unbounded: 50 documents at 200
 * characters plus 20 attestations at 600 is 20KB of JSON in a column
 * nothing was sizing for. Truncating the LIST rather than the string
 * keeps the result parseable — a JSON blob cut mid-token is worse than a
 * short one, because it fails at read time on a legal record instead of
 * at write time where someone can see it.
 */
/**
 * Check character for the scan-to-retrieve barcode.
 *
 * `RMPG-AOS:4471` has no redundancy, so a single misread digit resolves
 * to a DIFFERENT REAL RECEIPT and the clerk has no way to know. A mod-36
 * check over the digits turns that from a silent wrong answer into a
 * refusal to resolve, which is the only acceptable failure mode when the
 * thing being looked up is a legal record.
 */
export function receiptBarcodeCheck(receiptId: number): string {
  const sum = String(receiptId).split('').reduce((n, d, i) => n + Number(d) * (i + 2), 0);
  return (sum % 36).toString(36).toUpperCase();
}

export function boundedJson<T>(items: T[], maxItems: number, maxBytes: number): string {
  let out = items.slice(0, maxItems);
  let json = JSON.stringify(out);
  while (json.length > maxBytes && out.length > 1) {
    out = out.slice(0, out.length - 1);
    json = JSON.stringify(out);
  }
  return json;
}

function str(v: unknown, max = 500): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

// ── Form variants ───────────────────────────────────────────
// One form, four printed variations. MIRRORS
// client/src/utils/serveReceiptVariant.ts — there is no shared build
// between /src and /client/src, so the logic is duplicated on purpose.
// THIS COPY IS AUTHORITATIVE: the client's answer is treated as a hint
// and re-derived here before storage, because the client is a public,
// unauthenticated page and its POST body is fully attacker-controlled.
// A signer could otherwise claim the (Individual) variant — which has
// no authority attestation — while accepting on someone else's behalf.
export type ReceiptVariant = 'individual' | 'co_habitant' | 'business' | 'substitute';

export const VARIANT_LABEL: Record<ReceiptVariant, string> = {
  individual: 'Individual',
  co_habitant: 'Co-Habitant',
  business: 'Business',
  substitute: 'Substitute Service',
};

/**
 * Does this party name denote a legal ENTITY rather than a human?
 * Mirrors isEntityName in client/src/utils/serveReceiptVariant.ts.
 *
 * A registered agent signed a real service on 2026-07-27 answering "yes,
 * I am the named party" for "Chase Partners Ltd, ... SDP REIT LLC,
 * ISAOA". The client now withholds that question for an entity; the
 * server enforces it, because the client is public and its POST body is
 * attacker-controlled.
 */
const ENTITY_MARKERS = [
  'llc', 'l.l.c', 'inc', 'incorporated', 'corp', 'corporation', 'ltd', 'limited',
  'lp', 'llp', 'l.p', 'pllc', 'pc', 'company', 'co.', 'trust', 'partners',
  'partnership', 'associates', 'holdings', 'group', 'isaoa', 'atima', 'n.a.',
  'bank', 'foundation', 'institute', 'authority', 'district', 'university',
];

export function isEntityName(name: string | null | undefined): boolean {
  if (!name) return false;
  const t = ` ${name.toLowerCase().replace(/[,]/g, ' ')} `;
  return ENTITY_MARKERS.some((m) => t.includes(` ${m} `) || t.includes(` ${m}. `));
}

export function resolveReceiptVariant(i: {
  isNamedParty: boolean;
  premisesType: string | null;
  residesAtAddress: boolean;
  authorizedAgent: boolean;
  /** The party the process names, when known — an entity can never sign. */
  namedParty?: string | null;
}): ReceiptVariant {
  if (i.isNamedParty && !isEntityName(i.namedParty)) return 'individual';
  if (i.premisesType === 'business' || i.authorizedAgent) return 'business';
  if (i.residesAtAddress) return 'co_habitant';
  return 'substitute';
}

export function receiptFormTitle(v: ReceiptVariant): string {
  return `Acknowledgement of Service Form (${VARIANT_LABEL[v]})`;
}

/**
 * What the process server records on the MDT at the door, before the
 * form is handed over in either direction.
 *
 * This PRE-SELECTS the variation and pre-fills the subject's form. It
 * does not decide it. The declarations are the signer's own statements,
 * so the signer's answers stay authoritative — where the two disagree we
 * record the disagreement rather than overwrite it, because an officer
 * reading a doorstep and a person describing their own household are two
 * different kinds of evidence and a supervisor should see both.
 */
export interface ServeReceiptPrefill {
  /** null = officer could not tell; the subject answers it themselves. */
  is_named_party: boolean | null;
  premises_type: 'residence' | 'business' | 'other';
  resides_at_address: boolean;
  authorized_agent: boolean;
  recipient_name: string | null;
  recipient_relationship: string | null;
  business_name: string | null;
  recipient_job_title: string | null;
  /** What was actually handed over — the officer knows, the subject may not. */
  documents: Array<{ title: string; copies: number }>;
  note: string | null;
}

export interface ServeReceiptSubmission {
  variant: ReceiptVariant;
  recipient_name: string | null;
  recipient_phone: string | null;
  recipient_email: string | null;
  recipient_id_verified: number;
  business_name: string | null;
  recipient_age_confirmed: number;
  ack_received_documents: number;
  ack_information_true: number;
  recipient_signature: unknown;
  sub_resides_at_address: number;
  sub_is_authorized_agent: number;
  sub_agrees_to_deliver: number;
  sub_release_acknowledged: number;
  sub_defendant_name: string | null;
  id_scan_method: 'barcode' | 'manual' | null;
  aamva_data: Record<string, unknown> | null;
  manual_id: Record<string, unknown> | null;
  id_front_image: unknown;
  id_back_image: unknown;
  recipient_address_current: Record<string, unknown> | null;
  recipient_relationship: string | null;
}

/**
 * Gate on whether a submission is legally complete enough to record.
 *
 * ── THIS IS THE POLICY DECISION IN THIS FILE ────────────────
 * Everything else here is plumbing; this function decides what RMPG is
 * willing to put its name on. The rules below encode Utah R. Civ. P.
 * 4(d)(1): service on someone other than the named party requires a
 * person of suitable age and discretion who RESIDES at the dwelling —
 * or, at a business, an agent authorized to receive service.
 *
 * Deliberately strict choices you may want to loosen:
 *   - `sub_agrees_to_deliver` is REQUIRED on every non-individual
 *     variant. The rule itself does not condition validity on the
 *     substitute's promise; service is complete when the papers are
 *     left. Requiring it here means a co-resident who refuses to
 *     promise blocks the form — arguably correct for an *acknowledgment
 *     and release* (we're documenting an undertaking, not the service
 *     itself), but it does mean the officer falls back to a
 *     posting/attempt record in that case.
 *   - Age is self-attested, not verified. Tightening to require
 *     `recipient_id_verified` would be more defensible in a contested
 *     hearing but will stall routine serves.
 *   - The (Substitute Service) variant does NOT require the authority
 *     statement, because by construction the signer neither resides nor
 *     works there — asking them to affirm it would be asking for a
 *     false statement. The delivery undertaking carries the weight.
 *
 * Returns an operator-readable reason, or null when the submission passes.
 */
export function validateReceiptSubmission(s: ServeReceiptSubmission): string | null {
  if (!s.recipient_name) return 'Your name is required';
  // Required per operator instruction on the 2026-07-27 service. A proof
  // of service whose signer cannot be reached afterwards is hard to stand
  // behind if the service is ever contested.
  if (!s.recipient_phone) return 'A phone number is required';
  if (!s.recipient_email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.recipient_email)) {
    return 'A valid email address is required';
  }
  // ID verified via barcode scan OR manual entry with at least a front photo
  if (!s.recipient_id_verified && s.id_scan_method !== 'manual') {
    return 'Please scan your ID or enter your information manually';
  }
  if (!validSignature(s.recipient_signature)) return 'A signature is required';
  if (!s.recipient_age_confirmed) return 'You must confirm you are an adult over the age of eighteen';
  if (!s.ack_received_documents) return 'You must acknowledge receiving the documents';
  if (!s.ack_information_true) return 'You must attest the information is true and correct';

  if (s.variant === 'individual') return null;

  if (!s.sub_defendant_name) {
    return 'The individual or business the documents are intended for is required';
  }
  if (!s.sub_agrees_to_deliver) {
    return 'You must agree to deliver the documents to the individual or business named';
  }
  if (!s.sub_release_acknowledged) {
    return 'You must acknowledge that you are accepting on their behalf';
  }
  if (s.variant === 'business') {
    // sub_defendant_name is the entity named in the process. A signer who
    // ticks "authorized to accept" at a RESIDENCE resolves here — a
    // registered agent working from home — and has no separate business
    // name to give. Falling back keeps that real case fillable; only a
    // submission with NEITHER is genuinely incomplete.
    if (!s.business_name && !s.sub_defendant_name) return 'The business name is required';
    if (!s.sub_resides_at_address && !s.sub_is_authorized_agent) {
      return 'You must be an employee of, or authorized to accept service at, this address';
    }
  }
  if (s.variant === 'co_habitant' && !s.sub_resides_at_address) {
    return 'You must be a resident of the address for service';
  }
  return null;
}

interface TokenRow {
  id: number;
  serve_queue_id: number;
  expires_at: string | null;
  scans_used: number;
  max_scans: number;
  revoked_at: string | null;
  used_receipt_id: number | null;
  prefill_json: string | null;
  prefill_variant: string | null;
}

type TokenFailure = { code: string; message: string; http: 400 | 404 | 409 | 410 | 429 };

/** Resolve + validate a printed token. Never distinguishes "no such
 *  token" from "wrong token" beyond a flat 404 — no enumeration signal. */
async function resolveToken(
  db: D1Database,
  token: string,
): Promise<{ row: TokenRow } | { error: TokenFailure }> {
  if (!token || token.length < 16 || token.length > 64) {
    return { error: { code: 'invalid_token', message: 'This link is not valid.', http: 404 } };
  }
  const row = await queryFirst<TokenRow>(
    db,
    `SELECT id, serve_queue_id, expires_at, scans_used, max_scans, revoked_at, used_receipt_id,
            prefill_json, prefill_variant
       FROM serve_receipt_tokens WHERE token = ?`,
    token,
  );
  if (!row) {
    return { error: { code: 'invalid_token', message: 'This link is not valid.', http: 404 } };
  }
  if (row.revoked_at) {
    return { error: { code: 'revoked', message: 'This link has been revoked. Please ask the process server for a new one.', http: 410 } };
  }
  if (row.used_receipt_id) {
    return { error: { code: 'already_signed', message: 'This receipt has already been signed.', http: 409 } };
  }
  if (row.expires_at && Date.parse(`${row.expires_at.replace(' ', 'T')}Z`) < Date.now()) {
    return { error: { code: 'expired', message: 'This link has expired. Please ask the process server for a new one.', http: 410 } };
  }
  if (row.scans_used >= row.max_scans) {
    return { error: { code: 'scan_limit', message: 'This link has been opened too many times. Please ask the process server for a new one.', http: 410 } };
  }
  return { row };
}

// ============================================================
// PUBLIC ROUTER — /api/serve-receipt
// ============================================================

export const serveReceipt = new Hono<Env>();

/**
 * GET /api/serve-receipt/:token
 * Challenge. Returns only what the form needs to render.
 */
serveReceipt.get('/:token', async (c) => {
  const ip = clientIp(c);
  if (!(await rateLimitAllow(c.env.KV, `serve-receipt:ip:${ip}`, 60, 300))) {
    return c.json({ ok: false, code: 'rate_limited', message: 'Too many requests. Please wait a moment.' }, 429);
  }

  const db = getDb(c.env);
  const resolved = await resolveToken(db, c.req.param('token'));
  if ('error' in resolved) {
    return c.json({ ok: false, code: resolved.error.code, message: resolved.error.message }, resolved.error.http);
  }
  const tok = resolved.row;

  const job = await queryFirst<{
    id: number; case_number: string | null; court_name: string | null; jurisdiction: string | null;
    plaintiff_name: string | null; defendant_name: string | null; document_type: string | null;
    recipient_name: string | null; recipient_address: string | null; recipient_city: string | null;
    recipient_state: string | null; recipient_zip: string | null; status: string | null;
    assigned_officer_id: number | null; officer_id: number | null; created_by: number | null;
  }>(
    db,
    `SELECT id, case_number, court_name, jurisdiction, plaintiff_name, defendant_name,
            document_type, recipient_name, recipient_address, recipient_city,
            recipient_state, recipient_zip, status, assigned_officer_id, officer_id,
            created_by
       FROM serve_queue WHERE id = ?`,
    tok.serve_queue_id,
  );
  if (!job) {
    return c.json({ ok: false, code: 'invalid_token', message: 'This link is not valid.' }, 404);
  }

  // Document inventory — titles only, never the file contents or R2 keys.
  const docs = await query<{ file_name: string | null; doc_type: string | null }>(
    db,
    `SELECT file_name, doc_type FROM serve_intake_documents
      WHERE serve_queue_id = ? AND status != 'archived' ORDER BY id`,
    tok.serve_queue_id,
  ).catch(() => []);

  const officerId = job.assigned_officer_id ?? job.officer_id ?? job.created_by;
  // full_name is the NOT NULL column on users; first_name/last_name were
  // added later and are nullable, so preferring them leaves the process
  // server's name blank on the instrument for any account predating that
  // migration. Prefer full_name, fall back to the parts.
  const officer = officerId
    ? await queryFirst<{ full_name: string | null; first_name: string | null; last_name: string | null; badge_number: string | null }>(
        db,
        'SELECT full_name, first_name, last_name, badge_number FROM users WHERE id = ?',
        officerId,
      ).catch(() => null)
    : null;

  // NOT incremented here. This counter caps ABUSE of a real token, and a
  // page load is not abuse — a subject on a flaky doorstep connection who
  // reloads ten times would otherwise destroy their own link permanently,
  // with no way to tell them why. Counting is done on SUBMISSION, which is
  // the action worth capping.

  return c.json({
    ok: true,
    job: {
      id: job.id,
      case_number: job.case_number,
      court_name: job.court_name,
      jurisdiction: job.jurisdiction,
      plaintiff_name: job.plaintiff_name,
      defendant_name: job.defendant_name,
      document_type: job.document_type,
      recipient_name: job.recipient_name,
      service_address: job.recipient_address,
      service_city: job.recipient_city,
      service_state: job.recipient_state,
      service_zip: job.recipient_zip,
    },
    documents: docs.map((d) => ({
      title: d.file_name || d.doc_type || 'Court document',
      doc_type: d.doc_type,
    })),
    // The officer's doorstep read, so the subject's form opens with the
    // obvious answers already filled and the document list already
    // itemized. Every one of them stays editable: these are the
    // signer's declarations, and a pre-answered form they cannot correct
    // would be the officer's statement wearing the signer's signature.
    prefill: (() => {
      if (!tok.prefill_json) return null;
      try {
        return { ...JSON.parse(tok.prefill_json), variant: tok.prefill_variant ?? null };
      } catch {
        return null;
      }
    })(),
    server: officer
      ? {
          name: officer.full_name
            || [officer.first_name, officer.last_name].filter(Boolean).join(' ')
            || null,
          badge: officer.badge_number,
        }
      : null,
    agency: 'Rocky Mountain Protective Group',
  });
});

/**
 * POST /api/serve-receipt/:token
 * Submit the signed acknowledgment. Burns the token.
 */
serveReceipt.post('/:token', async (c) => {
  const ip = clientIp(c);
  if (!(await rateLimitAllow(c.env.KV, `serve-receipt-post:ip:${ip}`, 20, 300))) {
    return c.json({ ok: false, code: 'rate_limited', message: 'Too many requests. Please wait a moment.' }, 429);
  }

  // Per-TOKEN as well as per-IP. The IP bucket alone is defeated by
  // rotating addresses, and the thing worth protecting is one job's
  // signing link, not one network's fair share.
  const tokenParam = c.req.param('token');
  if (!(await rateLimitAllow(c.env.KV, `serve-receipt-post:tok:${tokenParam}`, 10, 600))) {
    return c.json({ ok: false, code: 'rate_limited', message: 'Too many attempts on this link.' }, 429);
  }

  const db = getDb(c.env);
  const resolved = await resolveToken(db, tokenParam);
  if ('error' in resolved) {
    return c.json({ ok: false, code: resolved.error.code, message: resolved.error.message }, resolved.error.http);
  }
  const tok = resolved.row;

  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ ok: false, code: 'bad_request', message: 'Invalid submission.' }, 400);

  // Re-derive the variant from the concrete facts rather than trusting
  // body.form_variant. See resolveReceiptVariant's comment: the client
  // is public and unauthenticated, so a submitted variant is a hint.
  const premisesType = str(body.premises_type, 30);
  const residesAtAddress = bool(body.sub_resides_at_address);
  const authorizedAgent = bool(body.sub_is_authorized_agent);
  const variant = resolveReceiptVariant({
    isNamedParty: str(body.form_variant, 30) === 'individual',
    premisesType,
    residesAtAddress: !!residesAtAddress,
    authorizedAgent: !!authorizedAgent,
    namedParty: str(body.sub_defendant_name, 200),
  });
  const formTitle = receiptFormTitle(variant);

  // Coarse legal category the rest of the serve subsystem understands.
  // 'personal' only for the named party signing for themselves; every
  // other variation is substitute service however it is titled.
  const method = variant === 'individual' ? 'personal' : 'substitute';

  const emailTo = str(body.recipient_email, 254);

  const submission: ServeReceiptSubmission = {
    variant,
    recipient_name: str(body.recipient_name, 200),
    recipient_phone: str(body.recipient_phone, 40),
    recipient_email: emailTo,
    recipient_id_verified: bool(body.recipient_id_verified),
    business_name: str(body.business_name, 200),
    recipient_age_confirmed: bool(body.recipient_age_confirmed),
    ack_received_documents: bool(body.ack_received_documents),
    ack_information_true: bool(body.ack_information_true),
    recipient_signature: body.recipient_signature,
    sub_resides_at_address: residesAtAddress,
    sub_is_authorized_agent: authorizedAgent,
    sub_agrees_to_deliver: bool(body.sub_agrees_to_deliver),
    sub_release_acknowledged: bool(body.sub_release_acknowledged),
    sub_defendant_name: str(body.sub_defendant_name, 200),
    id_scan_method: (str(body.id_scan_method, 20) as 'barcode' | 'manual' | null),
    aamva_data: (typeof body.aamva_data === 'object' && body.aamva_data) ? body.aamva_data as Record<string, unknown> : null,
    manual_id: (typeof body.manual_id === 'object' && body.manual_id) ? body.manual_id as Record<string, unknown> : null,
    id_front_image: body.id_front_image,
    id_back_image: body.id_back_image,
    recipient_address_current: (typeof body.recipient_address_current === 'object' && body.recipient_address_current) ? body.recipient_address_current as Record<string, unknown> : null,
    recipient_relationship: str(body.recipient_relationship, 120),
  };

  const idScanMethod = submission.id_scan_method;
  const aamvaData = submission.aamva_data;
  const manualId = submission.manual_id;
  const idFrontImage = submission.id_front_image;
  const idBackImage = submission.id_back_image;

  // Attestation sentences captured VERBATIM as shown to this signer.
  // Never regenerated server-side from current copy — editing the
  // wording later must not rewrite what past signers agreed to.
  const attRaw = Array.isArray(body.attestations) ? body.attestations : [];
  const attestations = attRaw.slice(0, 20).map((a: any) => ({
    id: String(a?.id ?? '').slice(0, 40),
    text: String(a?.text ?? '').slice(0, 600),
    accepted: bool(a?.accepted) === 1,
  })).filter((a) => a.id && a.text);

  const invalid = validateReceiptSubmission(submission);
  if (invalid) {
    return c.json({ ok: false, code: 'incomplete', message: invalid }, 400);
  }

  const serverSig = validSignature(body.server_signature) ? (body.server_signature as string) : null;
  const witnessSig = validSignature(body.witness_signature) ? (body.witness_signature as string) : null;

  const docsRaw = Array.isArray(body.documents) ? body.documents : [];
  const documents = docsRaw.slice(0, 50).map((d: any) => ({
    title: String(d?.title ?? 'Court document').slice(0, 200),
    copies: Number.isFinite(Number(d?.copies)) ? Math.max(1, Math.min(99, Number(d.copies))) : 1,
  }));

  const ipHash = await hashIp(ip, String(c.env.JWT_SECRET ?? 'salt'));

  // The job's status BEFORE this receipt advances it, so a later void can
  // restore what was actually there rather than guessing.
  const priorStatus = (await queryFirst<{ status: string | null }>(
    db, 'SELECT status FROM serve_queue WHERE id = ?', tok.serve_queue_id,
  ).catch(() => null))?.status ?? null;

  let ins;
  try {
    ins = await execute(
    db,
    `INSERT INTO serve_receipts (
       serve_queue_id, token_id, service_method, job_status_before,
       form_variant, form_title, attestations_json,
       recipient_name, recipient_role, recipient_relationship, recipient_phone,
       recipient_email, recipient_description, business_name, recipient_job_title,
       recipient_id_type, recipient_id_verified,
       recipient_age_confirmed,
       service_address, service_city, service_state, service_zip, premises_type,
       documents_json, document_count,
       sub_defendant_name, sub_resides_at_address, sub_is_authorized_agent,
       sub_agrees_to_deliver, sub_expected_delivery_at, sub_defendant_expected_at,
       sub_release_acknowledged, sub_declined_reason,
       ack_received_documents, ack_notice_read, ack_information_true,
       recipient_signature, recipient_signed_at,
       server_signature, server_name, server_badge, witness_name, witness_signature,
       latitude, longitude, accuracy_m, user_agent, ip_hash,
       device_fingerprint, screen_resolution, color_depth, timezone, language, languages,
       platform, hardware_concurrency, device_memory, max_touch_points, timezone_offset,
       email_to, email_status, notes
     ) VALUES (?,?,?,?, ?,?,?, ?,?,?,?, ?,?,?,?, ?,?, ?, ?,?,?,?,?, ?,?, ?,?,?, ?,?,?, ?,?, ?,?,?,
               ?, datetime('now'), ?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?,?, ?,?,?,?,?, ?,?,?)`,
    tok.serve_queue_id, tok.id, method, priorStatus,
    variant, formTitle, boundedJson(attestations, 20, 16_000),
    submission.recipient_name, variant, str(body.recipient_relationship, 120),
    str(body.recipient_phone, 40), emailTo, str(body.recipient_description, 300),
    submission.business_name, str(body.recipient_job_title, 120),
    str(body.recipient_id_type, 60), bool(body.recipient_id_verified),
    submission.recipient_age_confirmed,
    str(body.service_address, 250), str(body.service_city, 100), str(body.service_state, 2),
    str(body.service_zip, 10), premisesType,
    boundedJson(documents, 50, 8_000), documents.length,
    submission.sub_defendant_name, submission.sub_resides_at_address, submission.sub_is_authorized_agent,
    submission.sub_agrees_to_deliver, str(body.sub_expected_delivery_at, 40),
    str(body.sub_defendant_expected_at, 120),
    submission.sub_release_acknowledged, str(body.sub_declined_reason, 500),
    submission.ack_received_documents, bool(body.ack_notice_read), submission.ack_information_true,
    submission.recipient_signature as string,
    serverSig, str(body.server_name, 120), str(body.server_badge, 40),
    str(body.witness_name, 120), witnessSig,
    Number.isFinite(Number(body.latitude)) ? Number(body.latitude) : null,
    Number.isFinite(Number(body.longitude)) ? Number(body.longitude) : null,
    Number.isFinite(Number(body.accuracy_m)) ? Number(body.accuracy_m) : null,
    str(c.req.header('user-agent'), 300), ipHash,
    str(body.device_fingerprint, 128), str(body.screen_resolution, 20),
    Number.isFinite(Number(body.color_depth)) ? Number(body.color_depth) : null,
    str(body.timezone, 60), str(body.language, 20), str(body.languages, 200),
    str(body.platform, 300),
    Number.isFinite(Number(body.hardware_concurrency)) ? Number(body.hardware_concurrency) : null,
    Number.isFinite(Number(body.device_memory)) ? Number(body.device_memory) : null,
    Number.isFinite(Number(body.max_touch_points)) ? Number(body.max_touch_points) : null,
    Number.isFinite(Number(body.timezone_offset)) ? Number(body.timezone_offset) : null,
    emailTo, emailTo ? 'pending' : 'not_requested', str(body.notes, 1000),
    );
  } catch (err) {
    if (isDuplicateSignedReceipt(err)) {
      return c.json({ ok: false, code: 'already_signed', message: DUPLICATE_MESSAGE }, 409);
    }
    throw err;
  }

  const receiptId = Number(ins.meta.last_row_id);

  // Person upsert + ID photo storage — fire-and-forget via waitUntil.
  // A failure here must NOT block the receipt response: the signer is
  // standing at a door and the signature is the legally operative event.
  const bgTask = (async () => {
    try {
      const idData = aamvaData ?? manualId;
      if (!idData) return;

      const firstName = str(idData.first_name, 100);
      const lastName = str(idData.last_name, 100);
      if (!firstName || !lastName) return;

      const { personId, created } = await upsertPersonFromAos(db, {
        first_name: firstName,
        last_name: lastName,
        middle_name: str(idData.middle_name, 100),
        suffix: str(idData.suffix, 20),
        name_prefix: str(idData.name_prefix, 20),
        dob: str(idData.date_of_birth, 10) || str(idData.dob, 10),
        gender: str(idData.gender, 20),
        race: str(idData.race, 40),
        height: str(idData.height, 20),
        weight: str(idData.weight, 20),
        eye_color: str(idData.eye_color, 30),
        hair_color: str(idData.hair_color, 30),
        address: str(idData.address, 200),
        address2: str(idData.address2, 100),
        city: str(idData.city, 100),
        state: str(idData.state, 2),
        zip: str(idData.zip, 10),
        phone: str(body.recipient_phone, 40),
        email: str(body.recipient_email, 254),
        dl_number: str(idData.dl_number, 30),
        dl_state: str(idData.dl_state, 5),
        dl_class: str(idData.dl_class, 10),
        dl_expiry: str(idData.dl_expiry, 10),
        dl_issue_date: str(idData.dl_issue_date, 10),
        dl_restrictions: str(idData.dl_restrictions, 100),
        dl_endorsements: str(idData.dl_endorsements, 100),
        country: str(idData.country, 10),
        document_discriminator: str(idData.document_discriminator, 60),
        is_real_id: idData.is_real_id as boolean | null,
        is_organ_donor: idData.is_organ_donor as boolean | null,
        is_veteran: idData.is_veteran as boolean | null,
        under_18_until: str(idData.under_18_until, 10),
        under_21_until: str(idData.under_21_until, 10),
        aamva_version: typeof idData.aamva_version === 'number' ? idData.aamva_version : null,
        issuer_id: str(idData.issuer_id, 10),
        place_of_birth: str(idData.place_of_birth, 100),
        non_resident_indicator: idData.non_resident_indicator as boolean | null,
        limited_duration_doc: idData.limited_duration_doc as boolean | null,
        card_revision_date: str(idData.card_revision_date, 10),
        dl_hazmat_expiry: str(idData.dl_hazmat_expiry, 10),
        card_type: str(idData.card_type, 10),
        raw_aamva_elements: idData.raw_elements as Record<string, string> | null,
      });

      const frontPhoto = validIdPhoto(idFrontImage) ? (idFrontImage as string) : null;
      const backPhoto = validIdPhoto(idBackImage) ? (idBackImage as string) : null;
      const { frontKey, backKey } = await storeIdPhotos(c.env, receiptId, frontPhoto, backPhoto);

      // Update receipt with person link and R2 keys
      await execute(db,
        `UPDATE serve_receipts SET
           recipient_person_id = ?, recipient_aamva_json = ?,
           id_scan_method = ?, id_front_r2_key = ?, id_back_r2_key = ?
         WHERE id = ?`,
        personId, aamvaData ? JSON.stringify(aamvaData) : null,
        idScanMethod, frontKey, backKey, receiptId);

      await linkReceiptToPerson(db, receiptId, personId, 'recipient', idScanMethod, frontKey, backKey);

      // Also link person to the serve job
      await execute(db,
        `INSERT OR IGNORE INTO serve_queue_persons (serve_queue_id, person_id, role)
         VALUES (?, ?, 'recipient')`,
        tok.serve_queue_id, personId);

      log.info('AoS person upsert complete', { receiptId, personId, created, scanMethod: idScanMethod });
    } catch (err) {
      log.error('AoS person upsert failed', { receiptId }, err as Error);
    }
  })();
  try { c.executionCtx.waitUntil(bgTask); } catch { /* Miniflare test env has no ExecutionContext */ }

  // Submissions are what the cap is for. Recorded before the burn so a
  // rejected attempt still counts against a token being hammered.
  await execute(db, 'UPDATE serve_receipt_tokens SET scans_used = scans_used + 1 WHERE id = ?', tok.id)
    .catch((err) => {
      // Swallowed silently before. The cap is what stops a token being
      // hammered; if the increment stops landing it stops counting, and
      // nothing anywhere says so.
      // log.warn takes no error argument — the message goes in the context.
      log.warn('Receipt scan count not incremented', {
        tokenId: tok.id,
        receiptId,
        err: (err as Error)?.message ?? String(err),
      });
    });

  // Record the officer's expectation alongside the derived variation, and
  // how the encounter was completed.
  //
  // A variant mismatch is NOT an error — the officer is reading a doorstep
  // and the signer knows their own household — but it is exactly the thing
  // worth a supervisor's eye before an affidavit is filed on it.
  //
  // One statement rather than three: these are all columns of the row just
  // inserted, and as separate writes each could fail independently and
  // silently, leaving a legally-significant record partially annotated with
  // no trace. In particular a lost variant_conflict is a conflict nobody
  // ever sees.
  const channel = str(body.completion_channel, 20) === 'paper' ? 'paper' : 'mobile';
  await execute(
    db,
    `UPDATE serve_receipts
        SET completion_channel = ?,
            officer_variant = COALESCE(?, officer_variant),
            variant_conflict = COALESCE(?, variant_conflict)
      WHERE id = ?`,
    channel,
    tok.prefill_variant ?? null,
    // When no officer prefill exists (tok.prefill_variant is null):
    //   → store 0 (no conflict, no prefill to disagree with) rather than NULL.
    // NULL previously made "no prefill" and "agreed" indistinguishable in audits.
    tok.prefill_variant != null ? (tok.prefill_variant === variant ? 0 : 1) : 0,
    receiptId,
  ).catch((err) => {
    log.error(
      'Receipt annotations not recorded — completion channel and any variant conflict are missing',
      { receiptId, channel, officerVariant: tok.prefill_variant ?? null },
      err as Error,
    );
  });

  // Burn the token. Conditional on used_receipt_id still being NULL so two
  // concurrent submits cannot both claim it — the loser's UPDATE matches 0
  // rows and it reports already_signed rather than double-recording.
  const burn = await execute(
    db,
    `UPDATE serve_receipt_tokens
        SET used_receipt_id = ?, used_at = datetime('now')
      WHERE id = ? AND used_receipt_id IS NULL`,
    receiptId, tok.id,
  );
  if (!burn.meta.changes) {
    await execute(db, "UPDATE serve_receipts SET status = 'voided', void_reason = 'duplicate submission' WHERE id = ?", receiptId);
    return c.json({ ok: false, code: 'already_signed', message: 'This receipt has already been signed.' }, 409);
  }

  // ── Auto-advance the serve job ─────────────────────────────
  // Every variant of this form documents papers actually handed over,
  // so all four advance the job to 'served'. There is no variant that
  // records a non-delivery — a failed attempt is logged by the officer
  // through ServeAttemptModal, not by a recipient signature.
  const advances = true;
  {
    await execute(
      db,
      `UPDATE serve_queue
          SET status = 'served', serve_date = COALESCE(serve_date, datetime('now')),
              updated_at = datetime('now')
        WHERE id = ? AND status != 'served'`,
      tok.serve_queue_id,
    );
  }

  // Attempt row, so the receipt shows up on the existing attempt timeline.
  const nextAttempt = await queryFirst<{ n: number }>(
    db, 'SELECT COALESCE(MAX(attempt_number), 0) + 1 AS n FROM serve_attempts WHERE serve_queue_id = ?',
    tok.serve_queue_id,
  );
  const attempt = await execute(
    db,
    `INSERT INTO serve_attempts (
       serve_queue_id, attempt_number, attempt_at, result, latitude, longitude,
       notes, attempt_type, signature_data
     ) VALUES (?, ?, datetime('now'), ?, ?, ?, ?, 'receipt', ?)`,
    tok.serve_queue_id, nextAttempt?.n ?? 1,
    advances ? 'served' : 'attempted',
    Number.isFinite(Number(body.latitude)) ? Number(body.latitude) : null,
    Number.isFinite(Number(body.longitude)) ? Number(body.longitude) : null,
    `${formTitle} — receipt #${receiptId}, signed by ${submission.recipient_name}`,
    submission.recipient_signature as string,
  ).catch((err) => {
    log.error('serve receipt: attempt row insert failed', { receiptId, queueId: tok.serve_queue_id }, err as Error);
    return null;
  });

  if (attempt?.meta.last_row_id) {
    await execute(db, 'UPDATE serve_receipts SET serve_attempt_id = ? WHERE id = ?',
      Number(attempt.meta.last_row_id), receiptId).catch(() => undefined);
  }

  await recordAudit(c, {
    action: 'SERVE_RECEIPT_SIGNED',
    entityType: 'serve_queue',
    entityId: tok.serve_queue_id,
    details: { receipt_id: receiptId, form_variant: variant, service_method: method, advanced: advances },
    actorId: null,
  }).catch(() => undefined);

  log.info('Serve receipt signed', { receiptId, queueId: tok.serve_queue_id, variant, method });

  // Broadcast to live dispatch / serve feeds so they refresh without polling.
  broadcastAll('data_changed', {
    module: 'process-server',
    entity: 'serve_queue',
    id: tok.serve_queue_id,
    status: advances ? 'served' : 'attempted',
    event: 'receipt_signed',
  });

  return c.json({
    ok: true,
    receipt_id: receiptId,
    form_variant: variant,
    form_title: formTitle,
    officer_variant: tok.prefill_variant ?? null,
    variant_conflict: !!tok.prefill_variant && tok.prefill_variant !== variant,
    service_method: method,
    job_advanced: advances,
    email_status: emailTo ? 'pending' : 'not_requested',
  }, 201);
});

/**
 * POST /api/serve-receipt/:token/email
 * Email the recipient their copy of the signed receipt.
 *
 * The PDF arrives as base64 FROM THE BROWSER because jsPDF is the only
 * renderer we have and it is client-side — the Worker cannot rasterize
 * one (same constraint that makes the QR PNG a client-side render).
 *
 * Sent from the ASSIGNED OFFICER's mailbox, not a shared one: the agency
 * has no system mailbox configured, and a receipt arriving from the
 * server who actually handed over the documents is what a recipient can
 * recognize. No officer / no Graph config → 200 with a not_configured
 * status, per the repo's unset-integration convention.
 */
serveReceipt.post('/:token/email', async (c) => {
  const ip = clientIp(c);
  if (!(await rateLimitAllow(c.env.KV, `serve-receipt-mail:ip:${ip}`, 10, 600))) {
    return c.json({ ok: false, code: 'rate_limited' }, 429);
  }

  const db = getDb(c.env);
  const body = await c.req.json<{ receipt_id?: number; pdf_base64?: string; filename?: string }>()
    .catch(() => null);
  if (!body?.receipt_id || !body.pdf_base64) {
    return c.json({ ok: false, code: 'bad_request' }, 400);
  }
  if (body.pdf_base64.length > 6_000_000) {
    return c.json({ ok: false, code: 'too_large', message: 'Receipt PDF is too large to email.' }, 413);
  }
  // Size was the only gate: a 5 MB HTML file passed it as readily as a
  // PDF, and went out as an attachment from an officer's mailbox.
  if (!decodesToPdf(body.pdf_base64)) {
    return c.json({ ok: false, code: 'bad_request', message: 'Attachment is not a PDF.' }, 400);
  }

  // The token proves the caller just signed; pairing it with receipt_id
  // stops one token from mailing a different recipient's receipt out.
  const receipt = await queryFirst<{
    id: number; serve_queue_id: number; email_to: string | null;
    recipient_name: string; form_title: string | null; email_status: string;
  }>(
    db,
    // resolveToken cannot be reused here: by this point the token is spent
    // (used_receipt_id is set), which it treats as a failure. But revocation
    // still has to bite — a supervisor revoking a link after a signature
    // means "stop acting on this", and without this clause the holder could
    // still make an officer's mailbox send.
    `SELECT r.id, r.serve_queue_id, r.email_to, r.recipient_name, r.form_title, r.email_status
       FROM serve_receipts r
       JOIN serve_receipt_tokens t ON t.id = r.token_id
      WHERE r.id = ? AND t.token = ? AND t.revoked_at IS NULL`,
    body.receipt_id, c.req.param('token'),
  );
  if (!receipt) return c.json({ ok: false, code: 'not_found' }, 404);
  if (!receipt.email_to) return c.json({ ok: true, status: 'not_requested' });
  if (receipt.email_status === 'sent') return c.json({ ok: true, status: 'sent' });

  const job = await queryFirst<{ case_number: string | null; assigned_officer_id: number | null; officer_id: number | null }>(
    db,
    'SELECT case_number, assigned_officer_id, officer_id FROM serve_queue WHERE id = ?',
    receipt.serve_queue_id,
  );
  const ownerUserId = job?.assigned_officer_id ?? job?.officer_id ?? null;
  if (!ownerUserId) {
    await execute(db, "UPDATE serve_receipts SET email_status = 'not_configured', email_error = 'no assigned officer mailbox' WHERE id = ?", receipt.id);
    return c.json({ ok: true, status: 'not_configured' });
  }

  const caseRef = job?.case_number ? ` — Case ${job.case_number}` : '';
  // Title comes from the stored row, so the email names the exact
  // variation the recipient signed — (Business), (Co-Habitant), etc.
  const label = receipt.form_title || 'Acknowledgement of Service Form';

  try {
    const resendKey = c.env.RESEND_API_KEY;
    if (!resendKey) {
      await execute(db, "UPDATE serve_receipts SET email_status = 'not_configured', email_error = 'RESEND_API_KEY not set' WHERE id = ?", receipt.id);
      return c.json({ ok: true, status: 'not_configured' });
    }

    const { sendViaResend } = await import('../utils/resendEmail');
    const { buildAosEmailHtml } = await import('../utils/aosEmailTemplate');

    const docsRaw = await queryFirst<{ documents_json: string | null }>(
      db, 'SELECT documents_json FROM serve_receipts WHERE id = ?', receipt.id);
    const documents = docsRaw?.documents_json
      ? (JSON.parse(docsRaw.documents_json) as { title: string; copies?: number }[])
      : [];

    const serverInfo = ownerUserId
      ? await queryFirst<{ first_name: string | null; last_name: string | null; badge_number: string | null }>(
          db, 'SELECT first_name, last_name, badge_number FROM users WHERE id = ?', ownerUserId)
      : null;

    const html = buildAosEmailHtml({
      recipientName: receipt.recipient_name,
      formTitle: label,
      documents,
      caseNumber: job?.case_number || null,
      dateServed: new Date().toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
        timeZone: 'America/Denver',
      }),
      serverName: serverInfo
        ? [serverInfo.first_name, serverInfo.last_name].filter(Boolean).join(' ') || null
        : null,
      serverBadge: serverInfo?.badge_number ? `#${serverInfo.badge_number}` : null,
    });

    const result = await sendViaResend(resendKey, {
      from: 'Rocky Mountain Protective Group <server@rmpgutah.us>',
      to: receipt.email_to,
      subject: `${label}${caseRef}`,
      html,
      attachments: [{
        filename: body.filename || 'acknowledgement-of-service.pdf',
        content: body.pdf_base64,
      }],
    });

    const status = result.status === 'sent' ? 'sent' : 'failed';
    await execute(
      db,
      `UPDATE serve_receipts SET email_status = ?, email_error = ?,
              email_sent_at = CASE WHEN ? = 'sent' THEN datetime('now') ELSE NULL END
        WHERE id = ?`,
      status, result.error ? String(result.error).slice(0, 300) : null, status, receipt.id,
    );
    return c.json({ ok: true, status });
  } catch (err) {
    log.error('Serve receipt email failed', { receiptId: receipt.id }, err as Error);
    await execute(db, "UPDATE serve_receipts SET email_status = 'failed', email_error = ? WHERE id = ?",
      String((err as Error)?.message ?? 'send failed').slice(0, 300), receipt.id);
    return c.json({ ok: true, status: 'failed' });
  }
});

/**
 * POST /api/serve-receipt/:token/delivery
 * Record the outcome of emailing the recipient their copy. Called by the
 * signing page immediately after it renders the PDF (only the browser has
 * jsPDF — the Worker cannot rasterize one), so the status column reflects
 * what actually happened rather than an optimistic 'pending' forever.
 */
serveReceipt.post('/:token/delivery', async (c) => {
  // Its sibling /email is rate-limited and this was not, though both are
  // unauthenticated and both write to D1. A signing page makes exactly one
  // delivery call, so 10 per 10 minutes is far above any real use.
  const ip = clientIp(c);
  if (!(await rateLimitAllow(c.env.KV, `serve-receipt-delivery:ip:${ip}`, 10, 600))) {
    return c.json({ ok: false, code: 'rate_limited' }, 429);
  }

  const db = getDb(c.env);
  const body = await c.req.json<{ receipt_id?: number; status?: string; error?: string }>().catch(() => null);
  if (!body?.receipt_id) return c.json({ ok: false, code: 'bad_request' }, 400);

  const status = ['sent', 'failed', 'not_configured'].includes(String(body.status)) ? String(body.status) : 'failed';

  // Bind BOTH the token and the receipt id — the token alone proves the
  // caller signed this receipt, and the pairing stops one recipient's
  // token from writing a delivery status onto another's receipt.
  const res = await execute(
    db,
    `UPDATE serve_receipts
        SET email_status = ?, email_error = ?,
            email_sent_at = CASE WHEN ? = 'sent' THEN datetime('now') ELSE email_sent_at END
      WHERE id = ? AND token_id = (SELECT id FROM serve_receipt_tokens WHERE token = ?)`,
    status, str(body.error, 300), status, body.receipt_id, c.req.param('token'),
  );

  // A token/receipt pair that matches nothing used to return ok:true, so a
  // signing page whose delivery status never landed looked identical to one
  // that did — and the receipt sat on 'pending' forever with no signal
  // anywhere that a write had been silently dropped.
  if (!res.meta.changes) {
    log.warn('Serve receipt delivery status matched no row', {
      receiptId: body.receipt_id,
    });
    return c.json({ ok: false, code: 'not_found' }, 404);
  }
  return c.json({ ok: true });
});

// ============================================================
// ADMIN / OFFICER ROUTER — /api/serve-receipts
// ============================================================

export const serveReceiptAdmin = new Hono<Env>();

/**
 * POST /api/serve-receipts/:queueId/token
 * Mint the QR credential. The client renders the PNG (Workers cannot
 * rasterize) — we return { token, url } exactly like /api/cfs/:id/qr-token.
 */
serveReceiptAdmin.post(
  '/:queueId/token',
  requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'),
  async (c) => {
    const queueId = parseInt(c.req.param('queueId') || '', 10);
    if (!queueId) return c.json({ error: 'Invalid serve job id' }, 400);

    const db = getDb(c.env);
    const job = await queryFirst<{ id: number }>(db, 'SELECT id FROM serve_queue WHERE id = ?', queueId);
    if (!job) return c.json({ error: 'Serve job not found' }, 404);

    const user = c.get('user') as { id: number } | undefined;
    const reqBody = await c.req.json<{ ttl_days?: number }>().catch(() => ({} as { ttl_days?: number }));
    const ttlDays = Number(reqBody.ttl_days) || DEFAULT_TOKEN_TTL_DAYS;

    // Reuse an unburned, unexpired token for this job rather than minting a
    // new one per print. Reprinting a run sheet is routine; a fresh token
    // each time would silently invalidate the copy already in the field.
    const existing = await queryFirst<{ token: string }>(
      db,
      `SELECT token FROM serve_receipt_tokens
        WHERE serve_queue_id = ? AND used_receipt_id IS NULL AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > datetime('now'))
          AND scans_used < max_scans
        ORDER BY id DESC LIMIT 1`,
      queueId,
    );
    if (existing) {
      return c.json({ token: existing.token, url: `${PUBLIC_APP_URL}/m/serve-receipt/${existing.token}`, reused: true });
    }

    const token = randomToken();
    await execute(
      db,
      `INSERT INTO serve_receipt_tokens (serve_queue_id, token, created_by, expires_at)
       VALUES (?, ?, ?, datetime('now', ?))`,
      queueId, token, user?.id ?? null, `+${Math.max(1, Math.min(365, ttlDays))} days`,
    );

    await recordAudit(c, {
      action: 'SERVE_RECEIPT_TOKEN_CREATE',
      entityType: 'serve_queue',
      entityId: queueId,
      details: { ttl_days: ttlDays },
      actorId: user?.id ?? null,
    }).catch(() => undefined);

    return c.json({ token, url: `${PUBLIC_APP_URL}/m/serve-receipt/${token}`, reused: false });
  },
);

/**
 * POST /api/serve-receipts/:queueId/prefill
 * Officer MDT input, recorded at the door.
 *
 * Attaches to the ACTIVE token rather than to serve_queue, because it
 * describes one doorstep encounter — the same job can be attempted three
 * times at three addresses with three different people answering, and
 * each attempt has its own token.
 *
 * Mints a token if none is live, so the officer never has to think about
 * token lifecycle: they answer the questions and get a link back.
 */
serveReceiptAdmin.post(
  '/:queueId/prefill',
  requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'),
  async (c) => {
    const queueId = parseInt(c.req.param('queueId') || '', 10);
    if (!queueId) return c.json({ error: 'Invalid serve job id' }, 400);

    const body = await c.req.json<Partial<ServeReceiptPrefill>>().catch(() => null);
    if (!body) return c.json({ error: 'Invalid prefill' }, 400);

    const premises = ['residence', 'business', 'other'].includes(String(body.premises_type))
      ? body.premises_type as ServeReceiptPrefill['premises_type']
      : 'residence';

    const prefill: ServeReceiptPrefill = {
      is_named_party: body.is_named_party === null || body.is_named_party === undefined
        ? null
        : !!body.is_named_party,
      premises_type: premises,
      resides_at_address: !!body.resides_at_address,
      authorized_agent: !!body.authorized_agent,
      recipient_name: str(body.recipient_name, 200),
      recipient_relationship: str(body.recipient_relationship, 120),
      business_name: str(body.business_name, 200),
      recipient_job_title: str(body.recipient_job_title, 120),
      documents: (Array.isArray(body.documents) ? body.documents : []).slice(0, 50).map((d) => ({
        title: String(d?.title ?? 'Court document').slice(0, 200),
        copies: Number.isFinite(Number(d?.copies)) ? Math.max(1, Math.min(99, Number(d.copies))) : 1,
      })),
      note: str(body.note, 500),
    };

    // The officer's read of the doorstep, as a variation. Same resolver
    // the subject's answers go through, so the two are comparable.
    const prefillVariant = resolveReceiptVariant({
      isNamedParty: prefill.is_named_party === true,
      premisesType: prefill.premises_type,
      residesAtAddress: prefill.resides_at_address,
      authorizedAgent: prefill.authorized_agent,
    });

    const db = getDb(c.env);
    const job = await queryFirst<{ id: number }>(db, 'SELECT id FROM serve_queue WHERE id = ?', queueId);
    if (!job) return c.json({ error: 'Serve job not found' }, 404);

    const user = c.get('user') as { id: number } | undefined;
    let tok = await queryFirst<{ id: number; token: string }>(
      db,
      `SELECT id, token FROM serve_receipt_tokens
        WHERE serve_queue_id = ? AND used_receipt_id IS NULL AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > datetime('now'))
          AND scans_used < max_scans
        ORDER BY id DESC LIMIT 1`,
      queueId,
    );

    if (!tok) {
      const token = randomToken();
      const ins = await execute(
        db,
        `INSERT INTO serve_receipt_tokens (serve_queue_id, token, created_by, expires_at)
         VALUES (?, ?, ?, datetime('now', ?))`,
        queueId, token, user?.id ?? null, `+${DEFAULT_TOKEN_TTL_DAYS} days`,
      );
      tok = { id: Number(ins.meta.last_row_id), token };
    }

    await execute(
      db,
      `UPDATE serve_receipt_tokens
          SET prefill_json = ?, prefill_variant = ?, prefill_by = ?, prefill_at = datetime('now')
        WHERE id = ?`,
      JSON.stringify(prefill), prefillVariant, user?.id ?? null, tok.id,
    );

    await recordAudit(c, {
      action: 'SERVE_RECEIPT_PREFILL',
      entityType: 'serve_queue',
      entityId: queueId,
      details: { variant: prefillVariant, premises: prefill.premises_type },
      actorId: user?.id ?? null,
    }).catch(() => undefined);

    // Return the case caption and the assigned server WITH the link.
    //
    // The officer's card carries a ServeJob, which has no plaintiff or
    // defendant on it — printing a blank from card state alone renders a
    // court caption with empty parties, which is worse than no caption.
    // Same principle as /receipt/:id/document: the join stays on the
    // server so the printed form cannot disagree with the record.
    const caption = await queryFirst<Record<string, any>>(
      db,
      `SELECT case_number, court_name, jurisdiction, plaintiff_name, defendant_name,
              document_type, recipient_name, recipient_address, recipient_city,
              recipient_state, recipient_zip, assigned_officer_id, officer_id, created_by
         FROM serve_queue WHERE id = ?`,
      queueId,
    );
    const servingOfficerId = caption?.assigned_officer_id ?? caption?.officer_id
      ?? caption?.created_by ?? user?.id ?? null;
    const servingOfficer = servingOfficerId
      ? await queryFirst<{ full_name: string | null; first_name: string | null; last_name: string | null; badge_number: string | null }>(
          db, 'SELECT full_name, first_name, last_name, badge_number FROM users WHERE id = ?', servingOfficerId,
        ).catch(() => null)
      : null;

    return c.json({
      token: tok.token,
      url: `${PUBLIC_APP_URL}/m/serve-receipt/${tok.token}`,
      variant: prefillVariant,
      form_title: receiptFormTitle(prefillVariant),
      prefill,
      job: {
        case_number: caption?.case_number ?? null,
        court_name: caption?.court_name ?? null,
        jurisdiction: caption?.jurisdiction ?? null,
        plaintiff_name: caption?.plaintiff_name ?? null,
        defendant_name: caption?.defendant_name ?? null,
        document_type: caption?.document_type ?? null,
        recipient_name: caption?.recipient_name ?? null,
        service_address: formatServiceAddress({
          address: caption?.recipient_address, city: caption?.recipient_city,
          state: caption?.recipient_state, zip: caption?.recipient_zip,
        }),
      },
      server: {
        name: servingOfficer?.full_name
          || [servingOfficer?.first_name, servingOfficer?.last_name].filter(Boolean).join(' ')
          || null,
        badge: servingOfficer?.badge_number ?? null,
      },
    });
  },
);

/**
 * POST /api/serve-receipts/:queueId/refusal
 * Record that the recipient refused to sign.
 *
 * Attested by the OFFICER, not the recipient — a person refusing to sign
 * will not tap a phone either, so asking the refuser to record their own
 * refusal produces nothing. Before this there was no record at all: a
 * refused service simply vanished, which is the worst outcome, because
 * Utah R. Civ. P. 4(d) permits service where the papers are left in the
 * recipient's presence after refusal. The service IS good; the paperwork
 * just had nowhere to say so.
 *
 * Burns the token like a signature does. The encounter is over, and a
 * live link afterwards invites a second, contradictory record of the
 * same doorstep.
 */
serveReceiptAdmin.post(
  '/:queueId/refusal',
  requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'),
  async (c) => {
    const queueId = parseInt(c.req.param('queueId') || '', 10);
    if (!queueId) return c.json({ error: 'Invalid serve job id' }, 400);

    const body = await c.req.json<{
      recipient_name?: string; reason?: string; documents_left?: boolean;
      latitude?: number; longitude?: number; notes?: string;
    }>().catch(() => null);
    if (!body) return c.json({ error: 'Invalid submission' }, 400);
    // Length floor, not just presence. This is the only account of what
    // happened at a door where nobody signed — "n" satisfies a truthiness
    // check and tells a court nothing.
    const reasonText = (body.reason ?? '').trim();
    if (reasonText.length < 15) {
      return c.json({
        error: 'Describe what happened in a sentence — this is the only account '
          + 'of a doorstep where nobody signed.',
      }, 400);
    }

    const db = getDb(c.env);
    const user = c.get('user') as { id: number; username?: string } | undefined;

    const job = await queryFirst<{ id: number; recipient_name: string | null; defendant_name: string | null }>(
      db, 'SELECT id, recipient_name, defendant_name FROM serve_queue WHERE id = ?', queueId);
    if (!job) return c.json({ error: 'Serve job not found' }, 404);

    // [15] Receipt multiplicity guard — at most one signed receipt per job.
    // The token-burn path stops QR-signed duplicates, but paper/refusal paths
    // have no token and can produce extra receipts if the officer submits twice.
    const existingSigned = await queryFirst<{ id: number }>(db,
      `SELECT id FROM serve_receipts WHERE serve_queue_id = ? AND status = 'signed' LIMIT 1`,
      queueId,
    );
    if (existingSigned) {
      return c.json({
        ok: false, code: 'already_signed',
        message: 'A signed receipt already exists for this job. Void the existing receipt before adding another.',
      }, 409);
    }

    const tok = await queryFirst<{ id: number }>(
      db,
      `SELECT id FROM serve_receipt_tokens
        WHERE serve_queue_id = ? AND used_receipt_id IS NULL AND revoked_at IS NULL
        ORDER BY id DESC LIMIT 1`,
      queueId,
    );

    const priorStatus = (await queryFirst<{ status: string | null }>(
      db, 'SELECT status FROM serve_queue WHERE id = ?', queueId,
    ).catch(() => null))?.status ?? null;

    let ins;
    try {
      ins = await execute(
      db,
      `INSERT INTO serve_receipts (
         serve_queue_id, token_id, service_method, form_variant, form_title, job_status_before,
         completion_channel, recipient_name, recipient_role,
         sub_declined_reason, sub_defendant_name,
         ack_received_documents, recipient_signed_at,
         server_name, server_user_id, latitude, longitude, notes, status
       ) VALUES (?,?, 'refused', 'refused', ?, ?, 'refusal', ?, 'refused',
                 ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, 'signed')`,
      queueId, tok?.id ?? null,
      'Record of Refusal to Sign', priorStatus,
      str(body.recipient_name, 200) || job.recipient_name || 'Unidentified person',
      reasonText.slice(0, 1000),
      job.defendant_name,
      // Service is complete when the papers are LEFT, refusal or not. That
      // fact is what a court asks about, so it is recorded explicitly
      // rather than inferred from the refusal.
      body.documents_left === false ? 0 : 1,
      str(user?.username, 120), user?.id ?? null,
      Number.isFinite(Number(body.latitude)) ? Number(body.latitude) : null,
      Number.isFinite(Number(body.longitude)) ? Number(body.longitude) : null,
      str(body.notes, 1000),
      );
    } catch (err) {
      if (isDuplicateSignedReceipt(err)) return c.json({ error: DUPLICATE_MESSAGE }, 409);
      throw err;
    }
    const receiptId = Number(ins.meta.last_row_id);

    if (tok?.id) {
      await execute(
        db,
        `UPDATE serve_receipt_tokens SET used_receipt_id = ?, used_at = datetime('now')
          WHERE id = ? AND used_receipt_id IS NULL`,
        receiptId, tok.id,
      ).catch(() => undefined);
    }

    if (body.documents_left !== false) {
      await execute(
        db,
        `UPDATE serve_queue SET status = 'served',
                serve_date = COALESCE(serve_date, datetime('now')), updated_at = datetime('now')
          WHERE id = ? AND status != 'served'`,
        queueId,
      ).catch(() => undefined);
    }

    await recordAudit(c, {
      action: 'SERVE_RECEIPT_REFUSAL',
      entityType: 'serve_queue',
      entityId: queueId,
      details: { receipt_id: receiptId, documents_left: body.documents_left !== false },
      actorId: user?.id ?? null,
    }).catch(() => undefined);

    log.info('Serve refusal recorded', { receiptId, queueId });
    return c.json({ ok: true, receipt_id: receiptId }, 201);
  },
);

/**
 * POST /api/serve-receipts/:queueId/paper
 * Bring a hand-completed form back into the record.
 *
 * The paper path shipped as a dead end. An officer could print a blank,
 * get it signed in ink, and then had nowhere to put it —
 * completion_channel = 'paper' existed as a column and nothing ever wrote
 * it. A signed instrument sitting in a folder in a vehicle is not a
 * record; it is a liability with a signature on it.
 *
 * The wet signature is evidenced by a PHOTOGRAPH of the signed page,
 * stored where a captured e-signature would go and distinguished by the
 * channel — so nothing downstream mistakes a photographed page for a
 * signature drawn on glass. The officer additionally attests, by name,
 * that the transcription matches the paper, because they are the only
 * person who saw both.
 */
serveReceiptAdmin.post(
  '/:queueId/paper',
  requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'),
  async (c) => {
    const queueId = parseInt(c.req.param('queueId') || '', 10);
    if (!queueId) return c.json({ error: 'Invalid serve job id' }, 400);

    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body) return c.json({ error: 'Invalid submission' }, 400);

    const db = getDb(c.env);
    const job = await queryFirst<{ id: number; defendant_name: string | null;
      recipient_address: string | null; recipient_city: string | null;
      recipient_state: string | null; recipient_zip: string | null }>(
      db,
      `SELECT id, defendant_name, recipient_address, recipient_city,
              recipient_state, recipient_zip FROM serve_queue WHERE id = ?`,
      queueId,
    );
    if (!job) return c.json({ error: 'Serve job not found' }, 404);

    // [15] Receipt multiplicity guard (paper path)
    const existingSignedPaper = await queryFirst<{ id: number }>(db,
      `SELECT id FROM serve_receipts WHERE serve_queue_id = ? AND status = 'signed' LIMIT 1`,
      queueId,
    );
    if (existingSignedPaper) {
      return c.json({
        ok: false, code: 'already_signed',
        message: 'A signed receipt already exists for this job. Void the existing receipt before adding another.',
      }, 409);
    }

    const premisesType = str(body.premises_type, 30);
    const residesAtAddress = bool(body.sub_resides_at_address);
    const authorizedAgent = bool(body.sub_is_authorized_agent);
    const namedParty = str(body.sub_defendant_name, 200) || job.defendant_name;

    const variant = resolveReceiptVariant({
      isNamedParty: str(body.form_variant, 30) === 'individual',
      premisesType,
      residesAtAddress: !!residesAtAddress,
      authorizedAgent: !!authorizedAgent,
      namedParty,
    });

    // The photograph of the signed page. Same size ceiling as a drawn
    // signature — the client downscales before sending, because a raw
    // phone photo is several megabytes and this column is not storage.
    const pageImage = body.signed_page_image;
    if (!validPageImage(pageImage)) {
      return c.json({ error: 'A photograph of the signed page is required' }, 400);
    }

    const attRaw = Array.isArray(body.attestations) ? body.attestations : [];
    const attestationsTruncated = attRaw.length > 20;
    const attestations = attRaw.slice(0, 20).map((a: any) => ({
      id: String(a?.id ?? '').slice(0, 40),
      text: String(a?.text ?? '').slice(0, 600),
      accepted: bool(a?.accepted) === 1,
    })).filter((a) => a.id && a.text);

    const docsRaw = Array.isArray(body.documents) ? body.documents : [];
    const documentsTruncated = docsRaw.length > 50;
    const documents = docsRaw.slice(0, 50).map((d: any) => ({
      title: String(d?.title ?? 'Court document').slice(0, 200),
      copies: Number.isFinite(Number(d?.copies)) ? Math.max(1, Math.min(99, Number(d.copies))) : 1,
    }));

    const user = c.get('user') as { id: number; username?: string } | undefined;
    const signedAt = str(body.signed_at, 40);
    const priorStatus = (await queryFirst<{ status: string | null }>(
      db, 'SELECT status FROM serve_queue WHERE id = ?', queueId,
    ).catch(() => null))?.status ?? null;

    let ins;
    try {
      ins = await execute(
      db,
      `INSERT INTO serve_receipts (
         serve_queue_id, service_method, form_variant, form_title, completion_channel, job_status_before,
         attestations_json, recipient_name, recipient_role, recipient_relationship,
         recipient_phone, recipient_email, business_name, recipient_job_title,
         recipient_age_confirmed, service_address, service_city, service_state,
         service_zip, premises_type, documents_json, document_count,
         sub_defendant_name, sub_resides_at_address, sub_is_authorized_agent,
         sub_agrees_to_deliver, sub_release_acknowledged,
         ack_received_documents, ack_information_true,
         recipient_signature, recipient_signed_at,
         server_name, server_user_id, notes, status
       ) VALUES (?, ?, ?, ?, 'paper', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?,
                 ?, ?, ?, ?, ?, 1, 1, ?, COALESCE(?, datetime('now')), ?, ?, ?, 'signed')`,
      queueId,
      variant === 'individual' ? 'personal' : 'substitute',
      variant, receiptFormTitle(variant), priorStatus,
      JSON.stringify(attestations),
      str(body.recipient_name, 200), variant, str(body.recipient_relationship, 120),
      str(body.recipient_phone, 40), str(body.recipient_email, 254),
      str(body.business_name, 200), str(body.recipient_job_title, 120),
      job.recipient_address, job.recipient_city, job.recipient_state, job.recipient_zip,
      premisesType, JSON.stringify(documents), documents.length,
      namedParty, residesAtAddress, authorizedAgent,
      bool(body.sub_agrees_to_deliver), bool(body.sub_release_acknowledged),
      pageImage, signedAt,
      str(user?.username, 120), user?.id ?? null,
      // The transcription attestation is part of the record, not a UI
      // nicety: the officer is the only person who saw both the paper and
      // the screen, so their name has to be attached to the claim that
      // the two match.
      `Transcribed from a hand-completed form by ${user?.username ?? 'unknown'}. `
        + 'The photographed page is the signed original.',
      );
    } catch (err) {
      if (isDuplicateSignedReceipt(err)) return c.json({ error: DUPLICATE_MESSAGE }, 409);
      throw err;
    }
    const receiptId = Number(ins.meta.last_row_id);

    await execute(
      db,
      `UPDATE serve_queue SET status = 'served',
              serve_date = COALESCE(serve_date, ?, datetime('now')), updated_at = datetime('now')
        WHERE id = ? AND status != 'served'`,
      signedAt, queueId,
    ).catch(() => undefined);

    await recordAudit(c, {
      action: 'SERVE_RECEIPT_PAPER',
      entityType: 'serve_queue',
      entityId: queueId,
      details: { receipt_id: receiptId, variant },
      actorId: user?.id ?? null,
    }).catch(() => undefined);

    log.info('Paper acknowledgement transcribed', { receiptId, queueId, variant });
    const warnings: string[] = [];
    if (attestationsTruncated) warnings.push(`attestations array exceeded 20 entries — only the first 20 were recorded`);
    if (documentsTruncated) warnings.push(`documents array exceeded 50 entries — only the first 50 were recorded`);
    return c.json({ ok: true, receipt_id: receiptId, form_variant: variant, ...(warnings.length ? { warnings } : {}) }, 201);
  },
);

/**
 * Roles that may read a signed acknowledgement.
 *
 * Deliberately NOT the same set that may mint a token. Minting is a
 * doorstep action; reading returns a member of the public's signature
 * image, phone, email and physical description. `client_viewer` — a
 * hiring client with a login — was able to pull all of it, because these
 * two routes were the only ones in this file written without a gate.
 */
const RECEIPT_READ_ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'] as const;

/**
 * POST /api/serve-receipts/receipt/:id/correct
 * Void a signed acknowledgement and issue a fresh signing link, as one
 * auditable action.
 *
 * There was no correction path at all. The token burns on signature, so a
 * misspelt name or a wrong relationship was permanent — the officer had
 * to void the receipt (supervisor-only), then separately mint a token,
 * and nothing tied the two together. In practice that means small errors
 * stayed on legal records because fixing them was harder than living with
 * them.
 *
 * Deliberately NOT an edit. A signed instrument is a record of what a
 * person attested to; silently amending it would make the signature
 * evidence of words that were never on screen. The original is voided
 * with a stated reason and survives in full, and the correction is a NEW
 * signature.
 *
 * Same role gate as voiding, because that is what this does first.
 */
serveReceiptAdmin.post(
  '/receipt/:id/correct',
  requireRole('admin', 'manager', 'supervisor'),
  async (c) => {
    const id = parseInt(c.req.param('id') || '', 10);
    if (!id) return c.json({ error: 'Invalid receipt id' }, 400);

    const { reason } = await c.req.json<{ reason?: string }>().catch(() => ({ reason: '' }));
    const reasonText = (reason ?? '').trim();
    if (reasonText.length < 10) {
      return c.json({
        error: 'Say what was wrong with the original — it stays on the record '
          + 'alongside the correction.',
      }, 400);
    }

    const db = getDb(c.env);
    const user = c.get('user') as { id: number } | undefined;

    // Also fetch the original token's expiry so the correction token inherits
    // the remaining window rather than a fresh full TTL. If the original was
    // nearly expired, the correction shouldn't get more time than was left.
    const original = await queryFirst<{
      serve_queue_id: number;
      job_status_before: string | null;
      original_token_expires_at: string | null;
    }>(
      db,
      `SELECT r.serve_queue_id, r.job_status_before,
              t.expires_at AS original_token_expires_at
       FROM serve_receipts r
       LEFT JOIN serve_receipt_tokens t ON t.serve_queue_id = r.serve_queue_id
         AND t.used_receipt_id = r.id
       WHERE r.id = ? AND r.status = 'signed'`,
      id,
    );
    if (!original) return c.json({ error: 'Receipt not found or already voided' }, 404);

    const v = await execute(
      db,
      `UPDATE serve_receipts
          SET status = 'voided', voided_at = datetime('now'), voided_by = ?,
              void_reason = ?
        WHERE id = ? AND status = 'signed'`,
      user?.id ?? null, `Superseded by a correction: ${reasonText}`.slice(0, 500), id,
    );
    if (!v.meta.changes) return c.json({ error: 'Receipt not found or already voided' }, 404);

    // Put the job back so the corrected service can advance it again. The
    // partial unique index from 0209 would otherwise refuse the new
    // signature while the old row still held 'signed' — voiding first is
    // what makes the re-issue possible at all.
    await execute(
      db,
      "UPDATE serve_queue SET status = ?, serve_date = NULL, updated_at = datetime('now') WHERE id = ?",
      original.job_status_before || 'in_progress', original.serve_queue_id,
    ).catch(() => undefined);

    // Revoke any token still live for this job before minting a fresh
    // one, so a stale printed QR cannot compete with the correction.
    await execute(
      db,
      `UPDATE serve_receipt_tokens SET revoked_at = datetime('now')
        WHERE serve_queue_id = ? AND used_receipt_id IS NULL AND revoked_at IS NULL`,
      original.serve_queue_id,
    ).catch(() => undefined);

    // Correction token TTL: inherit the original token's remaining expiry window
    // rather than minting a fresh full TTL. A nearly-expired original should not
    // get more signing time via correction than it was originally granted.
    // If the original token's expiry is unavailable or already past, use the
    // default TTL as a safe fallback.
    const originalExpiresMs = original.original_token_expires_at
      ? new Date(original.original_token_expires_at).getTime()
      : null;
    const remainingMs = originalExpiresMs ? originalExpiresMs - Date.now() : 0;
    const ttlDays = remainingMs > 0
      ? Math.ceil(remainingMs / 86_400_000)
      : DEFAULT_TOKEN_TTL_DAYS;
    const token = randomToken();
    await execute(
      db,
      `INSERT INTO serve_receipt_tokens (serve_queue_id, token, created_by, expires_at)
       VALUES (?, ?, ?, datetime('now', ?))`,
      original.serve_queue_id, token, user?.id ?? null, `+${ttlDays} days`,
    );

    await recordAudit(c, {
      action: 'SERVE_RECEIPT_CORRECT',
      entityType: 'serve_queue',
      entityId: original.serve_queue_id,
      details: { voided_receipt_id: id, reason: reasonText },
      actorId: user?.id ?? null,
    }).catch(() => undefined);

    log.info('Receipt superseded by correction', { voidedId: id, queueId: original.serve_queue_id });
    return c.json({
      ok: true,
      voided_receipt_id: id,
      token,
      url: `${PUBLIC_APP_URL}/m/serve-receipt/${token}`,
    }, 201);
  },
);

/** GET /api/serve-receipts/:queueId — signed receipts for a job. */
serveReceiptAdmin.get('/:queueId', requireRole(...RECEIPT_READ_ROLES), async (c) => {
  const queueId = parseInt(c.req.param('queueId') || '', 10);
  if (!queueId) return c.json({ error: 'Invalid serve job id' }, 400);
  const rows = await query(
    getDb(c.env),
    `SELECT id, created_at, service_method, recipient_name, recipient_role,
            recipient_relationship, document_count, sub_agrees_to_deliver,
            sub_defendant_name, sub_expected_delivery_at, status,
            email_status, latitude, longitude
       FROM serve_receipts WHERE serve_queue_id = ? ORDER BY created_at DESC`,
    queueId,
  );
  return c.json(rows);
});

/** GET /api/serve-receipts/receipt/:id — full receipt incl. signatures. */
serveReceiptAdmin.get('/receipt/:id', requireRole(...RECEIPT_READ_ROLES), async (c) => {
  const id = parseInt(c.req.param('id') || '', 10);
  if (!id) return c.json({ error: 'Invalid receipt id' }, 400);
  const row = await queryFirst(getDb(c.env), 'SELECT * FROM serve_receipts WHERE id = ?', id);
  if (!row) return c.json({ error: 'Receipt not found' }, 404);
  return c.json(row);
});

/**
 * GET /api/serve-receipts/receipt/:id/document
 * Completion output: everything needed to render the SIGNED instrument,
 * already joined to its case.
 *
 * Exists so the officer can print the completed copy from the vehicle
 * after the subject signed on their own phone — the officer's device
 * never saw the signature or the answers, only the QR. Returning a
 * ready-to-render payload rather than a raw row keeps the join on the
 * server: the client would otherwise need a second call to serve_queue
 * and would be free to disagree with the stored record about what the
 * case caption says.
 *
 * Field names match ReceiptOfServiceData in
 * client/src/utils/servePdfGenerator.ts.
 */
serveReceiptAdmin.get('/receipt/:id/document', requireRole(...RECEIPT_READ_ROLES), async (c) => {
  const id = parseInt(c.req.param('id') || '', 10);
  if (!id) return c.json({ error: 'Invalid receipt id' }, 400);

  const db = getDb(c.env);
  const r = await queryFirst<Record<string, any>>(db, 'SELECT * FROM serve_receipts WHERE id = ?', id);
  if (!r) return c.json({ error: 'Receipt not found' }, 404);

  const job = await queryFirst<Record<string, any>>(
    db,
    `SELECT id, case_number, court_name, jurisdiction, plaintiff_name, defendant_name,
            document_type, assigned_officer_id, officer_id
       FROM serve_queue WHERE id = ?`,
    r.serve_queue_id,
  );

  // created_by last: a job with no assigned officer printed a blank
  // process-server line and "N/A" for the badge on the 2026-07-27 service,
  // and the name had to be written in by hand. A proof of service that
  // names no server is defective on its face.
  const officerId = job?.assigned_officer_id ?? job?.officer_id ?? job?.created_by ?? null;
  const officer = officerId
    ? await queryFirst<{ full_name: string | null; first_name: string | null; last_name: string | null; badge_number: string | null }>(
        db, 'SELECT full_name, first_name, last_name, badge_number FROM users WHERE id = ?', officerId,
      ).catch(() => null)
    : null;

  // Stored JSON, not regenerated. The attestation wording is what the
  // signer actually agreed to; re-deriving it from current code would
  // silently rewrite history the moment the copy is edited.
  let attestations: Array<{ id: string; text: string; accepted: boolean }> = [];
  try { attestations = JSON.parse(r.attestations_json || '[]'); } catch { attestations = []; }
  let documents: Array<{ title: string; copies: number }> = [];
  try { documents = JSON.parse(r.documents_json || '[]'); } catch { documents = []; }

  const variant = String(r.form_variant || 'individual');
  const isIndividual = variant === 'individual';

  return c.json({
    receiptId: r.id,
    formTitle: r.form_title || receiptFormTitle(variant as ReceiptVariant),
    variant,
    variantLabel: VARIANT_LABEL[variant as ReceiptVariant] ?? 'Individual',

    courtName: job?.court_name ?? '',
    caseNumber: job?.case_number ?? '',
    jobId: job?.id ?? r.serve_queue_id,
    jurisdiction: job?.jurisdiction ?? '',
    plaintiffName: job?.plaintiff_name ?? '',
    defendantName: job?.defendant_name ?? '',
    documentType: job?.document_type ?? '',

    serviceAddress: formatServiceAddress({
      address: r.service_address, city: r.service_city,
      state: r.service_state, zip: r.service_zip,
    }),
    premisesType: r.premises_type ?? '',
    serverName: officer?.full_name
      || [officer?.first_name, officer?.last_name].filter(Boolean).join(' ')
      || '',
    serverBadge: officer?.badge_number ?? '',
    agency: 'Rocky Mountain Protective Group',

    recipientName: r.recipient_name,
    recipientRelationship: r.recipient_relationship ?? undefined,
    recipientJobTitle: r.recipient_job_title ?? undefined,
    businessName: r.business_name ?? undefined,
    recipientPhone: r.recipient_phone ?? undefined,
    acceptingOnBehalfOf: isIndividual ? undefined : (r.sub_defendant_name ?? undefined),

    documents,
    attestations,

    residesAtAddress: !!r.sub_resides_at_address,
    authorizedAgent: !!r.sub_is_authorized_agent,
    expectedDeliveryAt: r.sub_expected_delivery_at ?? undefined,

    signedAt: r.recipient_signed_at || r.created_at,
    gps: (r.latitude != null && r.longitude != null)
      ? { lat: Number(r.latitude), lng: Number(r.longitude) }
      : undefined,
    signature: r.recipient_signature ?? undefined,

    // Officer-side context, not rendered on the instrument.
    meta: {
      status: r.status,
      completionChannel: r.completion_channel,
      officerVariant: r.officer_variant,
      variantConflict: !!r.variant_conflict,
      emailStatus: r.email_status,
      createdAt: r.created_at,
    },
  });
});

/** POST /api/serve-receipts/receipt/:id/void — supervisor correction. */
serveReceiptAdmin.post('/receipt/:id/void', requireRole('admin', 'manager', 'supervisor'), async (c) => {
  const id = parseInt(c.req.param('id') || '', 10);
  if (!id) return c.json({ error: 'Invalid receipt id' }, 400);
  const { reason } = await c.req.json<{ reason?: string }>().catch(() => ({ reason: '' }));
  if (!reason || String(reason).trim().length < 10) return c.json({ error: 'A void reason of at least 10 characters is required (it becomes part of the legal audit trail)' }, 400);

  const user = c.get('user') as { id: number } | undefined;
  const db = getDb(c.env);
  const before = await queryFirst<{ serve_queue_id: number; job_status_before: string | null }>(
    db, 'SELECT serve_queue_id, job_status_before FROM serve_receipts WHERE id = ?', id);

  const r = await execute(
    db,
    `UPDATE serve_receipts
        SET status = 'voided', voided_at = datetime('now'), voided_by = ?, void_reason = ?
      WHERE id = ? AND status = 'signed'`,
    user?.id ?? null, String(reason).slice(0, 500), id,
  );
  if (!r.meta.changes) return c.json({ error: 'Receipt not found or already voided' }, 404);

  // Put the job back. Signing advanced it to 'served'; striking the only
  // acknowledgement for it and leaving 'served' in place meant a job that
  // still needed serving looked done, with nothing to tell the officer.
  //
  // Only when NO other signed receipt survives — a job legitimately
  // holding a second, valid acknowledgement must stay served.
  let jobReverted = false;
  if (before?.serve_queue_id) {
    const survivor = await queryFirst<{ n: number }>(
      db,
      "SELECT COUNT(*) AS n FROM serve_receipts WHERE serve_queue_id = ? AND status = 'signed'",
      before.serve_queue_id,
    );
    if (!survivor?.n) {
      // job_status_before is NULL on receipts written before 0209. Falling
      // back to 'in_progress' is honest for those: attempts demonstrably
      // happened, and it is the state that puts the job back in front of
      // an officer rather than inventing a more specific claim.
      const restore = before.job_status_before || 'in_progress';
      const u = await execute(
        db,
        "UPDATE serve_queue SET status = ?, serve_date = NULL, updated_at = datetime('now') WHERE id = ?",
        restore, before.serve_queue_id,
      ).catch(() => null);
      jobReverted = !!u?.meta.changes;
    }
  }

  await recordAudit(c, {
    action: 'SERVE_RECEIPT_VOID',
    entityType: 'serve_receipts',
    entityId: id,
    details: { reason, job_reverted: jobReverted },
    actorId: user?.id ?? null,
  }).catch(() => undefined);

  return c.json({ success: true, job_reverted: jobReverted });
});

/**
 * GET /api/serve-receipts/:id/id-photo/:side
 * Retrieve the recipient's ID photo (front or back) from R2.
 */
serveReceiptAdmin.get(
  '/:id/id-photo/:side',
  requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'),
  async (c) => {
    const id = parseInt(c.req.param('id') || '', 10);
    const side = c.req.param('side');
    if (!id || (side !== 'front' && side !== 'back')) {
      return c.json({ error: 'Invalid request' }, 400);
    }

    const col = side === 'front' ? 'id_front_r2_key' : 'id_back_r2_key';
    const db = getDb(c.env);
    const row = await queryFirst<{ key: string | null }>(
      db,
      `SELECT ${col} as key FROM serve_receipts WHERE id = ?`,
      id,
    );
    if (!row?.key) return c.json({ error: 'No ID photo found' }, 404);

    const uploads = c.env.UPLOADS as R2Bucket | undefined;
    if (!uploads) return c.json({ error: 'Storage not configured' }, 503);

    const obj = await uploads.get(row.key);
    if (!obj) return c.json({ error: 'Photo not found in storage' }, 404);

    return new Response(obj.body, {
      headers: {
        'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
        'Cache-Control': 'private, max-age=300',
      },
    });
  },
);

/**
 * Age out email deliveries that will never resolve.
 *
 * email_status starts 'pending' and is settled by a follow-up call from
 * the signing page. If that page closes first — the subject walks away,
 * the tab is killed, the browser is backgrounded and reaped — nothing
 * ever settles it, and the record goes on claiming a delivery is in
 * flight. Months later an officer reading "pending" has no way to know
 * it means "never sent".
 *
 * 'unresolved', not 'failed'. We genuinely do not know: the mail may have
 * gone out and only the confirmation been lost. Recording a failure we
 * cannot demonstrate is the same class of mistake as leaving 'pending'.
 *
 * Called from the cron in src/index.ts. Returns the number aged out so a
 * sudden spike is visible in the logs rather than silent.
 */
export async function sweepStaleReceiptEmails(env: Env['Bindings'], olderThanHours = 24): Promise<number> {
  const r = await execute(
    getDb(env),
    `UPDATE serve_receipts
        SET email_status = 'unresolved',
            email_error = 'No delivery confirmation was received; the signing page '
                          || 'likely closed before the copy could be sent.'
      WHERE email_status = 'pending'
        AND created_at < datetime('now', ?)`,
    `-${Math.max(1, Math.min(720, olderThanHours))} hours`,
  ).catch((err) => {
    // Returning 0 on failure made a broken sweep indistinguishable from a
    // clean one, forever: the cron logs "aged out 0" either way, and rows
    // sit on 'pending' with nobody told the sweeper never ran.
    log.error('Stale receipt email sweep failed', { olderThanHours }, err as Error);
    return null;
  });
  const n = Number(r?.meta.changes ?? 0);
  if (n > 0) log.info('Aged out stale receipt email deliveries', { count: n, olderThanHours });
  return n;
}

export default serveReceipt;
