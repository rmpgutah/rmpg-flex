import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('digital evidence file routes', () => {
  it('encrypts uploads with the Worker env and serves by id, not a plaintext placeholder', () => {
    const src = readFileSync(join(__dirname, '../src/routes/evidence.ts'), 'utf8');
    expect(src).toContain('putEncrypted(c.env.UPLOADS, db, c.env,');
    expect(src).toContain("evidence.get('/digital/:id/file'");
    expect(src).toContain("evidence.get('/digital/file/*'");
    expect(src).not.toContain('File content placeholder');
    expect(src).not.toMatch(/UPLOADS\.put\(r2Key/);
  });
});
