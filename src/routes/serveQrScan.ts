// ============================================================
// RMPG Flex — Notice of Attempt QR Code scan handler
//
// PUBLIC route mounted at /api/verify (no auth — the subject scanning
// the QR code is a member of the public with no session).
//
// GET /                      Initial scan log + officer notification
// POST /location             GPS coords after browser permission grant
// POST /telemetry            Passive browser environment (no prompts)
// POST /details              Rich async fingerprint (canvas, WebGL, battery, WebRTC)
// POST /details/timeonpage   Time-on-page beacon (sendBeacon on pagehide)
// GET  /scans?jobRef=JOB-N   Scan history for a job (JWT auth required)
// ============================================================

import { Hono } from "hono";
import type { Env } from "../types";
import { getDb, queryFirst, execute, query } from "../utils/db";
import { log } from "../utils/logger";
import { clientIp } from "../utils/requestIp";
import { broadcastAll } from "./ws";
import { authMiddleware } from "../middleware/auth";

const app = new Hono<Env>();

// ── Helpers ──────────────────────────────────────────────────

function parseDeviceType(ua: string | null): string {
  if (!ua) return "unknown";
  const s = ua.toLowerCase();
  if (/ipad|tablet|kindle|playbook|silk|(android(?!.*mobile))/i.test(s))
    return "tablet";
  if (/mobile|iphone|ipod|android|blackberry|mini|windows\sce|palm/i.test(s))
    return "mobile";
  return "desktop";
}

function cfFloat(val: string | undefined): number | null {
  if (!val) return null;
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : null;
}

const toInt = (v: unknown) =>
  typeof v === "number" && isFinite(v) ? Math.round(v) : null;
const toFlt = (v: unknown) =>
  typeof v === "number" && isFinite(v) ? v : null;
const toStr = (v: unknown, max = 512) =>
  typeof v === "string" && v.length <= max ? v : null;
const toBool = (v: unknown) =>
  typeof v === "boolean" ? (v ? 1 : 0) : null;

// ── GET / — initial QR scan ──────────────────────────────────

app.get("/", async (c) => {
  const ref = (c.req.query("ref") ?? "").trim();
  if (!ref) {
    return c.json({ ok: false, error: "ref required" }, 400);
  }

  const db = getDb(c.env);
  const ip = clientIp(c);
  const ua = c.req.header("User-Agent") ?? null;
  const now = new Date().toISOString();

  // Cloudflare IP-geo headers — present on every Worker request.
  const geoCity = c.req.header("cf-ipcity") ?? null;
  const geoRegion = c.req.header("cf-ipregion") ?? null;
  const geoCountry = c.req.header("cf-ipcountry") ?? null;
  const geoLat = cfFloat(c.req.header("cf-iplatitude"));
  const geoLon = cfFloat(c.req.header("cf-iplongitude"));
  const deviceType = parseDeviceType(ua);

  // Resolve serve_queue row from "JOB-<id>" ref so we can notify the officer.
  let jobId: number | null = null;
  let officerId: number | null = null;
  let recipientName: string | null = null;

  const jobMatch = /^JOB-(\d+)$/i.exec(ref);
  if (jobMatch) {
    const jobRow = await queryFirst<{
      id: number;
      officer_id: number | null;
      recipient_name: string | null;
    }>(
      db,
      "SELECT id, officer_id, recipient_name FROM serve_queue WHERE id = ?",
      parseInt(jobMatch[1], 10),
    );
    if (jobRow) {
      jobId = jobRow.id;
      officerId = jobRow.officer_id;
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
      ref,
      jobId,
      now,
      ip,
      ua,
      geoCity,
      geoRegion,
      geoCountry,
      geoLat,
      geoLon,
      geoLat !== null ? "ip" : null,
      deviceType,
    );
    scanId = ins.meta?.last_row_id ?? null;
  } catch (err) {
    log.error("serve_qr_scan: insert failed", { ref, jobId }, err as Error);
  }

  // Notify the assigned officer (WS push + persistent notification).
  try {
    const scanTime = new Date(now).toLocaleTimeString("en-US", {
      timeZone: "America/Denver",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    const recipientLabel = recipientName ?? "Subject";
    const locationStr = geoCity
      ? ` from ${[geoCity, geoRegion, geoCountry].filter(Boolean).join(", ")}`
      : "";
    const deviceStr = deviceType !== "unknown" ? ` (${deviceType})` : "";
    const title = "QR Code Scanned — Subject Engaged";
    const message = `${recipientLabel} scanned the Notice of Attempt QR at ${scanTime} MT${locationStr}${deviceStr} (ref: ${ref}).`;

    broadcastAll("serve_qr_scan", {
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
      title,
      message,
      jobId,
      officerId,
    );

    if (scanId !== null) {
      await execute(
        db,
        "UPDATE serve_qr_scans SET notified = 1 WHERE id = ?",
        scanId,
      );
    }
  } catch (err) {
    log.error("serve_qr_scan: notify failed", { ref, jobId }, err as Error);
  }

  return c.json({
    ok: true,
    ref,
    scanId,
    agency: "Rocky Mountain Protective Group",
    phone: "(385) 340-6555",
    website: "https://rmpgutah.us",
    message:
      "This notice was issued by Rocky Mountain Protective Group, a licensed private process server " +
      "operating in the State of Utah. To arrange a convenient delivery time or confirm this notice " +
      "is genuine, please contact our office using the information above and reference: " +
      ref,
  });
});

// ── POST /location — GPS callback after browser permission ───

app.post("/location", async (c) => {
  let body: { scanId?: unknown; lat?: unknown; lon?: unknown; accuracy?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false }, 400);
  }

  const scanId = typeof body.scanId === "number" ? body.scanId : null;
  const lat = typeof body.lat === "number" ? body.lat : null;
  const lon = typeof body.lon === "number" ? body.lon : null;

  if (!scanId || lat === null || lon === null) {
    return c.json({ ok: false, error: "scanId, lat, lon required" }, 400);
  }

  const db = getDb(c.env);
  try {
    await execute(
      db,
      `UPDATE serve_qr_scans
          SET geo_lat = ?, geo_lon = ?, geo_source = 'gps'
        WHERE id = ?`,
      lat,
      lon,
      scanId,
    );

    const row = await queryFirst<{
      job_ref: string;
      job_id: number | null;
      geo_city: string | null;
      geo_region: string | null;
    }>(
      db,
      "SELECT job_ref, job_id, geo_city, geo_region FROM serve_qr_scans WHERE id = ?",
      scanId,
    );
    if (row) {
      broadcastAll("serve_qr_location", {
        scanId,
        jobId: row.job_id,
        ref: row.job_ref,
        lat,
        lon,
        source: "gps",
      });
    }
  } catch (err) {
    log.error(
      "serve_qr_scan: location update failed",
      { scanId },
      err as Error,
    );
  }

  return c.json({ ok: true });
});

// ── POST /telemetry — passive browser environment data ───────

interface TelemetryBody {
  scanId?: unknown;
  screenW?: unknown;
  screenH?: unknown;
  viewportW?: unknown;
  viewportH?: unknown;
  pixelRatio?: unknown;
  colorDepth?: unknown;
  timezoneIana?: unknown;
  lang?: unknown;
  touchPoints?: unknown;
  connectionType?: unknown;
  darkMode?: unknown;
  platform?: unknown;
}

app.post("/telemetry", async (c) => {
  let body: TelemetryBody;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false }, 400);
  }

  const scanId = typeof body.scanId === "number" ? body.scanId : null;
  if (!scanId) return c.json({ ok: false, error: "scanId required" }, 400);

  const db = getDb(c.env);
  try {
    await execute(
      db,
      `UPDATE serve_qr_scans SET
         screen_w = ?, screen_h = ?, viewport_w = ?, viewport_h = ?,
         pixel_ratio = ?, color_depth = ?, timezone_iana = ?, lang = ?,
         touch_points = ?, connection_type = ?, dark_mode = ?, platform = ?
       WHERE id = ?`,
      toInt(body.screenW),
      toInt(body.screenH),
      toInt(body.viewportW),
      toInt(body.viewportH),
      toFlt(body.pixelRatio),
      toInt(body.colorDepth),
      toStr(body.timezoneIana, 64),
      toStr(body.lang, 32),
      toInt(body.touchPoints),
      toStr(body.connectionType, 32),
      toBool(body.darkMode),
      toStr(body.platform, 64),
      scanId,
    );
  } catch (err) {
    log.error(
      "serve_qr_scan: telemetry update failed",
      { scanId },
      err as Error,
    );
  }

  return c.json({ ok: true });
});

// ── POST /details — rich async fingerprint data ───────────────
// canvas_fingerprint is a SHA-256 hex of drawn pixel data.
// local_ips is a JSON-serialized string[] from WebRTC ICE candidates.

interface DetailsBody {
  scanId?: unknown;
  hardwareConcurrency?: unknown;
  deviceMemory?: unknown;
  batteryLevel?: unknown;
  batteryCharging?: unknown;
  connectionDownlink?: unknown;
  connectionRtt?: unknown;
  connectionSaveData?: unknown;
  screenAvailW?: unknown;
  screenAvailH?: unknown;
  screenOrientation?: unknown;
  colorGamut?: unknown;
  hdrSupport?: unknown;
  reducedMotion?: unknown;
  pointerType?: unknown;
  cookieEnabled?: unknown;
  doNotTrack?: unknown;
  canvasFingerprint?: unknown;
  webglVendor?: unknown;
  webglRenderer?: unknown;
  localIps?: unknown;
  historyLength?: unknown;
  referrer?: unknown;
  pdfSupport?: unknown;
}

app.post("/details", async (c) => {
  let body: DetailsBody;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false }, 400);
  }

  const scanId = typeof body.scanId === "number" ? body.scanId : null;
  if (!scanId) return c.json({ ok: false, error: "scanId required" }, 400);

  // Validate local_ips: JSON array of IP strings, max 10 entries.
  let localIpsJson: string | null = null;
  if (Array.isArray(body.localIps)) {
    const ips = (body.localIps as unknown[])
      .filter(
        (ip): ip is string =>
          typeof ip === "string" && /^[\d.:a-f%]+$/i.test(ip),
      )
      .slice(0, 10);
    if (ips.length > 0) localIpsJson = JSON.stringify(ips);
  }

  const db = getDb(c.env);
  try {
    // ON CONFLICT upsert — replay-safe if client re-sends.
    await execute(
      db,
      `INSERT INTO serve_scan_details
         (scan_id, hardware_concurrency, device_memory,
          battery_level, battery_charging,
          connection_downlink, connection_rtt, connection_save_data,
          screen_avail_w, screen_avail_h, screen_orientation,
          color_gamut, hdr_support, reduced_motion, pointer_type,
          cookie_enabled, do_not_track,
          canvas_fingerprint, webgl_vendor, webgl_renderer,
          local_ips, history_length, referrer, pdf_support)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(scan_id) DO UPDATE SET
         hardware_concurrency = excluded.hardware_concurrency,
         device_memory        = excluded.device_memory,
         battery_level        = excluded.battery_level,
         battery_charging     = excluded.battery_charging,
         connection_downlink  = excluded.connection_downlink,
         connection_rtt       = excluded.connection_rtt,
         connection_save_data = excluded.connection_save_data,
         screen_avail_w       = excluded.screen_avail_w,
         screen_avail_h       = excluded.screen_avail_h,
         screen_orientation   = excluded.screen_orientation,
         color_gamut          = excluded.color_gamut,
         hdr_support          = excluded.hdr_support,
         reduced_motion       = excluded.reduced_motion,
         pointer_type         = excluded.pointer_type,
         cookie_enabled       = excluded.cookie_enabled,
         do_not_track         = excluded.do_not_track,
         canvas_fingerprint   = excluded.canvas_fingerprint,
         webgl_vendor         = excluded.webgl_vendor,
         webgl_renderer       = excluded.webgl_renderer,
         local_ips            = COALESCE(excluded.local_ips, local_ips),
         history_length       = excluded.history_length,
         referrer             = excluded.referrer,
         pdf_support          = excluded.pdf_support`,
      scanId,
      toInt(body.hardwareConcurrency),
      toFlt(body.deviceMemory),
      toFlt(body.batteryLevel),
      toBool(body.batteryCharging),
      toFlt(body.connectionDownlink),
      toInt(body.connectionRtt),
      toBool(body.connectionSaveData),
      toInt(body.screenAvailW),
      toInt(body.screenAvailH),
      toStr(body.screenOrientation, 32),
      toStr(body.colorGamut, 16),
      toBool(body.hdrSupport),
      toBool(body.reducedMotion),
      toStr(body.pointerType, 16),
      toBool(body.cookieEnabled),
      toStr(body.doNotTrack, 4),
      toStr(body.canvasFingerprint, 64),
      toStr(body.webglVendor, 256),
      toStr(body.webglRenderer, 256),
      localIpsJson,
      toInt(body.historyLength),
      toStr(body.referrer, 512),
      toBool(body.pdfSupport),
    );

    // Re-broadcast enhanced data to officers watching the serve module.
    const scanRow = await queryFirst<{ job_ref: string; job_id: number | null }>(
      db,
      "SELECT job_ref, job_id FROM serve_qr_scans WHERE id = ?",
      scanId,
    );
    if (scanRow) {
      broadcastAll("serve_qr_details", {
        scanId,
        jobId: scanRow.job_id,
        ref: scanRow.job_ref,
        canvasFingerprint: toStr(body.canvasFingerprint, 64),
        webglRenderer: toStr(body.webglRenderer, 256),
        localIps: localIpsJson,
        hardwareConcurrency: toInt(body.hardwareConcurrency),
        deviceMemory: toFlt(body.deviceMemory),
        batteryLevel: toFlt(body.batteryLevel),
      });
    }
  } catch (err) {
    log.error(
      "serve_qr_scan: details insert failed",
      { scanId },
      err as Error,
    );
  }

  return c.json({ ok: true });
});

// ── POST /details/timeonpage — page visibility update ────────

app.post("/details/timeonpage", async (c) => {
  let body: { scanId?: unknown; ms?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false }, 400);
  }

  const scanId = typeof body.scanId === "number" ? body.scanId : null;
  const ms =
    typeof body.ms === "number"
      ? Math.min(Math.round(body.ms), 86_400_000)
      : null;

  if (!scanId || ms === null)
    return c.json({ ok: false, error: "scanId + ms required" }, 400);

  const db = getDb(c.env);
  try {
    await execute(
      db,
      "UPDATE serve_scan_details SET time_on_page_ms = ? WHERE scan_id = ?",
      ms,
      scanId,
    );
  } catch (err) {
    log.error(
      "serve_qr_scan: timeonpage update failed",
      { scanId },
      err as Error,
    );
  }
  return c.json({ ok: true });
});

// ── GET /scans — officer view of scan history for a job ──────
// Requires JWT authentication.

app.use("/scans", authMiddleware);

app.get("/scans", async (c) => {
  const jobRef = (c.req.query("jobRef") ?? "").trim();
  if (!jobRef) return c.json({ ok: false, error: "jobRef required" }, 400);

  const db = getDb(c.env);

  const scans = await query<Record<string, unknown>>(
    db,
    `SELECT
       s.id, s.job_ref, s.job_id, s.scanned_at, s.ip_address, s.user_agent,
       s.geo_city, s.geo_region, s.geo_country, s.geo_lat, s.geo_lon, s.geo_source,
       s.device_type, s.screen_w, s.screen_h, s.viewport_w, s.viewport_h,
       s.pixel_ratio, s.color_depth, s.timezone_iana, s.lang,
       s.touch_points, s.connection_type, s.dark_mode, s.platform,
       d.hardware_concurrency, d.device_memory, d.battery_level, d.battery_charging,
       d.connection_downlink, d.connection_rtt, d.connection_save_data,
       d.screen_avail_w, d.screen_avail_h, d.screen_orientation,
       d.color_gamut, d.hdr_support, d.reduced_motion, d.pointer_type,
       d.cookie_enabled, d.do_not_track,
       d.canvas_fingerprint, d.webgl_vendor, d.webgl_renderer,
       d.local_ips, d.history_length, d.referrer, d.pdf_support, d.time_on_page_ms
     FROM serve_qr_scans s
     LEFT JOIN serve_scan_details d ON d.scan_id = s.id
     WHERE s.job_ref = ?
     ORDER BY s.scanned_at DESC
     LIMIT 50`,
    jobRef,
  );

  return c.json({ ok: true, scans });
});

export { app as serveQrScan };
