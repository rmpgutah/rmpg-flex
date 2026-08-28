import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mimeFromFilename, resolveUploadMime } from '../src/utils/uploadMime';

describe('resolveUploadMime', () => {
  it('keeps a real browser Content-Type', () => {
    expect(resolveUploadMime('shot.JPG', 'image/jpeg')).toBe('image/jpeg');
  });

  it('infers JPEG when the browser sends an empty type', () => {
    expect(resolveUploadMime('evidence.jpg', '')).toBe('image/jpeg');
    expect(mimeFromFilename('photo.HEIC')).toBe('image/heic');
  });

  it('infers from the filename when the type is application/octet-stream', () => {
    expect(resolveUploadMime('scan.pdf', 'application/octet-stream')).toBe('application/pdf');
  });
});

describe('Dispatch Files upload self-heal', () => {
  const uploads = readFileSync(resolve(process.cwd(), 'src/routes/uploads.ts'), 'utf8');
  const db = readFileSync(resolve(process.cwd(), 'src/utils/db.ts'), 'utf8');

  it('adds missing attachments evidence columns before INSERT (mig 0260)', () => {
    expect(db).toMatch(/export async function ensureAttachmentEvidenceColumns/);
    expect(uploads).toMatch(/await ensureAttachmentEvidenceColumns\(db\)/);
  });

  it('does not bind NaN entity_id from a non-numeric CFS string', () => {
    expect(uploads).toContain('.test(entityIdRaw)');
  });
});
