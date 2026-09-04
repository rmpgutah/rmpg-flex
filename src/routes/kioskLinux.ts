// ============================================================
// RMPG Flex — Kiosk Linux device registry (sub-project 4)
// ============================================================
// Registration + fleet tracking for Kiosk Linux devices. No OTA image
// delivery — see docs/superpowers/specs/2026-07-23-kiosk-linux-device-registry-design.md.
//
// Backed by a DEDICATED D1 database (kiosk-linux-fleet, bound KIOSK_DB) and
// R2 bucket (kiosk-linux-devices, bound KIOSK_DEVICES) — both separate from
// the main rmpg-flex DB and rmpg-flex-downloads bucket. Unset → every route
// returns { ok:false, code:'not_configured' }, never a crash.
//
// Admin endpoints (register/list/revoke) use the existing JWT authMiddleware
// + requireRole, applied per-route rather than per-prefix — this router
// ALSO serves device-token-authed endpoints (checkin/upload) that carry no
// JWT at all, so a blanket prefix-level authMiddleware would 401 every
// device check-in.
// ============================================================

import { Hono } from 'hono';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import bcrypt from 'bcryptjs';
import type { Env } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';
import { deviceAuthMiddleware } from '../middleware/kioskDeviceAuth';

const kioskLinux = new Hono<Env>();

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function nowIso(): string {
  return new Date().toISOString();
}

function requireKioskDb(env: { KIOSK_DB?: D1Database }): D1Database | null {
  return env.KIOSK_DB ?? null;
}

// ── Admin: register a device ────────────────────────────────
kioskLinux.post('/devices', authMiddleware, requireRole('admin', 'manager'), async (c) => {
  const db = requireKioskDb(c.env);
  if (!db) return c.json({ ok: false, code: 'not_configured' }, 200);

  const body = await c.req.json<{ label?: string }>().catch(() => ({}) as { label?: string });
  const label = body.label?.trim();
  if (!label) return c.json({ error: 'label is required' }, 400);

  const id = crypto.randomUUID();
  const token = randomToken();
  const tokenHash = await bcrypt.hash(token, 10);
  const registeredAt = nowIso();

  await db
    .prepare(
      `INSERT INTO kiosk_devices (id, label, token_hash, status, registered_at)
       VALUES (?, ?, ?, 'active', ?)`,
    )
    .bind(id, label, tokenHash, registeredAt)
    .run();

  // The ONLY response that ever carries the plaintext token.
  return c.json({ id, label, token, registered_at: registeredAt });
});

// ── Admin: list devices ──────────────────────────────────────
kioskLinux.get('/devices', authMiddleware, requireRole('admin', 'manager'), async (c) => {
  const db = requireKioskDb(c.env);
  if (!db) return c.json({ ok: false, code: 'not_configured' }, 200);

  const result = await db
    .prepare(
      `SELECT id, label, os_version, status, registered_at, last_seen_at, last_ip
       FROM kiosk_devices ORDER BY registered_at DESC`,
    )
    .all();
  return c.json({ devices: result.results ?? [] });
});

// ── Admin: revoke a device ───────────────────────────────────
kioskLinux.delete('/devices/:id', authMiddleware, requireRole('admin', 'manager'), async (c) => {
  const db = requireKioskDb(c.env);
  if (!db) return c.json({ ok: false, code: 'not_configured' }, 200);

  const id = c.req.param('id');
  const result = await db
    .prepare(`UPDATE kiosk_devices SET status = 'revoked' WHERE id = ? AND status = 'active'`)
    .bind(id)
    .run();
  if (!result.meta?.changes) {
    return c.json({ error: 'Device not found or already revoked' }, 404);
  }
  return c.json({ success: true });
});

// ── Device: check-in ─────────────────────────────────────────
kioskLinux.post('/devices/:id/checkin', deviceAuthMiddleware, async (c) => {
  const db = requireKioskDb(c.env);
  if (!db) return c.json({ ok: false, code: 'not_configured' }, 200);

  const device = c.get('kioskDevice');
  if (!device) return c.json({ error: 'Device authentication required' }, 401);
  const body = await c.req.json<{ os_version?: string }>().catch(() => ({}) as { os_version?: string });
  const lastIp = c.req.header('CF-Connecting-IP') ?? null;
  // Cap os_version length to prevent oversized strings reaching D1.
  const osVersion = typeof body.os_version === 'string' ? body.os_version.slice(0, 128) : null;

  await db
    .prepare(
      `UPDATE kiosk_devices SET last_seen_at = ?, os_version = COALESCE(?, os_version), last_ip = ?
       WHERE id = ?`,
    )
    .bind(nowIso(), osVersion, lastIp, device.id)
    .run();

  return c.json({ ok: true });
});

// ── Device: upload a config or log file ─────────────────────
kioskLinux.post('/devices/:id/upload', deviceAuthMiddleware, async (c) => {
  const db = requireKioskDb(c.env);
  const bucket = (c.env as { KIOSK_DEVICES?: R2Bucket }).KIOSK_DEVICES;
  if (!db || !bucket) return c.json({ ok: false, code: 'not_configured' }, 200);

  const device = c.get('kioskDevice');
  if (!device) return c.json({ error: 'Device authentication required' }, 401);
  const form = await c.req.formData();
  const file = form.get('file');
  const kind = form.get('kind');
  if (!(file instanceof File) || (kind !== 'config' && kind !== 'log')) {
    return c.json({ error: 'file (multipart) and kind ("config"|"log") are required' }, 400);
  }

  const uploadedAt = nowIso();
  const r2Key = `${device.id}/${kind}/${uploadedAt}-${file.name}`;
  await bucket.put(r2Key, file.stream());

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO kiosk_device_uploads (id, device_id, kind, r2_key, size_bytes, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, device.id, kind, r2Key, file.size, uploadedAt)
    .run();

  return c.json({ ok: true, id, r2_key: r2Key });
});

export default kioskLinux;
