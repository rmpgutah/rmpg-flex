// ============================================================
// storageAdapter — filesystem implementation tests (Option A)
// ============================================================
// Path layout (per design decision):
//   ${baseDir}/${YYYY-MM-DD}/unit-${unit_id}/${artifact_id}-${safeFilename}
// Date comes from captured_at; unit_id absent → 'unit-unknown'.
//
// Verifies:
//   1. Writes buffer to expected path, returns file:// URI + size
//   2. Sanitizes filenames — strips path separators, dotdot, control chars
//   3. Rejects path traversal even after sanitization (defense in depth)
//   4. Creates intermediate dirs
//   5. Round-trips body via get()
//   6. get() rejects URIs that resolve outside baseDir
//   7. Handles missing unit_id, missing filename
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createFilesystemStorage } from '../storageAdapter';

let baseDir: string;
beforeEach(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flex-evidence-test-'));
});
afterEach(() => {
  fs.rmSync(baseDir, { recursive: true, force: true });
});

describe('createFilesystemStorage — put()', () => {
  it('writes buffer to date/unit/artifact path and returns file:// URI', async () => {
    const storage = createFilesystemStorage(baseDir);
    const body = Buffer.from('clip bytes');
    const result = await storage.put({
      body,
      sha256: 'a'.repeat(64),
      artifact_type: 'driving_event_clip',
      artifact_id: 9871,
      unit_id: 12,
      captured_at: '2026-04-28 12:00:00',
      filename: 'front.mp4',
    });

    expect(result.size_bytes).toBe(body.length);
    expect(result.storage_uri).toMatch(/^file:\/\//);
    expect(result.storage_uri).toContain('2026-04-28');
    expect(result.storage_uri).toContain('unit-12');
    expect(result.storage_uri).toContain('9871-front.mp4');

    const expectedPath = path.join(baseDir, '2026-04-28', 'unit-12', '9871-front.mp4');
    expect(fs.existsSync(expectedPath)).toBe(true);
    expect(fs.readFileSync(expectedPath)).toEqual(body);
  });

  it('parses date from ISO captured_at with T separator', async () => {
    const storage = createFilesystemStorage(baseDir);
    const result = await storage.put({
      body: Buffer.from('x'),
      sha256: 'a'.repeat(64),
      artifact_type: 'driving_event_clip',
      artifact_id: 1,
      unit_id: 5,
      captured_at: '2026-04-28T12:00:00Z',
      filename: 'a.mp4',
    });
    expect(result.storage_uri).toContain('2026-04-28');
  });

  it('uses unit-unknown when unit_id is missing', async () => {
    const storage = createFilesystemStorage(baseDir);
    const result = await storage.put({
      body: Buffer.from('x'),
      sha256: 'a'.repeat(64),
      artifact_type: 'driving_event_clip',
      artifact_id: 1,
      captured_at: '2026-04-28 12:00:00',
      filename: 'a.mp4',
    });
    expect(result.storage_uri).toContain('unit-unknown');
  });

  it('uses default filename when not provided', async () => {
    const storage = createFilesystemStorage(baseDir);
    const result = await storage.put({
      body: Buffer.from('x'),
      sha256: 'a'.repeat(64),
      artifact_type: 'driving_event_clip',
      artifact_id: 42,
      unit_id: 5,
      captured_at: '2026-04-28 12:00:00',
    });
    expect(result.storage_uri).toContain('42-clip');
  });
});

describe('createFilesystemStorage — filename sanitization', () => {
  it('strips path separators from filenames', async () => {
    const storage = createFilesystemStorage(baseDir);
    const result = await storage.put({
      body: Buffer.from('x'),
      sha256: 'a'.repeat(64),
      artifact_type: 'driving_event_clip',
      artifact_id: 1,
      unit_id: 5,
      captured_at: '2026-04-28 12:00:00',
      filename: 'sub/dir/evil.mp4',
    });
    // Resolved path must stay inside baseDir, no extra dirs created.
    expect(result.storage_uri).not.toContain('sub/dir');
    const dirEntries = fs.readdirSync(path.join(baseDir, '2026-04-28', 'unit-5'));
    expect(dirEntries.some(f => f.includes('evil.mp4'))).toBe(true);
    expect(dirEntries.some(f => f.includes('sub'))).toBe(false);
  });

  it('rejects path traversal in filename', async () => {
    const storage = createFilesystemStorage(baseDir);
    const result = await storage.put({
      body: Buffer.from('x'),
      sha256: 'a'.repeat(64),
      artifact_type: 'driving_event_clip',
      artifact_id: 1,
      unit_id: 5,
      captured_at: '2026-04-28 12:00:00',
      filename: '../../../../etc/passwd',
    });
    // Sanitized filename must NOT escape baseDir.
    const resolved = result.storage_uri.replace(/^file:\/\//, '');
    expect(resolved.startsWith(baseDir)).toBe(true);
  });

  it('strips NUL bytes and control chars from filename', async () => {
    const storage = createFilesystemStorage(baseDir);
    const result = await storage.put({
      body: Buffer.from('x'),
      sha256: 'a'.repeat(64),
      artifact_type: 'driving_event_clip',
      artifact_id: 1,
      unit_id: 5,
      captured_at: '2026-04-28 12:00:00',
      filename: 'evil\x00\x01\x02name.mp4',
    });
    expect(result.storage_uri).not.toContain('\x00');
    expect(result.storage_uri).toContain('evilname.mp4');
  });

  it('truncates excessively long filenames', async () => {
    const storage = createFilesystemStorage(baseDir);
    const longName = 'a'.repeat(500) + '.mp4';
    const result = await storage.put({
      body: Buffer.from('x'),
      sha256: 'a'.repeat(64),
      artifact_type: 'driving_event_clip',
      artifact_id: 1,
      unit_id: 5,
      captured_at: '2026-04-28 12:00:00',
      filename: longName,
    });
    // Some filesystems limit to 255 bytes; we cap before that.
    const resolved = result.storage_uri.replace(/^file:\/\//, '');
    expect(path.basename(resolved).length).toBeLessThanOrEqual(255);
  });
});

describe('createFilesystemStorage — get()', () => {
  it('round-trips body via put → get', async () => {
    const storage = createFilesystemStorage(baseDir);
    const body = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]); // jpeg-ish header
    const { storage_uri } = await storage.put({
      body,
      sha256: 'a'.repeat(64),
      artifact_type: 'driving_event_clip',
      artifact_id: 1,
      unit_id: 5,
      captured_at: '2026-04-28 12:00:00',
      filename: 'a.mp4',
    });

    const got = await storage.get(storage_uri);
    expect(got).toEqual(body);
  });

  it('refuses URIs that resolve outside baseDir', async () => {
    const storage = createFilesystemStorage(baseDir);
    await expect(
      storage.get('file:///etc/passwd'),
    ).rejects.toThrow(/outside base/i);
  });

  it('refuses non-file:// URIs', async () => {
    const storage = createFilesystemStorage(baseDir);
    await expect(
      storage.get('s3://flex-evidence/x.mp4'),
    ).rejects.toThrow(/scheme/i);
  });
});

describe('createFilesystemStorage — write-once option (Phase 4)', () => {
  it('chmods the file to 0444 when writeOnce=true', async () => {
    const storage = createFilesystemStorage(baseDir, { writeOnce: true });
    const { storage_uri } = await storage.put({
      body: Buffer.from('lockme'),
      sha256: 'a'.repeat(64),
      artifact_type: 'driving_event_clip',
      artifact_id: 1,
      unit_id: 5,
      captured_at: '2026-04-28 12:00:00',
      filename: 'a.mp4',
    });
    const filePath = storage_uri.replace(/^file:\/\//, '');
    const stat = fs.statSync(filePath);
    // Mode masks: 0o777 isolates owner+group+other perms; we set 0o444 (read-only).
    // Some umasks may differ slightly across OS — check the read-only invariant.
    const mode = stat.mode & 0o777;
    expect(mode & 0o222).toBe(0); // No write bits set
    // Cleanup needs chmod first since the test fixture rmSync expects writable
    fs.chmodSync(filePath, 0o644);
  });

  it('leaves default 0644 when writeOnce=false (default)', async () => {
    const storage = createFilesystemStorage(baseDir);
    const { storage_uri } = await storage.put({
      body: Buffer.from('writable'),
      sha256: 'a'.repeat(64),
      artifact_type: 'driving_event_clip',
      artifact_id: 1,
      unit_id: 5,
      captured_at: '2026-04-28 12:00:00',
      filename: 'a.mp4',
    });
    const filePath = storage_uri.replace(/^file:\/\//, '');
    const stat = fs.statSync(filePath);
    expect(stat.mode & 0o200).not.toBe(0); // Owner write bit set
  });
});

describe('createFilesystemStorage — idempotency and overwrite', () => {
  it('refuses to overwrite an existing object at the same path', async () => {
    const storage = createFilesystemStorage(baseDir);
    const input = {
      body: Buffer.from('first'),
      sha256: 'a'.repeat(64),
      artifact_type: 'driving_event_clip',
      artifact_id: 1,
      unit_id: 5,
      captured_at: '2026-04-28 12:00:00',
      filename: 'a.mp4',
    };
    await storage.put(input);
    await expect(
      storage.put({ ...input, body: Buffer.from('second') }),
    ).rejects.toThrow(/already exists|EEXIST/i);
  });
});
