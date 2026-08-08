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
import { createHash } from 'node:crypto';
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

  // Content ratchet — defense in depth alongside the denylist above.
  //
  // The denylist only catches the SPECIFIC known real names it lists. It says
  // nothing about any other content change — including a wholesale re-paste of
  // a different real packet that happens to avoid those particular names. This
  // ratchet pins the exact bytes of each fixture to a hash recorded here, so
  // ANY edit to fixture content — not just a re-paste of a known name — fails
  // this test and forces a deliberate, reviewed update.
  //
  // These hashes were computed from the current fixture files on disk, not
  // derived from re-reading the same file inside the test (which would just
  // assert the file equals itself and prove nothing).
  const FIXTURE_HASHES: Record<string, string> = {
    'business-subpoena': '587a3e461084e351b574f5f8cd3eb4c5e1609859d4b9410eedebd7d9a2e7529f',
    'individual-employment': 'aff0a7be446fb962997e62710eacddb375dd2976047d4eb9e89003653db8fccc',
  };

  it('fixture content matches its recorded hash (content ratchet)', () => {
    for (const name of Object.keys(FIXTURE_HASHES)) {
      const raw = readFileSync(join(FIXTURE_DIR, `${name}.txt`));
      const actual = createHash('sha256').update(raw).digest('hex');
      expect(
        actual,
        `${name}.txt content changed (hash ${actual} != recorded ${FIXTURE_HASHES[name]}). ` +
          `If this is an intentional, reviewed edit to SYNTHETIC content, verify the new text ` +
          `still contains no real names/case data (see the denylist test above and the README), ` +
          `then update FIXTURE_HASHES['${name}'] in tests/serveIntakeFixtures.test.ts to the new ` +
          `hash. If you did NOT intentionally edit this fixture, treat this failure as a real ` +
          `packet possibly having been pasted in and stop.`
      ).toBe(FIXTURE_HASHES[name]);
    }
  });
});

describe('vision fixture corpus integrity', () => {
  const VISION_DIR = join(__dirname, 'fixtures', 'serve-intake', 'vision');
  const VISION_FIXTURES = ['watermark-bleed', 'homoglyph-address'];

  function loadVisionSvg(name: string): string {
    return readFileSync(join(VISION_DIR, `${name}.svg`), 'utf8');
  }

  it('carries no real client identities', () => {
    const forbidden = ['Telarus', 'Anderson', 'Clough', 'Foothill', 'Telarus, LLC', 'Currie'];
    for (const name of VISION_FIXTURES) {
      const svg = loadVisionSvg(name);
      for (const f of forbidden) {
        expect(svg.toLowerCase()).not.toContain(f.toLowerCase());
      }
    }
  });

  it('every vision fixture has an expected-vision block', () => {
    const expected = JSON.parse(readFileSync(join(VISION_DIR, 'expected-vision.json'), 'utf8'));
    expect(Object.keys(expected).sort()).toEqual([...VISION_FIXTURES].sort());
  });

  // Content ratchet — same rationale as FIXTURE_HASHES above: pins the exact
  // SVG source bytes so any edit (not just a re-paste of a known forbidden
  // name) is caught and forces a deliberate, reviewed hash update.
  const VISION_FIXTURE_HASHES: Record<string, string> = {
    'watermark-bleed': 'e9ede417dc91f028630c344787dd6dd3bd04d45e1393c0d5fe5c045cd8e47a79',
    'homoglyph-address': '92c84c504da242427ea58c777c086391cce37d3717e4a75ab53c01f680de0ff5',
  };

  it('vision fixture content matches its recorded hash (content ratchet)', () => {
    for (const name of VISION_FIXTURES) {
      const raw = readFileSync(join(VISION_DIR, `${name}.svg`));
      const actual = createHash('sha256').update(raw).digest('hex');
      expect(
        actual,
        `${name}.svg content changed (hash ${actual} != recorded ${VISION_FIXTURE_HASHES[name]}). ` +
          `If this is an intentional, reviewed edit to SYNTHETIC content, verify the new SVG text ` +
          `still contains no real names/case data, then update VISION_FIXTURE_HASHES['${name}'] in ` +
          `tests/serveIntakeFixtures.test.ts to the new hash, and re-run ` +
          `scripts/generate-vision-ab-fixtures.ts to regenerate the matching .png.`
      ).toBe(VISION_FIXTURE_HASHES[name]);
    }
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
