// test-workers/redactions.test.ts
// Miniflare route smoke test for POST /api/redactions: a client-produced redacted
// MP4 + metadata is stored to R2 + a video_redactions custody row, then listed and
// downloaded back. Runs against real Miniflare D1/R2 bindings.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import app from './entry';

async function execute(db: D1Database, sql: string): Promise<void> {
  await db.prepare(sql).run();
}

async function ensureBodycamTables(): Promise<void> {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, full_name TEXT, badge_number TEXT)`);
  await execute(db, `CREATE TABLE IF NOT EXISTS body_cameras (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    officer_id INTEGER NOT NULL,
    camera_id TEXT NOT NULL UNIQUE,
    make TEXT,
    model TEXT,
    firmware_version TEXT,
    storage_capacity_gb INTEGER DEFAULT 32,
    status TEXT NOT NULL DEFAULT 'available',
    condition TEXT NOT NULL DEFAULT 'good',
    assigned_at TEXT,
    returned_at TEXT,
    notes TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS bodycam_videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    camera_id INTEGER NOT NULL,
    officer_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER NOT NULL DEFAULT 0,
    duration_seconds INTEGER,
    mime_type TEXT DEFAULT 'video/mp4',
    recorded_at TEXT,
    case_number TEXT,
    classification TEXT DEFAULT 'routine',
    retention_status TEXT DEFAULT 'active',
    redacted_path TEXT,
    notes TEXT,
    uploaded_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);

  const existingUser = await db.prepare(`SELECT id FROM users WHERE id = 1`).first();
  if (!existingUser) {
    await db.prepare(`INSERT INTO users (id, full_name, badge_number) VALUES (1, 'Test Officer', 'T-1')`).run();
  }
}

describe('POST /api/redactions — stores the redacted MP4 + custody row', () => {
  beforeAll(async () => { await ensureBodycamTables(); });

  it('persists the file to R2 and a custody record, then lists + downloads it', async () => {
    const fd = new FormData();
    fd.append('video', new Blob([new Uint8Array([0, 0, 0, 24])], { type: 'video/mp4' }), 'redacted.mp4');
    fd.append('metadata', JSON.stringify({ event_id: 42, kinds: ['face', 'license_plate'], region_count: 3, style: 'blur' }));

    const res = await app.request('/api/redactions', { method: 'POST', body: fd }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { id: number; download_url: string };
    expect(body.id).toBeGreaterThan(0);

    const list = await app.request('/api/redactions?event_id=42', {}, env as unknown as Record<string, unknown>);
    const listBody = await list.json() as { redactions: Array<{ id: number; kinds: string; region_count: number }> };
    expect(listBody.redactions[0].kinds).toContain('face');
    expect(listBody.redactions[0].region_count).toBe(3);

    const dl = await app.request(body.download_url, {}, env as unknown as Record<string, unknown>);
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-type')).toBe('video/mp4');
  });

  it('links a redaction to a bodycam video and mirrors redacted_path onto bodycam_videos', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    await db.prepare(
      `INSERT INTO body_cameras (officer_id, camera_id, status, storage_capacity_gb) VALUES (1, 'TEST-CAM-2', 'assigned', 32)`
    ).run();
    const cam = await db.prepare(`SELECT id FROM body_cameras WHERE camera_id = 'TEST-CAM-2'`).first<{ id: number }>();
    const video = await db.prepare(
      `INSERT INTO bodycam_videos (camera_id, officer_id, title, file_path, file_size, mime_type, classification, uploaded_by)
       VALUES (?, 1, 'Redaction target', 'bodycam-videos/redact-uuid/original.mp4', 1024, 'video/mp4', 'routine', 'test-officer')`
    ).bind(cam!.id).run();
    const videoId = Number(video.meta.last_row_id);

    const fd = new FormData();
    fd.append('video', new Blob([new Uint8Array([0, 0, 0, 24])], { type: 'video/mp4' }), 'redacted.mp4');
    fd.append('metadata', JSON.stringify({ source_bodycam_video_id: videoId, kinds: ['face'], region_count: 1, style: 'blur' }));

    const res = await app.request('/api/redactions', { method: 'POST', body: fd }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { id: number; r2_key: string };

    const list = await app.request(`/api/redactions?bodycam_video_id=${videoId}`, {}, env as unknown as Record<string, unknown>);
    const listBody = await list.json() as { redactions: Array<{ id: number; source_bodycam_video_id: number }> };
    expect(listBody.redactions[0].source_bodycam_video_id).toBe(videoId);

    const updated = await db.prepare('SELECT redacted_path FROM bodycam_videos WHERE id = ?').bind(videoId).first<{ redacted_path: string }>();
    expect(updated?.redacted_path).toBe(body.r2_key);
  });
});
