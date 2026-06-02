// ============================================================
// RMPG Flex — Announcements (officer-facing reader)
// ============================================================
// The admin CRUD lives in src/routes/admin.ts (/api/admin/announcements*).
// This module is the READ surface every authenticated user hits to see
// active broadcasts: GET /api/announcements returns announcements that
// are is_active=1, within their [starts_at, expires_at] window, and
// either untargeted ('[]' = everyone) or targeted at the caller's role.
// Consumed by the AnnouncementBanner component in the client shell.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query } from '../utils/db';

const announcements = new Hono<Env>();

announcements.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const role = c.get('user')?.role ?? '';
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT id, title, body, type, priority, target_roles, starts_at, expires_at, created_at
         FROM announcements
        WHERE is_active = 1
          AND (starts_at IS NULL OR starts_at <= datetime('now','localtime'))
          AND (expires_at IS NULL OR expires_at >= datetime('now','localtime'))
        ORDER BY
          CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
          created_at DESC`,
    );
    // Role filtering in JS — target_roles is a JSON array string; '[]'
    // (or empty/malformed) means "everyone".
    const visible = rows.filter((r) => {
      try {
        const roles = JSON.parse(String(r.target_roles ?? '[]')) as string[];
        return !Array.isArray(roles) || roles.length === 0 || roles.includes(role);
      } catch {
        return true;
      }
    });
    return c.json(visible);
  } catch (err) {
    return c.json({ error: 'Failed to load announcements', detail: String(err) }, 500);
  }
});

export default announcements;
