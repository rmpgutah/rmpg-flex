// The public Acknowledgement-of-Service endpoints — the ones reachable
// with no session at all, where the token in the URL is the entire
// credential.
//
// These run the real router against Miniflare's D1 because the defects
// they pin are in the SQL and the response branch, not in a pure helper:
// a revoked token still reaching an officer's mailbox, and a delivery
// write that matched no row reporting success anyway. A unit test of the
// validators cannot see either.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { serveReceipt } from '../src/routes/serveReceipt';

const db = () => env.DB as unknown as import('@cloudflare/workers-types').D1Database;

function app() {
  const a = new Hono<{ Bindings: Record<string, unknown>; Variables: any }>();
  a.route('/serve-receipt', serveReceipt);
  return a;
}

const post = (path: string, body: unknown) =>
  app().request(
    `/serve-receipt${path}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    env as unknown as Record<string, unknown>,
  );

// jsPDF's real output begins JVBERi0 — that is '%PDF-'.
const REAL_PDF = 'JVBERi0xLjMKJbrfrOAKMyAwIG9iago';
const LIVE_TOKEN = 'tok_live_000000000000000000';
const REVOKED_TOKEN = 'tok_revoked_00000000000000';

beforeAll(async () => {
  await db().prepare(`CREATE TABLE IF NOT EXISTS serve_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_number TEXT, assigned_officer_id INTEGER, officer_id INTEGER,
    status TEXT DEFAULT 'pending'
  )`).run();
  await db().prepare(`CREATE TABLE IF NOT EXISTS serve_receipt_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    serve_queue_id INTEGER NOT NULL, token TEXT UNIQUE NOT NULL,
    expires_at TEXT, scans_used INTEGER DEFAULT 0, max_scans INTEGER DEFAULT 25,
    revoked_at TEXT, used_receipt_id INTEGER,
    prefill_json TEXT, prefill_variant TEXT
  )`).run();
  await db().prepare(`CREATE TABLE IF NOT EXISTS serve_receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    serve_queue_id INTEGER NOT NULL, token_id INTEGER,
    recipient_name TEXT, form_title TEXT, email_to TEXT,
    email_status TEXT, email_error TEXT, email_sent_at TEXT,
    status TEXT DEFAULT 'signed'
  )`).run();
});

beforeEach(async () => {
  for (const t of ['serve_receipts', 'serve_receipt_tokens', 'serve_queue']) {
    await db().prepare(`DELETE FROM ${t}`).run();
  }
  await db().prepare(
    "INSERT INTO serve_queue (id, case_number, assigned_officer_id) VALUES (1, '2026-CV-1', 42)",
  ).run();
  await db().prepare(
    `INSERT INTO serve_receipt_tokens (id, serve_queue_id, token, used_receipt_id, revoked_at)
     VALUES (1, 1, ?, 100, NULL), (2, 1, ?, 101, '2026-07-29 00:00:00')`,
  ).bind(LIVE_TOKEN, REVOKED_TOKEN).run();
  await db().prepare(
    `INSERT INTO serve_receipts (id, serve_queue_id, token_id, recipient_name, email_to, email_status)
     VALUES (100, 1, 1, 'Jane Doe', 'jane@example.com', 'pending'),
            (101, 1, 2, 'John Roe', 'john@example.com', 'pending')`,
  ).run();
});

describe('POST /:token/email — attachment must be a PDF', () => {
  it('refuses a non-PDF attachment', async () => {
    // The payload that matters: HTML, which passed the size gate as
    // readily as a PDF and left an officer's mailbox as an attachment
    // under an RMPG subject line with a caller-chosen filename.
    const res = await post(`/${LIVE_TOKEN}/email`, {
      receipt_id: 100,
      pdf_base64: Buffer.from('<html><body>not a pdf</body></html>').toString('base64'),
      filename: 'invoice.pdf',
    });
    expect(res.status).toBe(400);
    expect((await res.json() as any).code).toBe('bad_request');

    // And nothing was recorded as attempted — a refusal is not a delivery.
    const row = await db().prepare('SELECT email_status FROM serve_receipts WHERE id = 100').first<any>();
    expect(row.email_status).toBe('pending');
  });

  it('does not reject a genuine PDF on the way in', async () => {
    // Pins that the guard is not simply refusing everything: this gets
    // past validation into the send path (which has no mail binding in
    // test, so any outcome other than the 400 above is the point).
    const res = await post(`/${LIVE_TOKEN}/email`, { receipt_id: 100, pdf_base64: REAL_PDF });
    expect(res.status).not.toBe(400);
  });
});

describe('POST /:token/email — revocation still bites', () => {
  it('will not mail for a revoked token', async () => {
    // resolveToken cannot guard this route (the token is spent by now, and
    // it treats spent as failure), so revocation was checked nowhere: a
    // supervisor revoking a link after signature meant "stop acting on
    // this", and the holder could still make an officer's mailbox send.
    const res = await post(`/${REVOKED_TOKEN}/email`, { receipt_id: 101, pdf_base64: REAL_PDF });
    expect(res.status).toBe(404);
    expect((await res.json() as any).code).toBe('not_found');
  });

  it('still serves the un-revoked token for the same job', async () => {
    // Guards against over-broad matching — one revoked token must not
    // disable its sibling.
    const res = await post(`/${LIVE_TOKEN}/email`, { receipt_id: 100, pdf_base64: REAL_PDF });
    expect(res.status).not.toBe(404);
  });
});

describe('POST /:token/delivery — a write that matched nothing is not a success', () => {
  it('reports 404 when the token and receipt do not pair', async () => {
    // Previously ok:true. A signing page whose status never landed looked
    // identical to one that did, and the receipt sat on 'pending' forever
    // with nothing anywhere recording that a write had been dropped.
    const res = await post(`/${LIVE_TOKEN}/delivery`, { receipt_id: 101, status: 'sent' });
    expect(res.status).toBe(404);

    // The other recipient's row must be untouched by the mismatch.
    const row = await db().prepare('SELECT email_status FROM serve_receipts WHERE id = 101').first<any>();
    expect(row.email_status).toBe('pending');
  });

  it('records the status when the pair is genuine', async () => {
    const res = await post(`/${LIVE_TOKEN}/delivery`, { receipt_id: 100, status: 'sent' });
    expect(res.status).toBe(200);
    const row = await db().prepare(
      'SELECT email_status, email_sent_at FROM serve_receipts WHERE id = 100',
    ).first<any>();
    expect(row.email_status).toBe('sent');
    expect(row.email_sent_at).toBeTruthy();
  });
});
