import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const files = [
  'client/src/pages/AuditLogPage.tsx',
  'client/src/pages/records/BusinessTab.tsx',
];

describe('SPA no longer bypasses the zone proxy', () => {
  it('has no remaining directWorker: true call sites', () => {
    for (const rel of files) {
      const src = readFileSync(resolve(process.cwd(), rel), 'utf8');
      expect(src, rel).not.toMatch(/directWorker:\s*true/);
    }
  });
});
