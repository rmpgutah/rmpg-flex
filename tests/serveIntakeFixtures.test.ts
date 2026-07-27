// ============================================================
// Serve Intake golden-fixture harness
// ============================================================
// Fixtures are SYNTHETIC derivatives — see tests/fixtures/serve-intake/README.md.
// This suite pins the DETERMINISTIC layer only (pre-clean + normalization).
// Model-dependent extraction accuracy is measured by the A/B harness in
// Task 5, which is opt-in because it spends neurons.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { precleanText } from '../src/utils/serveIntakePreclean';

const FIXTURE_DIR = join(__dirname, 'fixtures', 'serve-intake');

export function loadFixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, `${name}.txt`), 'utf8');
}

export function loadExpected(): Record<string, Record<string, string>> {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, 'expected.json'), 'utf8'));
}

describe('fixture corpus integrity', () => {
  it('carries no real client identities', () => {
    // Guard against a real packet being pasted in later. These are the
    // parties in the live packets this corpus was derived from.
    const forbidden = ['Telarus', 'Anderson', 'Clough', 'Foothill', 'Telarus, LLC', 'Currie'];
    for (const name of ['business-subpoena', 'individual-employment']) {
      const text = loadFixture(name);
      for (const f of forbidden) {
        expect(text.toLowerCase()).not.toContain(f.toLowerCase());
      }
    }
  });

  it('every fixture has an expected block', () => {
    const expected = loadExpected();
    expect(Object.keys(expected).sort()).toEqual(['business-subpoena', 'individual-employment']);
  });
});

describe('pre-clean against real hazards', () => {
  it('removes the RUSH watermark bleed from the business fixture', () => {
    const cleaned = precleanText(loadFixture('business-subpoena'));
    expect(cleaned).not.toMatch(/^\s*[HSUR]\s*$/m);
    // The real content around the bleed must survive.
    expect(cleaned).toContain('UT Subpoena');
    expect(cleaned).toContain('Northgate Logistics, LLC');
  });

  it('preserves the witness-fee instrument in the individual fixture', () => {
    const cleaned = precleanText(loadFixture('individual-employment'));
    expect(cleaned).toContain('Check VV787 $18.50');
  });

  it('preserves the client diligence schedule verbatim', () => {
    const cleaned = precleanText(loadFixture('individual-employment'));
    expect(cleaned).toContain('1 between 6AM-9AM');
    expect(cleaned).toContain('One attempt must be on Saturday or Sunday');
  });

  it('is idempotent across the whole corpus', () => {
    for (const name of ['business-subpoena', 'individual-employment']) {
      const once = precleanText(loadFixture(name));
      expect(precleanText(once)).toBe(once);
    }
  });
});
