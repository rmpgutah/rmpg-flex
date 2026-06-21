import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

/** Spec §6.10 — Fleet V2 directory must contain zero `as any` casts. */
describe('Fleet V2 type discipline', () => {
  it('contains zero `as any` casts under client/src/pages/fleet/v2/', () => {
    const root = resolve(__dirname, '../../../../..'); // up to client/
    let out = '';
    try {
      out = execSync(
        `grep -rn "as any" "${root}/src/pages/fleet/v2/" --include="*.ts" --include="*.tsx" || true`,
        { encoding: 'utf-8' }
      );
    } catch {
      out = '';
    }
    // Exclude this test file itself from the check.
    const hits = out.split('\n').filter((l) => l && !l.includes('no-as-any.test.ts'));
    if (hits.length > 0) {
      // eslint-disable-next-line no-console
      console.error('Forbidden `as any` casts found:\n' + hits.join('\n'));
    }
    expect(hits).toEqual([]);
  });
});
