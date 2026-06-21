import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/** Spec §6.10 — Fleet V2 directory must contain zero `as any` casts.
 *  Uses execFileSync (not execSync) with an argument array so no shell is
 *  invoked — defense-in-depth even though __dirname is not user input. */
describe('Fleet V2 type discipline', () => {
  it('contains zero `as any` casts under client/src/pages/fleet/v2/', () => {
    const v2Dir = resolve(__dirname, '../'); // client/src/pages/fleet/v2/
    let out = '';
    try {
      out = execFileSync(
        'grep',
        ['-rn', 'as any', v2Dir, '--include=*.ts', '--include=*.tsx'],
        { encoding: 'utf-8' }
      );
    } catch {
      // grep exits 1 when no matches found — that's the success case here.
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
