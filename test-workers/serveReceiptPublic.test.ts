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
// ?raw inlines the migration text at build time. Runtime fs is not an
// option here: the workers pool percent-encodes the path it is given, so
// the space in this repo's path ("RMPG Flex") becomes %20 and every read
// misses no matter how the path is constructed.
import mig0207 from '../migrations/0207_serve_receipts.sql?raw';
import mig0209 from '../migrations/0209_serve_receipt_integrity.sql?raw';
import mig0210 from '../migrations/0210_serve_receipt_lifecycle.sql?raw';
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
  // Build the tables from the REAL migrations rather than hand-stubbing
  // them. A stub drifts from production the moment a column is added, and
  // the insert under test writes 51 columns — a thin stub fails as a 500
  // that looks like a code defect rather than a test-fixture gap.
  const sql = [mig0207, mig0209, mig0210].join('\n');

  // serve_queue and serve_attempts are pre-existing tables, not created by
  // these migrations — stubbed to the columns this router actually touches
  // (a signature advances the job and lands on the attempt timeline).
  await db().prepare(`CREATE TABLE IF NOT EXISTS serve_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_number TEXT, assigned_officer_id INTEGER, officer_id INTEGER,
    recipient_name TEXT, defendant_name TEXT,
    status TEXT DEFAULT 'pending', serve_date TEXT, updated_at TEXT
  )`).run();
  // Audit writes are fire-and-forget; without the table they log a warning
  // on every signature, which is noise that would mask a real failure.
  await db().prepare(`CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT, entity_type TEXT, entity_id INTEGER,
    details TEXT, user_id INTEGER, created_at TEXT DEFAULT (datetime('now'))
  )`).run();
  await db().prepare(`CREATE TABLE IF NOT EXISTS serve_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, serve_queue_id INTEGER,
    attempt_number INTEGER, attempt_at TEXT, result TEXT,
    latitude REAL, longitude REAL,
    -- No receipt_id on live serve_attempts (the link lives on
    -- serve_receipt_tokens.used_receipt_id).
    notes TEXT, attempt_type TEXT, signature_data TEXT
  )`).run();

  // Strip comment lines BEFORE splitting. Each migration opens with a
  // comment block, and because comments carry no semicolon that block and
  // the CREATE TABLE after it are one "statement" — skipping anything
  // starting with '--' silently skipped the table itself.
  const stripped = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  for (const stmt of stripped.split(';')) {
    const t = stmt.trim();
    if (!t) continue;
    // 0209's ALTER is expected to fail on a fresh 0207 table that already
    // declares the column; that is the documented D1 re-apply behaviour.
    await db().prepare(t).run().catch(() => undefined);
  }
});

beforeEach(async () => {
  for (const t of ['serve_receipts', 'serve_receipt_tokens', 'serve_queue']) {
    await db().prepare(`DELETE FROM ${t}`).run();
  }
  // Three jobs, because 0209 enforces ONE signed receipt per job with a
  // partial unique index. Two signed receipts sharing a serve_queue_id is
  // exactly the contradiction that index exists to prevent, so the
  // fixture must not create one.
  await db().prepare(
    `INSERT INTO serve_queue (id, case_number, assigned_officer_id)
     VALUES (1, '2026-CV-1', 42), (2, '2026-CV-2', 42), (3, '2026-CV-3', 42)`,
  ).run();
  await db().prepare(
    `INSERT INTO serve_receipt_tokens (id, serve_queue_id, token, used_receipt_id, revoked_at)
     VALUES (1, 1, ?, 100, NULL), (2, 2, ?, 101, '2026-07-29 00:00:00')`,
  ).bind(LIVE_TOKEN, REVOKED_TOKEN).run();
  await db().prepare(
    `INSERT INTO serve_receipts (id, serve_queue_id, token_id, recipient_name, email_to, email_status)
     VALUES (100, 1, 1, 'Jane Doe', 'jane@example.com', 'pending'),
            (101, 2, 2, 'John Roe', 'john@example.com', 'pending')`,
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

describe('POST /:token — the variant conflict signal', () => {
  // The officer's doorstep read is advisory; the signer knows their own
  // household. Disagreement is not an error, but variant_conflict is the
  // ONLY signal a supervisor gets before an affidavit is filed on it.
  //
  // It used to be written by a separate UPDATE that swallowed its own
  // failure, so a conflict could vanish leaving a clean-looking record.
  const PNG = 'data:image/png;base64,'
    + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(200).fill(0)])
        .toString('base64');

  async function mintToken(token: string, prefillVariant: string | null) {
    await db().prepare(
      `INSERT INTO serve_receipt_tokens (serve_queue_id, token, prefill_variant, max_scans)
       VALUES (3, ?, ?, 25)`,
    ).bind(token, prefillVariant).run();
  }

  const sign = (token: string, over: Record<string, unknown> = {}) =>
    post(`/${token}`, {
      form_variant: 'individual',
      recipient_name: 'Jane Doe',
      // Both required by validateReceiptSubmission: a proof of service
      // whose signer cannot be reached afterwards is hard to stand behind
      // if the service is ever contested.
      recipient_phone: '(801) 555-0142',
      recipient_email: 'jane@example.com',
      recipient_age_confirmed: true,
      ack_received_documents: true,
      ack_information_true: true,
      recipient_signature: PNG,
      ...over,
    });

  it('records a conflict when the officer read the doorstep differently', async () => {
    // Officer said co-habitant; the signer answers as the named party.
    await mintToken('tok_conflict_0000000000000', 'co_habitant');
    const res = await sign('tok_conflict_0000000000000');
    expect(res.status).toBe(201);

    const row = await db().prepare(
      `SELECT officer_variant, variant_conflict, form_variant, completion_channel
         FROM serve_receipts ORDER BY id DESC LIMIT 1`,
    ).first<any>();
    expect(row.form_variant).toBe('individual');
    expect(row.officer_variant).toBe('co_habitant');
    expect(row.variant_conflict).toBe(1);
    // Written in the SAME statement, so a conflict cannot land without it.
    expect(row.completion_channel).toBe('mobile');
  });

  it('records agreement as no conflict, without discarding the officer read', async () => {
    await mintToken('tok_agree_000000000000000', 'individual');
    expect((await sign('tok_agree_000000000000000')).status).toBe(201);

    const row = await db().prepare(
      'SELECT officer_variant, variant_conflict FROM serve_receipts ORDER BY id DESC LIMIT 1',
    ).first<any>();
    expect(row.officer_variant).toBe('individual');
    expect(row.variant_conflict).toBe(0);
  });

  it('distinguishes "no officer opinion" from "officer agreed"', async () => {
    // variant_conflict is NOT NULL DEFAULT 0, so absence of a doorstep
    // read cannot be encoded there — a token minted without a prefill
    // reads 0, identically to an officer who agreed.
    //
    // officer_variant is what separates them, and it must stay NULL: a
    // supervisor reading "conflict: no" needs to know whether anyone
    // actually looked. This pins that COALESCE does not invent an opinion.
    await mintToken('tok_noprefill_00000000000', null);
    expect((await sign('tok_noprefill_00000000000')).status).toBe(201);

    const row = await db().prepare(
      `SELECT officer_variant, variant_conflict, completion_channel
         FROM serve_receipts ORDER BY id DESC LIMIT 1`,
    ).first<any>();
    expect(row.officer_variant).toBeNull();
    expect(row.variant_conflict).toBe(0);
    // The channel still lands — it does not depend on the prefill.
    expect(row.completion_channel).toBe('mobile');
  });

  it('burns the token so the link cannot be signed twice', async () => {
    await mintToken('tok_burn_0000000000000000', null);
    expect((await sign('tok_burn_0000000000000000')).status).toBe(201);
    const second = await sign('tok_burn_0000000000000000');
    expect(second.status).toBe(409);
    expect((await second.json() as any).code).toBe('already_signed');
  });
});
