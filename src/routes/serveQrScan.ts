// ============================================================
// RMPG Flex — Notice of Attempt QR Code scan handler
//
// PUBLIC route mounted at /api/verify (no auth — the subject scanning
// the QR code is a member of the public with no session).
//
// On scan (GET /):
//   1. Parse the `?ref=` query param (e.g. "JOB-122" or a court case #).
//   2. Resolve the matching serve_queue row if the ref is a JOB- number.
//   3. Write a serve_qr_scans row (timestamp, IP, UA, IP-based geo).
//   4. Notify the assigned process server via WS + notifications table.
//   5. Return a subject-facing JSON payload with agency contact info.
//
// Location callback (POST /location):
//   Accepts GPS coordinates from the browser after the subject grants
//   the browser's native location permission. Updates the scan row.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, queryFirst, execute } from '../utils/db';
import { log } from '../utils/logger';
import { clientIp } from '../utils/requestIp';
import { broadcastAll } from './ws';

const app = new Hono<Env>();

// ── Helpers ──────────────────────────────────────────────────

function parseDeviceType(ua: string | null): string {
  if (!ua) return 'unknown';
  const s = ua.toLowerCase();
  if (/ipad|tablet|kindle|playbook|silk|(android(?!.*mobile))/i.test(s)) return 'tablet';
  if (/mobile|iphone|ipod|android|blackberry|mini|windows\sce|palm/i.test(s)) return 'mobile';
  return 'desktop';
}

function cfFloat(val: string | undefined): number | null {
  if (!val) return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

// ── GET / — initial QR scan ──────────────────────────────────

app.get('/', async (c) => {
  const ref = (c.req.query('ref') ?? '').trim();
  if (!ref) {
    return c.json({ ok: false, error: 'ref required' }, 400);
  }

  const db  = getDb(c.env);
  const ip  = clientIp(c);
  const ua  = c.req.header('User-Agent') ?? null;
  const now = new Date().toISOString();

  // Cloudflare IP-geo headers — present on every Worker request.
  const geoCity    = c.req.header('cf-ipcity')    ?? null;
  const geoRegion  = c.req.header('cf-ipregion')  ?? null;
  const geoCountry = c.req.header('cf-ipcountry') ?? null;
  const geoLat     = cfFloat(c.req.header('cf-iplatitude'));
  const geoLon     = cfFloat(c.req.header('cf-iplongitude'));
  const deviceType = parseDeviceType(ua);

  // Resolve serve_queue row from "JOB-<id>" ref so we can notify the officer.
  let jobId: number | null = null;
  let officerId: number | null = null;
  let recipientName: string | null = null;

  const jobMatch = /^JOB-(\d+)$/i.exec(ref);
  if (jobMatch) {
    const jobRow = await queryFirst<{ id: number; officer_id: number | null; recipient_name: string | null }>(
      db,
      'SELECT id, officer_id, recipient_name FROM serve_queue WHERE id = ?',
      parseInt(jobMatch[1], 10),
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
      `INSERT INTO serve_qr_scans
         (job_ref, job_id, scanned_at, ip_address, user_agent,
          geo_city, geo_region, geo_country, geo_lat, geo_lon, geo_source,
          device_type, notified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      ref, jobId, now, ip, ua,
      geoCity, geoRegion, geoCountry, geoLat, geoLon,
      (geoLat !== null ? 'ip' : null),
      deviceType,
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
    const locationStr = geoCity
      ? ` from ${[geoCity, geoRegion, geoCountry].filter(Boolean).join(', ')}`
      : '';
    const deviceStr = deviceType !== 'unknown' ? ` (${deviceType})` : '';
    const title   = 'QR Code Scanned — Subject Engaged';
    const message = `${recipientLabel} scanned the Notice of Attempt QR at ${scanTime} MT${locationStr}${deviceStr} (ref: ${ref}).`;

    broadcastAll('serve_qr_scan', {
      ref,
      jobId,
      scanId,
      recipientName: recipientLabel,
      scannedAt: now,
      ip,
      geoCity,
      geoRegion,
      geoCountry,
      geoLat,
      geoLon,
      deviceType,
    });

    await execute(
      db,
      `INSERT INTO notifications
         (type, priority, title, message, entity_type, entity_id, user_id, is_read, created_at)
       VALUES ('serve_qr_scan', 'high', ?, ?, 'serve_job', ?, ?, 0, datetime('now'))`,
      title, message, jobId, officerId,
    );

    if (scanId !== null) {
      await execute(db, 'UPDATE serve_qr_scans SET notified = 1 WHERE id = ?', scanId);
    }
  } catch (err) {
    log.error('serve_qr_scan: notify failed', { ref, jobId }, err as Error);
  }

  return c.json({
    ok:      true,
    ref,
    scanId,
    agency:  'Rocky Mountain Protective Group',
    phone:   '(385) 340-6555',
    website: 'https://rmpgutah.us',
    message:
      'This notice was issued by Rocky Mountain Protective Group, a licensed private process server ' +
      'operating in the State of Utah. To arrange a convenient delivery time or confirm this notice ' +
      'is genuine, please contact our office using the information above and reference: ' + ref,
  });
});

// ── POST /location — GPS callback after browser permission ───

app.post('/location', async (c) => {
  let body: { scanId?: unknown; lat?: unknown; lon?: unknown; accuracy?: unknown };
  try { body = await c.req.json(); } catch { return c.json({ ok: false }, 400); }

  const scanId  = typeof body.scanId  === 'number' ? body.scanId  : null;
  const lat     = typeof body.lat     === 'number' ? body.lat     : null;
  const lon     = typeof body.lon     === 'number' ? body.lon     : null;

  if (!scanId || lat === null || lon === null) {
    return c.json({ ok: false, error: 'scanId, lat, lon required' }, 400);
  }

  const db = getDb(c.env);
  try {
    await execute(
      db,
      `UPDATE serve_qr_scans
          SET geo_lat = ?, geo_lon = ?, geo_source = 'gps'
        WHERE id = ?`,
      lat, lon, scanId,
    );

    // Re-broadcast with precise location so the officer's live map updates.
    const row = await queryFirst<{ job_ref: string; job_id: number | null; geo_city: string | null; geo_region: string | null }>(
      db, 'SELECT job_ref, job_id, geo_city, geo_region FROM serve_qr_scans WHERE id = ?', scanId,
    );
    if (row) {
      broadcastAll('serve_qr_location', {
        scanId,
        jobId: row.job_id,
        ref: row.job_ref,
        lat,
        lon,
        source: 'gps',
      });
    }
  } catch (err) {
    log.error('serve_qr_scan: location update failed', { scanId }, err as Error);
  }

  return c.json({ ok: true });
});

export { app as serveQrScan };
