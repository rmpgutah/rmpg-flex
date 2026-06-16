// ============================================================
// RMPG Flex — Secure Evidence chain-of-custody manifests
// ============================================================
// Each secure capture from the iOS evidence camera files a manifest here: the
// SHA-256 of the ORIGINAL frame (also burned into the photo's pixels), its
// classification, exhibit sequence, officer, GPS, and capture time. The stored
// photo is therefore self-verifying — recompute the hash and check it against
// the burned-in fingerprint and this manifest.
//
//   POST /                file a manifest          -> {data}
//   GET  /                list (newest first)      -> {data}
//   GET  /verify/:sha256  confirm a hash is filed  -> {verified, match?}
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { emitAnalytics, flexEvent } from '../utils/analytics';
import { normalizeClassification, validateManifest, evidenceNumber, shortHash } from '../utils/evidence';

const evidence = new Hono<Env>();

async function ensureTable(db: ReturnType<typeof getDb>): Promise<void> {
  await execute(db, `CREATE TABLE IF NOT EXISTS evidence_manifests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    evidence_number TEXT,
    sha256 TEXT NOT NULL,
    classification TEXT NOT NULL DEFAULT 'EVIDENCE',
    sequence INTEGER,
    officer_id INTEGER,
    officer_name TEXT,
    badge TEXT,
    unit TEXT,
    case_ref TEXT,
    gps_lat REAL,
    gps_lng REAL,
    device_id TEXT,
    mime TEXT,
    captured_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);
  await execute(db, `CREATE INDEX IF NOT EXISTS idx_evidence_sha ON evidence_manifests(sha256)`);
}

// POST / — file a manifest.
evidence.post('/', async (c): Promise<Response> => {
  const db = getDb(c.env);
  await ensureTable(db);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const check = validateManifest(body);
  if (!check.ok) return c.json({ error: check.error }, 400);

  const userId = (c.get('userId') as number | undefined) ?? null;
  const year = new Date().getFullYear();
  const countRow = await queryFirst<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM evidence_manifests WHERE strftime('%Y', created_at) = ?`,
    String(year),
  ).catch(() => ({ n: 0 }) as { n: number });
  const evNumber = evidenceNumber(year, (countRow?.n ?? 0) + 1);

  const sha = String((body as Record<string, unknown>).sha256 ?? '');
  const res = await execute(
    db,
    `INSERT INTO evidence_manifests
       (evidence_number, sha256, classification, sequence, officer_id, officer_name,
        badge, unit, case_ref, gps_lat, gps_lng, device_id, mime, captured_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    evNumber,
    sha,
    normalizeClassification((body as Record<string, unknown>).classification),
    Number((body as Record<string, unknown>).sequence ?? 0) || 0,
    userId,
    String((body as Record<string, unknown>).officer_name ?? ''),
    String((body as Record<string, unknown>).badge ?? ''),
    String((body as Record<string, unknown>).unit ?? ''),
    String((body as Record<string, unknown>).case_ref ?? ''),
    (body as Record<string, unknown>).gps_lat ?? null,
    (body as Record<string, unknown>).gps_lng ?? null,
    String((body as Record<string, unknown>).device_id ?? ''),
    String((body as Record<string, unknown>).mime ?? 'image/jpeg'),
    String((body as Record<string, unknown>).captured_at ?? ''),
  );
  // Analytics lakehouse: evidence-logged event (best-effort, fire-and-forget).
  emitAnalytics(c.executionCtx, c.env.EVENTS, [flexEvent({
    event_type: 'evidence_logged', occurred_at: new Date().toISOString(),
    actor_id: userId, entity_type: 'evidence', entity_id: Number(res.meta?.last_row_id) || null,
    lat: (body as Record<string, unknown>).gps_lat, lng: (body as Record<string, unknown>).gps_lng,
    label: evNumber, category: 'evidence',
    payload: {
      classification: String((body as Record<string, unknown>).classification ?? ''),
      case_ref: String((body as Record<string, unknown>).case_ref ?? ''),
    },
  })]);

  return c.json({
    data: { id: res.meta?.last_row_id, evidence_number: evNumber, sha256: sha, short_hash: shortHash(sha) },
  });
});

// GET / — list newest first.
evidence.get('/', async (c): Promise<Response> => {
  const db = getDb(c.env);
  await ensureTable(db);
  const limit = Math.min(parseInt(c.req.query('limit') || '100', 10) || 100, 500);
  const rows = await query<Record<string, unknown>>(
    db,
    `SELECT * FROM evidence_manifests ORDER BY id DESC LIMIT ?`,
    limit,
  ).catch(() => [] as Record<string, unknown>[]);
  return c.json({ data: rows });
});

// GET /verify/:sha256 — confirm a (full or 16-char prefix) hash was filed.
evidence.get('/verify/:sha256', async (c): Promise<Response> => {
  const db = getDb(c.env);
  await ensureTable(db);
  const sha = c.req.param('sha256');
  const match = await queryFirst<Record<string, unknown>>(
    db,
    `SELECT id, evidence_number, sha256, classification, captured_at
       FROM evidence_manifests WHERE sha256 = ? OR sha256 LIKE ? ORDER BY id DESC LIMIT 1`,
    sha,
    `${sha}%`,
  ).catch(() => null);
  return c.json({ verified: !!match, match: match ?? null });
});

export default evidence;
