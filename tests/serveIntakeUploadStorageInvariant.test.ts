import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, '..', 'src', 'routes', 'serveIntake.ts'), 'utf8');

describe('serve intake upload persistence invariant', () => {
  it('never converts an R2 storage failure into a null document key', () => {
    expect(source).not.toMatch(/storeToR2\([^\n]+\)\.catch\(\(\)\s*=>\s*null\)/);
  });

  it('fails before committing intake records when document storage fails', () => {
    const storageFailure = source.indexOf("code: 'UPLOAD_STORAGE_FAILED'");
    const commit = source.indexOf('commit = await commitIntake', storageFailure);
    expect(storageFailure).toBeGreaterThan(-1);
    expect(commit).toBeGreaterThan(storageFailure);
  });

  it('rolls back every possible partial write in a failed multi-file upload', () => {
    expect(source).toContain('Promise.allSettled(');
    expect(source).toContain('c.env.UPLOADS.delete(key)');
    expect(source).toContain('deleteEncryptionKey(db, key)');
    expect(source.indexOf('c.env.UPLOADS.delete(key)')).toBeLessThan(
      source.indexOf("code: 'UPLOAD_STORAGE_FAILED'"),
    );
  });
});
