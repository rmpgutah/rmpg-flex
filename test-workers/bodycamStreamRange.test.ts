// End-to-end Miniflare test for GET /api/personnel/bodycam-videos/:id/stream.
//
// The helper tests (tests/byteRangeR2.test.ts, test-workers/r2RangeUnsatisfiable.test.ts)
// prove getR2Range() maps R2's throw to a value. This one proves the ROUTE is
// actually wired to it: before the fix, an unsatisfiable Range on a bodycam
// stream let R2's throw reach the handler's catch and became a 500 via
// dbErrorResponse. Playback routes are the ones a <video> element hammers with
// seek-driven Range requests, so this is where a 500 costs the most.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import app from './entry';

const R2_KEY = 'bodycam-videos/range-test-uuid/original.mp4';
const SIZE = 2048;

let videoId: number;

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  const bucket = (env as unknown as { UPLOADS: R2Bucket }).UPLOADS;

  await db.prepare(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, full_name TEXT, badge_number TEXT)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS body_cameras (
    id INTEGER PRIMARY KEY AUTOINCREMENT, officer_id INTEGER NOT NULL,
    camera_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'available',
    storage_capacity_gb INTEGER DEFAULT 32,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS bodycam_videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT, camera_id INTEGER NOT NULL,
    officer_id INTEGER NOT NULL, title TEXT NOT NULL, file_path TEXT NOT NULL,
    file_size INTEGER NOT NULL DEFAULT 0, duration_seconds INTEGER,
    mime_type TEXT DEFAULT 'video/mp4', recorded_at TEXT, case_number TEXT,
    classification TEXT DEFAULT 'routine', retention_status TEXT DEFAULT 'active',
    notes TEXT, uploaded_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`).run();

  await db.prepare(`INSERT OR IGNORE INTO users (id, full_name, badge_number) VALUES (1, 'Test Officer', 'T-1')`).run();
  await db.prepare(`INSERT OR IGNORE INTO body_cameras (officer_id, camera_id, status) VALUES (1, 'TEST-CAM-RANGE', 'assigned')`).run();
  const cam = await db.prepare(`SELECT id FROM body_cameras WHERE camera_id = 'TEST-CAM-RANGE'`).first<{ id: number }>();
  const row = await db.prepare(
    `INSERT INTO bodycam_videos (camera_id, officer_id, title, file_path, file_size, mime_type, uploaded_by)
     VALUES (?, 1, 'Range target', ?, ?, 'video/mp4', 'test-officer')`,
  ).bind(cam!.id, R2_KEY, SIZE).run();
  videoId = Number(row.meta.last_row_id);

  await bucket.put(R2_KEY, new Uint8Array(SIZE));
});

const stream = (range?: string) =>
  app.request(
    `/api/personnel/bodycam-videos/${videoId}/stream`,
    range ? { headers: { Range: range } } : {},
    env as unknown as Record<string, unknown>,
  );

describe('GET /api/personnel/bodycam-videos/:id/stream — Range handling', () => {
  it('serves the full body as 200 with no Range header', async () => {
    const res = await stream();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Length')).toBe(String(SIZE));
  });

  it('serves a satisfiable range as 206', async () => {
    const res = await stream('bytes=0-99');
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe(`bytes 0-99/${SIZE}`);
    expect(res.headers.get('Content-Length')).toBe('100');
  });

  it('returns 416 — not 500 — when start > end', async () => {
    const res = await stream('bytes=100-50');
    expect(res.status).toBe(416);
    expect(res.headers.get('Content-Range')).toBe(`bytes */${SIZE}`);
  });

  it('returns 416 — not 500 — when start is past EOF', async () => {
    const res = await stream('bytes=99999999999-');
    expect(res.status).toBe(416);
    expect(res.headers.get('Content-Range')).toBe(`bytes */${SIZE}`);
  });

  it('returns 416 at the start==size boundary but 206 one byte earlier', async () => {
    expect((await stream(`bytes=${SIZE}-`)).status).toBe(416);
    const last = await stream(`bytes=${SIZE - 1}-`);
    expect(last.status).toBe(206);
    expect(last.headers.get('Content-Range')).toBe(`bytes ${SIZE - 1}-${SIZE - 1}/${SIZE}`);
  });

  it('treats an unparseable Range as absent (full 200), per the route policy', async () => {
    // Deliberate pre-existing behaviour, preserved: the <video> element just
    // re-requests on the next seek rather than seeing an error.
    const res = await stream('bytes=abc-def');
    expect(res.status).toBe(200);
  });
});
