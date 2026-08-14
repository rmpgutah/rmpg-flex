// ============================================================
// RMPG Flex — Notice of Attempt QR Code scan handler
//
// PUBLIC route mounted at /api/verify (no auth — the subject scanning
// the QR code is a member of the public with no session).
//
// On scan:
//   1. Parse the `?ref=` query param (e.g. "JOB-122" or a court case #).
//   2. Resolve the matching serve_queue row if the ref is a JOB- number.
//   3. Write a serve_qr_scans row (timestamp, IP, UA).
//   4. Notify the assigned process server via WS + notifications table.
//   5. Return a subject-facing JSON payload with agency contact info.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, queryFirst, execute } from '../utils/db';
import { log } from '../utils/logger';
import { clientIp } from '../utils/requestIp';
import { broadcastAll } from './ws';

const app = new Hono<Env>();

app.get('/', async (c) => {
  const ref = (c.req.query('ref') ?? '').trim();
  if (!ref) {
    return c.json({ ok: false, error: 'ref required' }, 400);
  }

  const db  = getDb(c.env);
  const ip  = clientIp(c);
  const ua  = c.req.header('User-Agent') ?? null;
  const now = new Date().toISOString();

  // Resolve serve_queue row from "JOB-<id>" ref so we can notify the officer.
  let jobId: number | null = null;
  let officerId: number | null = null;
  let recipientName: string | null = null;

  const jobMatch = /^JOB-(\d+)$/i.exec(ref);
  if (jobMatch) {
    const jobRow = await queryFirst<{ id: number; officer_id: number | null; recipient_name: string | null }>(
      db,
      'SELECT id, officer_id, recipient_name FROM serve_queue WHERE id = ?',
      [parseInt(jobMatch[1], 10)],
    );
    if (jobRow) {
      jobId        = jobRow.id;
      officerId    = jobRow.officer_id;
      recipientName = jobRow.recipient_name;
    }
  }

  // Log the scan — best effort, don't let a DB error block the response.
  let scanId: number | null = null;
  try {
    const ins = await execute(
      db,
      'INSERT INTO serve_qr_scans (job_ref, job_id, scanned_at, ip_address, user_agent, notified) VALUES (?, ?, ?, ?, ?, 0)',
      [ref, jobId, now, ip, ua],
    );
    scanId = ins.meta?.last_row_id ?? null;
  } catch (err) {
    log.error('serve_qr_scan: insert failed', { ref, jobId }, err as Error);
  }

  // Notify the assigned officer (WS push + persistent notification).
  try {
    const scanTime = new Date(now).toLocaleTimeString('en-US', {
      timeZone: 'America/Denver',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
    const recipientLabel = recipientName ?? 'Subject';
    const title   = 'QR Code Scanned — Subject Engaged';
    const message = `${recipientLabel} scanned the Notice of Attempt QR at ${scanTime} MT (ref: ${ref}).`;

    // Broadcast to all online officers — the serve module listens for
    // 'serve_qr_scan' to surface a toast/badge in the ServePage.
    broadcastAll('serve_qr_scan', {
      ref,
      jobId,
      scanId,
      recipientName: recipientLabel,
      scannedAt: now,
      ip,
    });

    // Persist for officers who are offline; target the assigned server when
    // known, otherwise fan out to NULL (inbox shows it to all managers).
    await execute(
      db,
      `INSERT INTO notifications
         (type, priority, title, message, entity_type, entity_id, user_id, is_read, created_at)
       VALUES ('serve_qr_scan', 'high', ?, ?, 'serve_job', ?, ?, 0, datetime('now'))`,
      [title, message, jobId, officerId],
    );

    if (scanId !== null) {
      await execute(db, 'UPDATE serve_qr_scans SET notified = 1 WHERE id = ?', [scanId]);
    }
  } catch (err) {
    log.error('serve_qr_scan: notify failed', { ref, jobId }, err as Error);
  }

  return c.json({
    ok:      true,
    ref,
    agency:  'Rocky Mountain Protective Group',
    phone:   '(385) 340-6555',
    website: 'https://rmpgutah.us',
    message:
      'This notice was issued by Rocky Mountain Protective Group, a licensed private process server ' +
      'operating in the State of Utah. To arrange a convenient delivery time or confirm this notice ' +
      'is genuine, please contact our office using the information above and reference: ' + ref,
  });
});

export { app as serveQrScan };
